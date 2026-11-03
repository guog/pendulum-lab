import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

// Resolve the pinned package once per test process, rather than invoking npm for every step.
export function createBrowser(session, log, logPath) {
  let executable
  return (...args) => {
    if (!executable) {
      const resolved = spawnSync(
        'npx',
        ['--yes', '--package', 'agent-browser@0.41.1', '-c', 'command -v agent-browser'],
        { encoding: 'utf8', timeout: 120_000 },
      )
      if (resolved.status !== 0 || !resolved.stdout.trim())
        throw new Error(`Cannot resolve agent-browser: ${resolved.stderr}`)
      executable = resolved.stdout.trim()
    }
    const started = Date.now()
    appendFileSync(
      logPath,
      JSON.stringify({ phase: 'start', args, time: new Date(started).toISOString() }) + '\n',
    )
    const result = spawnSync(executable, ['--session', session, ...args], {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    })
    const entry = {
      args,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error?.message,
      elapsed_ms: Date.now() - started,
    }
    log.push(entry)
    appendFileSync(logPath, JSON.stringify({ phase: 'finish', ...entry }) + '\n')
    if (result.status !== 0)
      throw new Error(
        `浏览器步骤失败：${args.join(' ')}\n${result.stdout}\n${result.stderr}\n${result.error?.message ?? ''}`,
      )
    return result.stdout.trim()
  }
}

export function waitForConfig(browser, preset, benchmark) {
  const benchmarkCheck =
    benchmark === undefined
      ? ''
      : ` && JSON.parse(document.querySelector('#config').textContent).benchmark === ${JSON.stringify(benchmark)}`
  const ready = benchmark === undefined ? " && !document.querySelector('#benchmark').disabled" : ''
  browser(
    'wait',
    '--fn',
    `JSON.parse(document.querySelector('#config').textContent).preset === ${JSON.stringify(preset)}${benchmarkCheck}${ready} && !document.querySelector('#start').disabled`,
  )
}

export function verifyManifest(files, manifest, prefix = '') {
  for (const file of manifest.files) {
    const content = files[prefix + file.path]
    assert.equal(typeof content, 'string', `Missing ${prefix + file.path}`)
    assert.equal(createHash('sha256').update(content).digest('hex'), file.sha256)
    assert.equal(Buffer.byteLength(content), file.byte_length)
  }
}
