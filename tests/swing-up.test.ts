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
  assert.equal(output.first_stable.status, 'passed')
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
  const bundle = await session.exportEvidence()
  assert.equal(JSON.parse(bundle.files['result.json']!).first_stable.status, 'passed')
  const saved = JSON.parse(bundle.files['snapshot.json']!)
  const { createHash } = await import('node:crypto')
  assert.equal(
    saved.config_sha256,
    createHash('sha256')
      .update(JSON.stringify(saved.config, null, 2) + '\n')
      .digest('hex'),
  )
})

test('中止的起摆没有合格快照，导出保留失败结果', async () => {
  const session = createSession(createConfig('simple', 'swing-up'))
  session.start()
  session.advance(0.5)
  session.stop()
  const output = session.read()
  assert.equal(output.first_stable.status, 'failed')
  assert.equal(output.first_stable.snapshot, null)
  assert.equal(output.first_stable.disturbance_eligibility, 'blocked')
  const bundle = await session.exportEvidence()
  assert.equal(JSON.parse(bundle.files['result.json']!).first_stable.status, 'failed')
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
