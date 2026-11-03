import { createSession, type SessionOutput } from './session.ts'
import {
  physicsBenchmarkInputs,
  benchmarkVersion,
  type BenchmarkInput,
} from './benchmark-inputs.ts'
import type { PresetId } from './config.ts'
import { sha256 } from './evidence.ts'
import reference from './physics-reference.json' with { type: 'json' }

export type VerificationStatus = 'not_executed' | 'blocked' | 'passed' | 'failed' | 'invalid'
export type Metric = { name: string; actual: number; limit: number; unit: string; basis: string }
export type BenchmarkCase = BenchmarkInput & {
  status: VerificationStatus
  reason: string
  metrics: Metric[]
  experiment_id: string | null
  sim_time_s: number
  ledger: {
    initial_energy_J: number
    kinetic_energy_J: number
    potential_energy_J: number
    mechanical_energy_J: number
    dissipated_energy_J: number
    actuator_work_J: number
    force_external_work_J: number
    torque_external_work_J: number
    energy_residual_J: number
  } | null
}
export type BenchmarkBundle = {
  schema_version: 1
  kind: 'pendulum-physics-benchmarks'
  batch_id: string
  files: Record<string, string>
}

function evaluate(id: string, output: SessionOutput, coarse?: SessionOutput): Metric[] {
  const initial = output.config.initial_state
  if (id.startsWith('equilibrium'))
    return [
      {
        name: '最大状态偏差',
        actual: Math.max(
          ...output.samples.flatMap((sample) =>
            (Object.keys(initial) as (keyof typeof initial)[]).map((key) =>
              Math.abs(sample[key] - initial[key]),
            ),
          ),
        ),
        limit: 0,
        unit: '各状态SI绝对差',
        basis: '指定整数π、零速度时，重力矩与全部阻力为零，状态应精确不变。',
      },
      {
        name: '能量绝对误差',
        actual: output.samples.reduce((maximum, sample) => {
          const p = output.config.physics
          const expected =
            id === 'equilibrium-down'
              ? 0
              : 2 *
                p.gravity_m_s2 *
                ((p.rod_mass_kg * p.rod_length_m) / 2 +
                  p.counterweight_mass_kg * p.counterweight_position_m)
          return Math.max(
            maximum,
            Math.abs(sample.kinetic_energy_J + sample.potential_energy_J - expected),
          )
        }, 0),
        limit: 1e-12,
        unit: 'J',
        basis: '下垂Eref=0J，用绝对误差≤1e-12J（声明尺度1J），不除以零；倒立Eref=2Ag。',
      },
    ]
  const expected = reference.cases.find(
    (entry) => entry.id === id && entry.preset === output.config.preset,
  )
  if (
    !expected ||
    JSON.stringify(expected.physics) !== JSON.stringify(output.config.physics) ||
    JSON.stringify(expected.initial_state) !== JSON.stringify(initial) ||
    expected.duration_s !== output.config.timing.duration_s
  )
    throw new Error('独立参考缺失或输入不一致')
  const maximum = (values: number[]) =>
    values.reduce((max, value) => Math.max(max, Math.abs(value)), 0)
  const metrics: Metric[] = []
  for (const [column, name, limit, unit] of [
    ['cart_x_m', '独立参考车位差', 1e-6, 'm'],
    ['cart_v_m_s', '独立参考车速差', 1e-5, 'm/s'],
    ['theta_unwrapped_rad', '独立参考角差', 1e-6, 'rad'],
    ['theta_dot_rad_s', '独立参考角速度差', 1e-4, 'rad/s'],
  ] as const) {
    const stateIndex = reference.columns.indexOf(column)
    metrics.push({
      name,
      actual: maximum(
        expected.points.map((point) => {
          const sample = output.samples.find(
            (sample) => Math.abs(sample.sim_time_s - point.sim_time_s) < 1e-10,
          )
          if (!sample) throw new Error('缺少独立参考对齐样本')
          return sample[column] - point.state[stateIndex]!
        }),
      ),
      limit,
      unit,
      basis: `${reference.version}；41个冻结时刻；累计角直接相减。`,
    })
  }
  const first = output.samples[0]!
  metrics.push({
    name: '初始机械能误差',
    actual: Math.abs(first.kinetic_energy_J + first.potential_energy_J - expected.initial_energy_J),
    limit: 1e-12,
    unit: 'J',
    basis: '独立质量积分：均匀杆+点质量，T=S v²/2−A cosθ vω+Bω²/2，V=Ag(1+cosθ)。',
  })
  if (id.startsWith('rotation'))
    metrics.push({
      name: '多圈不足量',
      actual: Math.max(
        0,
        4 * Math.PI - Math.abs(output.state.theta_unwrapped_rad - initial.theta_unwrapped_rad),
      ),
      limit: 0,
      unit: 'rad',
      basis: '累计角至少跨越两圈，不能使用规范化角替代。',
    })
  if (id === 'release')
    metrics.push({
      name: '未发生自然下落',
      actual: output.samples.some(
        (sample) =>
          sample.theta_unwrapped_rad > initial.theta_unwrapped_rad + 0.1 &&
          sample.potential_energy_J < first.potential_energy_J - 0.01,
      )
        ? 0
        : 1,
      limit: 0,
      unit: '布尔违规',
      basis: '显式水平释放后朝+π下落，重力势能转化为动能。',
    })
  const { total_mass_kg: mass, first_moment_kg_m: moment } = expected.mass_properties
  const momentum =
    mass * initial.cart_v_m_s -
    moment * Math.cos(initial.theta_unwrapped_rad) * initial.theta_dot_rad_s
  if (output.config.physics.cart_coulomb_N === 0 && output.config.physics.cart_viscous_N_s_m === 0)
    metrics.push({
      name: '水平质心运动误差',
      actual: maximum(
        output.samples.map(
          (sample) =>
            mass * (sample.cart_x_m - initial.cart_x_m) -
            moment *
              (Math.sin(sample.theta_unwrapped_rad) - Math.sin(initial.theta_unwrapped_rad)) -
            momentum * sample.sim_time_s,
        ),
      ),
      limit: 1e-7,
      unit: 'kg·m',
      basis: '无水平外力时，系统水平质心匀速；SΔx−AΔsinθ=Pₓ(0)t。',
    })
  if (['coulomb', 'cart-viscous', 'joint-viscous', 'combined-damping'].includes(id)) {
    metrics.push({
      name: '独立参考耗散误差',
      actual: maximum(
        expected.points.map(
          (point) =>
            output.samples.find((sample) => Math.abs(sample.sim_time_s - point.sim_time_s) < 1e-10)!
              .dissipated_energy_J - point.dissipated_energy_J,
        ),
      ),
      limit: 1e-7,
      unit: 'J',
      basis: `${reference.version}的独立耗散积分。`,
    })
    metrics.push({
      name: '耗散账本残差',
      actual: maximum(
        output.samples.map(
          (sample) =>
            sample.kinetic_energy_J +
            sample.potential_energy_J +
            sample.dissipated_energy_J -
            expected.initial_energy_J,
        ),
      ),
      limit: 1e-7,
      unit: 'J',
      basis: '无驱动/外扰时 E(t)+D(t)=E(0)，D=∫[Fc v tanh(v/vs)+bc v²+bj ω²]dt。',
    })
    metrics.push({
      name: '耗散倒退量',
      actual: maximum(
        output.samples
          .slice(1)
          .map((sample, i) =>
            Math.min(0, sample.dissipated_energy_J - output.samples[i]!.dissipated_energy_J),
          ),
      ),
      limit: 1e-12,
      unit: 'J',
      basis: '全部阻力只能耗散；D(t)非负且单调递增。',
    })
    metrics.push({
      name: '缺少正耗散',
      actual: output.samples.at(-1)!.dissipated_energy_J > 0 ? 0 : 1,
      limit: 0,
      unit: '布尔违规',
      basis: '非零运动与非零阻力必须产生正耗散。',
    })
    if (id === 'coulomb' || id === 'cart-viscous') {
      const p = output.config.physics
      metrics.push({
        name: '解析车速误差',
        actual: maximum(
          output.samples.map(
            (sample) =>
              sample.cart_v_m_s -
              (id === 'coulomb'
                ? p.friction_smoothing_m_s *
                  Math.asinh(
                    Math.sinh(initial.cart_v_m_s / p.friction_smoothing_m_s) *
                      Math.exp(
                        (-p.cart_coulomb_N * sample.sim_time_s) / (mass * p.friction_smoothing_m_s),
                      ),
                  )
                : initial.cart_v_m_s *
                  Math.exp((-p.cart_viscous_N_s_m * sample.sim_time_s) / mass)),
          ),
        ),
        limit: 1e-8,
        unit: 'm/s',
        basis:
          '零重力水平静止杆：粘性v=v0 exp(-bt/S)；平滑库仑v=vs asinh[sinh(v0/vs) exp(-Fc t/(S vs))]。',
      })
    }
  }
  if (id === 'convergence-0.5ms') {
    if (!coarse || coarse.status !== 'completed') throw new Error('1ms基准未完整运行，收敛比较阻塞')
    for (const [column, name, limit, unit] of [
      ['cart_x_m', '两步长最大车位差', 0.001, 'm'],
      ['theta_unwrapped_rad', '两步长最大角差', Math.PI / 1800, 'rad'],
    ] as const) {
      if (coarse.samples.length !== output.samples.length) throw new Error('收敛轨迹样本未对齐')
      metrics.push({
        name,
        actual: maximum(
          output.samples.map((sample, i) => {
            const other = coarse.samples[i]!
            if (Math.abs(sample.sim_time_s - other.sim_time_s) > 1e-12)
              throw new Error('收敛轨迹时刻未对齐')
            return sample[column] - other[column]
          }),
        ),
        limit,
        unit,
        basis:
          '10s冻结光滑无控制场景，全部10001个共同1ms时刻直接比较原精度累计角和车位；角差≤0.1°，车位差≤1mm。',
      })
    }
  }
  if (id === 'energy-30s')
    metrics.push({
      name: '最大相对能量漂移',
      actual: maximum(
        output.samples.map(
          (sample) =>
            (sample.kinetic_energy_J + sample.potential_energy_J - expected.initial_energy_J) /
            Math.abs(expected.initial_energy_J),
        ),
      ),
      limit: 0.001,
      unit: '比例',
      basis: `Eref=${expected.initial_energy_J}J，非零；30s全部30001个物理步点最大|E−Eref|/|Eref|≤0.1%。`,
    })
  return metrics
}

