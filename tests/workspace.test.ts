import test from 'node:test'
import assert from 'node:assert/strict'
import { openWorkspace, type WorkspaceFiles } from '../src/workspace.ts'

class Files implements WorkspaceFiles {
  data = new Map<string, string>()
  writable = true
  async permission(mode: 'read' | 'readwrite') {
    return mode === 'read' || this.writable
  }
  async list(path: string) {
    return [
      ...new Set(
        [...this.data.keys()]
          .filter((k) => k.startsWith(path ? path + '/' : ''))
          .map((k) => k.slice(path ? path.length + 1 : 0).split('/')[0]!),
      ),
    ]
  }
  async read(path: string) {
    const text = this.data.get(path)
    if (text === undefined) throw new Error('missing')
    return text
  }
  async write(path: string, text: string) {
    this.data.set(path, text)
  }
}

test('explicitly selected empty directory initializes; unrelated directory stays untouched', async () => {
  const files = new Files()
  const workspace = await openWorkspace(files)
  assert.equal(workspace.writable, true)
  assert.deepEqual(await workspace.experiments(), [])
  assert.equal((await openWorkspace(files)).id, workspace.id)
  const unrelated = new Files()
  unrelated.data.set('personal.txt', 'keep')
  await assert.rejects(openWorkspace(unrelated), /非空/)
  assert.deepEqual([...unrelated.data], [['personal.txt', 'keep']])
})

import { createConfig } from '../src/session.ts'

test('60s default and high frequency loads seal and reopen all prescribed records', async () => {
  for (const period of [0.01, 0.001, 0.1]) {
    const files = new Files(),
      workspace = await openWorkspace(files)
    const config = createConfig('standard', 'equilibrium')
    config.timing.duration_s = 60
    config.timing.sample_period_s = period
    const run = await workspace.create(config)
    await run.start()
    await run.advance(60)
    const loaded = await (await openWorkspace(files)).load(run.id)
    assert.equal(loaded.integrity, 'sealed-verified')
    assert.equal(loaded.output.samples.length, 60 / period + 1)
    assert.equal(loaded.output.samples.at(-1)!.sim_time_s, 60)
    assert.deepEqual(loaded.output, run.read().output)
    assert.equal(loaded.result.formal_acceptance, 'not_eligible')
    assert.equal(loaded.manifest.committed_sim_time_s, 60)
  }
})

test('slow disk stops physics before the ceiling, preserving all 1ms samples', async () => {
  const files = new Files(),
    workspace = await openWorkspace(files)
  const config = createConfig('standard', 'equilibrium')
  config.timing.sample_period_s = 0.001
  const run = await workspace.create(config)
  await run.start()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const write = files.write.bind(files)
  files.write = async (path, text) => {
    await gate
    await write(path, text)
  }
  const advancing = run.advance(0.5)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(run.progress().sim_time_s, 0.5)
  assert.equal(run.progress().committed_sim_time_s, 0)
  assert.equal(run.progress().saving, true)
  await assert.rejects(run.advance(0.501), /存储/)
  assert.equal(run.read().output.samples.length, 501)
  release()
  await advancing
  await run.stop()
  assert.equal((await workspace.load(run.id)).output.samples.length, 501)
})

test('write failure never acknowledges data; retry preserves a diagnostic and the tail', async () => {
  const files = new Files(),
    workspace = await openWorkspace(files)
  const run = await workspace.create(createConfig('standard', 'equilibrium'))
  await run.start()
  const write = files.write.bind(files)
  files.write = async () => {
    throw new Error('disk full')
  }
  await assert.rejects(run.advance(0.5), /disk full/)
  assert.equal(run.progress().committed_sim_time_s, 0)
  assert.equal(run.progress().status, 'paused')
  assert.equal((await workspace.load(run.id)).output.samples.length, 1)
  files.write = write
  await run.retry()
  await run.stop()
  const loaded = await workspace.load(run.id)
  assert.equal(loaded.output.samples.length, 51)
  assert.ok(loaded.output.events.some((e) => e.event_type === 'storage_error'))
  assert.equal(loaded.integrity, 'sealed-verified')
})

test('read-only opens history, denied read refuses, tampered content cannot be called complete', async () => {
  const files = new Files(),
    workspace = await openWorkspace(files)
  const run = await workspace.create(createConfig('standard', 'equilibrium'))
  await run.start()
  await run.advance(0.203)
  await run.stop()
  files.writable = false
  const readOnly = await openWorkspace(files)
  assert.equal((await readOnly.load(run.id)).output.sim_time_s, 0.203)
  await assert.rejects(readOnly.create(createConfig('simple', 'equilibrium')), /只读/)
  const original = files.permission.bind(files)
  files.permission = async () => false
  await assert.rejects(openWorkspace(files), /无读/)
  files.permission = original
  const samplePath = [...files.data.keys()].find((p) => p.includes('samples/chunk-000003'))!
  files.data.set(samplePath, files.data.get(samplePath)! + 'corrupt')
  await assert.rejects(readOnly.load(run.id), /完整性/)
})

