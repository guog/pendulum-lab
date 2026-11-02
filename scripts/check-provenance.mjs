import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Read only the final paragraph so examples in the body cannot act as disclosure.
export function validateProvenance(text) {
  const footer = text
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .at(-1)
  const fields = new Map()
  for (const line of footer.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z-]*): (\S.*)$/.exec(line)
    if (!match) throw new Error('End with a plain-text provenance trailer block')
    const [, key, value] = match
    if (fields.has(key)) throw new Error(`Duplicate trailer: ${key}`)
    fields.set(key, value.trim())
  }
  const assisted = fields.get('Assisted-by')
  const usage = fields.get('AI-Usage')
  if (assisted && usage) throw new Error('Conflicting AI provenance declarations')
  if (assisted === 'LLM' && fields.get('AI-Agent')) return
  if (!assisted && !fields.has('AI-Agent') && usage === 'none') return
  if (
    !assisted &&
    !fields.has('AI-Agent') &&
    usage === 'automation' &&
    fields.get('Automation-Agent')
  )
    return
  throw new Error(
    'Require Assisted-by: LLM + AI-Agent, AI-Usage: none, or AI-Usage: automation + Automation-Agent',
  )
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function checkRange(base, head) {
  if (![base, head].every((sha) => /^[a-f0-9]{40}$/.test(sha))) {
    throw new Error('Expected full base and head commit SHAs')
  }
  const legacy = JSON.parse(
    readFileSync(new URL('../.github/ai-provenance-legacy.json', import.meta.url)),
  )
  for (const sha of git('rev-list', '--reverse', `${base}..${head}`).split('\n').filter(Boolean)) {
    const message = git('show', '-s', '--format=%B', sha)
    if (Object.hasOwn(legacy, sha)) {
      validateProvenance(legacy[sha])
      console.log(`${sha}: disclosed in historical ledger`)
    } else {
      validateProvenance(message)
      console.log(`${sha}: provenance present`)
    }
  }
}

function main() {
  const [mode, file] = process.argv.slice(2)
  if (mode === '--edit') {
    validateProvenance(readFileSync(file, 'utf8'))
  } else if (mode === '--event') {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
    if (event.comment) {
      validateProvenance(event.comment.body ?? '')
    } else if (event.pull_request) {
      validateProvenance(event.pull_request.body ?? '')
      checkRange(event.pull_request.base.sha, event.pull_request.head.sha)
    } else if (event.issue) {
      validateProvenance(event.issue.body ?? '')
    } else {
      throw new Error('Unsupported event')
    }
  } else {
    throw new Error('Use --edit <message-file> or --event')
  }
  console.log('AI provenance check passed')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(`AI provenance: ${error.message}`)
    process.exitCode = 1
  }
}
