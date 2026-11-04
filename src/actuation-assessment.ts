import type { Sample, SessionOutput } from './session.ts'
import {
  actuationCases,
  createActuationConfig,
  type ActuationCaseId,
} from './actuator-benchmarks.ts'
import reference from './actuation-reference.json' with { type: 'json' }

export const actuationAssessmentFormat = {
  version: 'actuation-assessment-2',
  requirement: 'P0-PHY-02/05',
} as const

export function assessActuation(output: SessionOutput) {
  const { config, samples, state, events } = output
  const id = config.benchmark
  if (!Object.hasOwn(actuationCases, id)) return null
  const metrics: { name: string; actual: number; limit: number; unit: string; basis: string }[] = []
  const result = (
    status: 'not_executed' | 'invalid' | 'blocked' | 'passed' | 'failed',
    reason: string,
  ) => ({
    ...actuationAssessmentFormat,
    status,
    reason,
    metrics,
  })
  if (output.status === 'ready' || output.status === 'running' || output.status === 'paused')
    return result('not_executed', '观察窗口尚未完整执行；未形成基准结论。')
  const frozen = createActuationConfig(config.preset, id as ActuationCaseId)
  for (const field of ['physics', 'initial_state', 'input_program', 'timing'] as const)
    if (JSON.stringify(config[field]) !== JSON.stringify(frozen[field]))
      return result('blocked', '输入与冻结基准不符，不套用原基准阈值。')
  if (
    id === 'rail-boundary'
      ? !events.some((event) => event.event_type === 'boundary')
      : output.status !== 'completed'
  )
    return result('invalid', '提前停止、触边或数值异常；完整基准不能判通过。')
  const metric = (name: string, actual: number, limit: number, unit: string, basis: string) =>
    metrics.push({ name, actual, limit, unit, basis })
  const check = (name: string, condition: boolean, basis: string) =>
    metric(name, condition ? 0 : 1, 0, '违规数', basis)
  const p = config.physics
  const mass = p.cart_mass_kg + p.rod_mass_kg + p.counterweight_mass_kg
  const t = output.sim_time_s
  const v0 = config.initial_state.cart_v_m_s
  metric(
    '最大力超限',
    Math.max(0, ...samples.map((s) => Math.abs(s.force_actual_N) - p.force_max_N)),
    1e-12,
    'N',
    '每物理步记录；驱动及制动均受最大力约束。',
  )
  metric(
    '最大绝对功率超限',
    Math.max(0, ...samples.map((s) => Math.abs(s.actuator_power_W) - p.power_max_W)),
    1e-12,
    'W',
    'abs(F×v)≤Pmax，包含负功率制动。',
  )
  check(
    '超速方向输入',
    samples.every(
      (s) => Math.abs(s.cart_v_m_s) < p.speed_max_m_s || s.force_actual_N * s.cart_v_m_s <= 0,
    ),
    '达到速度上限时不能主动继续加速；不截断连续状态。',
  )
  metric(
    '最大分类能量收支残差',
    Math.max(...samples.map((s) => Math.abs(s.energy_residual_J))),
    1e-7,
    'J',
    'E+D−E0−Wactuator−Whorizontal−Wtorque；不以外扰合计替代分类量。',
  )
  const last = samples.at(-1)!
  if (id === 'near-zero' || id === 'force-limit') {
    const force = id === 'near-zero' ? 1 : p.force_max_N
    metric(
      '匀加速车速误差',
      Math.abs(state.cart_v_m_s - v0 - (force * t) / mass),
      1e-9,
      'm/s',
      '零重力水平杆：总质量平移，v=v0+Ft/S。',
    )
    metric(
      '匀加速车位误差',
      Math.abs(state.cart_x_m - v0 * t - (force * t * t) / (2 * mass)),
      1e-9,
      'm',
      'x=v0t+Ft²/(2S)。',
    )
    metric(
      '执行器做功误差',
      Math.abs(last.actuator_work_J - force * state.cart_x_m),
      1e-9,
      'J',
      '恒力W=FΔx。',
    )
  }
  if (id === 'power-drive' || id === 'power-brake') {
    const power = id === 'power-drive' ? 5 : -5
    metric(
      '恒功率车速平方误差',
      Math.abs(state.cart_v_m_s ** 2 - v0 ** 2 - (2 * power * t) / mass),
      1e-8,
      'm²/s²',
      '独立关系：Δ(Sv²/2)=Pt。',
    )
    metric(
      '执行器恒功率做功误差',
      Math.abs(last.actuator_work_J - power * t),
      1e-8,
      'J',
      '正负功率均W=Pt。',
    )
  }
  if (id === 'speed-crossing' || id === 'speed-crossing-reverse') {
    const direction = Math.sign(v0)
    const delta = p.speed_max_m_s - Math.abs(v0)
    const switchTime = (mass * delta) / 20
    metric(
      '限速切换后车速误差',
      Math.abs(state.cart_v_m_s - direction * p.speed_max_m_s),
      1e-10,
      'm/s',
      '水平杆零重力：先匀加速到上限，再无驱动力匀速；不截断速度。',
    )
    metric(
      '限速切换后车位误差',
      Math.abs(state.cart_x_m - direction * (p.speed_max_m_s * t - (delta * switchTime) / 2)),
      1e-10,
      'm',
      '解析分段轨迹，切换时刻t*=S(vmax−|v0|)/20。',
    )
    metric(
      '限速切换执行器做功误差',
      Math.abs(last.actuator_work_J - (mass * (p.speed_max_m_s ** 2 - v0 ** 2)) / 2),
      1e-10,
      'J',
      '只有达到上限前做功，W=S(vmax²−v0²)/2。',
    )
    check(
      '无自致超速及限制事件',
      !output.qualification_reasons.includes('overspeed') &&
        events.some((event) => event.event_type === 'limit_speed_direction_start'),
      '纯执行器平移不应因积分切换制造超速，限制区间必须记录。',
    )
  }
  if (id === 'pulse-endpoint') {
    metric(
      '脉冲终点车速误差',
      Math.abs(state.cart_v_m_s - (3 * t) / mass),
      1e-10,
      'm/s',
      '请求1N、外力2N在[0,0.1s)保持，v=Ft/S。',
    )
    metric(
      '脉冲终点车位误差',
      Math.abs(state.cart_x_m - (3 * t * t) / (2 * mass)),
      1e-10,
      'm',
      'x=Ft²/(2S)。',
    )
    metric(
      '脉冲执行器做功误差',
      Math.abs(last.actuator_work_J - state.cart_x_m),
      1e-10,
      'J',
      '1N×位移。',
    )
    metric(
      '脉冲水平外力做功误差',
      Math.abs(last.force_external_work_J - 2 * state.cart_x_m),
      1e-10,
      'J',
      '2N×位移；终点归零不抹去已完成做功。',
    )
    check(
      '终点输入及事件',
      last.force_requested_N === 0 &&
        last.force_actual_N === 0 &&
        last.force_external_N === 0 &&
        last.torque_external_Nm === 0 &&
        events.filter((event) => event.event_type === 'input' && event.sim_time_s === t).length ===
          3,
      '正常完成前处理到期结束命令，再生成唯一终点样本。',
    )
  }
  if (id === 'speed-direction') {
    metric(
      '上限后制动车速误差',
      Math.abs(state.cart_v_m_s - v0 + 1 / mass),
      1e-9,
      'm/s',
      '前0.1s禁止正向加速，后0.1s施加−10N制动。',
    )
    check(
      '速度方向限制事件',
      events.some((event) => event.event_type === 'limit_speed_direction_start'),
      '限制起止须可审计。',
    )
  }
  if (id === 'external-overspeed' || id === 'coupling-overspeed') {
    check(
      '真实超速与取消资格',
      samples.some((s) => s.overspeed) && output.qualification_reasons.includes('overspeed'),
      '保留真实速度，超速后资格不能恢复。',
    )
    check(
      '超速分类原因',
      events.some(
        (event) =>
          event.event_type === 'overspeed_start' &&
          Array.isArray(event.payload.causes) &&
          event.payload.causes.includes(
            id === 'external-overspeed' ? 'horizontal_external' : 'coupling',
          ),
      ),
      '记录入射区间的外力或耦合原因。',
    )
    if (id === 'external-overspeed') {
      metric(
        '反向外力后车速误差',
        Math.abs(state.cart_v_m_s - v0),
        1e-9,
        'm/s',
        '等时长±10N冲量抵消；随后0.01s无外力。',
      )
      check(
        '超速区间恢复',
        events.some(
          (event) => event.event_type === 'overspeed_end' && event.payload.active_at_end === false,
        ),
        '恢复事件包含起止与持续时间。',
      )
    }
  }
  if (id === 'joint-torque' || id === 'combined-work') {
    const oracle = reference.cases.find((item) => item.id === id && item.preset === config.preset)
    if (!oracle) return result('blocked', '缺少独立动量参考。')
    for (const [index, column] of reference.columns.entries()) {
      let error = 0
      for (const point of oracle.points) {
        const sample = samples.find((s) => Math.abs(s.sim_time_s - point.sim_time_s) < 1e-12)
        if (!sample) return result('blocked', '缺少独立参考所需的真实采样点。')
        error = Math.max(
          error,
          Math.abs(Number(sample[column as keyof Sample]) - point.values[index]!),
        )
      }
      metric(
        `${column}参考误差`,
        error,
        1e-7,
        index < 4 ? 'SI' : 'J',
        '独立广义动量DOP853，两精度交叉验证；21个共同采样时刻。',
      )
    }
  }
  if (id === 'rail-boundary') {
    const acceleration = 3 / mass
    const expectedTime = 0.0002 / (Math.sqrt(0.04 + 0.0002 * acceleration) + 0.2)
    metric(
      '解析触边时间误差',
      Math.abs(t - expectedTime),
      1e-10,
      's',
      '零重力水平杆：解0.0001=0.2t+(3/S)t²/2。',
    )
    metric(
      '触边位置误差',
      Math.abs(state.cart_x_m - p.track_length_m / 2),
      1e-12,
      'm',
      '滑块中心有效行程，不扣视觉宽度。',
    )
    metric(
      '部分步执行器做功误差',
      Math.abs(last.actuator_work_J - 0.0001),
      1e-10,
      'J',
      '1N×0.0001m；不把完整步做功写入终止样本。',
    )
    metric(
      '部分步水平外力做功误差',
      Math.abs(last.force_external_work_J - 0.0002),
      1e-10,
      'J',
      '2N×0.0001m。',
    )
    check(
      '终止与安全区事件',
      state.cart_v_m_s > 0 &&
        events.some((e) => e.event_type === 'safety_buffer_start') &&
        !events.some((e) => e.event_type === 'input' && e.sim_time_s >= 0.001),
      '安全区告警；触边不反弹，不执行终止后的排队外力矩。',
    )
  }
  return metrics.every((item) => Number.isFinite(item.actual) && item.actual <= item.limit)
    ? result('passed', '该冻结物理基准已通过；不代表正式起摆、耐久或扰动恢复验收。')
    : result('failed', '超出冻结容差或缺失必要行为，保留全部证据。')
}