export function createPhysicsBenchmarks(preset: PresetId) {
  const batch_id = crypto.randomUUID()
  const cases: BenchmarkCase[] = physicsBenchmarkInputs(preset).map((input) => ({
    ...input,
    status: 'not_executed',
    reason: '尚未执行',
    metrics: [],
    experiment_id: null,
    sim_time_s: 0,
    ledger: null,
  }))
  const sessions = new Map<string, ReturnType<typeof createSession>>()
  let index = 0
  let status: 'ready' | 'running' | 'paused' | 'completed' | 'stopped' = 'ready'
  return {
    start() {
      if (status !== 'ready') throw new Error('请新建基准批次')
      status = 'running'
    },
    advance() {
      if (status !== 'running') return
      const item = cases[index]!
      let session = sessions.get(item.id)
      if (!session) {
        session = createSession(item.config)
        sessions.set(item.id, session)
        session.start()
      }
      session.advance(1)
      const output = session.read()
      item.experiment_id = output.experiment_id
      item.sim_time_s = output.sim_time_s
      const first = output.samples[0]!
      const last = output.samples.at(-1)!
      item.ledger = {
        initial_energy_J: first.kinetic_energy_J + first.potential_energy_J,
        kinetic_energy_J: last.kinetic_energy_J,
        potential_energy_J: last.potential_energy_J,
        mechanical_energy_J: last.kinetic_energy_J + last.potential_energy_J,
        dissipated_energy_J: last.dissipated_energy_J,
        actuator_work_J: last.actuator_work_J,
        force_external_work_J: last.force_external_work_J,
        torque_external_work_J: last.torque_external_work_J,
        energy_residual_J: last.energy_residual_J,
      }
      if (output.status === 'running') return
      try {
        item.metrics =
          output.status === 'completed'
            ? evaluate(item.id, output, sessions.get('convergence-1ms')?.read())
            : []
        item.status =
          output.status !== 'completed'
            ? 'invalid'
            : item.metrics.every(
                  (metric) => Number.isFinite(metric.actual) && metric.actual <= metric.limit,
                )
              ? 'passed'
              : 'failed'
        item.reason =
          output.status === 'completed'
            ? '按冻结输入完成，逐项比较原始数据'
            : `提前结束：${output.status}；${JSON.stringify(output.events.at(-1))}；最后有效状态=${JSON.stringify(output.state)}`
      } catch (error) {
        item.status = 'blocked'
        item.reason = error instanceof Error ? error.message : String(error)
      }
      index++
      if (index === cases.length) status = 'completed'
    },
    pause() {
      if (status === 'running') {
        status = 'paused'
        sessions.get(cases[index]!.id)?.pause('background')
      }
    },
    resume() {
      if (status !== 'paused') throw new Error('基准未暂停')
      const session = sessions.get(cases[index]!.id)
      if (session?.read().status === 'paused') session.resume()
      status = 'running'
    },
    stop() {
      if (status === 'running' || status === 'paused') {
        sessions.get(cases[index]!.id)?.stop()
        cases[index]!.status = 'invalid'
        cases[index]!.reason = '批次被终止；保留已运行记录'
        status = 'stopped'
      }
    },
    read() {
      return structuredClone({
        batch_id,
        version: benchmarkVersion,
        status,
        active_case: cases[index]?.id ?? null,
        cases,
      })
    },
    async exportEvidence(): Promise<BenchmarkBundle> {
      if (status === 'ready' || status === 'running') throw new Error('请先暂停或结束基准再导出')
      const files: Record<string, string> = {}
      for (const [id, session] of sessions) {
        const bundle = await session.exportEvidence()
        for (const [path, content] of Object.entries(bundle.files))
          files[`experiments/${id}/${path}`] = content
      }
      files['results.json'] = JSON.stringify(this.read(), null, 2) + '\n'
      files['reference.json'] = JSON.stringify(reference, null, 2) + '\n'
      const entries = await Promise.all(
        Object.entries(files).map(async ([path, content]) => ({
          path,
          byte_length: new TextEncoder().encode(content).byteLength,
          sha256: await sha256(content),
        })),
      )
      files['manifest.json'] =
        JSON.stringify(
          {
            schema_version: 1,
            batch_id,
            version: benchmarkVersion,
            files: entries,
            persistence_confirmed: false,
          },
          null,
          2,
        ) + '\n'
      return { schema_version: 1, kind: 'pendulum-physics-benchmarks', batch_id, files }
    },
  }
}
export type BenchmarkOutput = ReturnType<ReturnType<typeof createPhysicsBenchmarks>['read']>
