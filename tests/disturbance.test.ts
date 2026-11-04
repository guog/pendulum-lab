import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createConfig, createSession } from '../src/session.ts'

beforeEach((t) => {
  if (!('mock' in t)) throw new Error('测试计时不可用')
  t.mock.method(performance, 'now', () => 0)
})

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
  const ended = result.events.find((event) => event.event_type === 'disturbance_end')!
  assert.equal(ended.payload.reason, 'controller_error')
  assert.ok(ended.sim_time_s < result.disturbance!.pulse_end_s)
  assert.equal(ended.payload.actual_time_s, ended.sim_time_s)
  assert.equal(result.disturbance?.pulse_actual_end_s, ended.sim_time_s)
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
  let pausedTime = -1
  const run = session.forkDisturbance('horizontal', async (progress) => {
    pausedTime = progress.sim_time_s
    checkpoints++
    if (checkpoints === 3)
      await new Promise<void>((resolve) => {
        release = resolve
      })
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(checkpoints, 3)
  const frozenTime = pausedTime
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(pausedTime, frozenTime)
  assert.ok(release)
  release()
  const result = await run
  assert.equal(result.disturbance?.status, 'recovered')
  assert.ok(checkpoints > 3)
})

test('合成扰动仅用于诊断，全程稳定被识别但不能获得物理验证资格', async () => {
  const { createSyntheticSession } = await import('../src/session.ts')
  const source = createSyntheticSession(createConfig('simple', 'swing-up'), [])
  source.start()
  source.advance(15)
  source.pause()
  const bundle = await source.exportEvidence()
  source.confirmExport(bundle.experiment_id, source.read().events.length)
  const start = source.read().first_stable.snapshot!.physics_tick
  const state = { cart_x_m: 0, cart_v_m_s: 0, theta_unwrapped_rad: 0, theta_dot_rad_s: 0 }
  const steps = Array.from({ length: 10100 }, (_, index) => ({ tick: start + index + 1, state }))
  const result = await source.forkSyntheticDisturbance('horizontal', steps)
  assert.equal(result.disturbance?.status, 'suppressed')
  assert.equal(result.trajectory_source, 'synthetic')
  assert.equal(result.first_stable.disturbance_eligibility, 'blocked')
  assert.equal(result.disturbance?.validity, 'synthetic')
})

test('恢复恰好在截止、提前一步和延后一步分别得到正确分类', async () => {
  const { createSyntheticSession } = await import('../src/session.ts')
  const source = createSyntheticSession(createConfig('simple', 'swing-up'), [])
  source.start()
  source.advance(15)
  source.pause()
  const bundle = await source.exportEvidence()
  source.confirmExport(bundle.experiment_id, source.read().events.length)
  const start = source.read().first_stable.snapshot!.physics_tick
  const stable = { cart_x_m: 0, cart_v_m_s: 0, theta_unwrapped_rad: 0, theta_dot_rad_s: 0 }
  const unstable = { ...stable, cart_x_m: 0.101 }
  for (const [returnAt, expected] of [
    [5099, 'recovered'],
    [5100, 'recovered'],
    [5101, 'failed'],
  ] as const) {
    const steps = Array.from({ length: 10100 }, (_, index) => ({
      tick: start + index + 1,
      state: index + 1 < returnAt ? unstable : stable,
    }))
    const result = await source.forkSyntheticDisturbance('horizontal', steps)
    assert.equal(result.disturbance?.status, expected, `returnAt ${returnAt}`)
    const terminal = result.events.find((event) => event.event_type === 'disturbance_result')!
    assert.equal(terminal.sim_time_s, (start + Math.min(returnAt + 5000, 10100)) / 1000)
  }
})

