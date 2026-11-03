import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { validateProvenance } from './check-provenance.mjs'

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim()
const git = (...args) => run('git', args)
const api = (endpoint, ...options) => JSON.parse(run('gh', ['api', ...options, endpoint]))

function commit(file) {
  if (!file) throw new Error('commit requires a message file')
  validateProvenance(readFileSync(file, 'utf8'))
  const result = spawnSync('npx', ['--no', '--', 'commitlint', '--edit', file], {
    stdio: 'inherit',
  })
  if (result.status !== 0) throw new Error('commitlint failed')
  console.log('Commit message and provenance passed')
}

function tree(base, expected) {
  if (!base) throw new Error('tree requires a base ref')
  const baseSha = git('rev-parse', '--verify', `${base}^{commit}`)
  const treeSha = git('write-tree')
  if (expected && treeSha !== expected) throw new Error('Index tree changed since review')
  const unstaged = git('diff', '--name-only')
  const untracked = git('ls-files', '--others', '--exclude-standard')
  const files = git('diff', '--name-only', baseSha, treeSha)
  if (!files) throw new Error('Review diff is empty')
  console.log(JSON.stringify({ base: baseSha, tree: treeSha, files, unstaged, untracked }, null, 2))
}

function pr(repo, number, expectedHead) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') ||
    !/^\d+$/.test(number ?? '') ||
    !/^[a-f0-9]{40}$/.test(expectedHead ?? '')
  )
    throw new Error('pr requires owner/repo, number and expected full head SHA')
  const pull = api(`repos/${repo}/pulls/${number}`)
  if (pull.state !== 'open' || pull.draft || pull.head.sha !== expectedHead)
    throw new Error('PR is not open and ready at the expected head')
  validateProvenance(pull.body ?? '')
  const latestRun = () => {
    const pages = api(
      `repos/${repo}/actions/workflows/quality.yml/runs?event=pull_request&head_sha=${expectedHead}&per_page=100`,
      '--paginate',
      '--slurp',
    )
    return pages
      .flatMap((page) => page.workflow_runs)
      .filter(
        (run) =>
          run.head_sha === expectedHead &&
          run.event === 'pull_request' &&
          run.pull_requests.some((item) => item.number === Number(number)),
      )
      .sort((a, b) => b.id - a.id)[0]
  }
  const latest = latestRun()
  if (!latest || latest.status !== 'completed' || latest.conclusion !== 'success')
    throw new Error('Latest PR workflow run is missing, incomplete or unsuccessful')
  if (Date.parse(latest.created_at) < Date.parse(pull.updated_at))
    throw new Error('Latest PR workflow predates the last PR update; verify a fresh run')
  const jobsPages = api(
    `repos/${repo}/actions/runs/${latest.id}/jobs?per_page=100`,
    '--paginate',
    '--slurp',
  )
  const jobs = jobsPages.flatMap((page) => page.jobs)
  for (const name of ['Repository checks', 'PR title', 'AI provenance']) {
    if (
      !jobs.some(
        (job) => job.name === name && job.status === 'completed' && job.conclusion === 'success',
      )
    )
      throw new Error(`Required job did not pass: ${name}`)
  }
  // Re-read after the checks so an update during inspection cannot silently pass.
  const current = api(`repos/${repo}/pulls/${number}`)
  if (
    current.head.sha !== expectedHead ||
    current.updated_at !== pull.updated_at ||
    current.state !== 'open' ||
    current.draft
  )
    throw new Error('PR changed during verification; retry')
  const finalRun = latestRun()
  if (
    !finalRun ||
    finalRun.id !== latest.id ||
    finalRun.run_attempt !== latest.run_attempt ||
    finalRun.status !== 'completed' ||
    finalRun.conclusion !== 'success'
  )
    throw new Error('Latest PR workflow changed during verification; retry')
  console.log(
    JSON.stringify(
      {
        pr: number,
        head: expectedHead,
        base: pull.base.sha,
        run: latest.id,
        updated_at: pull.updated_at,
        jobs: jobs.map(({ name, conclusion }) => ({ name, conclusion })),
      },
      null,
      2,
    ),
  )
}

try {
  const [mode, ...args] = process.argv.slice(2)
  if (mode === 'commit' && args.length === 1) commit(...args)
  else if (mode === 'tree' && args.length >= 1 && args.length <= 2) tree(...args)
  else if (mode === 'pr' && args.length === 3) pr(...args)
  else
    throw new Error(
      'Use commit <message-file> | tree <base-ref> [reviewed-tree] | pr <owner/repo> <number> <head-sha>',
    )
} catch (error) {
  console.error(`Preflight: ${error.message}`)
  process.exitCode = 1
}
