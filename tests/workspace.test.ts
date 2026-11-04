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

test('an unsupported result version is rejected even when its digest is valid', async () => {
  const { sha256 } = await import('../src/evidence.ts')
  const files = new Files()
  const workspace = await openWorkspace(files)
  const run = await workspace.create(createConfig('standard', 'equilibrium'))
  await run.start()
  await run.advance(0.1)
  await run.stop()
  const prefix = `experiments/${run.id}/`
  const manifest = JSON.parse(await files.read(prefix + 'manifest.json'))
  const result = JSON.parse(await files.read(prefix + manifest.result.path))
  result.schema_version = 999
  const text = JSON.stringify(result)
  await files.write(prefix + manifest.result.path, text)
  manifest.result.sha256 = await sha256(text)
  manifest.result.byte_length = new TextEncoder().encode(text).byteLength
  await files.write(prefix + 'manifest.json', JSON.stringify(manifest))
  await assert.rejects(workspace.load(run.id), /结果格式/)
})

test('result metadata must agree with the snapshot, configuration and recorded state', async () => {
  const { sha256 } = await import('../src/evidence.ts')
  const files = new Files()
  const workspace = await openWorkspace(files)
  const run = await workspace.create(createConfig('standard', 'equilibrium'))
  await run.start()
  await run.advance(0.1)
  await run.stop()
  const prefix = `experiments/${run.id}/`
  const manifest = JSON.parse(await files.read(prefix + 'manifest.json'))
  const original = JSON.parse(await files.read(prefix + manifest.result.path))
  for (const patch of [
    { status: 'running' },
    { rules_version: 'unsupported-future-version' },
    { last_state: { ...original.last_state, cart_x_m: 1 } },
    { last_state: { x: 123456789 } },
    { trajectory_source: 'synthetic' },
    { execution_mode: 'memory-research' },
    { formal_acceptance: 'eligible' },
    { qualification_reasons: ['invented'] },
    { condition_intervals: [{}] },
    { first_stable: { status: 'passed' } },
    { endurance: { status: 'passed' } },
    { horizontal_disturbance: 'passed' },
    { torque_disturbance: 'passed' },
  ]) {
    const text = JSON.stringify({ ...original, ...patch })
    await files.write(prefix + manifest.result.path, text)
    manifest.result.sha256 = await sha256(text)
    manifest.result.byte_length = new TextEncoder().encode(text).byteLength
    await files.write(prefix + 'manifest.json', JSON.stringify(manifest))
    await assert.rejects(workspace.load(run.id), /结果.*不一致/, JSON.stringify(patch))
  }
})

test('result diagnostics have a supported assessment schema and retain historical values', async () => {
  const { createActuationConfig } = await import('../src/actuator-benchmarks.ts')
  const { sha256 } = await import('../src/evidence.ts')
  for (const config of [
    createConfig('standard', 'equilibrium'),
    createActuationConfig('standard', 'force-limit'),
  ]) {
    const files = new Files(),
      workspace = await openWorkspace(files)
    const run = await workspace.create(config)
    await run.start()
    await run.advance(config.benchmark === 'force-limit' ? 0.02 : 0.1)
    if (!run.progress().sealed) await run.stop()
    const prefix = `experiments/${run.id}/`
    const manifest = JSON.parse(await files.read(prefix + 'manifest.json'))
    const original = JSON.parse(await files.read(prefix + manifest.result.path))
    const assessment = original.actuation_assessment
    const patches = assessment
      ? [
          { actuation_assessment: { ...assessment, version: 'unknown' } },
          { actuation_assessment: { ...assessment, status: 'unknown' } },
          { actuation_assessment: { ...assessment, status: ['passed'] } },
          {
            actuation_assessment: {
              ...assessment,
              metrics: [{ ...assessment.metrics[0], actual: 'NaN' }],
            },
          },
          { limitation: {} },
        ]
      : [{ actuation_assessment: { version: 'unknown', status: 'passed' } }, { limitation: {} }]
    for (const patch of patches) {
      const text = JSON.stringify({ ...original, ...patch })
      await files.write(prefix + manifest.result.path, text)
      manifest.result.sha256 = await sha256(text)
      manifest.result.byte_length = new TextEncoder().encode(text).byteLength
      await files.write(prefix + 'manifest.json', JSON.stringify(manifest))
      await assert.rejects(workspace.load(run.id), /结果格式/)
    }
    const reordered = {
      ...original,
      last_state: Object.fromEntries(Object.entries(original.last_state).reverse()),
    }
    const text = JSON.stringify(reordered)
    await files.write(prefix + manifest.result.path, text)
    manifest.result.sha256 = await sha256(text)
    manifest.result.byte_length = new TextEncoder().encode(text).byteLength
    await files.write(prefix + 'manifest.json', JSON.stringify(manifest))
    assert.deepEqual((await workspace.load(run.id)).result, reordered)
  }
})

