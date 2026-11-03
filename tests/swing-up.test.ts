import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConfig, createSession } from '../src/session.ts'

test('自动起摆从精确静止下垂开始，控制输入主动启动并记录', () => {
  const session = createSession(createConfig('simple', 'swing-up'))
  session.start()
  const initial = session.read()
  assert.deepEqual(initial.state, {
    cart_x_m: 0,
    cart_v_m_s: 0,
    theta_unwrapped_rad: Math.PI,
    theta_dot_rad_s: 0,
  })
  assert.notEqual(initial.samples[0]?.force_requested_N, 0)
  session.advance(0.01)
  assert.notEqual(session.read().state.cart_x_m, 0)
})

test('首次稳定需要逐步连续五秒并产生同一时刻的完整快照', async () => {
  const session = createSession(createConfig('simple', 'swing-up'))
  session.start()
  session.advance(30)
  const output = session.read()
  assert.equal(output.first_stable.status, 'blocked')
  assert.equal(output.first_stable.physical_status, 'passed')
  assert.ok(output.first_stable.snapshot)
  assert.equal(output.first_stable.disturbance_eligibility, 'blocked_pending_export')
  assert.equal(output.config.physics.cart_coulomb_N, 0.2)
  assert.equal(output.config.physics.cart_viscous_N_s_m, 0.1)
  assert.equal(output.config.physics.joint_viscous_Nm_s_rad, 0.002)
  assert.deepEqual(output.first_stable.snapshot.config, output.config)
  assert.ok(output.first_stable.snapshot.sim_time_s <= 30)
  const entered = output.events.findLast((event) => event.event_type === 'stability_enter')!
  const completed = output.events.find((event) => event.event_type === 'first_stable')!
  assert.ok(Math.abs(completed.sim_time_s - entered.sim_time_s - 5) < 1e-9)
  assert.deepEqual(output.first_stable.snapshot.state, completed.payload.state)
  session.pause()
  const bundle = await session.exportEvidence()
  assert.equal(JSON.parse(bundle.files['result.json']!).first_stable.status, 'blocked')
  const saved = JSON.parse(bundle.files['snapshot.json']!)
  const { createHash } = await import('node:crypto')
  assert.equal(
    saved.config_sha256,
    createHash('sha256')
      .update(JSON.stringify(saved.config, null, 2) + '\n')
      .digest('hex'),
  )
})

test('用户中止的起摆没有合格快照，导出区分中止与控制失败', async () => {
  const session = createSession(createConfig('simple', 'swing-up'))
  session.start()
  session.advance(0.5)
  session.stop()
  const output = session.read()
  assert.equal(output.first_stable.status, 'invalid')
  assert.equal(output.first_stable.reason, 'user_stopped')
  assert.equal(output.first_stable.snapshot, null)
  assert.equal(output.first_stable.disturbance_eligibility, 'blocked')
  const bundle = await session.exportEvidence()
  assert.equal(JSON.parse(bundle.files['result.json']!).first_stable.status, 'invalid')
  assert.equal(bundle.files['snapshot.json'], undefined)
})

test('重置清除控制器状态并重现相同的受控轨迹', () => {
  const session = createSession(createConfig('simple', 'swing-up'))
  session.start()
  session.advance(2)
  const original = session.read()
  session.reset()
  assert.equal(session.read().controller?.state.updates, 0)
  session.start()
  session.advance(2)
  assert.deepEqual(session.read().samples, original.samples)
  assert.deepEqual(session.read().controller?.state, original.controller?.state)
})

test('控制器状态序列化后可恢复相同的后续输出', async () => {
  const { createController } = await import('../src/controller.ts')
  const config = createConfig('simple', 'swing-up')
  const original = createController(config.physics)
  original.update(config.initial_state, 0)
  const restored = createController(config.physics, JSON.parse(JSON.stringify(original.read())))
  const next = { ...config.initial_state, cart_x_m: 0.01, cart_v_m_s: 0.1, theta_dot_rad_s: 0.2 }
  assert.equal(restored.update(next, 0.01), original.update(next, 0.01))
  assert.deepEqual(restored.read(), original.read())
})

test('越界事件记录四状态并在首次进入合格区间前保留初始违规', () => {
  const session = createSession(createConfig('simple', 'swing-up'))
  session.start()
  session.advance(5)
  const violation = session
    .read()
    .events.find((event) => event.event_type === 'stability_violation')
  assert.ok(violation)
  assert.equal(violation.sim_time_s, 0)
  assert.equal(violation.payload.theta_unwrapped_rad, Math.PI)
  assert.equal(violation.payload.cart_x_m, 0)
  assert.equal(violation.payload.cart_v_m_s, 0)
  assert.equal(violation.payload.theta_dot_rad_s, 0)
})

