import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

export function pullInputs(repository, pull) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') ||
    !Number.isSafeInteger(pull?.number) ||
    pull.number < 1 ||
    !/^[a-f0-9]{40}$/.test(pull.head?.sha ?? '') ||
    !/^[a-f0-9]{40}$/.test(pull.base?.sha ?? '') ||
    typeof pull.title !== 'string' ||
    (pull.body !== null && typeof pull.body !== 'string')
  )
    throw new Error('Invalid PR check inputs')
  const hash = (value) => createHash('sha256').update(value).digest('hex')
  return {
    schema_version: 1,
    repository,
    pr: pull.number,
    head: pull.head.sha,
    base: pull.base.sha,
    title_sha256: hash(pull.title),
    body_sha256: hash(pull.body ?? ''),
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [eventFile, destination, ...extra] = process.argv.slice(2)
    if (!eventFile || !destination || extra.length)
      throw new Error('Use ci-inputs.mjs event.json output.json')
    const event = JSON.parse(readFileSync(eventFile, 'utf8'))
    const run_id = Number(process.env.GITHUB_RUN_ID),
      run_attempt = Number(process.env.GITHUB_RUN_ATTEMPT)
    if (
      !Number.isSafeInteger(run_id) ||
      run_id < 1 ||
      !Number.isSafeInteger(run_attempt) ||
      run_attempt < 1
    )
      throw new Error('Invalid CI run identity')
    const inputs = {
      ...pullInputs(event.repository?.full_name, event.pull_request),
      run_id,
      run_attempt,
    }
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, JSON.stringify(inputs, null, 2) + '\n')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
