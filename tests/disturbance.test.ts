import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConfig, createSession } from '../src/session.ts'

test('没有已确认的合格快照时不能分叉扰动实验', async () => {
  const session = createSession(createConfig('simple', 'swing-up'))
  await assert.rejects(() => session.forkDisturbance('horizontal'), /快照/)
})

test('两种扰动从同一真实快照分叉并各自记录输入', async () => {
  const session = createSession(createConfig('simple', 'swing-up'))
  session.start()
  session.advance(50)
  const evidence = await session.exportEvidence()
  session.confirmExport(evidence.experiment_id, session.read().events.length)
  const source = session.read()
  const horizontal = await session.forkDisturbance('horizontal')
  const torque = await session.forkDisturbance('torque')
  assert.equal(horizontal.snapshot_sha256, torque.snapshot_sha256)
  assert.notEqual(horizontal.experiment_id, torque.experiment_id)
  assert.equal(horizontal.samples[0]?.force_external_N, 3.5)
  assert.equal(horizontal.samples[0]?.torque_external_Nm, 0)
  assert.equal(torque.samples[0]?.force_external_N, 0)
  assert.equal(torque.samples[0]?.torque_external_Nm, 0.1)
  assert.deepEqual(session.read(), source)
})

test('脉冲在精确的左闭右开区间内生效并保留恢复相位', async () => {
  const session = createSession(createConfig('simple', 'swing-up'))
  session.start()
  session.advance(50)
  const evidence = await session.exportEvidence()
  session.confirmExport(evidence.experiment_id, session.read().events.length)
  const snapshot = session.read().first_stable.snapshot!
  const child = await session.forkDisturbance('horizontal')
  const start = child.disturbance!.pulse_start_s
  const end = child.disturbance!.pulse_end_s
  assert.ok(Math.abs(end - start - 0.1) < 1e-9)
  assert.equal(child.samples[0]!.sim_time_s, start)
  assert.equal(child.samples[0]!.force_requested_N, snapshot.forces.force_requested_N)
  assert.equal(child.samples.findLast((sample) => sample.sim_time_s < end)?.force_external_N, 3.5)
  assert.equal(child.samples.find((sample) => sample.sim_time_s >= end)?.force_external_N, 0)
  assert.deepEqual(
    child.events.filter((event) => event.event_type === 'disturbance_start').length,
    1,
  )
  assert.deepEqual(child.events.filter((event) => event.event_type === 'disturbance_end').length, 1)
  assert.ok(['suppressed', 'recovered', 'failed'].includes(child.disturbance!.status))
})

test('标准工况使用各自幅值，控制异常不得报告成功', async (t) => {
  let slow = false
  let clock = 0
  t.mock.method(performance, 'now', () => (slow ? (clock += 20) : 0))
  const session = createSession(createConfig('standard', 'swing-up'))
  session.start()
  session.advance(90)
  const evidence = await session.exportEvidence()
  session.confirmExport(evidence.experiment_id, session.read().events.length)
  slow = true
  const result = await session.forkDisturbance('horizontal')
  assert.equal(result.samples[0]?.force_external_N, 2)
  assert.equal(result.disturbance?.status, 'error')
  assert.ok(result.events.some((event) => event.event_type === 'controller_error'))
})

test('耐久失败后，真实快照仍可用于独立扰动', async (t) => {
  let slow = false
  let clock = 0
  t.mock.method(performance, 'now', () => (slow ? (clock += 20) : 0))
  const session = createSession(createConfig('simple', 'swing-up'))
  session.start()
  session.advance(15)
  slow = true
  session.advance(0.02)
  assert.equal(session.read().endurance.status, 'failed')
  const bundle = await session.exportEvidence()
  session.confirmExport(bundle.experiment_id, session.read().events.length)
  slow = false
  const child = await session.forkDisturbance('horizontal')
  assert.equal(child.disturbance?.status, 'recovered')
  assert.ok(child.events.some((event) => event.event_type === 'disturbance_stability_lost'))
  const result = child.events.find((event) => event.event_type === 'disturbance_result')!
  assert.equal(result.payload.result, 'recovered')
  assert.ok(Math.abs(result.sim_time_s - Number(result.payload.recovery_start_s) - 5) < 1e-9)
  assert.ok(result.sim_time_s <= child.disturbance!.deadline_s)
})

test('力矩扰动在截止时不足连续五秒则失败，保留完整窗口', async () => {
  const session = createSession(createConfig('simple', 'swing-up'))
  session.start()
  session.advance(50)
  const bundle = await session.exportEvidence()
  session.confirmExport(bundle.experiment_id, session.read().events.length)
  const child = await session.forkDisturbance('torque')
  const result = child.events.find((event) => event.event_type === 'disturbance_result')!
  assert.equal(child.disturbance?.status, 'failed')
  assert.equal(result.sim_time_s, child.disturbance?.deadline_s)
  assert.ok(result.sim_time_s - Number(result.payload.recovery_start_s) < 5)
})

test('扰动推进可在检查点暂停并恢复，不在等待期间继续计算', async () => {
  const session = createSession(createConfig('simple', 'swing-up'))
  session.start()
  session.advance(50)
  const bundle = await session.exportEvidence()
  session.confirmExport(bundle.experiment_id, session.read().events.length)
  let release: (() => void) | undefined
  let checkpoints = 0
  const run = session.forkDisturbance('horizontal', async () => {
    checkpoints++
    if (checkpoints === 3)
      await new Promise<void>((resolve) => {
        release = resolve
      })
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(checkpoints, 3)
  assert.ok(release)
  release()
  const result = await run
  assert.equal(result.disturbance?.status, 'recovered')
  assert.ok(checkpoints > 3)
})
