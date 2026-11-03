import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
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
    state: 'open',
    draft: false,
    head: { sha },
    base: { sha: 'b'.repeat(40) },
    body: 'Test\n\nAssisted-by: LLM\nAI-Agent: OpenAI Codex',
    updated_at: '2026-01-01T00:00:00Z',
  }
  const run = {
    id: 10,
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
  const data = { pull, runs: [{ workflow_runs: [run] }], jobs: [{ jobs }] }
  writeFileSync(join(directory, 'data.json'), JSON.stringify(data))
  const gh = join(directory, 'gh')
  writeFileSync(
    gh,
    `#!/usr/bin/env node\nconst fs = require('node:fs'); const d = require(${JSON.stringify(join(directory, 'data.json'))}); const p = process.argv.at(-1); if (!process.argv.includes('api')) process.exit(2); const marker = ${JSON.stringify(join(directory, 'called'))}; if (p.includes('/runs?') && ${newRun}) { if (fs.existsSync(marker)) d.runs[0].workflow_runs[0].id++; else fs.writeFileSync(marker, ''); } console.log(JSON.stringify(p.includes('/jobs?') ? d.jobs : p.includes('/runs?') ? d.runs : d.pull));\n`,
  )
  chmodSync(gh, 0o755)
  return directory
}
function check(directory) {
  return spawnSync(process.execPath, [script, 'pr', 'owner/repo', '12', sha], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
  })
}
for (const [name, status, old, expected] of [
  ['current passing run', 'success', false, 0],
  ['failed latest run', 'failure', false, 1],
  ['run predates edit', 'success', true, 1],
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
