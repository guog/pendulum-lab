import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { readBuildIdentity } from './build-identity.ts'

const chrome =
  process.env.CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!existsSync(chrome))
  throw new Error('请通过CHROME_EXECUTABLE指定已安装的Chrome；此检查不安装或替代真实目标浏览器。')
const chromeVersion = spawnSync(chrome, ['--version'], { encoding: 'utf8', timeout: 10_000 })
if (chromeVersion.status !== 0) throw new Error('无法读取指定Chrome的实际版本')
const artifacts = process.env.BROWSER_ARTIFACTS_DIR
  ? resolve(process.env.BROWSER_ARTIFACTS_DIR)
  : await mkdtemp(join(tmpdir(), 'pendulum-browser-'))
mkdirSync(artifacts, { recursive: true })
const session = `pendulum-smoke-${process.pid}`
const base = 'http://localhost:4173/'
const server = spawn('npm', ['run', 'preview'], {
  detached: process.platform !== 'win32',
  stdio: ['ignore', 'pipe', 'pipe'],
})
const log = []
function browser(...args) {
  const result = spawnSync(
    'npx',
    ['--yes', 'agent-browser@0.41.1', '--session', session, ...args],
    { encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
  )
  log.push({ args, status: result.status, stdout: result.stdout, stderr: result.stderr })
  if (result.status !== 0)
    throw new Error(`浏览器步骤失败：${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
  return result.stdout.trim()
}
const click = (name) => {
  const ids = {
    开始基准: '#start',
    暂停: '#pause',
    继续: '#pause',
    终止: '#stop',
    重置: '#reset',
    生成下载副本: '#prepare-download',
  }
  browser('scrollintoview', ids[name])
  return browser('find', 'role', 'button', 'click', '--name', name, '--exact')
}
const text = (selector) => browser('get', 'text', selector)
function verifyBundle(path) {
  const raw = readFileSync(path, 'utf8')
  const bundle = JSON.parse(raw)
  assert.equal(bundle.kind, 'pendulum-research-bundle')
  const config = JSON.parse(bundle.files['config.json'])
  const result = JSON.parse(bundle.files['result.json'])
  const manifest = JSON.parse(bundle.files['manifest.json'])
  assert.equal(config.experiment_id, bundle.experiment_id)
  assert.equal(result.experiment_id, bundle.experiment_id)
  assert.equal(
    config.environment.user_agent.match(/Chrome\/(\d+)/)?.[1],
    chromeVersion.stdout.match(/Chrome (\d+)/)?.[1],
  )
  assert.match(config.versions.build ?? '', /^[a-f0-9]{64}$/)
  const build = JSON.parse(readFileSync('dist/build-info.json', 'utf8'))
  assert.deepEqual(config.build_identity, build)
  assert.deepEqual(build, readBuildIdentity(process.cwd()))
  assert.equal(config.versions.build, build.source_sha256)
  assert.equal(
    build.source_revision,
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  )
  assert.equal(typeof build.source_dirty, 'boolean')
  assert.equal(result.formal_acceptance, 'not_eligible')
  for (const file of manifest.files) {
    assert.equal(createHash('sha256').update(bundle.files[file.path]).digest('hex'), file.sha256)
    assert.equal(Buffer.byteLength(bundle.files[file.path]), file.byte_length)
  }
  const lines = bundle.files['samples/chunk-000001.csv'].trim().split('\n')
  assert.equal(lines.length - 1, result.sample_count)
  assert.ok(lines.slice(1).every((line) => !/NaN|Infinity/.test(line)))
  return { bundle, config, result, lines }
}
function downloadAndVerify(filename) {
  if (
    JSON.parse(browser('eval', "document.querySelector('details.download-options').open", '--json'))
      .data.result !== true
  ) {
    browser('scrollintoview', 'details.download-options')
    browser('find', 'text', '下载副本与文件校验', 'click', '--exact')
  }
  click('生成下载副本')
  browser('wait', '#download')
  assert.match(text('#record-state'), /尚未确认导出/)
  const path = join(artifacts, filename)
  browser('scrollintoview', '#download')
  browser('download', '#download', path)
  const data = verifyBundle(path)
  assert.match(text('#record-state'), /尚未确认导出/)
  const wrong = join(artifacts, `wrong-${filename}`)
  writeFileSync(wrong, readFileSync(path, 'utf8') + ' ')
  browser('upload', '#verify-file', wrong)
  browser('wait', '--text', '文件与当前证据包不一致')
  assert.match(text('#record-state'), /尚未确认导出/)
  browser('upload', '#verify-file', path)
  browser('wait', '--text', '当前证据已导出并校验')
  return { path, ...data }
}
try {
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error('静态预览服务未能启动')), 15_000)
    const listener = (data) => {
      const message = data.toString()
      if (message.includes('http://localhost:4173/')) {
        clearTimeout(timeout)
        resolveReady()
      }
    }
    server.stdout.on('data', listener)
    server.stderr.on('data', (data) => log.push({ server_error: data.toString() }))
    server.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`预览服务提前退出：${code}`))
    })
  })
  browser('--executable-path', chrome, 'open', base)
  browser('set', 'viewport', '1440', '1000')
  browser('wait', '--text', '准备就绪')
  assert.match(browser('get', 'title'), /一阶倒立摆实验台/)
  browser('focus', '#preset')
  browser('screenshot', join(artifacts, 'desktop-ready.png'))
  click('开始基准')
  browser('wait', '--text', '运行中')
  click('暂停')
  browser('wait', '--text', '已暂停')
  const paused = text('#time')
  browser('wait', '200')
  assert.equal(text('#time'), paused)
  click('继续')
  browser('wait', '--text', '运行中')
  const tabs = JSON.parse(browser('tab', 'list', '--json')).data.tabs
  const appTab = tabs.find((tab) => tab.url === base).tabId
  browser('tab', 'new', 'about:blank')
  browser('tab', appTab)
  browser('wait', '--text', '已暂停')
  const backgroundPaused = text('#time')
  browser('wait', '200')
  assert.equal(text('#time'), backgroundPaused)
  click('继续')
  click('终止')
  browser('wait', '--text', '已终止')
  browser('screenshot', '--full', join(artifacts, 'desktop-stopped.png'))
  const first = downloadAndVerify('release-evidence.json')
  const events = first.bundle.files['events/part-000001.jsonl'].trim().split('\n').map(JSON.parse)
  assert.ok(
    events.some((event) => event.event_type === 'pause' && event.payload.reason === 'background'),
  )
  assert.ok(
    events.some(
      (event) =>
        event.event_type === 'export' &&
        event.payload.stage === 'requested' &&
        event.payload.persistence_confirmed === false,
    ),
  )
  assert.equal(first.result.status, 'stopped')
  assert.equal(first.config.initial_state.theta_unwrapped_rad, Math.PI / 2)
  click('重置')
  browser('wait', '--text', '准备就绪')
  assert.equal(text('#time'), '0.000')
  assert.equal(text('#sample-count'), '0')
  browser('select', '#preset', 'simple')
  browser('select', '#benchmark', 'equilibrium')
  browser('wait', '--text', '静止下垂')
  click('开始基准')
  browser('wait', '--text', '基准已结束')
  assert.equal(text('#time'), '10.000')
  assert.equal(text('#sample-count'), '1001')
  const second = downloadAndVerify('equilibrium-evidence.json')
  assert.notEqual(first.bundle.experiment_id, second.bundle.experiment_id)
  assert.equal(second.config.preset, 'simple')
  assert.equal(second.config.benchmark, 'equilibrium')
  assert.equal(second.result.status, 'completed')
  const columns = second.lines[0].split(',')
  for (const line of second.lines.slice(1)) {
    const values = line.split(',')
    assert.equal(Number(values[columns.indexOf('cart_x_m')]), 0)
    assert.equal(Number(values[columns.indexOf('theta_unwrapped_rad')]), Math.PI)
  }
  const accessibility = JSON.parse(browser('a11y', '--json'))
  assert.equal(accessibility.data.counts.violations, 0)
  writeFileSync(join(artifacts, 'accessibility.json'), JSON.stringify(accessibility, null, 2))
  browser('screenshot', '--full', join(artifacts, 'desktop-completed.png'))
  browser('set', 'viewport', '1100', '900')
  browser('screenshot', '--full', join(artifacts, 'desktop-1100.png'))
  const overflow = JSON.parse(
    browser(
      'eval',
      'JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth})',
      '--json',
    ),
  ).data
  log.push({ overflow })
  const dimensions =
    typeof overflow.result === 'string' ? JSON.parse(overflow.result) : overflow.result
  assert.ok(dimensions.scroll <= dimensions.width, '桌面视口存在横向溢出')
  // Controlled DOM visibility event exercises start-before-worker-ack ordering;
  // the separate tab-switch scenario above checks actual browser visibility.
  click('重置')
  browser('wait', '--text', '准备就绪')
  browser(
    'eval',
    `document.querySelector('#start').click(); Object.defineProperty(document, 'hidden', {configurable:true, get:()=>true}); document.dispatchEvent(new Event('visibilitychange'))`,
  )
  browser('wait', '--text', '已暂停')
  const raceTime = text('#time')
  assert.equal(raceTime, '0.000')
  browser('wait', '200')
  assert.equal(text('#time'), raceTime)
  browser('eval', `delete document.hidden; document.dispatchEvent(new Event('visibilitychange'))`)
  assert.equal(text('#status'), '已暂停')
  assert.equal(text('#time'), raceTime)
  writeFileSync(
    join(artifacts, 'summary.json'),
    JSON.stringify(
      {
        status: 'passed',
        scenario: 'T01 real Chrome + macOS + localhost',
        chrome,
        chrome_version: chromeVersion.stdout.trim(),
        user_agent: first.config.environment.user_agent,
        build_identity: first.config.build_identity,
        release_experiment_id: first.bundle.experiment_id,
        equilibrium_experiment_id: second.bundle.experiment_id,
        equilibrium_samples: second.result.sample_count,
        controlled_start_before_ack_visibility_regression: 'passed',
        artifacts,
      },
      null,
      2,
    ),
  )
  console.log(`真实浏览器检查通过，证据位于：${artifacts}`)
} finally {
  writeFileSync(join(artifacts, 'browser-log.json'), JSON.stringify(log, null, 2))
  try {
    browser('close')
  } catch {
    /* Preserve the original failure. */
  }
  if (server.pid) {
    try {
      if (process.platform === 'win32') server.kill()
      else process.kill(-server.pid, 'SIGTERM')
    } catch {
      /* Already exited. */
    }
  }
}
