import { createBrowser, verifyManifest, waitForConfig } from './browser-driver.mjs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import assert from 'node:assert/strict'
import { readBuildIdentity } from './build-identity.ts'

const chrome =
  process.env.CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!existsSync(chrome)) throw new Error('请通过CHROME_EXECUTABLE指定真实Chrome。')
const chromeVersion = spawnSync(chrome, ['--version'], { encoding: 'utf8', timeout: 10000 })
assert.equal(chromeVersion.status, 0)
const artifacts = process.env.BROWSER_ARTIFACTS_DIR
  ? resolve(process.env.BROWSER_ARTIFACTS_DIR, 't03')
  : await mkdtemp(join(tmpdir(), 'pendulum-actuation-'))
mkdirSync(artifacts, { recursive: true })
const session = `pendulum-actuation-${process.pid}`
const base = 'http://localhost:4175/'
const server = spawn('npm', ['run', 'preview', '--', '--port', '4175', '--strictPort'], {
  detached: process.platform !== 'win32',
  stdio: ['ignore', 'pipe', 'pipe'],
})
const log = []
const browser = createBrowser(session, log, join(artifacts, 'browser-steps.jsonl'))

const click = (selector) => {
  browser('scrollintoview', selector)
  browser('click', selector)
}
const text = (selector) => browser('get', 'text', selector)
const hash = (text) => createHash('sha256').update(text).digest('hex')
const cases = [
  'near-zero',
  'force-limit',
  'power-drive',
  'power-brake',
  'speed-direction',
  'speed-crossing',
  'speed-crossing-reverse',
  'pulse-endpoint',
  'external-overspeed',
  'coupling-overspeed',
  'joint-torque',
  'combined-work',
  'rail-boundary',
]
const selectedCases = process.argv.length > 2 ? process.argv.slice(2) : cases
assert.ok(
  selectedCases.every((id) => cases.includes(id)),
  '未知基准参数',
)
const summary = []
const desktopWidths = new Set([1440])
let wrongFileRejections = 0
try {
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error('预览服务器未就绪')), 15000)
    server.stdout.on('data', (data) => {
      if (data.toString().includes(base)) {
        clearTimeout(timeout)
        resolveReady()
      }
    })
    server.stderr.on('data', (data) => log.push({ server_error: data.toString() }))
    server.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`预览服务退出：${code}`))
    })
  })
  browser('--executable-path', chrome, 'open', base)
  browser('set', 'viewport', '1440', '1000')
  browser(
    'wait',
    '--fn',
    'document.querySelector("#status").textContent === "准备就绪" && !document.querySelector("#start").disabled',
  )
  browser('snapshot', '-i')
  for (const preset of ['simple', 'standard']) {
    browser('select', '#preset', preset)
    waitForConfig(browser, preset)
    for (const id of selectedCases) {
      browser('select', '#benchmark', id)
      waitForConfig(browser, preset, id)
      assert.match(text('#config'), new RegExp(`"benchmark": "${id}"`))
      if (id === 'combined-work') {
        assert.match(text('#parameters'), /0\.1 N·s\/m/, '冻结输入摘要缺少实际滑块粘性阻力')
        assert.match(text('#parameters'), /0\.002 N·m·s\/rad/, '冻结输入摘要缺少实际关节粘性阻力')
      }
      click('#start')
      browser('wait', '--text', '受力基准：通过')
      assert.match(text('#actuation-result'), /不代表正式/)
      assert.equal(
        JSON.parse(
          browser('eval', 'document.querySelectorAll("#force-charts canvas").length', '--json'),
        ).data.result,
        8,
      )
      if (
        !JSON.parse(
          browser('eval', 'document.querySelector("details.download-options").open', '--json'),
        ).data.result
      )
        click('details.download-options > summary')
      click('#prepare-download')
      browser('wait', '#download')
      const path = join(artifacts, `${preset}-${id}.json`)
      browser('scrollintoview', '#download')
      browser('download', '#download', path)
      assert.match(text('#record-state'), /尚未确认导出/)
      const raw = readFileSync(path, 'utf8'),
        bundle = JSON.parse(raw)
      const config = JSON.parse(bundle.files['config.json']),
        result = JSON.parse(bundle.files['result.json'])
      assert.equal(config.benchmark, id)
      assert.equal(config.preset, preset)
      assert.equal(result.actuation_assessment.status, 'passed')
      assert.equal(result.formal_acceptance, 'not_eligible')
      assert.deepEqual(
        config.build_identity,
        JSON.parse(readFileSync('dist/build-info.json', 'utf8')),
      )
      assert.deepEqual(config.build_identity, readBuildIdentity(process.cwd()))
      assert.equal(
        config.environment.user_agent.match(/Chrome\/(\d+)/)?.[1],
        chromeVersion.stdout.match(/Chrome (\d+)/)?.[1],
      )
      const manifest = JSON.parse(bundle.files['manifest.json'])
      verifyManifest(bundle.files, manifest)
      const csv = bundle.files['samples/chunk-000001.csv'].trim().split('\n')
      assert.equal(csv.length - 1, result.sample_count)
      assert.match(csv[0], /saturation_reasons,saturated$/)
      assert.ok(!/NaN|Infinity/.test(csv.join('\n')))
      if (id === 'joint-torque') {
        const wrong = join(artifacts, 'wrong.json')
        writeFileSync(wrong, raw + ' ')
        browser('upload', '#verify-file', wrong)
        browser('wait', '--text', '文件与当前证据包不一致')
        assert.match(text('#record-state'), /尚未确认导出/)
        wrongFileRejections++
      }
      browser('upload', '#verify-file', path)
      browser('wait', '--text', '当前证据已导出并校验')
      if (['combined-work', 'rail-boundary', 'speed-crossing', 'pulse-endpoint'].includes(id)) {
        // Open native disclosures for visible evidence; no application state mutation.
        browser(
          'eval',
          'document.querySelectorAll("#force-ledger, #force-events").forEach(e => e.closest("details").open = true)',
        )
        browser('set', 'viewport', '1100', '900')
        desktopWidths.add(1100)
        browser('screenshot', '--full', join(artifacts, `${preset}-${id}.png`))
        const dims = JSON.parse(
          browser(
            'eval',
            '({width:innerWidth,scroll:document.documentElement.scrollWidth})',
            '--json',
          ),
        ).data.result
        assert.ok(dims.scroll <= dims.width)
        browser('set', 'viewport', '1440', '1000')
      }
      const compressed = gzipSync(raw)
      writeFileSync(`${path}.gz`, compressed)
      summary.push({
        preset,
        id,
        experiment_id: bundle.experiment_id,
        status: result.actuation_assessment.status,
        sim_time_s: result.sim_time_s,
        sample_count: result.sample_count,
        metrics: result.actuation_assessment.metrics,
        qualification_reasons: result.qualification_reasons,
        condition_intervals: result.condition_intervals,
        last_sample: Object.fromEntries(
          csv[0].split(',').map((key, index) => [key, csv.at(-1).split(',')[index]]),
        ),
        sha256: hash(raw),
        gzip_sha256: hash(compressed),
        build_identity: config.build_identity,
      })
      console.log(`${preset}/${id}: passed, actual file read back and verified`)
    }
  }
  const computedTypography = JSON.parse(
    browser(
      'eval',
      'Object.fromEntries(["body","h1","h2"].map(s=>[s,getComputedStyle(document.querySelector(s)).fontSize]))',
      '--json',
    ),
  ).data.result
  const accessibility = JSON.parse(browser('a11y', '--json'))
  writeFileSync(join(artifacts, 'accessibility.json'), JSON.stringify(accessibility, null, 2))
  assert.equal(accessibility.data.counts.violations, 0)
  writeFileSync(
    join(artifacts, 'verification.json'),
    JSON.stringify(
      {
        status: 'passed',
        scenario: 'T03 real Chrome macOS localhost',
        chrome_version: chromeVersion.stdout.trim(),
        os: spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim(),
        architecture: process.arch,
        cases: summary,
        axe_violations: 0,
        download_readback: 'passed',
        wrong_file_rejection: wrongFileRejections > 0 ? 'passed' : 'not_executed',
        wrong_file_rejection_count: wrongFileRejections,
        desktop_widths: [...desktopWidths],
        computed_typography: computedTypography,
      },
      null,
      2,
    ) + '\n',
  )
} finally {
  writeFileSync(join(artifacts, 'browser-log.json'), JSON.stringify(log, null, 2))
  try {
    browser('close')
  } catch {
    /* Preserve original failure. */
  }
  if (server.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM')
    } catch {
      /* Already stopped. */
    }
  }
}
