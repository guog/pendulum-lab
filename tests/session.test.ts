import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConfig, createSession } from '../src/session.ts'

test('零重力无阻力基准按物理时间匀速运动，并完整记录10ms采样点', () => {
  const config = createConfig('simple', 'equilibrium')
  config.physics.gravity_m_s2 = 0
  config.initial_state.cart_v_m_s = 0.2
  const session = createSession(config)
  session.start()
  session.advance(0.025)

  const output = session.read()
  assert.equal(output.sim_time_s, 0.025)
  assert.ok(Math.abs(output.state.cart_x_m - 0.005) < 1e-12)
  assert.equal(output.state.cart_v_m_s, 0.2)
  assert.equal(output.state.theta_unwrapped_rad, Math.PI)
  assert.deepEqual(
    output.samples.map((sample) => sample.sim_time_s),
    [0, 0.01, 0.02],
  )
})

test('水平释放的有质量杆遵循重力动力学，而非匀速或预设动画', () => {
  const config = createConfig('standard', 'release')
  config.initial_state.theta_unwrapped_rad = Math.PI / 2
  const session = createSession(config)
  session.start()
  session.advance(0.001)

  const output = session.read()
  // 水平零速瞬间：由独立的重力矩/绕轴惯量计算，角加速度为30.9789473684rad/s²。
  assert.ok(Math.abs(output.state.theta_dot_rad_s - 0.0309789473684) < 1e-8)
  assert.ok(output.state.theta_unwrapped_rad > Math.PI / 2)
  assert.ok(output.state.cart_x_m < 0)
})

test('暂停不推进物理时间，继续保留状态，重置生成全新实验', () => {
  const session = createSession(createConfig('standard', 'release'))
  session.start()
  session.advance(0.025)
  session.pause('background')
  const paused = session.read()
  session.advance(1)
  assert.deepEqual(session.read(), paused)
  assert.equal(paused.status, 'paused')
  session.resume()
  session.advance(0.005)
  session.stop()
  const ended = session.read()
  assert.equal(ended.sim_time_s, 0.03)
  assert.equal(ended.status, 'stopped')
  assert.deepEqual(
    ended.events.map((event) => event.event_type),
    ['start', 'pause', 'resume', 'stop'],
  )
  session.reset()
  const reset = session.read()
  assert.equal(reset.status, 'ready')
  assert.equal(reset.sim_time_s, 0)
  assert.equal(reset.samples.length, 0)
  assert.notEqual(reset.experiment_id, ended.experiment_id)
})

test('拒绝非法物理配置，并隔离外部对已创建配置的修改', () => {
  const invalid = createConfig('standard', 'release')
  invalid.physics.gravity_m_s2 = Number.NaN
  assert.throws(() => createSession(invalid), /gravity_m_s2/)
  const beyondRod = createConfig('standard', 'release')
  beyondRod.physics.counterweight_position_m = 0.6
  assert.throws(() => createSession(beyondRod), /counterweight_position_m/)

  const config = createConfig('standard', 'release')
  config.initial_state.theta_unwrapped_rad = Math.PI / 2
  const session = createSession(config)
  config.physics.gravity_m_s2 = 0
  session.start()
  session.advance(0.001)
  assert.ok(session.read().state.theta_dot_rad_s > 0.03)
  const output = session.read()
  output.config.physics.gravity_m_s2 = 0
  assert.equal(session.read().config.physics.gravity_m_s2, 9.81)
})

test('导出同一次实验的完整配置、原始CSV、事件、结果及可独立校验的清单', async () => {
  const session = createSession(createConfig('standard', 'release'))
  session.start()
  session.advance(0.025)
  session.stop()
  const bundle = await session.exportEvidence()
  assert.equal(bundle.kind, 'pendulum-research-bundle')
  assert.equal(bundle.schema_version, 1)
  const config = JSON.parse(bundle.files['config.json']!)
  assert.equal(config.experiment_id, bundle.experiment_id)
  assert.equal(config.schema_version, 1)
  assert.equal(config.physics.rod_mass_kg, 0.2)
  assert.equal(config.physics.counterweight_position_m, 0.25)
  const lines = bundle.files['samples/chunk-000001.csv']!.trim().split('\n')
  const columns = lines[0]!.split(',')
  assert.equal(lines.length, 5)
  const timeColumn = columns.indexOf('sim_time_s')
  assert.deepEqual(
    lines.slice(1).map((line) => Number(line.split(',')[timeColumn])),
    [0, 0.01, 0.02, 0.025],
  )
  const result = JSON.parse(bundle.files['result.json']!)
  assert.equal(result.formal_acceptance, 'not_eligible')
  assert.equal(result.execution_mode, 'memory-research')
  assert.equal(result.first_stable, 'not_executed')
  const { createHash } = await import('node:crypto')
  const manifest = JSON.parse(bundle.files['manifest.json']!)
  for (const file of manifest.files) {
    assert.equal(createHash('sha256').update(bundle.files[file.path]!).digest('hex'), file.sha256)
    assert.equal(Buffer.byteLength(bundle.files[file.path]!), file.byte_length)
  }
})

