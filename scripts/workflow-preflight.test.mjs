import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { verifyManifest, waitForConfig } from './browser-driver.mjs'

const script = resolve('scripts/workflow-preflight.mjs')
const sha = 'a'.repeat(40)
function fixture(runStatus = 'success', changed = false, newRun = false) {
  const directory = mkdtempSync(join(tmpdir(), 'preflight-test-'))
  const pull = {
    number: 12,
    title: 'feat: test',
    state: 'open',
    draft: false,
    head: { sha },
    base: { sha: 'b'.repeat(40) },
    body: 'Test\n\nAssisted-by: LLM\nAI-Agent: OpenAI Codex',
    updated_at: '2026-01-01T00:00:00Z',
  }
  const run = {
    id: 10,
    run_attempt: 1,
    head_sha: sha,
    event: 'pull_request',
    pull_requests: [{ number: 12 }],
    status: 'completed',
    conclusion: runStatus,
    created_at: changed ? '2025-01-01T00:00:00Z' : '2026-01-02T00:00:00Z',
  }
  const jobs = ['Repository checks', 'PR title', 'AI provenance'].map((name) => ({
    name,
    status: 'completed',
    conclusion: 'success',
  }))
  const hash = (value) => createHash('sha256').update(value).digest('hex')
  const artifact = {
    schema_version: 1,
    repository: 'owner/repo',
    pr: 12,
    head: sha,
    base: pull.base.sha,
    title_sha256: hash(pull.title),
    body_sha256: hash(changed ? 'older body' : pull.body),
    run_id: 10,
    run_attempt: 1,
  }
  const data = { pull, runs: [{ workflow_runs: [run] }], jobs: [{ jobs }], artifact }
  writeFileSync(join(directory, 'data.json'), JSON.stringify(data))
  const gh = join(directory, 'gh')
  writeFileSync(
    gh,
    `#!/usr/bin/env node\nconst fs = require('node:fs'); const d = JSON.parse(fs.readFileSync(${JSON.stringify(join(directory, 'data.json'))})); if(process.argv.includes('download')) { const dir=process.argv[process.argv.indexOf('--dir')+1];fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(require('node:path').join(dir,'inputs.json'),JSON.stringify(d.artifact));process.exit(0) } const p = process.argv.at(-1); if (!process.argv.includes('api')) process.exit(2); if (p.includes('/pulls/') && d.nextPull) { const original=d.pull; d.pull=d.nextPull; delete d.nextPull; fs.writeFileSync(${JSON.stringify(join(directory, 'data.json'))},JSON.stringify(d)); console.log(JSON.stringify(original)); process.exit(0); } const marker = ${JSON.stringify(join(directory, 'called'))}; if (p.includes('/runs?') && ${newRun}) { if (fs.existsSync(marker)) d.runs[0].workflow_runs[0].id++; else fs.writeFileSync(marker, ''); } console.log(JSON.stringify(p.includes('/jobs?') ? d.jobs : p.includes('/runs?') ? d.runs : d.pull));\n`,
  )
  chmodSync(gh, 0o755)
  return directory
}
test('PR preflight accepts comment-only updates after successful checks of identical inputs', () => {
  const directory = fixture()
  try {
    const path = join(directory, 'data.json'),
      data = JSON.parse(readFileSync(path, 'utf8'))
    data.pull.updated_at = '2027-01-01T00:00:00Z'
    writeFileSync(path, JSON.stringify(data))
    const result = check(directory)
    assert.equal(result.status, 0, result.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
function check(directory) {
  return spawnSync(process.execPath, [script, 'pr', 'owner/repo', '12', sha], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
  })
}
for (const [name, status, old, expected] of [
  ['current passing run', 'success', false, 0],
  ['failed latest run', 'failure', false, 1],
  ['body differs from recorded inputs', 'success', true, 1],
]) {
  test(`PR preflight: ${name}`, () => {
    const directory = fixture(status, old)
    try {
      assert.equal(check(directory).status, expected)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
test('PR preflight rejects a new run started during verification', () => {
  const directory = fixture('success', false, true)
  try {
    const result = check(directory)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /workflow changed/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
test('manifest verification detects tampering and missing data', () => {
  const value = '实际内容'
  const entry = {
    path: 'file',
    byte_length: Buffer.byteLength(value),
    sha256: createHash('sha256').update(value).digest('hex'),
  }
  verifyManifest({ file: value }, { files: [entry] })
  assert.throws(() => verifyManifest({ file: value + ' ' }, { files: [entry] }))
  assert.throws(() => verifyManifest({}, { files: [entry] }))
})
test('state wait checks selected preset and case and enabled start', () => {
  let args
  waitForConfig(
    (...input) => {
      args = input
    },
    'simple',
    'near-zero',
  )
  assert.equal(args[0], 'wait')
  assert.equal(args[1], '--fn')
  assert.match(args[2], /near-zero/)
  assert.match(args[2], /!document.querySelector\('#start'\).disabled/)
})

test('PR preflight refuses changed inputs, wrong artifact identity and missing required jobs', () => {
  for (const patch of [
    { pull: { title: 'fix: changed' } },
    { pull: { body: 'Changed\n\nAssisted-by: LLM\nAI-Agent: OpenAI Codex' } },
    { pull: { base: { sha: 'c'.repeat(40) } } },
    { pull: { head: { sha: 'c'.repeat(40) } } },
    { artifact: { run_id: 11 } },
    { artifact: { run_attempt: 2 } },
    { artifact: { repository: 'other/repo' } },
    { artifact: { body_sha256: null } },
    { artifact: { schema_version: 999 } },
    { jobs: [{ jobs: [] }] },
  ]) {
    const dir = fixture()
    try {
      const path = join(dir, 'data.json'),
        data = JSON.parse(readFileSync(path, 'utf8'))
      for (const [key, value] of Object.entries(patch))
        data[key] = Array.isArray(value) ? value : { ...data[key], ...value }
      writeFileSync(path, JSON.stringify(data))
      assert.equal(check(dir).status, 1, JSON.stringify(patch))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('PR preflight distinguishes comment-only races from actual input races', () => {
  for (const patch of [
    { updated_at: '2029-01-01T00:00:00Z' },
    { title: 'fix: new title' },
    { base: { sha: 'd'.repeat(40) } },
  ]) {
    const dir = fixture()
    try {
      const path = join(dir, 'data.json'),
        data = JSON.parse(readFileSync(path, 'utf8'))
      data.nextPull = { ...data.pull, ...patch }
      writeFileSync(path, JSON.stringify(data))
      const result = check(dir)
      assert.equal(result.status, Object.hasOwn(patch, 'updated_at') ? 0 : 1, result.stderr)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})