test('改变简单工况的物理参数时不能得到正式候选快照', () => {
  const config = createConfig('simple', 'swing-up')
  config.physics.cart_coulomb_N = 0
  config.physics.cart_viscous_N_s_m = 0
  config.physics.joint_viscous_Nm_s_rad = 0
  const session = createSession(config)
  session.start()
  session.advance(30)
  const result = session.read()
  assert.equal(result.first_stable.physical_status, 'passed')
  assert.equal(result.first_stable.status, 'invalid')
  assert.equal(result.first_stable.physical_stable_since_s, 4.018)
  assert.equal(result.first_stable.physical_first_stable_s, 9.018)
  assert.equal(result.first_stable.snapshot, null)
  assert.ok(result.qualification_reasons.includes('nonstandard_config'))
})

test('控制预算超时时，已发生的安全区间在终止时关闭', (t) => {
  const config = createConfig('simple', 'swing-up')
  config.physics.safety_buffer_m = 1.49
  let slow = false
  let clock = 0
  t.mock.method(performance, 'now', () => (slow ? (clock += 20) : 0))
  const session = createSession(config)
  session.start()
  session.advance(0.6)
  assert.ok(
    session
      .read()
      .condition_intervals.some(
        (interval) => interval.condition === 'safety_buffer' && interval.end_time_s === null,
      ),
  )
  slow = true
  session.advance(0.01)
  const output = session.read()
  assert.equal(output.status, 'error')
  assert.ok(output.condition_intervals.some((interval) => interval.condition === 'safety_buffer'))
  assert.ok(output.condition_intervals.every((interval) => interval.end_time_s !== null))
})

test('读回确认同一证据后快照可用，旧版本或其他实验的确认被拒绝', async () => {
  const session = createSession(createConfig('simple', 'swing-up'))
  session.start()
  session.advance(30)
  session.pause()
  const bundle = await session.exportEvidence()
  const exported = session.read()
  assert.equal(exported.first_stable.disturbance_eligibility, 'blocked_pending_export')
  assert.throws(() => session.confirmExport('other', exported.events.length), /证据/)
  assert.throws(
    () => session.confirmExport(bundle.experiment_id, exported.events.length - 1),
    /证据/,
  )
  session.confirmExport(bundle.experiment_id, exported.events.length)
  assert.equal(session.read().first_stable.disturbance_eligibility, 'eligible')
  assert.equal(session.read().first_stable.status, 'passed')
  const confirmedBundle = await session.exportEvidence()
  assert.equal(
    JSON.parse(confirmedBundle.files['result.json']!).first_stable.disturbance_eligibility,
    'eligible',
  )
  session.reset()
  assert.equal(session.read().first_stable.disturbance_eligibility, 'blocked')
})

test('首次稳定之前确认的部分记录不能确认之后生成的快照', async () => {
  const session = createSession(createConfig('simple', 'swing-up'))
  session.start()
  session.advance(0.5)
  session.pause()
  const partial = await session.exportEvidence()
  session.confirmExport(partial.experiment_id, session.read().events.length)
  session.resume()
  session.advance(30)
  assert.ok(session.read().first_stable.snapshot)
  assert.equal(session.read().first_stable.status, 'blocked')
  assert.equal(session.read().first_stable.disturbance_eligibility, 'blocked_pending_export')
  session.pause()
  const complete = await session.exportEvidence()
  session.confirmExport(complete.experiment_id, session.read().events.length)
  assert.equal(session.read().first_stable.status, 'passed')
  assert.equal(session.read().first_stable.disturbance_eligibility, 'eligible')
})

test('标准工况自动起摆保持冻结物理参数与60秒时限', () => {
  const config = createConfig('standard', 'swing-up')
  assert.equal(config.timing.duration_s, 60)
  assert.equal(config.physics.rod_length_m, 0.5)
  assert.equal(config.physics.cart_mass_kg, 1)
  assert.equal(config.physics.track_length_m, 2)
  assert.equal(config.physics.force_max_N, 20)
  const session = createSession(config)
  session.start()
  assert.equal(session.read().state.theta_unwrapped_rad, Math.PI)
  assert.notEqual(session.read().samples[0]?.force_requested_N, 0)
})

test('标准工况使用自身冻结配置判定资格并导出真实结果', async () => {
  const session = createSession(createConfig('standard', 'swing-up'))
  session.start()
  session.advance(60)
  const result = session.read()
  assert.ok(!result.qualification_reasons.includes('nonstandard_config'))
  const bundle = await session.exportEvidence()
  assert.equal(JSON.parse(bundle.files['config.json']!).preset, 'standard')
  assert.equal(
    JSON.parse(bundle.files['result.json']!).first_stable.physical_status,
    result.first_stable.physical_status,
  )
})

test('标准工况篡改物理参数不能获得合格快照', () => {
  const config = createConfig('standard', 'swing-up')
  config.physics.force_max_N = 21
  const session = createSession(config)
  session.start()
  session.advance(60)
  assert.ok(session.read().qualification_reasons.includes('nonstandard_config'))
  assert.equal(session.read().first_stable.snapshot, null)
})