test('malformed CSV cells are rejected instead of being silently converted', async () => {
  const { sha256 } = await import('../src/evidence.ts')
  const files = new Files(),
    workspace = await openWorkspace(files)
  const run = await workspace.create(createConfig('standard', 'equilibrium'))
  await run.start()
  await run.advance(0.1)
  await run.stop()
  const prefix = `experiments/${run.id}/`
  const manifest = JSON.parse(await files.read(prefix + 'manifest.json'))
  const entry = manifest.batches.find((batch: { sample_count: number }) => batch.sample_count > 0)
    .files[0]
  const original = await files.read(prefix + entry.path)
  const columns = original.split('\n')[0]!.split(',')
  for (const [field, value] of [
    ['overspeed', 'INVALID'],
    ['saturated', '0'],
    ['cart_x_m', ''],
    ['cart_x_m', ' '],
    ['cart_x_m', 'NaN'],
    ['cart_x_m', '1e999'],
    ['control_mode', 'unknown'],
    ['controller_phase', 'unknown'],
    ['saturation_reasons', 'unknown'],
  ]) {
    const lines = original.split('\n'),
      cells = lines[1]!.split(',')
    cells[columns.indexOf(field!)] = value!
    lines[1] = cells.join(',')
    const text = lines.join('\n')
    await files.write(prefix + entry.path, text)
    entry.sha256 = await sha256(text)
    entry.byte_length = new TextEncoder().encode(text).byteLength
    await files.write(prefix + 'manifest.json', JSON.stringify(manifest))
    await assert.rejects(workspace.load(run.id), /采样|样本/, `${field}=${value}`)
  }
})

test('sealed directory records carry the approved format versions and experiment identity', async () => {
  const files = new Files(),
    workspace = await openWorkspace(files)
  const run = await workspace.create(createConfig('standard', 'equilibrium'))
  await run.start()
  await run.advance(0.01)
  await run.stop()
  const record = await (await openWorkspace(files)).load(run.id)
  const prefix = `experiments/${run.id}/`
  const config = JSON.parse(await files.read(prefix + record.manifest.config.path))
  const snapshot = JSON.parse(await files.read(prefix + record.manifest.snapshot.path))
  assert.deepEqual(
    {
      sample_schema_version: record.manifest.sample_schema_version,
      snapshot_schema_version: snapshot.schema_version,
      config_experiment_id: config.experiment_id,
    },
    { sample_schema_version: 1, snapshot_schema_version: 1, config_experiment_id: run.id },
  )
  assert.equal(record.integrity, 'sealed-verified')
  assert.deepEqual(record.output, run.read().output)
})

test('history refuses missing or unsupported sample format versions', async () => {
  const files = new Files(),
    workspace = await openWorkspace(files)
  const run = await workspace.create(createConfig('standard', 'equilibrium'))
  await run.start()
  await run.stop()
  const path = `experiments/${run.id}/manifest.json`
  const manifest = JSON.parse(await files.read(path))
  for (const version of [999, undefined, null, 0, '1', 1.5]) {
    await files.write(path, JSON.stringify({ ...manifest, sample_schema_version: version }))
    await assert.rejects(workspace.load(run.id), /采样版本/, `version=${version}`)
  }
  await files.write(path, JSON.stringify(manifest))
  assert.equal((await workspace.load(run.id)).integrity, 'sealed-verified')
})

