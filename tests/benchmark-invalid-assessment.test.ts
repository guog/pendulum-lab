import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhysicsBenchmarks } from '../src/benchmarks.ts'

test('无效基准保留完整窗口误差不可评估和冻结阈值，不将异常诊断冒充物理通过', async () => {
  const suite = createPhysicsBenchmarks('standard')
  suite.start()
  while (suite.read().status === 'running') suite.advance()
  const output = suite.read()
  const rotation = output.cases.find((item) => item.id === 'rotation')!
  assert.equal(rotation.status, 'invalid')
  assert.deepEqual(rotation.metrics, [])
  assert.equal(rotation.assessment?.status, 'unavailable')
  assert.match(rotation.assessment!.error, /完整窗口误差未计算/)
  assert.match(rotation.assessment!.error, new RegExp(`${rotation.sim_time_s}s / 2s`))
  for (const threshold of ['1e-6 m', '1e-5 m/s', '1e-6 rad', '1e-4 rad/s', '两圈'])
    assert.ok(rotation.assessment!.threshold.includes(threshold), threshold)
  const numerical = output.cases.find((item) => item.id === 'numerical-failure')!
  assert.equal(numerical.status, 'invalid')
  assert.deepEqual(numerical.metrics, [])
  assert.equal(numerical.assessment?.status, 'not_applicable')
  assert.match(numerical.assessment!.threshold, /不适用/)
  assert.match(numerical.assessment!.error, /数值异常安全诊断/)
  const bundle = await suite.exportEvidence()
  const exported = JSON.parse(bundle.files['results.json']!)
  for (const item of [rotation, numerical])
    assert.deepEqual(
      exported.cases.find((entry: { id: string }) => entry.id === item.id).assessment,
      item.assessment,
    )

  const stopped = createPhysicsBenchmarks('simple')
  stopped.start()
  stopped.advance()
  stopped.stop()
  assert.equal(stopped.read().cases[0]!.assessment?.status, 'unavailable')
  assert.match(stopped.read().cases[0]!.assessment!.threshold, /0.*1e-12 J/)
  assert.equal(stopped.read().cases[1]!.status, 'not_executed')
  assert.equal(stopped.read().cases[1]!.assessment, null)
})
