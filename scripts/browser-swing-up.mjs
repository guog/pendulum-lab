import { createBrowser, waitForConfig, verifyManifest } from './browser-driver.mjs'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const dir = process.env.BROWSER_ARTIFACTS_DIR ?? '/tmp/pendulum-issue9-browser'
mkdirSync(dir, { recursive: true })
const server = spawn('npm', ['run', 'preview'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
})
const log = []
const browser = createBrowser(`issue9-${process.pid}`, log, `${dir}/steps.jsonl`)
try {
  await new Promise((resolve, reject) => {
    let timer = setTimeout(() => reject(Error('server timeout')), 15000)
    server.stdout.on('data', (d) => {
      if (String(d).includes('localhost:4173')) {
        clearTimeout(timer)
        resolve()
      }
    })
    server.on('exit', reject)
  })
  browser(
    '--executable-path',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'open',
    'http://localhost:4173/',
  )
  waitForConfig(browser, 'standard')
  browser('select', '#benchmark', 'swing-up')
  waitForConfig(browser, 'simple', 'swing-up')
  assert.equal(
    JSON.parse(browser('eval', "document.querySelector('#preset').disabled", '--json')).data.result,
    true,
  )
  assert.equal(
    JSON.parse(browser('eval', "document.querySelector('#preset').value", '--json')).data.result,
    'simple',
  )
  browser('click', '#start')
  browser(
    'wait',
    '--fn',
    "document.querySelector('#status').textContent === '基准已结束' || document.querySelector('#status').textContent === '计算已冻结' || document.querySelector('#status').textContent === '已终止'",
  )
  const text = browser('get', 'text', '#end-reason')
  console.log('页面结果:', text)
  browser('screenshot', '--full', `${dir}/result.png`)
  browser('eval', "document.querySelector('details.download-options').open=true")
  browser('click', '#prepare-download')
  browser('wait', '#download')
  browser('download', '#download', `${dir}/evidence.json`)
  const bundle = JSON.parse(readFileSync(`${dir}/evidence.json`))
  const result = JSON.parse(bundle.files['result.json'])
  verifyManifest(bundle.files, JSON.parse(bundle.files['manifest.json']))
  console.log(
    '首次稳定状态:',
    result.first_stable.status,
    '仿真时间:',
    result.first_stable.snapshot?.sim_time_s,
  )
  assert.equal(result.first_stable.status, 'passed')
  assert.ok(bundle.files['snapshot.json'])
  assert.match(text, /候选快照待导出校验/)
  assert.equal(result.first_stable.disturbance_eligibility, 'blocked_pending_export')
  browser('upload', '#verify-file', `${dir}/evidence.json`)
  browser('wait', '--text', '当前证据已导出并校验')
  browser(
    'wait',
    '--fn',
    "document.querySelector('#end-reason').textContent.includes('快照证据已导出校验')",
  )
  writeFileSync(
    `${dir}/summary.json`,
    JSON.stringify(
      {
        text,
        result: result.first_stable,
        controller: JSON.parse(bundle.files['controller.json']),
        experiment_id: bundle.experiment_id,
      },
      null,
      2,
    ),
  )
} finally {
  try {
    browser('close')
  } catch {}
  try {
    process.kill(-server.pid, 'SIGTERM')
  } catch {}
}
