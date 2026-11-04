import assert from 'node:assert/strict'
import {
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createBrowser } from './browser-driver.mjs'
import { readBuildIdentity } from './build-identity.ts'

// Real Chrome/FSA regression. Explicitly authorize a fresh disposable directory first.
// Debugger pauses after create and before start; OS permissions cause the real write failure.
const session = process.env.BROWSER_SESSION
const root = process.env.WORKSPACE_TEST_DIR && resolve(process.env.WORKSPACE_TEST_DIR)
const out = process.env.BROWSER_ARTIFACTS_DIR && resolve(process.env.BROWSER_ARTIFACTS_DIR)
assert.ok(
  session && root && out,
  'BROWSER_SESSION, WORKSPACE_TEST_DIR, BROWSER_ARTIFACTS_DIR required',
)
mkdirSync(out, { recursive: true })
assert.equal(
  readdirSync(out).length,
  0,
  'Preserve existing evidence; use a new artifacts directory',
)
const browser = createBrowser(session, [], join(out, 'browser-steps.jsonl'))
const save = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n')
const evaluate = (expression) => JSON.parse(browser('eval', expression, '--json')).data.result
const state = () =>
  evaluate(
    `Object.fromEntries(['progress','error','history','load','export','retry','resume','stop'].map(id => {const e=document.querySelector('#workspace-'+id); return [id,{text:e.textContent,value:e.value,disabled:e.disabled}]}))`,
  )
