import { createBrowser } from './browser-driver.mjs'
import { readBuildIdentity } from './build-identity.ts'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'

// Attach only to a named test session after the user explicitly selected a test directory.
// No fake picker, Worker, handle or browser-internal persistence is used.
const session = process.env.BROWSER_SESSION
const destination = process.env.BROWSER_ARTIFACTS_DIR
if (!session || !destination)
  throw new Error('先在命名Chrome会话选择测试目录，再提供BROWSER_SESSION和BROWSER_ARTIFACTS_DIR。')
const artifacts = resolve(destination)
mkdirSync(artifacts, { recursive: true })
const drive = createBrowser(session, [], join(artifacts, 'browser-steps.jsonl'))
const tabs = JSON.parse(drive('tab', 'list', '--json')).data.tabs
const url = new URL(process.env.BROWSER_URL ?? 'http://localhost:5183/').href
const appTab = tabs.find((tab) => tab.url === url)?.tabId
if (!appTab) throw new Error(`命名会话缺少 ${url} 测试页面`)
// Keep every DOM operation on the app tab even if another tab becomes active.
const browser = (...args) => {
  if (args[0] !== 'tab') drive('tab', appTab)
  return drive(...args)
}
const text = (selector) => browser('get', 'text', selector)
const ready = () => browser('wait', '--fn', '!document.querySelector("#workspace-pause").disabled')
const paused = () =>
  browser(
    'wait',
    '--fn',
    'document.querySelector("#workspace-progress").textContent.includes("状态 paused") && !document.querySelector("#workspace-stop").disabled',
  )
const time = () => Number(text('#workspace-progress').match(/仿真 ([\d.]+) s/)?.[1])
const hideWith = (button) =>
  browser(
    'eval',
    `document.querySelector('${button}').click(); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'))`,
  )
const reveal = () =>
  browser('eval', 'delete document.hidden; document.dispatchEvent(new Event("visibilitychange"))')
const summary = {
  status: 'failed',
  source: JSON.parse(
    readFileSync(process.env.BROWSER_BUILD_INFO ?? 'dist/build-info.json', 'utf8'),
  ),
  url,
  coverage: ['authorized-directory-session', 'visibility', 'history-signal-colors'],
  native_picker: 'not_exercised_by_this_script',
}
assert.deepEqual(summary.source, readBuildIdentity(process.cwd()))
try {
  assert.match(text('#workspace-identity'), /可写/)
  assert.equal(browser('is', 'enabled', '#workspace-start'), 'true')
  // Same JS turn: the hide event necessarily precedes the first Worker acknowledgement.
  hideWith('#workspace-start')
  paused()
  assert.equal(time(), 0)
  reveal()
  browser('wait', '200')
  assert.equal(time(), 0)
  assert.match(text('#workspace-progress'), /状态 paused/)
  summary.start_before_ack = 'passed'

  hideWith('#workspace-resume')
  paused()
  assert.equal(time(), 0)
  reveal()
  browser('wait', '200')
  assert.equal(time(), 0)
  assert.match(text('#workspace-progress'), /状态 paused/)
  summary.resume_before_ack = 'passed'

  browser('click', '#workspace-resume')
  ready()
  browser(
    'wait',
    '--fn',
    'Number(document.querySelector("#workspace-progress").textContent.match(/仿真 ([\\d.]+) s/)[1]) > 0',
  )
  browser('tab', 'new', 'about:blank')
  browser('tab', appTab)
  paused()
  const backgroundTime = time()
  browser('wait', '200')
  assert.equal(time(), backgroundTime)
  summary.native_tab_background = 'passed'
  browser('click', '#workspace-stop')
  browser(
    'wait',
    '--fn',
    'document.querySelector("#workspace-progress").textContent.includes("已封存（完整性确认）") && !document.querySelector("#workspace-load").disabled',
  )
  browser(
    'wait',
    '--fn',
    'document.querySelector("#workspace-record").textContent.includes("sealed-verified")',
  )
  browser('click', '#workspace-record details:nth-of-type(4) summary')
  const events = JSON.parse(text('#workspace-record details:nth-of-type(4) pre'))
  assert.equal(
    events.filter((e) => e.event_type === 'pause' && e.payload.reason === 'background').length,
    3,
  )
  assert.equal(events.filter((e) => e.event_type === 'resume').length, 2)
  assert.equal(events.at(-1).event_type, 'stop')
  assert.equal(events[1].sim_time_s, 0)
  const rendered = JSON.parse(
    browser(
      'eval',
      `JSON.stringify([...document.querySelectorAll('#workspace-record canvas')].map((canvas, index) => {
    const expected = [[49,95,158],[8,119,107],[153,96,24],[130,85,161]][index];
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let matches = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === expected[0] && pixels[i+1] === expected[1] && pixels[i+2] === expected[2] && pixels[i+3] === 255) matches++;
    }
    return { expected, matches };
  }))`,
      '--json',
    ),
  ).data
  const colors = typeof rendered.result === 'string' ? JSON.parse(rendered.result) : rendered.result
  assert.equal(colors.length, 4)
  assert.ok(
    colors.every((item) => item.matches > 0),
    `历史曲线配色不符: ${JSON.stringify(colors)}`,
  )
  summary.history_signal_colors = colors
  summary.status = 'passed'
  summary.final_progress = text('#workspace-progress')
  summary.events = events
  browser('scrollintoview', '#workspace-progress')
  browser('screenshot', join(artifacts, 'paused-and-sealed.png'))
} catch (error) {
  summary.error = String(error)
  summary.final_progress = text('#workspace-progress')
  browser('screenshot', join(artifacts, 'failed.png'))
  throw error
} finally {
  writeFileSync(join(artifacts, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  // Preserve the failed experiment in its selected directory; never discard it on assertion failure.
  reveal()
  browser(
    'wait',
    '--fn',
    '!document.querySelector("#workspace-stop").disabled || !document.querySelector("#workspace-start").disabled',
  )
  if (browser('is', 'enabled', '#workspace-stop') === 'true') {
    browser('click', '#workspace-stop')
    browser(
      'wait',
      '--fn',
      'document.querySelector("#workspace-progress").textContent.includes("已封存（完整性确认）")',
    )
  }
}