test('采样间两次短暂越界都留事件，第二次越界重新开始五秒恢复', async () => {
  const { createSyntheticSession } = await import('../src/session.ts')
  const source = createSyntheticSession(createConfig('simple', 'swing-up'), [])
  source.start()
  source.advance(15)
  source.pause()
  const bundle = await source.exportEvidence()
  source.confirmExport(bundle.experiment_id, source.read().events.length)
  const start = source.read().first_stable.snapshot!.physics_tick
  const stable = { cart_x_m: 0, cart_v_m_s: 0, theta_unwrapped_rad: 0, theta_dot_rad_s: 0 }
  const steps = Array.from({ length: 10100 }, (_, index) => {
    const offset = index + 1
    return {
      tick: start + offset,
      state: offset === 101 || offset === 1001 ? { ...stable, cart_x_m: 0.101 } : stable,
    }
  })
  const result = await source.forkSyntheticDisturbance('torque', steps)
  assert.equal(result.disturbance?.status, 'recovered')
  assert.deepEqual(
    result.events
      .filter((event) => event.event_type === 'disturbance_stability_lost')
      .map((event) => event.sim_time_s),
    [(start + 101) / 1000, (start + 1001) / 1000],
  )
  const terminal = result.events.find((event) => event.event_type === 'disturbance_result')!
  assert.equal(terminal.sim_time_s, (start + 6002) / 1000)
  assert.ok(result.samples.every((sample) => sample.cart_x_m !== 0.101))
})

test('扰动截止时超速或触边优先于成功，违规与未恢复区分', async () => {
  const { createSyntheticSession } = await import('../src/session.ts')
  const source = createSyntheticSession(createConfig('simple', 'swing-up'), [])
  source.start()
  source.advance(15)
  source.pause()
  const bundle = await source.exportEvidence()
  source.confirmExport(bundle.experiment_id, source.read().events.length)
  const start = source.read().first_stable.snapshot!.physics_tick
  const stable = { cart_x_m: 0, cart_v_m_s: 0, theta_unwrapped_rad: 0, theta_dot_rad_s: 0 }
  for (const [state, reason] of [
    [{ ...stable, cart_v_m_s: 3 }, 'overspeed'],
    [{ ...stable, cart_x_m: 1.5 }, 'boundary'],
  ] as const) {
    const steps = Array.from({ length: 10100 }, (_, index) => ({
      tick: start + index + 1,
      state: index === 10099 ? state : stable,
    }))
    const result = await source.forkSyntheticDisturbance('horizontal', steps)
    assert.equal(result.disturbance?.status, 'violation')
    assert.ok(result.qualification_reasons.includes(reason))
    assert.ok(
      !result.events.some(
        (event) =>
          event.event_type === 'disturbance_result' && event.payload.result === 'suppressed',
      ),
    )
  }
})

test('真实分叉只保留源控制输出与相位，并从源采样时钟的下个边界继续', async () => {
  const source = createSession(createConfig('simple', 'swing-up'))
  source.start()
  source.advance(50)
  const bundle = await source.exportEvidence()
  source.confirmExport(bundle.experiment_id, source.read().events.length)
  const snapshot = source.read().first_stable.snapshot!
  const child = await source.forkDisturbance('horizontal')
  assert.equal(child.samples[0]!.sim_time_s, snapshot.sim_time_s)
  assert.equal(child.samples[0]!.force_requested_N, snapshot.controller.request)
  assert.equal(child.samples[0]!.controller_phase, snapshot.controller.phase)
  const secondTick = snapshot.physics_tick + ((10 - snapshot.sample_phase_steps) % 10)
  assert.equal(child.samples[1]!.sim_time_s, secondTick / 1000)
  const savedEnd = child.samples.at(-1)!.sim_time_s
  const controlUpdates =
    Math.floor((savedEnd * 1000 + 1e-7) / 10) - Math.floor(snapshot.physics_tick / 10)
  assert.equal(child.controller?.state.updates, snapshot.controller.updates + controlUpdates)
})