const summary = {
  status: 'failed',
  source: readBuildIdentity(process.cwd()),
  coverage: 'native-start-save-failure',
}
let socket, send, mode, temporary
try {
  const tabs = JSON.parse(browser('tab', 'list', '--json')).data.tabs
  const tab = tabs.find((t) => t.url === (process.env.BROWSER_URL ?? 'http://localhost:5183/'))
  assert.ok(tab, 'Named session must contain the test page')
  browser('tab', tab.tabId)
  assert.deepEqual(
    evaluate('JSON.parse(document.querySelector("#config").textContent).build_identity'),
    summary.source,
  )
  assert.deepEqual(JSON.parse(readFileSync('dist/build-info.json', 'utf8')), summary.source)
  const identity = JSON.parse(readFileSync(join(root, 'workspace.json'), 'utf8'))
  assert.match(browser('get', 'text', '#workspace-identity'), new RegExp(identity.workspace_id))
  assert.equal(browser('is', 'enabled', '#workspace-start'), 'true')
  assert.equal(evaluate('document.querySelector("#workspace-history").options.length'), 0)
  const processes = execFileSync('ps', ['-axo', 'pid,ppid,command'], { encoding: 'utf8' })
  const daemon = Number(readFileSync(join(homedir(), '.agent-browser', session + '.pid'), 'utf8'))
  const chrome = processes
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .find(
      (m) =>
        m &&
        Number(m[2]) === daemon &&
        m[3].startsWith(
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=',
        ),
    )
  assert.ok(chrome, 'Dedicated native Chrome process required')
  const profile = chrome[3].match(/--user-data-dir=(\S+)/)[1]
  const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]
  const targets = await (await fetch('http://localhost:' + port + '/json/list')).json()
  const worker = targets.find((t) => t.type === 'worker' && t.url.includes('workspace.worker-'))
  assert.ok(worker)
  socket = new WebSocket(worker.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  const events = [],
    pending = new Map()
  let sequence = 0
  socket.onmessage = ({ data }) => {
    const m = JSON.parse(data)
    if (m.id) {
      pending.get(m.id)?.(m)
      pending.delete(m.id)
    } else events.push(m)
  }
  send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence
      pending.set(id, (m) => (m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result)))
      socket.send(JSON.stringify({ id, method, params }))
    })
  await send('Debugger.enable')
  const parsed = events.find(
    (e) => e.method === 'Debugger.scriptParsed' && e.params.url === worker.url,
  )
  assert.ok(parsed)
  const { scriptSource } = await send('Debugger.getScriptSource', {
    scriptId: parsed.params.scriptId,
  })
  writeFileSync(join(out, 'worker.js'), scriptSource)
  const matches = [...scriptSource.matchAll(/await (\w+)\.start\(\)/g)]
  assert.equal(matches.length, 1, 'Fail closed if the production start location changes')
  const match = matches[0],
    lines = scriptSource.slice(0, match.index).split('\n')
  const location = {
    scriptId: parsed.params.scriptId,
    lineNumber: lines.length - 1,
    columnNumber: lines.at(-1).length,
  }
  const breakpoint = await send('Debugger.setBreakpoint', { location })
  save('armed.json', { worker, location, breakpoint, source: summary.source })
  browser('click', '#workspace-start')
  let paused
  for (let i = 0; i < 400; i++) {
    paused = events.find((e) => e.method === 'Debugger.paused')
    if (paused) break
    await new Promise((r) => setTimeout(r, 25))
  }
  assert.ok(paused, 'Production Worker must pause before start')
  const frame = await send('Debugger.evaluateOnCallFrame', {
    callFrameId: paused.params.callFrames[0].callFrameId,
    expression: match[1] + '.progress()',
    returnByValue: true,
  })
  assert.ok(!frame.exceptionDetails)
  const initial = frame.result.value
  assert.equal(initial.status, 'ready')
  assert.equal(initial.committed_sim_time_s, 0)
  save('paused.json', { paused, initial })
  cpSync(root, join(out, 'before-fault'), { recursive: true })
  const id = initial.experiment_id
  temporary = join(root, 'tmp')
  mode = statSync(temporary).mode & 0o777
  chmodSync(temporary, 0o555)
  await send('Debugger.removeBreakpoint', { breakpointId: breakpoint.breakpointId })
  await send('Debugger.resume')
  browser(
    'wait',
    '--fn',
    'document.querySelector("#workspace-progress").textContent.includes("状态 paused") && !document.querySelector("#workspace-retry").disabled',
  )
  summary.frozen = state()
  save('frozen.json', summary.frozen)
  browser('screenshot', join(out, 'frozen.png'))
  assert.match(summary.frozen.error.text, /NoModificationAllowedError/)
  assert.equal(summary.frozen.resume.disabled, true)
  assert.equal(summary.frozen.stop.disabled, true)
  assert.equal(
    summary.frozen.history.value,
    id,
    'Frozen experiment must be selected without a successful list refresh',
  )
  assert.equal(
    summary.frozen.load.disabled,
    false,
    'Recovery must remain available after start fails',
  )
  browser('click', '#workspace-load')
  browser('wait', '--fn', '!document.querySelector("#workspace-export").disabled')
  browser('click', '#workspace-export')
  let download
  const downloads = process.env.BROWSER_DOWNLOADS_DIR ?? join(homedir(), 'Downloads')
  for (let i = 0; i < 200; i++) {
    download = readdirSync(downloads).find(
      (n) => n.startsWith('recovery-' + id) && n.endsWith('.json'),
    )
    if (download) break
    await new Promise((r) => setTimeout(r, 25))
  }
  assert.ok(download, 'Actual Chrome download required')
  const recovered = JSON.parse(readFileSync(join(downloads, download), 'utf8'))
  cpSync(join(downloads, download), join(out, 'download.json'))
  assert.equal(recovered.recovery.diagnostics.experiment_id, id)
  assert.equal(recovered.recovery.diagnostics.confirmed_sim_time_s, 0)
  assert.equal(recovered.recovery.diagnostics.status, 'interrupted')
  assert.equal(recovered.live_fault.storage_fault.name, 'NoModificationAllowedError')
  assert.equal(recovered.live_fault.output.status, 'paused')
  assert.ok(recovered.live_fault.output.events.some((e) => e.event_type === 'storage_error'))
  // create() confirms the ready snapshot; start's first sample is still in the frozen tail.
  assert.equal(recovered.recovery.record.output.samples.length, 0)
  assert.equal(recovered.live_fault.output.samples.length, 1)
  browser('screenshot', join(out, 'recovery.png'))
  const manifest = JSON.parse(
    readFileSync(join(out, 'before-fault', 'experiments', id, 'manifest.json'), 'utf8'),
  )
  for (const entry of [
    manifest.config,
    manifest.snapshot,
    manifest.result,
    ...manifest.batches.flatMap((b) => b.files),
  ]) {
    assert.deepEqual(
      readFileSync(join(root, 'experiments', id, entry.path)),
      readFileSync(join(out, 'before-fault', 'experiments', id, entry.path)),
    )
  }
  chmodSync(temporary, mode)
  mode = undefined
  browser('click', '#workspace-retry')
  browser('wait', '--fn', '!document.querySelector("#workspace-stop").disabled')
  assert.match(browser('get', 'text', '#workspace-progress'), /状态 paused · 仿真 0.000/)
  browser('click', '#workspace-stop')
  browser(
    'wait',
    '--fn',
    'document.querySelector("#workspace-progress").textContent.includes("已封存（完整性确认）")',
  )
  cpSync(root, join(out, 'after-retry'), { recursive: true })
  summary.status = 'passed'
} catch (error) {
  summary.error = error.stack
  process.exitCode = 1
} finally {
  if (mode !== undefined) chmodSync(temporary, mode)
  if (send) await send('Debugger.disable').catch(() => {})
  socket?.close()
  save('summary.json', summary)
  console.log(JSON.stringify(summary))
}
