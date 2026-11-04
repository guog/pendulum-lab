import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyRecordContract } from './record-contract.mjs'
import { buildEvidence } from '../src/evidence.ts'
import { createConfig, createSession } from '../src/session.ts'
import { openWorkspace } from '../src/workspace.ts'

const id = '00000000-0000-4000-8000-000000000013'
// Hand-authored values from Issue #4 D-02/D-03, independent of either writer.
const fixture = () => ({
  'config.json': JSON.stringify({ schema_version: 1, experiment_id: id }),
  'manifest.json': JSON.stringify({
    schema_version: 1,
    sample_schema_version: 1,
    experiment_id: id,
  }),
  'result.json': JSON.stringify({ schema_version: 1, experiment_id: id }),
  'snapshots/one.json': JSON.stringify({ schema_version: 1, experiment_id: id }),
  'events/one.jsonl': JSON.stringify({ schema_version: 1, experiment_id: id }) + '\n',
})

test('both public writers produce records satisfying the independent CSV contract', async () => {
  const config = createConfig('standard', 'equilibrium')
  const session = createSession(config)
  session.start()
  session.advance(0.01)
  session.stop()
  const output = session.read()
  const memory = (await buildEvidence(output)).files
  verifyRecordContract(memory, output.experiment_id)
  const data = new Map()
  const files = {
    async permission() {
      return true
    },
    async list(path) {
      const prefix = path ? path + '/' : ''
      return [
        ...new Set(
          [...data.keys()]
            .filter((k) => k.startsWith(prefix))
            .map((k) => k.slice(prefix.length).split('/')[0]),
        ),
      ]
    },
    async read(path) {
      if (!data.has(path)) throw new Error('missing')
      return data.get(path)
    },
    async write(path, text) {
      data.set(path, text)
    },
  }
  const workspace = await openWorkspace(files)
  const run = await workspace.create(config)
  await run.start()
  await run.advance(0.01)
  await run.stop()
  const prefix = `experiments/${run.id}/`
  const directory = Object.fromEntries(
    [...data].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]),
  )
  verifyRecordContract(
    { ...directory, 'workspace.json': await files.read('workspace.json') },
    run.id,
    workspace.id,
  )
  for (const [records, recordId] of [
    [memory, output.experiment_id],
    [directory, run.id],
  ]) {
    const path = Object.keys(records).find((k) => k.startsWith('samples/'))
    const broken = {
      ...records,
      [path]: records[path].replace('sample_index', 'unrecognized_column'),
    }
    assert.throws(() => verifyRecordContract(broken, recordId), /CSV header/)
  }
})
test('independent record contract accepts v1 and refuses absent or unknown format and identity', () => {
  const files = fixture()
  assert.doesNotThrow(() => verifyRecordContract(files, id))
  for (const [path, field, bad] of [
    ['manifest.json', 'sample_schema_version', undefined],
    ['manifest.json', 'sample_schema_version', 999],
    ['snapshots/one.json', 'schema_version', undefined],
    ['config.json', 'experiment_id', 'another-experiment'],
    ['result.json', 'schema_version', '1'],
    ['events/one.jsonl', 'schema_version', null],
  ]) {
    const broken = fixture()
    broken[path] = JSON.stringify({ ...JSON.parse(broken[path]), [field]: bad })
    assert.throws(() => verifyRecordContract(broken, id), new RegExp(field))
  }
})

test('directory contract independently verifies root workspace version and identity', () => {
  const workspaceId = '00000000-0000-4000-8000-000000000014'
  for (const patch of [
    { schema_version: 999 },
    { schema_version: undefined },
    { workspace_id: '' },
    { workspace_id: undefined },
    { workspace_id: id },
  ]) {
    const files = {
      ...fixture(),
      'workspace.json': JSON.stringify({ schema_version: 1, workspace_id: workspaceId, ...patch }),
    }
    assert.throws(() => verifyRecordContract(files, id, workspaceId), /workspace.json/)
  }
  assert.throws(() => verifyRecordContract(fixture(), id, workspaceId), /workspace.json/)
  assert.doesNotThrow(() =>
    verifyRecordContract(
      {
        ...fixture(),
        'workspace.json': JSON.stringify({ schema_version: 1, workspace_id: workspaceId }),
      },
      id,
      workspaceId,
    ),
  )
})
