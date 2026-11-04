import { createBrowser, waitForConfig, verifyManifest } from './browser-driver.mjs'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const chrome =
  process.env.CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!existsSync(chrome)) throw new Error('请指定已安装的目标 Chrome')
const version = spawnSync(chrome, ['--version'], { encoding: 'utf8', timeout: 10000 })
if (version.status !== 0) throw new Error('无法读取 Chrome 版本')
const artifacts = process.env.BROWSER_ARTIFACTS_DIR
  ? resolve(process.env.BROWSER_ARTIFACTS_DIR)
  : await mkdtemp(join(tmpdir(), 'pendulum-disturbance-'))
mkdirSync(artifacts, { recursive: true })
const log = []
const browser = createBrowser(
  `pendulum-disturbance-${process.pid}`,
  log,
  join(artifacts, 'browser-steps.jsonl'),
)
const server = spawn('npm', ['run', 'preview'], {
  detached: process.platform !== 'win32',
  stdio: ['ignore', 'pipe', 'pipe'],
})
const text = (selector) => browser('get', 'text', selector)
const hash = (value) => createHash('sha256').update(value).digest('hex')
try {
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error('预览服务未启动')), 15000)
    server.stdout.on('data', (data) => {
      if (String(data).includes('http://localhost:4173/')) {
        clearTimeout(timeout)
        resolveReady()
      }
    })
    server.once('exit', () => reject(new Error('预览服务提前退出')))
  })
  browser('--executable-path', chrome, 'open', 'http://localhost:4173/')
  browser('wait', '--text', '准备就绪')
  browser('select', '#preset', 'simple')
  browser('select', '#benchmark', 'swing-up')
  waitForConfig(browser, 'simple', 'swing-up')
  browser('click', '#start')
  for (let i = 0; i < 100 && Number(text('#time')) < 15; i++) {
    const status = text('#status')
    if (!['运行中', '准备就绪'].includes(status))
      throw new Error(`源实验提前结束：${status} ${text('#end-reason')}`)
    browser('wait', '1000')
  }
  assert.ok(Number(text('#time')) >= 15)
  browser('click', '#pause')
  browser('wait', '--text', '已暂停')
  browser('eval', "document.querySelector('details.download-options').open = true")
  browser('click', '#prepare-download')
  browser('wait', '#download')
  const sourcePath = join(artifacts, 'source.json')
  browser('download', '#download', sourcePath)
  const source = JSON.parse(readFileSync(sourcePath, 'utf8'))
  verifyManifest(source.files, JSON.parse(source.files['manifest.json']))
  browser('upload', '#verify-file', sourcePath)
  browser('wait', '--fn', "!document.querySelector('#run-disturbances').disabled")
  browser('click', '#run-disturbances')
  browser('wait', '300')
  browser(
    'eval',
    "Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'))",
  )
  browser('wait', '--text', '扰动实验已暂停')
  const paused = text('#disturbance-current')
  assert.match(paused, /\d+\.\d{3} s/)
  browser('wait', '500')
  assert.equal(text('#disturbance-current'), paused)
  browser('eval', "delete document.hidden; document.dispatchEvent(new Event('visibilitychange'))")
  browser('wait', '--fn', "!document.querySelector('#resume-disturbances').disabled")
  browser('click', '#resume-disturbances')
  browser('wait', '300')
  browser(
    'eval',
    "Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden; document.dispatchEvent(new Event('visibilitychange'))",
  )
  browser('wait', '--fn', "!document.querySelector('#resume-disturbances').disabled")
  const quickPaused = text('#disturbance-current')
  assert.match(quickPaused, /扰动实验已暂停/)
  browser('click', '#resume-disturbances')
  browser('wait', '--text', '扰动证据尚未导出校验')
  const display = text('#disturbance-result')
  assert.match(display, /简单工况 · 水平外力/)
  assert.match(display, /简单工况 · 关节外力矩/)
  browser('screenshot', '--full', join(artifacts, 'results.png'))
  // Use the public download path and read the real file back into the application.
  browser(
    'eval',
    "document.querySelector('#prepare-disturbance-download').parentElement.open = true",
  )
  browser('click', '#prepare-disturbance-download')
  browser('wait', '#download-disturbances')
  const savedPath = join(artifacts, 'disturbances.json')
  browser('scrollintoview', '#download-disturbances')
  browser('download', '#download-disturbances', savedPath)
  assert.match(text('#disturbance-result'), /尚未导出校验/)
  const invalidPath = join(artifacts, 'invalid-disturbances.json')
  writeFileSync(invalidPath, readFileSync(savedPath, 'utf8') + ' ')
  browser('upload', '#verify-disturbances', invalidPath)
  browser('wait', '--text', '文件与当前扰动证据不一致')
  assert.match(text('#disturbance-result'), /尚未导出校验/)
  browser('upload', '#verify-disturbances', savedPath)
  browser('wait', '--text', '扰动证据已导出并校验')
  const saved = JSON.parse(readFileSync(savedPath, 'utf8'))
  assert.equal(saved.results.length, 2)
  const [horizontal, torque] = saved.results
  assert.equal(horizontal.kind, 'horizontal')
  assert.equal(torque.kind, 'torque')
  assert.notEqual(horizontal.experiment_id, torque.experiment_id)
  assert.equal(horizontal.source_experiment_id, source.experiment_id)
  assert.equal(torque.source_experiment_id, source.experiment_id)
  assert.equal(horizontal.snapshot_sha256, torque.snapshot_sha256)
  assert.equal(
    horizontal.snapshot_sha256,
    hash(JSON.stringify(horizontal.snapshot, null, 2) + '\n'),
  )
  assert.equal(horizontal.samples[0].force_external_N, 3.5)
  assert.equal(torque.samples[0].torque_external_Nm, 0.1)
  const pausedEvents = saved.results
    .flatMap((result) => result.events)
    .filter((event) => ['pause', 'resume'].includes(event.event_type))
  assert.equal(pausedEvents.length, 4)
  for (let index = 0; index < pausedEvents.length; index += 2) {
    assert.equal(pausedEvents[index].event_type, 'pause')
    assert.equal(pausedEvents[index].payload.reason, 'background')
    assert.equal(pausedEvents[index + 1].event_type, 'resume')
    assert.equal(pausedEvents[index].sim_time_s, pausedEvents[index + 1].sim_time_s)
  }
  for (const result of saved.results) {
    assert.equal(result.disturbance.validity, 'physical')
    assert.ok(result.samples.length > 2)
    assert.ok(result.events.some((event) => event.event_type === 'disturbance_start'))
    assert.ok(result.events.some((event) => event.event_type === 'disturbance_end'))
    assert.ok(result.events.some((event) => event.event_type === 'disturbance_result'))
  }
  browser('click', '#prepare-download')
  browser('wait', '#download')
  const afterPath = join(artifacts, 'source-after.json')
  browser('download', '#download', afterPath)
  const after = JSON.parse(readFileSync(afterPath, 'utf8'))
  verifyManifest(after.files, JSON.parse(after.files['manifest.json']))
  assert.equal(after.files['samples/chunk-000001.csv'], source.files['samples/chunk-000001.csv'])
  assert.deepEqual(
    JSON.parse(after.files['result.json']).endurance,
    JSON.parse(source.files['result.json']).endurance,
  )
  // Preserve and verify the simple source before switching to the standard case.
  browser('upload', '#verify-file', afterPath)
  browser('wait', '--text', '当前证据已导出并校验')
  browser('select', '#preset', 'standard')
  waitForConfig(browser, 'standard', 'swing-up')
  browser('click', '#start')
  for (let i = 0; i < 100 && Number(text('#time')) < 15; i++) {
    const status = text('#status')
    if (!['运行中', '准备就绪'].includes(status))
      throw new Error(`标准源实验提前结束：${status} ${text('#end-reason')}`)
    browser('wait', '1000')
  }
  assert.ok(Number(text('#time')) >= 15)
  browser('click', '#pause')
  browser('wait', '--text', '已暂停')
  browser('eval', "document.querySelector('details.download-options').open = true")
  browser('click', '#prepare-download')
  browser('wait', '#download')
  const standardPath = join(artifacts, 'source-standard.json')
  browser('download', '#download', standardPath)
  const standard = JSON.parse(readFileSync(standardPath, 'utf8'))
  verifyManifest(standard.files, JSON.parse(standard.files['manifest.json']))
  browser('upload', '#verify-file', standardPath)
  browser('wait', '--fn', "!document.querySelector('#run-disturbances').disabled")
  browser('click', '#run-disturbances')
  browser(
    'wait',
    '--fn',
    "document.querySelector('#disturbance-result').textContent.includes('标准工况 · 关节外力矩')",
  )
  assert.match(text('#disturbance-result'), /简单工况 · 水平外力/)
  browser('click', '#prepare-disturbance-download')
  browser('wait', '#download-disturbances')
  const bothPath = join(artifacts, 'disturbances-both.json')
  browser('scrollintoview', '#download-disturbances')
  browser('download', '#download-disturbances', bothPath)
  browser('upload', '#verify-disturbances', savedPath)
  browser('wait', '--text', '文件与当前扰动证据不一致')
  browser('upload', '#verify-disturbances', bothPath)
  browser('wait', '--text', '扰动证据已导出并校验')
  const both = JSON.parse(readFileSync(bothPath, 'utf8'))
  assert.equal(both.results.length, 4)
  const [standardForce, standardTorque] = both.results.slice(2)
  assert.equal(standardForce.source_experiment_id, standard.experiment_id)
  assert.equal(standardTorque.source_experiment_id, standard.experiment_id)
  assert.equal(standardForce.snapshot_sha256, standardTorque.snapshot_sha256)
  assert.equal(
    standardForce.snapshot_sha256,
    hash(JSON.stringify(standardForce.snapshot, null, 2) + '\n'),
  )
  assert.equal(standardForce.samples[0].force_external_N, 2)
  assert.equal(standardTorque.samples[0].torque_external_Nm, 0.1)
  assert.equal(new Set(both.results.map((result) => result.experiment_id)).size, 4)
  for (const result of both.results) assert.equal(result.disturbance.validity, 'physical')
  browser('screenshot', '--full', join(artifacts, 'both-presets.png'))
  // Exercise a single test, manual pause/resume, and termination while paused.
  browser('click', '#run-horizontal')
  browser('wait', '--fn', "!document.querySelector('#pause-disturbances').disabled")
  browser('click', '#pause-disturbances')
  browser('wait', '--fn', "!document.querySelector('#resume-disturbances').disabled")
  const manualPaused = text('#disturbance-current')
  browser('wait', '300')
  assert.equal(text('#disturbance-current'), manualPaused)
  browser('click', '#resume-disturbances')
  browser('wait', '--fn', "!document.querySelector('#pause-disturbances').disabled")
  browser('click', '#pause-disturbances')
  browser('wait', '--fn', "!document.querySelector('#resume-disturbances').disabled")
  browser('click', '#stop-disturbances')
  browser('wait', '--text', '用户终止')
  browser('wait', '--fn', "!document.querySelector('#run-torque').disabled")
  browser('click', '#run-torque')
  browser(
    'wait',
    '--fn',
    "(document.querySelector('#disturbance-result').textContent.match(/工况 · /g) || []).length === 6",
  )
  browser('click', '#prepare-disturbance-download')
  browser('wait', '#download-disturbances')
  const singlePath = join(artifacts, 'disturbances-single.json')
  browser('scrollintoview', '#download-disturbances')
  browser('download', '#download-disturbances', singlePath)
  const singles = JSON.parse(readFileSync(singlePath, 'utf8')).results
  assert.equal(singles.length, 6)
  assert.equal(singles[4].kind, 'horizontal')
  assert.equal(singles[4].disturbance.status, 'invalid')
  assert.ok(
    singles[4].events.some(
      (event) => event.event_type === 'pause' && event.payload.reason === 'manual',
    ),
  )
  assert.ok(singles[4].events.some((event) => event.event_type === 'stop'))
  assert.equal(singles[5].kind, 'torque')
  assert.ok(singles[5].events.some((event) => event.event_type === 'disturbance_result'))
  writeFileSync(
    join(artifacts, 'summary.json'),
    JSON.stringify(
      {
        status: 'passed',
        chrome: version.stdout.trim(),
        paused,
        sourcePath,
        savedPath,
        standardPath,
        bothPath,
        native_picker: 'not tested; download and actual file readback verified',
        visibility: 'controlled visibilitychange event',
        results: both.results.map((item) => ({
          id: item.experiment_id,
          kind: item.kind,
          result: item.disturbance.status,
        })),
      },
      null,
      2,
    ),
  )
  console.log(`扰动 Chrome 页面验证通过，证据位于：${artifacts}`)
} finally {
  writeFileSync(join(artifacts, 'browser-log.json'), JSON.stringify(log, null, 2))
  try {
    browser('close')
  } catch {
    /* Preserve original failure. */
  }
  if (server.pid)
    try {
      if (process.platform === 'win32') server.kill()
      else process.kill(-server.pid, 'SIGTERM')
    } catch {
      /* Already exited. */
    }
}
