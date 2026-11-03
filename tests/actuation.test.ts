import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConfig as createBaseConfig, createSession } from '../src/session.ts'

const createConfig = (...args: Parameters<typeof createBaseConfig>) => {
  const config = createBaseConfig(...args)
  config.control_mode = 'prescribed'
  return config
}

const close = (actual: number, expected: number, tolerance = 1e-10) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)

test('零速受限请求推动水平杆，执行器与水平外力分别做功并满足独立匀加速解', async () => {
  const config = createConfig('simple', 'equilibrium')
  config.physics.gravity_m_s2 = 0
  config.initial_state.theta_unwrapped_rad = Math.PI / 2
  config.timing.duration_s = 0.01
  Object.assign(config, {
    input_program: [{ at_s: 0, force_requested_N: 70, force_external_N: 2 }],
  })
  const session = createSession(config)
  session.start()
  session.advance(0.01)
  const output = session.read()
  // Independent horizontal-rod translation: S=.74kg, F=35+2=37N, a=50m/s².
  close(output.state.cart_x_m, 0.0025)
  close(output.state.cart_v_m_s, 0.5)
  const first = output.samples[0]!
  assert.equal(output.config.control_mode, 'prescribed')
  assert.equal(first.control_mode, 'prescribed')
  assert.equal(first.force_requested_N, 70)
  assert.equal(first.force_actual_N, 35)
  assert.equal(first.force_external_N, 2)
  assert.equal(first.actuator_power_W, 0)
  const last = output.samples.at(-1)!
  close(last.actuator_work_J, 0.0875)
  close(last.force_external_work_J, 0.005)
  close(last.torque_external_work_J, 0)
  close(last.energy_residual_J, 0)
  const bundle = await session.exportEvidence()
  assert.match(bundle.files['samples/chunk-000001.csv']!, /70,35,2,0/)
})

test('正反向驱动和制动每步限制绝对机械功率，达到速度上限只允许制动', () => {
  for (const direction of [-1, 1]) {
    for (const braking of [false, true]) {
      const config = createConfig('standard', 'equilibrium')
      config.physics.gravity_m_s2 = 0
      config.physics.power_max_W = 5
      config.initial_state.theta_unwrapped_rad = Math.PI / 2
      config.initial_state.cart_v_m_s = direction
      config.timing.sample_period_s = 0.001
      config.timing.duration_s = 0.02
      config.input_program = [{ at_s: 0, force_requested_N: direction * (braking ? -40 : 40) }]
      const session = createSession(config)
      session.start()
      session.advance(0.02)
      const output = session.read()
      close(output.samples[0]!.force_actual_N, direction * (braking ? -5 : 5))
      for (const sample of output.samples) {
        assert.ok(Math.abs(sample.actuator_power_W) <= 5 + 1e-12)
        assert.ok(Math.abs(sample.energy_residual_J) < 1e-9)
      }
      // Constant signed power, S=1.25kg: v²=v0²+2Pt/S.
      close(output.state.cart_v_m_s, direction * Math.sqrt(1 + (braking ? -0.16 : 0.16)), 1e-9)
    }
    const config = createConfig('standard', 'equilibrium')
    config.physics.gravity_m_s2 = 0
    config.initial_state.theta_unwrapped_rad = Math.PI / 2
    config.initial_state.cart_v_m_s = direction * 2
    config.input_program = [{ at_s: 0, force_requested_N: direction * 20 }]
    const session = createSession(config)
    session.start()
    session.advance(0.01)
    close(session.read().state.cart_v_m_s, direction * 2)
    assert.ok(session.read().samples.every((sample) => sample.force_actual_N === 0))
  }
})

