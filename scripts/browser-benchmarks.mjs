import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir, arch, totalmem, cpus } from 'node:os'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import assert from 'node:assert/strict'
import { readBuildIdentity } from './build-identity.ts'

const artifacts = resolve(
  process.env.BROWSER_ARTIFACTS_DIR ?? join(tmpdir(), `pendulum-t02-${process.pid}`),
)
mkdirSync(artifacts, { recursive: true })
const chrome =
  process.env.CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const chromeVersion = execFileSync(chrome, ['--version'], { encoding: 'utf8' }).trim()
const session = `pendulum-t02-${process.pid}`
const log = []
const server = spawn('npm', ['run', 'preview', '--', '--port', '4174', '--strictPort'], {
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})
function browser(...args) {
  const result = spawnSync(
    'npx',
    ['--yes', 'agent-browser@0.41.1', '--session', session, ...args],
    { encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
  )
  log.push({ args, status: result.status, stdout: result.stdout, stderr: result.stderr })
  if (result.status !== 0)
    throw new Error(`浏览器步骤失败 ${args.join(' ')}: ${result.stdout} ${result.stderr}`)
  return result.stdout.trim()
}
const click = (selector) => {
  browser('scrollintoview', selector)
  browser('click', selector)
}
const text = (selector) => browser('get', 'text', selector)
const hash = (value) => createHash('sha256').update(value).digest('hex')
function verify(raw, preset) {
  const bundle = JSON.parse(raw)
  assert.equal(bundle.kind, 'pendulum-physics-benchmarks')
  const results = JSON.parse(bundle.files['results.json'])
  assert.equal(results.status, 'completed')
  assert.equal(results.batch_id, bundle.batch_id)
  assert.equal(results.cases.length, 16)
  const manifest = JSON.parse(bundle.files['manifest.json'])
  for (const file of manifest.files) {
    assert.equal(hash(bundle.files[file.path]), file.sha256)
    assert.equal(Buffer.byteLength(bundle.files[file.path]), file.byte_length)
  }
  for (const item of results.cases) {
    const prefix = `experiments/${item.id}/`
    const config = JSON.parse(bundle.files[prefix + 'config.json'])
    const result = JSON.parse(bundle.files[prefix + 'result.json'])
    assert.equal(config.preset, preset)
    assert.equal(result.experiment_id, item.experiment_id)
    assert.deepEqual(config.build_identity, readBuildIdentity(process.cwd()))
    assert.equal(
      config.environment.user_agent.match(/Chrome\/(\d+)/)?.[1],
      chromeVersion.match(/Chrome (\d+)/)?.[1],
    )
    for (const file of JSON.parse(bundle.files[prefix + 'manifest.json']).files)
      assert.equal(hash(bundle.files[prefix + file.path]), file.sha256)
    assert.ok(!/NaN|Infinity/.test(bundle.files[prefix + 'samples/chunk-000001.csv']))
    if (item.id === 'numerical-failure') {
      assert.equal(item.status, 'invalid')
      assert.equal(result.status, 'error')
      assert.equal(result.sim_time_s, 0)
      assert.deepEqual(result.last_state, config.initial_state)
    } else if (item.id === 'rotation' && preset === 'standard') {
      assert.equal(item.status, 'invalid')
      assert.equal(result.status, 'stopped')
      assert.match(bundle.files[prefix + 'events/part-000001.jsonl'], /boundary/)
    } else {
      assert.equal(item.status, 'passed', JSON.stringify(item))
      assert.ok(
        item.metrics.every(
          (metric) => Number.isFinite(metric.actual) && metric.actual <= metric.limit,
        ),
      )
    }
    if (item.id === 'energy-30s') assert.equal(result.sample_count, 30001)
    if (item.id.startsWith('convergence-')) assert.equal(result.sample_count, 10001)
  }
  return {
    batch_id: bundle.batch_id,
    source: results.cases[0].config.build_identity,
    counts: Object.fromEntries(
      ['passed', 'failed', 'invalid', 'blocked'].map((status) => [
        status,
        results.cases.filter((item) => item.status === status).length,
      ]),
    ),
    metrics: results.cases
      .filter((item) => ['energy-30s', 'convergence-0.5ms'].includes(item.id))
      .map(({ id, metrics }) => ({ id, metrics })),
  }
}
try {
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error('预览服务超时')), 15000)
    server.stdout.on('data', (data) => {
      if (data.toString().includes('http://localhost:4174/')) {
        clearTimeout(timeout)
        resolveReady()
      }
    })
    server.stderr.on('data', (data) => log.push({ server_error: data.toString() }))
    server.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`预览服务退出${code}`))
    })
  })
  browser('--executable-path', chrome, 'open', 'http://localhost:4174/')
  browser('set', 'viewport', '1440', '1000')
  browser('wait', '--text', '准备就绪')
  assert.match(text('#bench-status'), /未执行 16/)
  const reports = []
  for (const preset of ['standard', 'simple']) {
    browser('select', '#bench-preset', preset)
    click('#bench-run')
    browser('wait', '--text', '批次已完成')
    if (
      !JSON.parse(
        browser(
          'eval',
          `document.querySelector('#bench-results details[data-id="energy-30s"]').open`,
          '--json',
        ),
      ).data.result
    )
      browser('click', '#bench-results details[data-id="energy-30s"] summary')
    assert.match(text('#bench-results details[data-id="energy-30s"]'), /最大相对能量漂移/)
    browser('scrollintoview', '#bench-title')
    browser('eval', 'window.scrollTo(0,0)')
    browser('screenshot', '--full', join(artifacts, `${preset}-benchmarks.png`))
    browser('scrollintoview', '#bench-results details[data-id="energy-30s"]')
    browser('screenshot', join(artifacts, `${preset}-energy-detail.png`))
    click('#bench-prepare')
    browser('wait', '#bench-download')
    assert.match(text('#bench-record'), /尚未确认导出/)
    const path = join(artifacts, `${preset}-benchmarks.json`)
    browser('download', '#bench-download', path)
    const raw = readFileSync(path, 'utf8')
    const report = verify(raw, preset)
    writeFileSync(path + '.gz', gzipSync(raw))
    assert.match(text('#bench-record'), /尚未确认导出/)
    const wrong = join(artifacts, 'wrong-benchmark.json')
    writeFileSync(wrong, '{}')
    browser('upload', '#bench-verify', wrong)
    browser('wait', '--text', '文件与当前基准证据不一致')
    assert.match(text('#bench-record'), /尚未确认导出/)
    browser('upload', '#bench-verify', path)
    browser('wait', '--text', '基准证据已导出并校验')
    reports.push({
      preset,
      ...report,
      file_sha256: hash(raw),
      gzip_sha256: hash(readFileSync(path + '.gz')),
    })
  }
  const a11y = JSON.parse(browser('a11y', '--json'))
  assert.equal(a11y.data.counts.violations, 0)
  writeFileSync(join(artifacts, 'benchmarks-accessibility.json'), JSON.stringify(a11y, null, 2))
  browser('set', 'viewport', '1100', '900')
  browser('scrollintoview', '#bench-title')
  browser('screenshot', join(artifacts, 'benchmarks-1100.png'))
  const dimensions = JSON.parse(
    browser('eval', '({width:innerWidth,scroll:document.documentElement.scrollWidth})', '--json'),
  ).data.result
  assert.ok(dimensions.scroll <= dimensions.width)
  click('#bench-new')
  browser('wait', '--text', '未执行 16')
  // Controlled start-before-ack visibility ordering; actual background behavior is also exercised by T01.
  browser(
    'eval',
    `document.querySelector('#bench-run').click(); Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}); document.dispatchEvent(new Event('visibilitychange'))`,
  )
  browser('wait', '--text', '批次已暂停')
  const frozen = text('#bench-status')
  browser('wait', '200')
  assert.equal(text('#bench-status'), frozen)
  browser('eval', `delete document.hidden; document.dispatchEvent(new Event('visibilitychange'))`)
  assert.match(text('#bench-status'), /批次已暂停/)
  click('#bench-stop')
  browser('wait', '--text', '批次已终止')
  writeFileSync(
    join(artifacts, 'benchmarks-summary.json'),
    JSON.stringify(
      {
        status: 'passed',
        chrome_version: chromeVersion,
        environment: {
          os: execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
          arch: arch(),
          cpu: cpus()[0]?.model,
          memory_bytes: totalmem(),
        },
        reports,
        controlled_visibility_pause: 'passed',
        download_readback_and_wrong_file_rejection: 'passed',
        axe_violations: 0,
        desktop_widths: [1440, 1100],
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`T02真实Chrome验证通过：${artifacts}`)
} finally {
  writeFileSync(join(artifacts, 'benchmarks-browser-log.json'), JSON.stringify(log, null, 2))
  try {
    browser('close')
  } catch {
    /* Keep original failure. */
  }
  try {
    process.kill(-server.pid, 'SIGTERM')
  } catch {
    /* Already exited. */
  }
}
