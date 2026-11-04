import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createBrowser } from './browser-driver.mjs'
import { readBuildIdentity } from './build-identity.ts'
import { isDeepStrictEqual } from 'node:util'

const session = process.env.BROWSER_SESSION
const destination = process.env.BROWSER_ARTIFACTS_DIR
const issues = []
if (!session) issues.push('BROWSER_SESSION: provide an existing named Chrome test session')
if (!destination) issues.push('BROWSER_ARTIFACTS_DIR: provide a new evidence directory')
const report = {
  status: 'blocked',
  coverage: 'environment-preflight',
  native_picker: 'not_exercised',
  issues,
}
let artifacts
let ownEvidence = false
try {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--preflight'))
    issues.push('Only --preflight is supported; configure BROWSER_URL via environment')
  const url = new URL(process.env.BROWSER_URL ?? 'http://localhost:5183/')
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.hash
  )
    issues.push('BROWSER_URL: use an explicit loopback test URL')
  report.url = url.href
  if (destination) {
    artifacts = resolve(destination)
    mkdirSync(artifacts, { recursive: true })
    if (readdirSync(artifacts).length)
      throw new Error('Use a new evidence directory; existing evidence is preserved')
    ownEvidence = true
  }
  const chrome =
    process.env.CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  if (!existsSync(chrome))
    issues.push('CHROME_EXECUTABLE: Chrome is not installed at the configured path')
  if (!issues.length) {
    const version = spawnSync(chrome, ['--version'], { encoding: 'utf8', timeout: 10000 })
    if (version.status !== 0 || !/Google Chrome \d+/.test(version.stdout))
      throw new Error('Cannot identify real Google Chrome')
    report.chrome = version.stdout.trim()
    const source = readBuildIdentity(process.cwd())
    const build = JSON.parse(
      readFileSync(process.env.BROWSER_BUILD_INFO ?? 'dist/build-info.json', 'utf8'),
    )
    if (!isDeepStrictEqual(source, build))
      throw new Error('Build identity is stale; rebuild this source before testing')
    report.source = source
    const browser = createBrowser(session, [], join(artifacts, 'browser-steps.jsonl'))
    const tabs = JSON.parse(browser('tab', 'list', '--json')).data.tabs
    const tab = tabs.find((t) => t.url === url.href)
    if (!tab) throw new Error(`Existing session has no test page at ${url.href}`)
    browser('tab', tab.tabId)
    const evaluated = JSON.parse(
      browser(
        'eval',
        `({ build_identity:JSON.parse(document.querySelector('#config').textContent).build_identity, userAgent:navigator.userAgent, secure:isSecureContext, picker:typeof window.showDirectoryPicker==='function', writable:document.querySelector('#workspace-identity')?.textContent.includes('可写'), ready:document.querySelector('#workspace-start')?.disabled===false })`,
        '--json',
      ),
    ).data.result
    const state = typeof evaluated === 'string' ? JSON.parse(evaluated) : evaluated
    if (
      !state.userAgent?.includes('Chrome/' + version.stdout.match(/Google Chrome (\d+)/)[1] + '.')
    )
      issues.push('Named session is not the configured Chrome version')
    if (!isDeepStrictEqual(state.build_identity, source))
      issues.push('Page build identity does not match the current source')
    if (!state.secure || !state.picker)
      issues.push('Native directory API unavailable in this secure context')
    if (!state.writable)
      issues.push(
        'Explicitly select and authorize a disposable test directory in this session first',
      )
    else if (!state.ready)
      issues.push('Workspace is not ready; finish any existing test run before continuing')
    if (!issues.length) report.status = 'ready'
  }
} catch (error) {
  issues.push(error.message)
}
try {
  if (ownEvidence)
    writeFileSync(join(artifacts, 'preflight.json'), JSON.stringify(report, null, 2) + '\n')
} catch (error) {
  issues.push(`Cannot write evidence: ${error.message}`)
  report.status = 'blocked'
}
if (issues.length) {
  console.error(JSON.stringify(report))
  process.exitCode = 1
} else if (process.argv.includes('--preflight')) console.log(JSON.stringify(report))
else {
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/browser-workspace-visibility.mjs')],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        BROWSER_URL: report.url,
        BROWSER_SESSION: session,
        BROWSER_ARTIFACTS_DIR: artifacts,
      },
    },
  )
  process.exitCode = result.status ?? 1
}