test('物理与采样周期相互独立，达到基准时长后精确结束且不静默取整输入', () => {
  const config = createConfig('simple', 'equilibrium')
  config.timing.physics_step_s = 0.0005
  config.timing.sample_period_s = 0.001
  config.timing.duration_s = 0.003
  const session = createSession(config)
  session.start()
  assert.throws(() => session.advance(0.0001), /物理步/)
  assert.throws(() => session.advance(Number.NaN), /时长/)
  session.advance(0.01)
  const output = session.read()
  assert.equal(output.status, 'completed')
  assert.equal(output.sim_time_s, 0.003)
  assert.deepEqual(
    output.samples.map((sample) => sample.sim_time_s),
    [0, 0.001, 0.002, 0.003],
  )
  assert.equal(output.state.theta_unwrapped_rad, Math.PI)
  assert.equal(output.state.cart_x_m, 0)
  assert.equal(output.events.at(-1)?.event_type, 'completed')
})

test('黏性阻力按解析匀速衰减基准耗散动能，能量账本可核验', () => {
  const config = createConfig('simple', 'equilibrium')
  config.physics.gravity_m_s2 = 0
  config.physics.cart_viscous_N_s_m = 0.37
  config.initial_state.theta_unwrapped_rad = Math.PI / 2
  config.initial_state.cart_v_m_s = 0.2
  const session = createSession(config)
  session.start()
  session.advance(0.2)
  const last = session.read().samples.at(-1)!
  // 杆水平、零重力：总质量0.74kg，v(0.2s)=0.2*exp(-0.1)。
  assert.ok(Math.abs(last.cart_v_m_s - 0.18096748360719192) < 1e-12)
  assert.ok(last.dissipated_energy_J > 0.0026)
  assert.ok(Math.abs(last.kinetic_energy_J + last.dissipated_energy_J - 0.0148) < 1e-12)
})

test('步内触边定位真实终止时刻，保留终点且不碰撞反弹', () => {
  const config = createConfig('simple', 'equilibrium')
  config.physics.gravity_m_s2 = 0
  config.initial_state.cart_x_m = 1.4999
  config.initial_state.cart_v_m_s = 0.2
  const session = createSession(config)
  session.start()
  session.advance(0.016)
  const output = session.read()
  assert.equal(output.status, 'stopped')
  assert.ok(Math.abs(output.sim_time_s - 0.0005) < 1e-11)
  assert.ok(Math.abs(output.state.cart_x_m - 1.5) < 1e-12)
  assert.equal(output.state.cart_v_m_s, 0.2)
  assert.equal(output.events.at(-1)?.event_type, 'boundary')
  assert.equal(output.samples.at(-1)?.sim_time_s, output.sim_time_s)
})

test('数值发散冻结在最后有效状态，导出不包含非法物理样本', async () => {
  const config = createConfig('standard', 'release')
  config.initial_state.theta_dot_rad_s = 1e50
  const session = createSession(config)
  session.start()
  const initial = session.read().state
  session.advance(0.001)
  const output = session.read()
  assert.equal(output.status, 'error')
  assert.equal(output.sim_time_s, 0)
  assert.deepEqual(output.state, initial)
  assert.equal(output.events.at(-1)?.event_type, 'numerical_error')
  assert.ok(
    output.samples.every((sample) =>
      Object.values(sample).every((value) => typeof value !== 'number' || Number.isFinite(value)),
    ),
  )
  const bundle = await session.exportEvidence()
  assert.equal(JSON.parse(bundle.files['result.json']!).status, 'error')
})

test('一次推进与分批推进产生相同的10秒原始轨迹，完整结束含1001个采样点', () => {
  const config = createConfig('standard', 'release')
  const whole = createSession(config)
  const batched = createSession(config)
  whole.start()
  batched.start()
  whole.advance(10)
  for (let i = 0; i < 625; i++) batched.advance(0.016)
  assert.equal(whole.read().status, 'completed')
  assert.equal(batched.read().status, 'completed')
  assert.equal(whole.read().samples.length, 1001)
  assert.deepEqual(batched.read().samples, whole.read().samples)
})

