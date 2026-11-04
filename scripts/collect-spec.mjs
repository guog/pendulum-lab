import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const api = (path) =>
  JSON.parse(
    execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
  )
try {
  const [repo, number, destination, ...extra] = process.argv.slice(2)
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') ||
    !/^[1-9]\d*$/.test(number ?? '') ||
    !destination ||
    extra.length
  )
    throw new Error('Use collect-spec.mjs owner/repo issue-number output.json')
  const sources = [],
    seen = new Set(),
    visiting = new Set()
  function collect(number) {
    if (visiting.has(number)) throw new Error('Parent specification cycle')
    if (seen.has(number)) return
    if (seen.size >= 100) throw new Error('Too many parent specifications')
    visiting.add(number)
    const issue = api(`repos/${repo}/issues/${number}`)
    const body = issue.body ?? ''
    sources.push({
      number,
      title: issue.title,
      url: issue.html_url,
      body,
      body_sha256: createHash('sha256').update(body).digest('hex'),
    })
    seen.add(number)
    let parent
    try {
      parent = api(`repos/${repo}/issues/${number}/parent`).number
    } catch (error) {
      if (!String(error.stderr).includes('HTTP 404')) throw error
    }
    if (parent) collect(parent)
    const explicit = [...body.matchAll(/^Part of\s+#(\d+)\b/gim)].map((m) => Number(m[1]))
    const section = body.match(/^## Parent\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1] ?? ''
    for (const match of section.matchAll(/https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/g))
      if (match[1] === repo) explicit.push(Number(match[2]))
    for (const linked of explicit) collect(linked)
    visiting.delete(number)
  }
  collect(Number(number))
  writeFileSync(
    destination,
    JSON.stringify({ schema_version: 1, repo, root_issue: Number(number), sources }, null, 2) +
      '\n',
  )
  console.log(JSON.stringify({ destination, issues: sources.map((s) => s.number) }))
} catch (error) {
  console.error(`Spec collection: ${error.message}`)
  process.exitCode = 1
}