test('invalid sampling rejects before creating an experiment; unsealed reopen reports confirmed prefix', async () => {
  const files = new Files(),
    workspace = await openWorkspace(files)
  const config = createConfig('standard', 'equilibrium')
  config.timing.sample_period_s = 0.003
  await assert.rejects(workspace.create(config), /采样/)
  assert.deepEqual(await workspace.experiments(), [])
  const run = await workspace.create(createConfig('standard', 'equilibrium'))
  await run.start()
  await run.advance(0.7)
  const loaded = await workspace.load(run.id)
  assert.equal(loaded.integrity, 'interrupted-confirmed-prefix')
  assert.equal(loaded.output.sim_time_s, 0.5)
  await run.stop()
  assert.ok(
    Math.abs((await workspace.load(run.id)).output.samples.at(-1)!.sim_time_s - 0.7) < 1e-12,
  )
})

test('rehashed malformed CSV is rejected as data, even when byte digests agree', async () => {
  const files = new Files(),
    workspace = await openWorkspace(files)
  const run = await workspace.create(createConfig('standard', 'equilibrium'))
  await run.start()
  await run.stop()
  const manifestPath = `experiments/${run.id}/manifest.json`
  const manifest = JSON.parse(files.data.get(manifestPath)!)
  const entry = manifest.batches[1].files[0]
  const path = `experiments/${run.id}/${entry.path}`
  const content = files.data.get(path)!.replace('cart_x_m', 'unknown')
  files.data.set(path, content)
  const { sha256 } = await import('../src/evidence.ts')
  entry.sha256 = await sha256(content)
  entry.byte_length = new TextEncoder().encode(content).byteLength
  files.data.set(manifestPath, JSON.stringify(manifest))
  await assert.rejects(workspace.load(run.id), /采样格式/)
})

test('directory result assesses the complete experiment rather than the final chunk', async () => {
  const { createActuationConfig } = await import('../src/actuator-benchmarks.ts')
  const { assessActuation } = await import('../src/actuation-assessment.ts')
  const workspace = await openWorkspace(new Files())
  const run = await workspace.create(createActuationConfig('standard', 'speed-direction'))
  await run.start()
  await run.advance(0.1)
  await run.pause()
  run.resume()
  await run.advance(0.1)
  const record = await workspace.load(run.id)
  assert.deepEqual(record.result.actuation_assessment, assessActuation(run.read().output))
})

test('pause between batch boundaries does not skip the next half-second commit', async () => {
  const workspace = await openWorkspace(new Files())
  const run = await workspace.create(createConfig('standard', 'equilibrium'))
  await run.start()
  await run.advance(0.2)
  await run.pause()
  run.resume()
  await run.advance(0.3)
  assert.equal(run.progress().committed_sim_time_s, 0.5)
})

test('workspace identity with missing required fields is refused without rewriting', async () => {
  const files = new Files()
  await openWorkspace(files)
  const identity = JSON.parse(files.data.get('workspace.json')!)
  delete identity.created_at_utc
  const malformed = JSON.stringify(identity)
  files.data.set('workspace.json', malformed)
  await assert.rejects(openWorkspace(files), /无效工作区/)
  assert.equal(files.data.get('workspace.json'), malformed)
})

test('a valid 600s experiment remains readable across 1202 batches after a pause and seals', async () => {
  const files = new Files()
  const workspace = await openWorkspace(files)
  const config = createConfig('standard', 'equilibrium')
  config.timing.duration_s = 600
  config.timing.sample_period_s = 0.1
  const run = await workspace.create(config)
  await run.start()
  await run.advance(0.2)
  await run.pause()
  run.resume()
  await run.advance(598.8)
  assert.equal((await workspace.load(run.id)).output.sim_time_s, 599)
  await run.advance(0.5)
  assert.equal((await workspace.load(run.id)).output.sim_time_s, 599.5)
  await run.advance(0.5)
  const reopened = await (await openWorkspace(files)).load(run.id)
  assert.equal(reopened.integrity, 'sealed-verified')
  assert.equal(reopened.output.status, 'completed')
  assert.equal(reopened.output.samples.length, 6001)
  assert.equal(reopened.output.samples.at(-1)!.sim_time_s, 600)
  assert.deepEqual(reopened.output, run.read().output)
})
