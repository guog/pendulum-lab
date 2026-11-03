import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConfig, createSession } from '../src/session.ts'

test('首次稳定后继续20秒并独立导出耐久结果及原快照', async () => {
  const session = createSession(createConfig('simple', 'swing-up'))
  session.start()
  session.advance(50)
  const result = session.read()
  assert.equal(result.endurance.status, 'passed')
  assert.equal(result.endurance.end_s! - result.endurance.start_s!, 20)
  assert.equal(result.endurance.rules_version, 'QV-1')
  assert.ok(result.first_stable.snapshot)
  assert.equal(result.first_stable.snapshot.sim_time_s, result.endurance.start_s)
  const evidence = await session.exportEvidence()
  assert.deepEqual(JSON.parse(evidence.files['result.json']!).endurance, result.endurance)
})

test('首次稳定后控制异常使耐久失败且不抹除共同快照', async (t) => {
  let slow = false
  let clock = 0
  t.mock.method(performance, 'now', () => (slow ? (clock += 20) : 0))
  const session = createSession(createConfig('simple', 'swing-up'))
  session.start()
  session.advance(15)
  const snapshot = session.read().first_stable.snapshot
  assert.ok(snapshot)
  slow = true
  session.advance(0.02)
  const result = session.read()
  assert.equal(result.endurance.status, 'failed')
  assert.deepEqual(result.first_stable.snapshot, snapshot)
  assert.equal(result.first_stable.disturbance_eligibility, 'blocked_pending_export')
  const bundle = await session.exportEvidence()
  const saved = JSON.parse(bundle.files['result.json']!)
  assert.equal(saved.endurance.status, 'failed')
  assert.equal(saved.first_stable.physical_status, 'passed')
  assert.ok(bundle.files['snapshot.json'])
  assert.match(bundle.files['events/part-000001.jsonl']!, /controller_error/)
  assert.match(bundle.files['events/part-000001.jsonl']!, /endurance_failed/)
  assert.ok(bundle.files['samples/chunk-000001.csv']!.split('\n').length > 100)
})

test('耐久规则在截止时刻优先判定越界，短暂越界不可恢复为通过', async () => {
  const { createEnduranceAssessment } = await import('../src/endurance.ts')
  const stable = { cart_x_m: 0, cart_v_m_s: 0, theta_unwrapped_rad: 0, theta_dot_rad_s: 0 }
  const rule = createEnduranceAssessment(1000, 0.001)
  assert.equal(rule.observe(20999, { ...stable, cart_x_m: 0.101 }), 'failed')
  assert.equal(rule.observe(21000, stable), 'failed')
  const deadline = createEnduranceAssessment(1000, 0.001)
  assert.equal(deadline.observe(21000, { ...stable, theta_dot_rad_s: 0.201 }), 'failed')
  const success = createEnduranceAssessment(1000, 0.001)
  assert.equal(success.observe(20999, stable), 'running')
  assert.equal(success.observe(21000, stable), 'passed')
})

test('手动及后台暂停期间耐久仿真时间不推进', () => {
  const session = createSession(createConfig('simple', 'swing-up'))
  session.start()
  session.advance(15)
  const before = session.read()
  assert.equal(before.endurance.status, 'running')
  for (const reason of ['manual', 'background'] as const) {
    session.pause(reason)
    session.advance(20)
    assert.equal(session.read().sim_time_s, before.sim_time_s)
    session.resume()
  }
  session.advance(35)
  assert.equal(session.read().endurance.status, 'passed')
})

test('标准工况取得独立的20秒耐久结果', () => {
  const session = createSession(createConfig('standard', 'swing-up'))
  session.start()
  session.advance(90)
  const result = session.read()
  assert.equal(result.endurance.status, 'passed')
  assert.ok(result.first_stable.snapshot)
  assert.ok(Math.abs(result.endurance.end_s! - result.endurance.start_s! - 20) < 1e-9)
})

test('合成会话中单步越界立即使耐久失败，导出保留失败证据且快照没有扰动资格', async () => {
  const { createSyntheticSession } = await import('../src/session.ts')
  const session = createSyntheticSession(createConfig('simple', 'swing-up'), [
    {
      tick: 15001,
      state: { cart_x_m: 0.101, cart_v_m_s: 0, theta_unwrapped_rad: 0, theta_dot_rad_s: 0 },
    },
    {
      tick: 15002,
      state: { cart_x_m: 0, cart_v_m_s: 0, theta_unwrapped_rad: 0, theta_dot_rad_s: 0 },
    },
  ])
  session.start()
  session.advance(40)
  const output = session.read()
  assert.equal(output.endurance.status, 'failed')
  assert.equal(output.endurance.end_s, 15.001)
  assert.equal(output.first_stable.disturbance_eligibility, 'blocked')
  assert.equal(output.trajectory_source, 'synthetic')
  assert.equal(output.endurance.validity, 'synthetic')
  assert.deepEqual(
    output.events.findLast((e) => e.event_type === 'endurance_failed')?.payload.failed_thresholds,
    ['position'],
  )
  const bundle = await session.exportEvidence()
  assert.equal(JSON.parse(bundle.files['result.json']!).trajectory_source, 'synthetic')
  session.confirmExport(bundle.experiment_id, session.read().events.length)
  assert.equal(session.read().first_stable.disturbance_eligibility, 'blocked')
})

