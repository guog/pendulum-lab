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