test('触边事件独立携带四状态与违规条件，含初始触边', () => {
  for (const position of [1.5, 1.4999]) {
    const config = createConfig('simple', 'equilibrium')
    config.physics.gravity_m_s2 = 0
    config.initial_state.cart_x_m = position
    config.initial_state.cart_v_m_s = 0.2
    const session = createSession(config)
    session.start()
    session.advance(0.016)
    const output = session.read()
    assert.deepEqual(output.events.at(-1)?.payload, {
      ...output.state,
      condition: 'abs(cart_x_m) >= track_length_m / 2',
      track_limit_m: 1.5,
    })
  }
})

test('导出请求逐次记事件且不添加重复样本，不冒称写盘已成功', async () => {
  const session = createSession(createConfig('standard', 'release'))
  session.start()
  session.advance(0.016)
  session.pause()
  const original = session.read()
  await session.exportEvidence()
  const bundle = await session.exportEvidence()
  const output = session.read()
  assert.deepEqual(output.samples, original.samples)
  assert.equal(output.sim_time_s, original.sim_time_s)
  const exports = output.events.filter((event) => event.event_type === 'export')
  assert.equal(exports.length, 2)
  assert.ok(exports.every((event) => event.sim_time_s === original.sim_time_s))
  assert.deepEqual(exports[0]?.payload, { stage: 'requested', persistence_confirmed: false })
  const exportedEvents = bundle.files['events/part-000001.jsonl']!.trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.equal(exportedEvents.filter((event) => event.event_type === 'export').length, 2)
})

test('步内触边后返回仍在首次触边终止，左右边界及两种物理步长一致', () => {
  const cases = [
    { x: 1.4999998, v: 0.0013, earliest: 0.0002, latest: 0.00022 },
    { x: 1.499999, v: 0.00264865, earliest: 0.0006, latest: 0.00063 },
  ]
  for (const scenario of cases) {
    for (const direction of [-1, 1]) {
      for (const physicsStep of [0.001, 0.0005]) {
        const config = createConfig('simple', 'release')
        config.physics.gravity_m_s2 = 0
        config.timing.physics_step_s = physicsStep
        config.initial_state = {
          cart_x_m: direction * scenario.x,
          cart_v_m_s: direction * scenario.v,
          theta_unwrapped_rad: (direction * Math.PI) / 2,
          theta_dot_rad_s: direction * 10,
        }
        const session = createSession(config)
        session.start()
        session.advance(0.001)
        const output = session.read()
        assert.equal(output.status, 'stopped')
        // 初加速度约-3.31m/s²的独立短时近似给出首次交点区间。
        // 第二例在0.5ms和1ms都位于轨道内，不能只增加半步抽查。
        assert.ok(output.sim_time_s > scenario.earliest && output.sim_time_s < scenario.latest)
        assert.ok(Math.abs(output.state.cart_x_m - direction * 1.5) < 1e-12)
        assert.ok(output.state.cart_v_m_s * direction > 0, '首次触边时仍向外运动')
        assert.equal(output.samples.at(-1)?.sim_time_s, output.sim_time_s)
        const boundaries = output.events.filter((event) => event.event_type === 'boundary')
        assert.equal(boundaries.length, 1)
        assert.equal(boundaries[0]?.sim_time_s, output.sim_time_s)
      }
    }
  }
})

test('合法整步时长不受浮点除法误差影响，非整步及超容量输入仍拒绝', () => {
  for (const physicsStep of [0.001, 0.0005]) {
    for (const [duration, count] of [
      [0.043, 6],
      [1.001, 102],
      [1.002, 102],
    ]) {
      const config = createConfig('simple', 'equilibrium')
      config.timing.physics_step_s = physicsStep
      config.timing.duration_s = duration
      const session = createSession(config)
      session.start()
      session.advance(duration)
      const output = session.read()
      assert.equal(output.status, 'completed')
      assert.ok(Math.abs(output.sim_time_s - duration) < 1e-12)
      assert.equal(output.samples.length, count)
      assert.equal(output.samples.at(-1)?.sim_time_s, output.sim_time_s)
    }
  }
  for (const duration of [0.0431, 0, -0.001, Number.NaN, Infinity, 600.001]) {
    const config = createConfig('simple', 'equilibrium')
    config.timing.duration_s = duration
    assert.throws(() => createSession(config), /时长/)
  }
  const maximum = createConfig('simple', 'equilibrium')
  maximum.timing.duration_s = 100
  maximum.timing.sample_period_s = 0.001
  assert.doesNotThrow(() => createSession(maximum))
  maximum.timing.duration_s = 100.001
  assert.throws(() => createSession(maximum), /容量/)
})