test('history refuses unsupported snapshot versions even with matching digests', async () => {
  const { sha256 } = await import('../src/evidence.ts')
  const files = new Files(),
    workspace = await openWorkspace(files)
  const run = await workspace.create(createConfig('standard', 'equilibrium'))
  await run.start()
  await run.stop()
  const prefix = `experiments/${run.id}/`
  const manifest = JSON.parse(await files.read(prefix + 'manifest.json'))
  const original = await files.read(prefix + manifest.snapshot.path)
  const snapshot = JSON.parse(original)
  for (const version of [999, undefined, null, 0, '1', 1.5, 1]) {
    const text = JSON.stringify({ ...snapshot, schema_version: version })
    await files.write(prefix + manifest.snapshot.path, text)
    manifest.snapshot.sha256 = await sha256(text)
    manifest.snapshot.byte_length = new TextEncoder().encode(text).byteLength
    await files.write(prefix + 'manifest.json', JSON.stringify(manifest))
    if (version === 1) assert.equal((await workspace.load(run.id)).integrity, 'sealed-verified')
    else await assert.rejects(workspace.load(run.id), /快照版本/, `version=${version}`)
  }
})

test('history requires configuration identity to match the selected experiment', async () => {
  const { sha256 } = await import('../src/evidence.ts')
  const files = new Files(),
    workspace = await openWorkspace(files)
  const run = await workspace.create(createConfig('standard', 'equilibrium'))
  await run.start()
  await run.stop()
  const prefix = `experiments/${run.id}/`
  const manifest = JSON.parse(await files.read(prefix + 'manifest.json'))
  const config = JSON.parse(await files.read(prefix + manifest.config.path))
  for (const id of [crypto.randomUUID(), undefined, null, '', 1, run.id]) {
    const text = JSON.stringify({ ...config, experiment_id: id })
    await files.write(prefix + manifest.config.path, text)
    manifest.config.sha256 = await sha256(text)
    manifest.config.byte_length = new TextEncoder().encode(text).byteLength
    await files.write(prefix + 'manifest.json', JSON.stringify(manifest))
    if (id === run.id) assert.equal((await workspace.load(run.id)).integrity, 'sealed-verified')
    else await assert.rejects(workspace.load(run.id), /配置.*实验标识/, `id=${id}`)
  }
})

test('recovery preserves the last acknowledged prefix when the replaceable manifest is torn', async () => {
  const files = new Files(),
    workspace = await openWorkspace(files)
  const run = await workspace.create(createConfig('standard', 'equilibrium'))
  await run.start()
  await run.advance(0.5)
  const confirmed = (await workspace.load(run.id)).output
  files.data.set(`experiments/${run.id}/manifest.json`, '{"torn":')
  const recovered = await (await openWorkspace(files)).recover(run.id)
  assert.deepEqual(recovered.record!.output, confirmed)
  assert.equal(recovered.diagnostics.status, 'interrupted')
  assert.equal(recovered.diagnostics.confirmed_sim_time_s, 0.5)
  assert.equal(recovered.diagnostics.unconfirmed_tail!.end_sim_time_s, null)
  assert.equal(recovered.record!.result.formal_acceptance, 'not_eligible')
})

test('permission loss freezes every command except explicit save retry and exposes the last valid state', async () => {
  const files = new Files(),
    workspace = await openWorkspace(files)
  const run = await workspace.create(createConfig('standard', 'equilibrium'))
  await run.start()
  const write = files.write.bind(files)
  files.write = async () => {
    throw new DOMException('revoked', 'NotAllowedError')
  }
  await assert.rejects(run.advance(0.5), /revoked/)
  const frozen = run.read().output
  assert.equal(run.progress().storage_fault!.name, 'NotAllowedError')
  assert.equal(run.progress().storage_fault!.sim_time_s, 0.5)
  assert.deepEqual(run.progress().storage_fault!.last_valid_state, frozen.state)
  for (const command of [
    () => run.start(),
    () => run.pause(),
    () => run.stop(),
    () => run.advance(0.1),
  ])
    await assert.rejects(command, /存储/)
  assert.throws(() => run.resume(), /存储/)
  assert.deepEqual(run.read().output, frozen)
  files.write = write
  await run.retry()
  assert.equal(run.progress().status, 'paused')
  assert.equal(run.progress().committed_sim_time_s, 0.5)
  await run.stop()
  assert.ok(
    (await workspace.load(run.id)).output.events.some((e) => e.event_type === 'storage_error'),
  )
})

