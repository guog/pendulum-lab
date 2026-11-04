import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

test('workspace browser preflight reports all missing prerequisites once without starting a browser', () => {
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/workspace-browser.mjs'), '--preflight'],
    {
      encoding: 'utf8',
      env: { ...process.env, BROWSER_SESSION: '', BROWSER_ARTIFACTS_DIR: '' },
    },
  )
  assert.equal(result.status, 1)
  const report = JSON.parse(result.stderr)
  assert.equal(report.status, 'blocked')
  assert.ok(report.issues.some((i) => i.includes('BROWSER_SESSION')))
  assert.ok(report.issues.some((i) => i.includes('BROWSER_ARTIFACTS_DIR')))
})

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readBuildIdentity } from './build-identity.ts'

test('workspace command uses the configured URL, reports build identity and preserves blocked evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'workspace-cli-'))
  try {
    const url = 'http://localhost:5299/'
    const state = {
      userAgent: 'Mozilla/5.0 Chrome/156.0.0.0',
      secure: true,
      picker: true,
      writable: true,
      ready: true,
      build_identity: readBuildIdentity(process.cwd()),
    }
    const agent = join(dir, 'agent'),
      chrome = join(dir, 'chrome'),
      build = join(dir, 'build.json')
    writeFileSync(build, JSON.stringify(readBuildIdentity(process.cwd())))
    writeFileSync(join(dir, 'state.json'), JSON.stringify(state))
    writeFileSync(
      agent,
      `#!/usr/bin/env node\nconst a=process.argv.slice(2);if(a.includes('list'))console.log(JSON.stringify({data:{tabs:[{tabId:'configured',url:${JSON.stringify(url)}}]}}));else if(a.includes('eval'))console.log(JSON.stringify({data:{result:JSON.parse(require('node:fs').readFileSync(${JSON.stringify(join(dir, 'state.json'))}))}}));else console.log('ok')`,
    )
    writeFileSync(join(dir, 'npx'), `#!/bin/sh\nprintf '%s\\n' '${agent}'\n`)
    writeFileSync(chrome, '#!/bin/sh\necho "Google Chrome 156.0.0.0"\n')
    for (const path of [agent, chrome, join(dir, 'npx')]) chmodSync(path, 0o755)
    const run = (name, extra = {}) =>
      spawnSync(process.execPath, [resolve('scripts/workspace-browser.mjs'), '--preflight'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          BROWSER_SESSION: 'explicit-fixture',
          BROWSER_ARTIFACTS_DIR: join(dir, name),
          BROWSER_URL: url,
          BROWSER_BUILD_INFO: build,
          CHROME_EXECUTABLE: chrome,
          ...extra,
        },
      })
    const ready = run('ready')
    assert.equal(ready.status, 0, ready.stderr)
    const report = JSON.parse(ready.stdout)
    assert.equal(report.url, url)
    assert.equal(report.status, 'ready')
    assert.equal(report.source.source_sha256, readBuildIdentity(process.cwd()).source_sha256)
    assert.equal(report.native_picker, 'not_exercised')
    state.build_identity = { ...state.build_identity, source_sha256: 'f'.repeat(64) }
    writeFileSync(join(dir, 'state.json'), JSON.stringify(state))
    assert.equal(run('wrong-page-build').status, 1, 'stale page must be rejected')
    state.build_identity = readBuildIdentity(process.cwd())
    writeFileSync(join(dir, 'state.json'), JSON.stringify(state))
    writeFileSync(build, JSON.stringify({ sentinel: 'alternative-build-file' }))
    const downstream = spawnSync(
      process.execPath,
      [resolve('scripts/browser-workspace-visibility.mjs')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          BROWSER_SESSION: 'explicit-fixture',
          BROWSER_URL: url,
          BROWSER_ARTIFACTS_DIR: join(dir, 'downstream'),
          BROWSER_BUILD_INFO: build,
        },
      },
    )
    assert.notEqual(downstream.status, 0)
    assert.match(downstream.stderr, /alternative-build-file/)
    writeFileSync(build, JSON.stringify(readBuildIdentity(process.cwd())))
    mkdirSync(join(dir, 'legacy'))
    writeFileSync(join(dir, 'legacy/summary.json'), 'OLD EVIDENCE')
    assert.equal(run('legacy').status, 1, 'old evidence without preflight must be refused')
    assert.equal(readFileSync(join(dir, 'legacy/summary.json'), 'utf8'), 'OLD EVIDENCE')
    state.writable = false
    state.ready = false
    writeFileSync(join(dir, 'state.json'), JSON.stringify(state))
    const blocked = run('blocked')
    assert.match(blocked.stderr, /Explicitly select and authorize/)
    assert.equal(JSON.parse(blocked.stderr).issues.length, 1)
    const saved = readFileSync(join(dir, 'blocked/preflight.json'), 'utf8')
    assert.match(run('blocked').stderr, /preserved/)
    assert.equal(readFileSync(join(dir, 'blocked/preflight.json'), 'utf8'), saved)
    writeFileSync(
      build,
      JSON.stringify({ ...readBuildIdentity(process.cwd()), source_sha256: '0'.repeat(64) }),
    )
    assert.match(run('stale').stderr, /stale/)
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    assert.equal(pkg.scripts['test:workspace:browser'], 'node scripts/workspace-browser.mjs')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('workspace preflight reports an unusable evidence location without an uncaught stack', () => {
  const dir = mkdtempSync(join(tmpdir(), 'workspace-location-'))
  try {
    const file = join(dir, 'file')
    writeFileSync(file, 'keep')
    const result = spawnSync(
      process.execPath,
      [resolve('scripts/workspace-browser.mjs'), '--preflight'],
      {
        encoding: 'utf8',
        env: { ...process.env, BROWSER_SESSION: 'test', BROWSER_ARTIFACTS_DIR: file },
      },
    )
    assert.equal(result.status, 1)
    assert.equal(JSON.parse(result.stderr).status, 'blocked')
    assert.equal(readFileSync(file, 'utf8'), 'keep')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