test('合成分叉不能从真实会话伪造，且不接受快照前或无效轨迹', async () => {
  const real = createSession(createConfig('simple', 'swing-up'))
  await assert.rejects(() => real.forkSyntheticDisturbance('horizontal', []), /合成会话/)
  const { createSyntheticSession } = await import('../src/session.ts')
  const source = createSyntheticSession(createConfig('simple', 'swing-up'), [])
  source.start()
  source.advance(15)
  source.pause()
  const bundle = await source.exportEvidence()
  source.confirmExport(bundle.experiment_id, source.read().events.length)
  const snapshot = source.read().first_stable.snapshot!
  await assert.rejects(() => source.forkDisturbance('horizontal'), /合格快照/)
  await assert.rejects(
    () =>
      source.forkSyntheticDisturbance('horizontal', [
        { tick: snapshot.physics_tick, state: snapshot.state },
      ]),
    /快照之后/,
  )
  await assert.rejects(
    () =>
      source.forkSyntheticDisturbance('horizontal', [
        { tick: snapshot.physics_tick + 1, state: { ...snapshot.state, cart_x_m: Infinity } },
      ]),
    /非法合成轨迹/,
  )
})

test('扰动后台暂停及继续作为同一仿真时刻的关键事件保留', async () => {
  const source = createSession(createConfig('simple', 'swing-up'))
  source.start()
  source.advance(50)
  const bundle = await source.exportEvidence()
  source.confirmExport(bundle.experiment_id, source.read().events.length)
  let checkpoints = 0
  const result = await source.forkDisturbance('horizontal', async () => {
    checkpoints++
    return checkpoints === 3 ? { reason: 'background' } : undefined
  })
  const pause = result.events.find((event) => event.event_type === 'pause')!
  const resume = result.events.find((event) => event.event_type === 'resume')!
  assert.equal(pause.payload.reason, 'background')
  assert.equal(resume.sim_time_s, pause.sim_time_s)
  assert.ok(result.events.indexOf(pause) < result.events.indexOf(resume))
})

test('合成扰动发生数值异常时标记异常并保留最后有效状态', async () => {
  const { createSyntheticSession } = await import('../src/session.ts')
  const source = createSyntheticSession(createConfig('simple', 'swing-up'), [])
  source.start()
  source.advance(15)
  source.pause()
  const bundle = await source.exportEvidence()
  source.confirmExport(bundle.experiment_id, source.read().events.length)
  const snapshot = source.read().first_stable.snapshot!
  const result = await source.forkSyntheticDisturbance('torque', [
    {
      tick: snapshot.physics_tick + 1,
      state: { ...snapshot.state, cart_v_m_s: 1e308 },
    },
  ])
  assert.equal(result.disturbance?.status, 'error')
  assert.equal(result.samples.at(-1)?.sim_time_s, snapshot.sim_time_s)
  assert.ok(result.events.some((event) => event.event_type === 'numerical_error'))
})

test('脉冲期间超速、触边或数值异常记录实际终止而非计划终点', async () => {
  const { createSyntheticSession } = await import('../src/session.ts')
  const source = createSyntheticSession(createConfig('simple', 'swing-up'), [])
  source.start()
  source.advance(15)
  source.pause()
  const bundle = await source.exportEvidence()
  source.confirmExport(bundle.experiment_id, source.read().events.length)
  const snapshot = source.read().first_stable.snapshot!
  for (const [state, reason] of [
    [{ ...snapshot.state, cart_v_m_s: 3 }, 'violation'],
    [{ ...snapshot.state, cart_x_m: 1.5 }, 'boundary'],
    [{ ...snapshot.state, cart_v_m_s: 1e308 }, 'numerical_error'],
  ] as const) {
    const child = await source.forkSyntheticDisturbance('horizontal', [
      { tick: snapshot.physics_tick + 1, state },
    ])
    const ends = child.events.filter((event) => event.event_type === 'disturbance_end')
    assert.equal(ends.length, 1)
    assert.equal(ends[0]!.payload.reason, reason)
    assert.equal(ends[0]!.sim_time_s, child.disturbance?.pulse_actual_end_s)
    assert.ok(ends[0]!.sim_time_s < child.disturbance!.pulse_end_s)
  }
})
