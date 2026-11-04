import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { openWorkspace } from '../src/workspace.ts'
import { createConfig } from '../src/session.ts'

// Complementary Node/local-disk evidence. Does NOT exercise Chrome authorization/FSA.
const root = await mkdtemp(join(tmpdir(), 'pendulum-13-disk-'))
const results = []
for (const [name, period, duration, delay] of [
  ['default-60s', 0.01, 60, 0],
  ['high-frequency-60s', 0.001, 60, 0],
  ['slow-disk', 0.001, 1.203, 50],
]) {
  const dir = join(root, name)
  await mkdir(dir)
  let delayed = false
  const files = {
    async permission() {
      return true
    },
    async list(path) {
      return readdir(join(dir, path))
    },
    async read(path) {
      return readFile(join(dir, path), 'utf8')
    },
    async write(path, text) {
      if (delayed && delay) await new Promise((resolve) => setTimeout(resolve, delay))
      await mkdir(dirname(join(dir, path)), { recursive: true })
      await writeFile(join(dir, path), text)
    },
  }
  const workspace = await openWorkspace(files)
  const config = createConfig('standard', 'equilibrium')
  config.timing.sample_period_s = period
  config.timing.duration_s = duration
  const run = await workspace.create(config)
  await run.start()
  delayed = true
  const started = performance.now()
  const advancing = run.advance(duration)
  let observed = null
  if (delay) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    observed = run.progress()
    assert.equal(observed.saving, true)
    assert.equal(observed.sim_time_s, 0.5)
    assert.equal(observed.committed_sim_time_s, 0)
  }
  await advancing
  const record = await (await openWorkspace(files)).load(run.id)
  assert.equal(record.integrity, 'sealed-verified')
  assert.equal(record.output.samples.length, Math.floor((duration + 1e-12) / period) + 1)
  const prefix = `experiments/${run.id}/`
  const manifest = record.manifest
  for (const entry of [
    manifest.config,
    manifest.snapshot,
    manifest.result,
    ...manifest.batches.flatMap((batch) => batch.files),
  ]) {
    const content = await files.read(prefix + entry.path)
    assert.equal(Buffer.byteLength(content), entry.byte_length)
    assert.equal(createHash('sha256').update(content).digest('hex'), entry.sha256)
  }
  results.push({
    name,
    directory: dir,
    sample_period_s: period,
    duration_s: duration,
    elapsed_ms: performance.now() - started,
    sample_count: record.output.samples.length,
    event_count: record.output.events.length,
    manifest,
    slow_write_observation: observed,
  })
}
process.stdout.write(
  JSON.stringify({ tool: 'Node fs, not Chrome FSA', root, results }, null, 2) + '\n',
)