test('recovery diagnoses a torn mirror and orphan files without adopting samples or rewriting disk', async () => {
  const files = new Files(),
    workspace = await openWorkspace(files)
  const run = await workspace.create(createConfig('standard', 'equilibrium'))
  await run.start()
  await run.advance(0.7)
  files.data.set(`experiments/${run.id}/samples/unpublished.csv`, 'invented')
  files.data.set(`experiments/${run.id}/manifest.json`, '{')
  const before = [...files.data]
  const recovery = await workspace.recover(run.id)
  assert.equal(recovery.record!.output.samples.length, 51)
  assert.equal(recovery.diagnostics.confirmed_sim_time_s, 0.5)
  assert.ok(recovery.diagnostics.failures.some((f) => f.path === 'manifest.json'))
  assert.ok(recovery.diagnostics.orphan_files.includes('samples/unpublished.csv'))
  assert.equal(recovery.diagnostics.unconfirmed_tail!.end_sim_time_s, null)
  assert.deepEqual([...files.data], before)
})

test('every interrupted write/readback cut retains the acknowledged prefix and never rewrites confirmed files', async () => {
  // Discover boundary operations through the injected filesystem, then interrupt each side.
  const probe = new Files(),
    probeWorkspace = await openWorkspace(probe)
  const probeRun = await probeWorkspace.create(createConfig('standard', 'equilibrium'))
  await probeRun.start()
  await probeRun.advance(0.5)
  const operations: string[] = []
  const probeWrite = probe.write.bind(probe),
    probeRead = probe.read.bind(probe)
  probe.write = async (path, text) => {
    operations.push('write:' + path.split(probeRun.id)[1])
    await probeWrite(path, text)
  }
  probe.read = async (path) => {
    operations.push('read:' + path.split(probeRun.id)[1])
    return probeRead(path)
  }
  await probeRun.advance(0.5)
  for (let cut = 0; cut < operations.length; cut++) {
    for (const side of ['before', 'after'] as const) {
      const files = new Files(),
        workspace = await openWorkspace(files)
      const run = await workspace.create(createConfig('standard', 'equilibrium'))
      await run.start()
      await run.advance(0.5)
      const immutable = [...files.data].filter(
        ([path]) => !path.startsWith('tmp/') && !path.endsWith('/manifest.json'),
      )
      const read = files.read.bind(files),
        write = files.write.bind(files)
      let count = 0
      async function boundary<T>(operation: () => Promise<T>) {
        const hit = count++ === cut
        if (hit && side === 'before') throw new DOMException('cut', 'AbortError')
        const result = await operation()
        if (hit && side === 'after') throw new DOMException('cut', 'AbortError')
        return result
      }
      files.read = (path) => boundary(() => read(path))
      files.write = (path, text) => boundary(() => write(path, text))
      await assert.rejects(run.advance(0.5), /cut/, `${operations[cut]}:${side}`)
      files.read = read
      files.write = write
      const recovery = await (await openWorkspace(files)).recover(run.id)
      assert.ok(recovery.record, `${operations[cut]}:${side}`)
      assert.ok(recovery.diagnostics.confirmed_sim_time_s! >= 0.5)
      assert.equal(run.progress().committed_sim_time_s, 0.5)
      assert.equal(run.progress().status, 'paused')
      assert.equal(recovery.diagnostics.unconfirmed_tail!.end_sim_time_s, null)
      assert.deepEqual(
        recovery.record.output.samples.slice(0, 51),
        run.read().output.samples.slice(0, 51),
      )
      for (const [path, text] of immutable) assert.equal(files.data.get(path), text, path)
    }
  }
})

