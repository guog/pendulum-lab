import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

test('spec collection follows native parents and explicit parent references without treating dependencies as specs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-cli-'))
  try {
    const responses = {
      'repos/owner/repo/issues/13': {
        number: 13,
        title: 'child',
        body: 'Blocked by #6',
        html_url: 'https://github.com/owner/repo/issues/13',
      },
      'repos/owner/repo/issues/13/parent': { number: 4 },
      'repos/owner/repo/issues/4': {
        number: 4,
        title: 'parent',
        body: 'Part of #2\n\nD-02: sample_schema_version=1',
        html_url: 'https://github.com/owner/repo/issues/4',
      },
      'repos/owner/repo/issues/2': {
        number: 2,
        title: 'root',
        body: 'Frozen root specification',
        html_url: 'https://github.com/owner/repo/issues/2',
      },
    }
    writeFileSync(join(dir, 'data.json'), JSON.stringify(responses))
    writeFileSync(
      join(dir, 'gh'),
      `#!/usr/bin/env node\nconst fs=require('node:fs');const d=JSON.parse(fs.readFileSync(${JSON.stringify(join(dir, 'data.json'))}));const v=d[process.argv.at(-1)];if(!v){process.stderr.write('HTTP 404');process.exit(1)}console.log(JSON.stringify(v))`,
    )
    chmodSync(join(dir, 'gh'), 0o755)
    const output = join(dir, 'spec.json')
    const result = spawnSync(
      process.execPath,
      [resolve('scripts/collect-spec.mjs'), 'owner/repo', '13', output],
      { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } },
    )
    assert.equal(result.status, 0, result.stderr)
    const spec = JSON.parse(readFileSync(output, 'utf8'))
    assert.deepEqual(
      spec.sources.map((s) => s.number),
      [13, 4, 2],
    )
    assert.match(spec.sources[1].body, /sample_schema_version=1/)
    assert.match(spec.sources[1].body_sha256, /^[a-f0-9]{64}$/)
    assert.ok(result.stdout.includes(output))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('explicit Parent links are collected and API failures or parent cycles fail closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-links-'))
  try {
    const root = {
      number: 13,
      title: 'child',
      body: '## Parent\n\n[spec](https://github.com/owner/repo/issues/4)\n\n## Dependencies\n#6',
    }
    const values = {
      'repos/owner/repo/issues/13': root,
      'repos/owner/repo/issues/4': { number: 4, title: 'spec', body: 'frozen' },
    }
    writeFileSync(
      join(dir, 'gh'),
      `#!/usr/bin/env node\nconst fs=require('node:fs');const d=JSON.parse(fs.readFileSync(${JSON.stringify(join(dir, 'data.json'))}));const v=d[process.argv.at(-1)];if(v?.error){process.stderr.write(v.error);process.exit(1)}if(!v){process.stderr.write('HTTP 404');process.exit(1)}console.log(JSON.stringify(v))`,
    )
    chmodSync(join(dir, 'gh'), 0o755)
    const output = join(dir, 'spec.json')
    const run = () =>
      spawnSync(
        process.execPath,
        [resolve('scripts/collect-spec.mjs'), 'owner/repo', '13', output],
        { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } },
      )
    writeFileSync(join(dir, 'data.json'), JSON.stringify(values))
    assert.equal(run().status, 0)
    assert.deepEqual(
      JSON.parse(readFileSync(output)).sources.map((s) => s.number),
      [13, 4],
    )
    const saved = readFileSync(output, 'utf8')
    values['repos/owner/repo/issues/13/parent'] = { error: 'HTTP 403' }
    writeFileSync(join(dir, 'data.json'), JSON.stringify(values))
    assert.notEqual(run().status, 0)
    assert.equal(readFileSync(output, 'utf8'), saved)
    values['repos/owner/repo/issues/13/parent'] = { number: 4 }
    values['repos/owner/repo/issues/4/parent'] = { number: 13 }
    writeFileSync(join(dir, 'data.json'), JSON.stringify(values))
    assert.match(run().stderr, /cycle/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