test('合成会话在耐久截止时刻触边时先终止，再判耐久失败', async () => {
  const { createSyntheticSession } = await import('../src/session.ts')
  const session = createSyntheticSession(createConfig('simple', 'swing-up'), [
    {
      tick: 32008,
      state: { cart_x_m: 1.5, cart_v_m_s: 0, theta_unwrapped_rad: 0, theta_dot_rad_s: 0 },
    },
  ])
  session.start()
  session.advance(40)
  const result = session.read()
  assert.equal(result.endurance.status, 'failed')
  assert.ok(Math.abs(result.endurance.end_s! - 32.008) < 1e-10)
  const atDeadline = result.events.filter((event) => Math.abs(event.sim_time_s - 32.008) < 1e-10)
  assert.ok(atDeadline.some((event) => event.event_type === 'boundary'))
  assert.ok(atDeadline.some((event) => event.event_type === 'endurance_failed'))
  assert.ok(
    atDeadline.findIndex((event) => event.event_type === 'boundary') <
      atDeadline.findIndex((event) => event.event_type === 'endurance_failed'),
  )
  assert.ok(!atDeadline.some((event) => event.event_type === 'endurance_passed'))
  const bundle = await session.exportEvidence()
  assert.equal(JSON.parse(bundle.files['result.json']!).endurance.status, 'failed')
})

test('合成会话在耐久截止时刻控制超时优先于通过', async (t) => {
  const { createSyntheticSession } = await import('../src/session.ts')
  let slow = false
  let clock = 0
  t.mock.method(performance, 'now', () => (slow ? (clock += 20) : 0))
  const state = { cart_x_m: 0, cart_v_m_s: 0, theta_unwrapped_rad: 0, theta_dot_rad_s: 0 }
  const trajectory = Array.from({ length: 5001 }, (_, i) => ({ tick: i + 10, state }))
  const session = createSyntheticSession(createConfig('simple', 'swing-up'), trajectory)
  session.start()
  session.advance(25.009)
  assert.equal(session.read().endurance.status, 'running')
  slow = true
  session.advance(0.001)
  const result = session.read()
  assert.equal(result.endurance.status, 'failed')
  const atDeadline = result.events.filter((event) => Math.abs(event.sim_time_s - 25.01) < 1e-10)
  assert.ok(atDeadline.some((event) => event.event_type === 'controller_error'))
  assert.ok(atDeadline.some((event) => event.event_type === 'endurance_failed'))
  assert.ok(
    atDeadline.findIndex((event) => event.event_type === 'controller_error') <
      atDeadline.findIndex((event) => event.event_type === 'endurance_failed'),
  )
  assert.ok(!atDeadline.some((event) => event.event_type === 'endurance_passed'))
})

test('合成会话即使耐久规则通过也不会冒称物理稳定或赋予快照资格', async () => {
  const { createSyntheticSession } = await import('../src/session.ts')
  const session = createSyntheticSession(createConfig('simple', 'swing-up'), [])
  session.start()
  session.advance(50)
  const result = session.read()
  assert.equal(result.endurance.status, 'passed')
  assert.equal(result.endurance.validity, 'synthetic')
  assert.equal(result.first_stable.physical_status, 'not_executed')
  assert.equal(result.first_stable.status, 'invalid')
  assert.equal(result.first_stable.snapshot?.trajectory_source, 'synthetic')
  const evidence = await session.exportEvidence()
  session.confirmExport(evidence.experiment_id, session.read().events.length)
  assert.equal(session.read().first_stable.disturbance_eligibility, 'blocked')
})

test('真实步内触边早于合成步末输入，未发生的合成状态不会写入事件', async () => {
  const { createSyntheticSession } = await import('../src/session.ts')
  const config = createConfig('simple', 'release')
  config.initial_state.cart_x_m = 1.4999
  config.initial_state.cart_v_m_s = 1
  const session = createSyntheticSession(config, [
    { tick: 1, state: { cart_x_m: 0, cart_v_m_s: 0, theta_unwrapped_rad: 0, theta_dot_rad_s: 0 } },
  ])
  session.start()
  session.advance(0.001)
  const result = session.read()
  assert.equal(result.status, 'stopped')
  assert.ok(result.sim_time_s < 0.001)
  assert.ok(result.events.some((event) => event.event_type === 'boundary'))
  assert.ok(!result.events.some((event) => event.event_type === 'synthetic_state'))
})

test('合成状态分量有限但能量溢出时保留最后有效状态并终止耐久', async () => {
  const { createSyntheticSession } = await import('../src/session.ts')
  const session = createSyntheticSession(createConfig('simple', 'swing-up'), [
    {
      tick: 15001,
      state: { cart_x_m: 0, cart_v_m_s: 1e308, theta_unwrapped_rad: 0, theta_dot_rad_s: 0 },
    },
  ])
  session.start()
  session.advance(15)
  const before = session.read()
  session.advance(0.001)
  const result = session.read()
  assert.equal(result.status, 'error')
  assert.deepEqual(result.state, before.state)
  assert.equal(result.sim_time_s, before.sim_time_s)
  assert.equal(result.endurance.status, 'failed')
  assert.ok(result.events.some((event) => event.event_type === 'numerical_error'))
  assert.ok(!result.events.some((event) => event.event_type === 'synthetic_state'))
})
