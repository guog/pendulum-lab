import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

test('CI records the actual PR event inputs bound to its run and attempt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-inputs-'))
  try {
    const pull = {
      number: 28,
      head: { sha: 'a'.repeat(40) },
      base: { sha: 'b'.repeat(40) },
      title: 'feat: example',
      body: 'Exact body\n',
    }
    const event = join(dir, 'event.json'),
      output = join(dir, 'artifact/inputs.json')
    writeFileSync(
      event,
      JSON.stringify({ repository: { full_name: 'owner/repo' }, pull_request: pull }),
    )
    const result = spawnSync(process.execPath, [resolve('scripts/ci-inputs.mjs'), event, output], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_RUN_ID: '10', GITHUB_RUN_ATTEMPT: '2' },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(readFileSync(output)), {
      schema_version: 1,
      repository: 'owner/repo',
      pr: 28,
      head: 'a'.repeat(40),
      base: 'b'.repeat(40),
      title_sha256: createHash('sha256').update('feat: example').digest('hex'),
      body_sha256: createHash('sha256').update('Exact body\n').digest('hex'),
      run_id: 10,
      run_attempt: 2,
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
