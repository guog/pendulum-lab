import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createPhysicsBenchmarks } from '../src/benchmarks.ts'

test('异步导出冻结整批原始记录与结果，后续继续推进不改写导出快照', async () => {
  const suite = createPhysicsBenchmarks('simple')
  suite.start()
  for (let i = 0; i < 11; i++) suite.advance()
  suite.pause()
  const exporting = suite.exportEvidence()
  suite.resume()
  suite.advance()
  const bundle = await exporting
  const snapshot = JSON.parse(bundle.files['results.json']!)
  assert.equal(snapshot.status, 'paused')
  assert.equal(snapshot.cases[0].sim_time_s, 10)
  assert.equal(snapshot.cases[1].sim_time_s, 1)
  for (const [id, status, time] of [
    ['equilibrium-down', 'completed', 10],
    ['equilibrium-up', 'paused', 1],
  ] as const) {
    const prefix = `experiments/${id}/`
    const child = JSON.parse(bundle.files[prefix + 'result.json']!)
    assert.equal(child.status, status)
    assert.equal(child.sim_time_s, time)
    assert.equal(
      child.experiment_id,
      snapshot.cases.find((item: { id: string }) => item.id === id).experiment_id,
    )
    const csv = bundle.files[prefix + 'samples/chunk-000001.csv']!.trim().split('\n')
    assert.equal(Number(csv.at(-1)!.split(',')[1]), time)
  }
  for (const entry of JSON.parse(bundle.files['manifest.json']!).files) {
    assert.equal(createHash('sha256').update(bundle.files[entry.path]!).digest('hex'), entry.sha256)
  }
  assert.equal(suite.read().status, 'running')
  assert.equal(suite.read().cases[1]!.sim_time_s, 2)
})

test('终止只使已经开始的当前基准无效，尚未创建的项目保持未执行', async () => {
  for (const completedSteps of [0, 1, 10]) {
    const suite = createPhysicsBenchmarks('simple')
    suite.start()
    for (let i = 0; i < completedSteps; i++) suite.advance()
    suite.stop()
    const output = suite.read()
    assert.equal(output.status, 'stopped')
    assert.ok(
      output.cases
        .filter((item) => item.experiment_id === null)
        .every((item) => item.status === 'not_executed'),
    )
    assert.equal(
      output.cases[0]!.status,
      completedSteps === 0 ? 'not_executed' : completedSteps === 1 ? 'invalid' : 'passed',
    )
    const bundle = await suite.exportEvidence()
    const exported = JSON.parse(bundle.files['results.json']!)
    assert.deepEqual(exported.cases, output.cases)
    assert.equal(Object.hasOwn(bundle.files, 'experiments/equilibrium-up/result.json'), false)
    if (completedSteps > 0)
      assert.equal(
        JSON.parse(bundle.files['experiments/equilibrium-down/result.json']!).status,
        completedSteps === 1 ? 'stopped' : 'completed',
      )
  }
})