test('外力造成超速保留连续状态、记录违规起止持续时间并永久取消正式资格', async () => {
  const config = createConfig('standard', 'equilibrium')
  config.physics.gravity_m_s2 = 0
  config.initial_state.theta_unwrapped_rad = Math.PI / 2
  config.initial_state.cart_v_m_s = 1.99
  config.timing.duration_s = 0.02
  config.input_program = [
    { at_s: 0, force_external_N: 12.5 },
    { at_s: 0.01, force_external_N: -12.5 },
  ]
  const session = createSession(config)
  session.start()
  session.advance(0.02)
  const output = session.read()
  assert.ok(output.samples.some((sample) => sample.cart_v_m_s > 2.08))
  close(output.state.cart_v_m_s, 1.99)
  const start = output.events.find((event) => event.event_type === 'overspeed_start')!
  const end = output.events.find((event) => event.event_type === 'overspeed_end')!
  assert.ok(start && end, '缺少逐步超速事件')
  assert.ok(
    start.payload.causes instanceof Array && start.payload.causes.includes('horizontal_external'),
  )
  close(Number(end.payload.duration_s), end.sim_time_s - start.sim_time_s)
  const bundle = await session.exportEvidence()
  assert.ok(JSON.parse(bundle.files['result.json']!).qualification_reasons.includes('overspeed'))
})

test('初始或同刻触边优先于输入，终止样本保留入射力与部分步分类做功', () => {
  for (const x of [1.5, 1.4999]) {
    const config = createConfig('simple', 'equilibrium')
    config.physics.gravity_m_s2 = 0
    config.initial_state = {
      cart_x_m: x,
      cart_v_m_s: 0.2,
      theta_unwrapped_rad: Math.PI / 2,
      theta_dot_rad_s: 0,
    }
    config.input_program = [{ at_s: x === 1.5 ? 0 : 0.001, force_external_N: 100 }]
    const session = createSession(config)
    session.start()
    session.advance(0.01)
    const output = session.read()
    assert.equal(output.status, 'stopped')
    assert.ok(!output.events.some((event) => event.event_type === 'input'))
    close(output.state.cart_v_m_s, 0.2)
    assert.equal(output.samples.at(-1)!.force_external_N, 0)
  }
})

test('外扰脉冲左闭右开，同刻先结束再开始，采样使用新输入且暂停不消费命令', () => {
  const config = createConfig('standard', 'equilibrium')
  config.physics.gravity_m_s2 = 0
  config.initial_state.theta_unwrapped_rad = Math.PI / 2
  config.timing.duration_s = 0.2
  config.input_program = [
    { at_s: 0, force_external_N: 2 },
    { at_s: 0.1, force_external_N: 3 },
    { at_s: 0.1, force_external_N: 0 },
  ]
  const session = createSession(config)
  session.start()
  session.advance(0.09)
  session.pause('background')
  const paused = session.read()
  session.advance(0.1)
  assert.deepEqual(session.read(), paused)
  session.resume()
  session.advance(0.02)
  const output = session.read()
  assert.equal(output.samples.find((sample) => sample.sim_time_s === 0.1)!.force_external_N, 3)
  assert.deepEqual(
    output.events
      .filter((event) => event.event_type === 'input' && event.sim_time_s === 0.1)
      .map((event) => event.payload.value),
    [0, 3],
  )
  close(output.state.cart_v_m_s, 0.184)
})

test('非法命令时刻、未知字段与非有限输入拒绝，已创建会话的输入和重置记录相互隔离', () => {
  for (const command of [
    { at_s: 0.0001, force_requested_N: 1 },
    { at_s: -0.001, force_external_N: 1 },
    { at_s: 11, force_external_N: 1 },
    { at_s: 0, force_requested_N: Infinity },
    { at_s: 0, unknown: 1 },
    { at_s: 0 },
  ]) {
    const config = createConfig('simple', 'release')
    Object.assign(config, { input_program: [command] })
    assert.throws(() => createSession(config), /输入/)
  }
  const config = createConfig('simple', 'equilibrium')
  config.input_program = [{ at_s: 0, force_requested_N: 100 }]
  const session = createSession(config)
  config.input_program[0]!.force_requested_N = 0
  session.start()
  session.advance(0.001)
  session.stop()
  const first = session.read()
  session.reset()
  assert.deepEqual(session.read().condition_intervals, [])
  assert.deepEqual(session.read().qualification_reasons, [])
  session.start()
  assert.equal(session.read().samples[0]!.force_requested_N, 100)
  assert.notEqual(session.read().experiment_id, first.experiment_id)
})

