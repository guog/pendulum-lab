import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConfig, createSession } from '../src/session.ts'

const close = (actual: number, expected: number, tolerance = 1e-10) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)

test('观察窗口终点先结束外扰及请求力，再记录唯一终点样本和完整分类做功', async () => {
  const config = createConfig('standard', 'equilibrium')
  config.control_mode = 'prescribed'
  config.physics.gravity_m_s2 = 0
  config.initial_state.theta_unwrapped_rad = Math.PI / 2
  config.timing.duration_s = 0.1
  config.input_program = [
    { at_s: 0, force_requested_N: 1, force_external_N: 2 },
    { at_s: 0.1, force_requested_N: 0, force_external_N: 0, torque_external_Nm: 0 },
  ]
  const session = createSession(config)
  session.start()
  session.advance(0.1)
  const output = session.read()
  assert.equal(output.status, 'completed')
  const last = output.samples.at(-1)!
  assert.equal(last.sim_time_s, 0.1)
  assert.equal(last.force_requested_N, 0)
  assert.equal(last.force_actual_N, 0)
  assert.equal(last.force_external_N, 0)
  assert.equal(last.torque_external_Nm, 0)
  // S=1.25kg, a=3/1.25=2.4m/s², x(.1)=.012m; impulse ends after integration.
  close(last.cart_v_m_s, 0.24)
  close(last.cart_x_m, 0.012)
  close(last.actuator_work_J, 0.012)
  close(last.force_external_work_J, 0.024)
  close(last.energy_residual_J, 0)
  const endInputs = output.events.filter(
    (event) => event.event_type === 'input' && event.sim_time_s === 0.1,
  )
  assert.deepEqual(
    endInputs.map((event) => event.payload.field),
    ['force_external_N', 'torque_external_Nm', 'force_requested_N'],
  )
  assert.equal(output.events.at(-1)!.event_type, 'completed')
  assert.equal(output.samples.filter((sample) => sample.sim_time_s === 0.1).length, 1)
  const bundle = await session.exportEvidence()
  const lines = bundle.files['samples/chunk-000001.csv']!.trim().split('\n')
  const header = lines[0]!.split(',')
  const final = lines.at(-1)!.split(',')
  assert.equal(final[header.indexOf('force_external_N')], '0')
})

test('正反向跨入速度上限时按解析切换时刻分段，无自致超速或虚假做功', () => {
  for (const preset of ['simple', 'standard'] as const) {
    for (const direction of [-1, 1]) {
      for (const dt of [0.001, 0.0005]) {
        const config = createConfig(preset, 'equilibrium')
        config.control_mode = 'prescribed'
        config.physics.gravity_m_s2 = 0
        config.initial_state.theta_unwrapped_rad = Math.PI / 2
        config.initial_state.cart_v_m_s = direction * (config.physics.speed_max_m_s - 0.001)
        config.timing.physics_step_s = dt
        config.timing.sample_period_s = 0.001
        config.timing.duration_s = 0.005
        config.input_program = [{ at_s: 0, force_requested_N: direction * 20 }]
        const session = createSession(config)
        session.start()
        session.advance(0.005)
        const output = session.read(),
          last = output.samples.at(-1)!
        // Independent translation cutoff: S=.74/1.25kg, v reaches vmax at 37/62.5μs.
        const expectedWork = preset === 'standard' ? 0.002499375 : 0.00184963
        const expectedX = preset === 'standard' ? 0.00999996875 : 0.0124999815
        close(last.cart_v_m_s, direction * config.physics.speed_max_m_s)
        close(last.cart_x_m, direction * expectedX)
        close(last.actuator_work_J, expectedWork)
        assert.ok(output.samples.every((sample) => Math.abs(sample.energy_residual_J) < 1e-10))
        assert.ok(
          output.samples.every(
            (sample) => Math.abs(sample.cart_v_m_s) <= config.physics.speed_max_m_s,
          ),
        )
        assert.ok(!output.qualification_reasons.includes('overspeed'))
        assert.ok(output.events.some((event) => event.event_type === 'limit_speed_direction_start'))
      }
    }
  }
})