test('a corrupt new commit falls back to verified history and leaves unrelated experiments intact', async () => {
  const files = new Files(),
    workspace = await openWorkspace(files)
  const healthy = await workspace.create(createConfig('standard', 'equilibrium'))
  await healthy.start()
  await healthy.advance(0.1)
  await healthy.stop()
  const run = await workspace.create(createConfig('standard', 'equilibrium'))
  await run.start()
  await run.advance(0.5)
  const old = await workspace.load(run.id)
  await run.advance(0.5)
  const newest = await workspace.load(run.id)
  const latestSample = newest.manifest.batches.at(-1)!.files[0]!
  files.data.set(`experiments/${run.id}/${latestSample.path}`, 'damaged')
  const before = [...files.data]
  const recovery = await workspace.recover(run.id)
  assert.deepEqual(recovery.record!.output, old.output)
  assert.equal(recovery.diagnostics.status, 'interrupted')
  assert.ok(recovery.diagnostics.failures.some((f) => f.error.includes('完整性')))
  assert.equal(recovery.diagnostics.unconfirmed_tail!.end_sim_time_s, null)
  assert.equal((await workspace.recover(healthy.id)).diagnostics.status, 'sealed')
  assert.deepEqual([...files.data], before)
})

test('a directory without a valid published prefix exports diagnostics and never adopts loose files', async () => {
  const files = new Files(),
    workspace = await openWorkspace(files)
  const id = '11111111-1111-4111-8111-111111111111'
  files.data.set(`experiments/${id}/samples/chunk-000001.csv`, 'unpublished')
  files.data.set(`experiments/${id}/config.json`, '{}')
  const before = [...files.data]
  const recovery = await workspace.recover(id)
  assert.equal(recovery.record, null)
  assert.equal(recovery.diagnostics.status, 'unverifiable')
  assert.equal(recovery.diagnostics.confirmed_sim_time_s, null)
  assert.deepEqual(recovery.diagnostics.orphan_files.sort(), [
    'config.json',
    'samples/chunk-000001.csv',
  ])
  assert.deepEqual([...files.data], before)
})

test('invalid experiment identity is rejected before any filesystem read', async () => {
  const files = new Files(),
    workspace = await openWorkspace(files)
  files.read = async () => {
    throw new Error('unexpected filesystem read')
  }
  await assert.rejects(workspace.load('../../private'), /非法实验标识/)
})

test('renamed old commit records cannot supersede a newer verified prefix', async () => {
  const files = new Files(),
    workspace = await openWorkspace(files)
  const run = await workspace.create(createConfig('standard', 'equilibrium'))
  await run.start()
  await run.advance(0.5)
  const prefix = `experiments/${run.id}/`
  files.data.set(
    prefix + 'confirmed/manifest-999999.json',
    files.data.get(prefix + 'confirmed/manifest-000001.json')!,
  )
  const recovery = await workspace.recover(run.id)
  assert.equal(recovery.diagnostics.confirmed_sim_time_s, 0.5)
  assert.ok(recovery.diagnostics.failures.some((f) => f.path === 'confirmed/manifest-999999.json'))
})

test('global temporary files remain pending investigation with unknown experiment ownership', async () => {
  const files = new Files(),
    workspace = await openWorkspace(files)
  const run = await workspace.create(createConfig('standard', 'equilibrium'))
  await run.start()
  await run.stop()
  files.data.set('tmp/pending.json.crswap', 'partial temporary content')
  const before = [...files.data]
  const recovery = await workspace.recover(run.id)
  assert.deepEqual(recovery.diagnostics.workspace_orphan_files.sort(), [
    'tmp/pending.json',
    'tmp/pending.json.crswap',
  ])
  assert.deepEqual([...files.data], before)
  assert.equal(recovery.diagnostics.status, 'sealed')
})

test('an unreadable orphan directory cannot block verified history or diagnostic export', async () => {
  const files = new Files(),
    workspace = await openWorkspace(files)
  const run = await workspace.create(createConfig('standard', 'equilibrium'))
  await run.start()
  await run.advance(0.1)
  await run.stop()
  const expected = await workspace.load(run.id)
  const list = files.list.bind(files)
  files.data.set(`experiments/${run.id}/diagnostics`, 'not a directory')
  files.list = async (path) => {
    if (path.endsWith('/diagnostics'))
      throw new DOMException('not a directory', 'TypeMismatchError')
    return list(path)
  }
  const before = [...files.data]
  const recovery = await workspace.recover(run.id)
  assert.deepEqual(recovery.record!.output, expected.output)
  assert.equal(recovery.diagnostics.status, 'sealed')
  assert.ok(recovery.diagnostics.scan_failures.some((f) => f.path === 'diagnostics'))
  assert.ok(recovery.diagnostics.orphan_files.includes('diagnostics'))
  assert.deepEqual([...files.data], before)
})