test('关节力矩与混合做功符合独立DOP853动量参考，两个工况的分类账本分别核验', async () => {
  const { readFileSync } = await import('node:fs')
  const { createActuationConfig } = await import('../src/actuator-benchmarks.ts')
  const reference = JSON.parse(
    readFileSync(new URL('../src/actuation-reference.json', import.meta.url), 'utf8'),
  )
  for (const preset of ['simple', 'standard'] as const) {
    for (const id of ['joint-torque', 'combined-work'] as const) {
      const config = createActuationConfig(preset, id)
      const oracle = reference.cases.find(
        (item: { preset: string; id: string }) => item.preset === preset && item.id === id,
      )
      assert.deepEqual(oracle.physics, config.physics)
      assert.deepEqual(oracle.initial_state, config.initial_state)
      assert.deepEqual(oracle.input_program, config.input_program)
      const session = createSession(config)
      session.start()
      session.advance(config.timing.duration_s)
      const output = session.read()
      assert.equal(output.status, 'completed')
      for (const point of oracle.points) {
        const sample = output.samples.find(
          (sample) => Math.abs(sample.sim_time_s - point.sim_time_s) < 1e-12,
        )!
        assert.ok(sample)
        for (const [index, column] of reference.columns.entries())
          close(Number(sample[column as keyof typeof sample]), point.values[index], 1e-7)
        assert.ok(Math.abs(sample.energy_residual_J) < 1e-7)
      }
      if (id === 'joint-torque') {
        const beforeEnd = output.samples.find((sample) => sample.sim_time_s === 0.1)!
        assert.equal(beforeEnd.torque_external_Nm, 0)
        close(
          beforeEnd.torque_external_work_J,
          0.1 * (beforeEnd.theta_unwrapped_rad - Math.PI),
          1e-10,
        )
        assert.equal(beforeEnd.force_external_work_J, 0)
        assert.equal(beforeEnd.actuator_work_J, 0)
        assert.ok(beforeEnd.theta_unwrapped_rad > Math.PI)
        assert.ok(beforeEnd.cart_x_m < 0)
      }
    }
  }
})

test('全部冻结受力场景分别导出独立结论，提前终止或修改输入不会获得通过', async () => {
  const { createActuationConfig, actuationCases } = await import('../src/actuator-benchmarks.ts')
  for (const preset of ['simple', 'standard'] as const) {
    for (const id of Object.keys(actuationCases) as (keyof typeof actuationCases)[]) {
      const config = createActuationConfig(preset, id)
      const session = createSession(config)
      session.start()
      session.advance(config.timing.duration_s)
      const bundle = await session.exportEvidence()
      const result = JSON.parse(bundle.files['result.json']!)
      assert.equal(result.actuation_assessment.status, 'passed', `${preset}/${id}`)
      assert.equal(result.formal_acceptance, 'not_eligible')
      assert.ok(result.actuation_assessment.metrics.length > 0)
      assert.ok(bundle.files['reference.json'])
      const events = session.read().events
      assert.ok(
        events.every(
          (event, index) => index === 0 || events[index - 1]!.sim_time_s <= event.sim_time_s,
        ),
      )
      if (id === 'force-limit') {
        const interval = result.condition_intervals.find(
          (item: { condition: string }) => item.condition === 'limit_force',
        )
        close(interval.duration_s, 0.02)
        assert.equal(interval.active_at_end, true)
      }
    }
  }
  const partial = createSession(createActuationConfig('simple', 'combined-work'))
  partial.start()
  partial.advance(0.01)
  partial.pause()
  const pausedExport = partial.exportEvidence()
  partial.resume()
  partial.advance(0.01)
  partial.stop()
  const paused = JSON.parse((await pausedExport).files['result.json']!)
  assert.equal(paused.status, 'paused')
  assert.equal(paused.sim_time_s, 0.01)
  assert.equal(paused.actuation_assessment.status, 'not_executed')
  assert.equal(
    JSON.parse((await partial.exportEvidence()).files['result.json']!).actuation_assessment.status,
    'invalid',
  )
  const changed = createActuationConfig('standard', 'joint-torque')
  changed.input_program![0]!.torque_external_Nm = 0.2
  const mismatch = createSession(changed)
  mismatch.start()
  mismatch.advance(0.2)
  assert.equal(
    JSON.parse((await mismatch.exportEvidence()).files['result.json']!).actuation_assessment.status,
    'blocked',
  )
})