test('限速切换前后触边都保留真实部分步轨迹与做功，同刻边界阻止后续命令', () => {
  for (const direction of [-1, 1]) {
    for (const gap of [0.00005, 0.0005]) {
      for (const dt of [0.001, 0.0005]) {
        const config = createConfig('standard', 'equilibrium')
        config.control_mode = 'prescribed'
        config.physics.gravity_m_s2 = 0
        config.initial_state = {
          cart_x_m: direction * (1 - gap),
          cart_v_m_s: direction * 1.999,
          theta_unwrapped_rad: Math.PI / 2,
          theta_dot_rad_s: 0,
        }
        config.timing.physics_step_s = dt
        config.input_program = [
          { at_s: 0, force_requested_N: direction * 20 },
          { at_s: 0.001, force_external_N: 50 },
        ]
        const session = createSession(config)
        session.start()
        session.advance(0.001)
        const output = session.read(),
          last = output.samples.at(-1)!
        const expectedTime =
          gap < 0.00012496875
            ? (2 * gap) / (Math.sqrt(1.999 ** 2 + 32 * gap) + 1.999)
            : 0.0000625 + (gap - 0.00012496875) / 2
        close(output.sim_time_s, expectedTime)
        close(last.cart_x_m, direction)
        close(last.actuator_work_J, 20 * Math.min(gap, 0.00012496875))
        close(last.energy_residual_J, 0)
        assert.equal(output.status, 'stopped')
        assert.ok(!output.qualification_reasons.includes('overspeed'))
        assert.ok(
          !output.events.some(
            (event) => event.event_type === 'input' && event.sim_time_s === 0.001,
          ),
        )
      }
    }
  }
  const config = createConfig('simple', 'equilibrium')
  config.physics.gravity_m_s2 = 0
  config.initial_state.cart_x_m = 1.4998
  config.initial_state.cart_v_m_s = 0.2
  config.timing.duration_s = 0.001
  config.input_program = [{ at_s: 0.001, force_external_N: 2 }]
  const session = createSession(config)
  session.start()
  session.advance(0.001)
  assert.equal(session.read().status, 'stopped')
  assert.ok(!session.read().events.some((event) => event.event_type === 'input'))
})

test('切断驱动后外力仍造成真实超速，不能以限速切换截断状态或恢复资格', () => {
  const config = createConfig('standard', 'equilibrium')
  config.control_mode = 'prescribed'
  config.physics.gravity_m_s2 = 0
  config.initial_state.theta_unwrapped_rad = Math.PI / 2
  config.initial_state.cart_v_m_s = 1.999
  config.timing.duration_s = 0.001
  config.input_program = [{ at_s: 0, force_requested_N: 20, force_external_N: 1 }]
  const session = createSession(config)
  session.start()
  session.advance(0.001)
  const output = session.read(),
    last = output.samples.at(-1)!
  // Independent piecewise translation: a_on=16.8, a_off=.8m/s².
  close(last.cart_v_m_s, 2 + 0.8 * (0.001 - 0.001 / 16.8))
  assert.ok(last.cart_v_m_s > 2)
  assert.equal(last.force_actual_N, 0)
  close(last.energy_residual_J, 0)
  assert.ok(output.qualification_reasons.includes('overspeed'))
  assert.ok(
    output.events.some(
      (event) =>
        event.event_type === 'overspeed_start' &&
        Array.isArray(event.payload.causes) &&
        event.payload.causes.includes('horizontal_external'),
    ),
  )
})

test('恒功率驱动跨入速度上限时分段做功，驱动力与绝对功率约束仍同时有效', () => {
  for (const direction of [-1, 1]) {
    for (const dt of [0.001, 0.0005]) {
      const config = createConfig('standard', 'equilibrium')
      config.control_mode = 'prescribed'
      config.physics.gravity_m_s2 = 0
      config.physics.power_max_W = 5
      config.initial_state.theta_unwrapped_rad = Math.PI / 2
      config.initial_state.cart_v_m_s = direction * 1.999
      config.timing.physics_step_s = dt
      config.timing.sample_period_s = 0.001
      config.timing.duration_s = 0.005
      config.input_program = [{ at_s: 0, force_requested_N: direction * 40 }]
      const session = createSession(config)
      session.start()
      session.advance(0.005)
      const output = session.read(),
        last = output.samples.at(-1)!
      // Constant power until cutoff: ΔK=.625*(4−1.999²)=.002499375J.
      close(last.cart_v_m_s, direction * 2)
      close(last.actuator_work_J, 0.002499375)
      assert.ok(output.samples.every((sample) => Math.abs(sample.actuator_power_W) <= 5 + 1e-12))
      assert.ok(output.samples.every((sample) => Math.abs(sample.energy_residual_J) < 1e-10))
      assert.ok(!output.qualification_reasons.includes('overspeed'))
    }
  }
})
