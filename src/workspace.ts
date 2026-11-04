import { createSession, type ExperimentConfig, type SessionOutput } from './session.ts'
import { validateConfig } from './config.ts'
import { buildEvidence, buildResult, sha256, sampleColumns } from './evidence.ts'

// The only persistence boundary: callers supply the directory explicitly on every open.
export interface WorkspaceFiles {
  permission(mode: 'read' | 'readwrite'): Promise<boolean>
  list(path: string): Promise<string[]>
  read(path: string): Promise<string>
  write(path: string, text: string): Promise<void>
}
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
const bytes = (text: string) => new TextEncoder().encode(text).byteLength
const safePath = (path: string) =>
  /^[a-zA-Z0-9_./-]+$/.test(path) && !path.split('/').some((p) => !p || p === '.' || p === '..')
type Entry = { path: string; byte_length: number; sha256: string }
type Batch = {
  sample_count: number
  event_count: number
  first_sample_index: number | null
  last_sample_index: number | null
  first_event_index: number | null
  last_event_index: number | null
  first_time_s: number | null
  last_time_s: number | null
  files: Entry[]
}
type Manifest = {
  schema_version: 1
  experiment_id: string
  revision: number
  config: Entry
  committed_sim_time_s: number
  sample_count: number
  event_count: number
  sealed: boolean
  batches: Batch[]
  snapshot: Entry
  result: Entry
}
async function checkedRead(files: WorkspaceFiles, entry: Entry, prefix: string) {
  if (
    !entry ||
    !safePath(entry.path) ||
    !Number.isSafeInteger(entry.byte_length) ||
    entry.byte_length < 0 ||
    entry.byte_length > 64 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(entry.sha256)
  )
    throw new Error('非法文件引用')
  const text = await files.read(prefix + entry.path)
  if (bytes(text) !== entry.byte_length || (await sha256(text)) !== entry.sha256)
    throw new Error(`完整性校验失败：${entry.path}`)
  return text
}
async function publish(files: WorkspaceFiles, path: string, text: string): Promise<Entry> {
  // Temporary content is closed and checked before publishing a final file.
  await files.write('tmp/pending.json', text)
  if ((await files.read('tmp/pending.json')) !== text) throw new Error('临时文件读回校验失败')
  await files.write(path, text)
  if ((await files.read(path)) !== text) throw new Error('发布文件读回校验失败')
  return { path, byte_length: bytes(text), sha256: await sha256(text) }
}
export async function openWorkspace(files: WorkspaceFiles) {
  if (!(await files.permission('read'))) throw new Error('无读权限')
  const names = await files.list('')
  const writable = await files.permission('readwrite')
  if (!names.length) {
    if (!writable) throw new Error('空目录无写权限')
    // Identity is published first: no unrelated nonempty directory is adopted.
    const identity = json({
      schema_version: 1,
      kind: 'pendulum-workspace',
      workspace_id: crypto.randomUUID(),
      created_at_utc: new Date().toISOString(),
      state: 'active',
      index_revision: 0,
      application_compatibility: '0.x',
    })
    await files.write('workspace.json', identity)
    if ((await files.read('workspace.json')) !== identity) throw new Error('工作区初始化校验失败')
  } else if (!names.includes('workspace.json')) throw new Error('非空无关目录，拒绝初始化')
  const identity = JSON.parse(await files.read('workspace.json'))
  if (
    identity.schema_version !== 1 ||
    identity.kind !== 'pendulum-workspace' ||
    typeof identity.workspace_id !== 'string' ||
    !identity.workspace_id ||
    identity.application_compatibility !== '0.x' ||
    identity.state !== 'active' ||
    !Number.isSafeInteger(identity.index_revision) ||
    identity.index_revision < 0 ||
    typeof identity.created_at_utc !== 'string' ||
    !Number.isFinite(Date.parse(identity.created_at_utc))
  )
    throw new Error('无效工作区或不支持的版本')
  async function experiments() {
    const names = await files.list('')
    if (!names.includes('experiments')) return []
    return (await files.list('experiments')).filter((id) => /^[a-f0-9-]{36}$/.test(id))
  }
  async function load(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('非法实验标识')
    const prefix = `experiments/${id}/`
    const raw = await files.read(prefix + 'manifest.json')
    if (bytes(raw) > 16 * 1024 * 1024) throw new Error('清单过大')
    const m: Manifest = JSON.parse(raw)
    if (
      m.schema_version !== 1 ||
      m.experiment_id !== id ||
      !Number.isSafeInteger(m.revision) ||
      m.revision < 1 ||
      !Array.isArray(m.batches) ||
      m.batches.length > 1202 ||
      !Number.isFinite(m.committed_sim_time_s) ||
      m.committed_sim_time_s < 0 ||
      typeof m.sealed !== 'boolean'
    )
      throw new Error('非法实验清单')
    const config = JSON.parse(await checkedRead(files, m.config, prefix)) as ExperimentConfig
    validateConfig(config)
    const snapshot = JSON.parse(await checkedRead(files, m.snapshot, prefix)) as Omit<
      SessionOutput,
      'samples' | 'events'
    >
    const result = JSON.parse(await checkedRead(files, m.result, prefix))
    const samples: SessionOutput['samples'] = [],
      events: SessionOutput['events'] = []
    const seen = new Set([m.config.path, m.snapshot.path, m.result.path])
    for (const batch of m.batches) {
      if (!Array.isArray(batch.files) || batch.files.length !== 2) throw new Error('非法提交批次')
      for (const entry of batch.files) {
        if (seen.has(entry.path)) throw new Error('重复文件引用')
        seen.add(entry.path)
      }
      const csv = await checkedRead(files, batch.files[0]!, prefix)
      const lines = csv.trimEnd().split('\n'),
        columns = lines.shift()!.split(',')
      if (
        columns.join(',') !== sampleColumns.join(',') ||
        lines.some((line) => line.split(',').length !== columns.length)
      )
        throw new Error('非法采样格式')
      const rows = lines.map((line) =>
        Object.fromEntries(
          line
            .split(',')
            .map((value, i) => [
              columns[i]!,
              ['control_mode', 'controller_phase'].includes(columns[i]!)
                ? value
                : columns[i] === 'saturation_reasons'
                  ? value
                    ? value.split('|')
                    : []
                  : ['overspeed', 'saturated'].includes(columns[i]!)
                    ? value === 'true'
                    : Number(value),
            ]),
        ),
      ) as SessionOutput['samples']
      const eventText = await checkedRead(files, batch.files[1]!, prefix)
      const part = eventText.trim()
        ? (eventText
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line)) as SessionOutput['events'])
        : []
      if (
        rows.length !== batch.sample_count ||
        part.length !== batch.event_count ||
        (rows[0]?.sample_index ?? null) !== batch.first_sample_index ||
        (rows.at(-1)?.sample_index ?? null) !== batch.last_sample_index ||
        (part[0]?.event_index ?? null) !== batch.first_event_index ||
        (part.at(-1)?.event_index ?? null) !== batch.last_event_index ||
        (rows[0]?.sim_time_s ?? null) !== batch.first_time_s ||
        (rows.at(-1)?.sim_time_s ?? null) !== batch.last_time_s
      )
        throw new Error('批次范围不一致')
      for (const event of part as (SessionOutput['events'][number] & {
        experiment_id?: string
        model_version?: string
      })[]) {
        if (
          event.schema_version !== 1 ||
          typeof event.event_type !== 'string' ||
          !event.payload ||
          typeof event.payload !== 'object' ||
          event.experiment_id !== id ||
          event.model_version !== config.versions.model
        )
          throw new Error('事件版本关联不一致')
        delete event.experiment_id
        delete event.model_version
      }
      samples.push(...rows)
      events.push(...part)
    }
    for (const [records, key] of [
      [samples, 'sample_index'],
      [events, 'event_index'],
    ] as const) {
      for (let i = 0; i < records.length; i++) {
        const row = records[i]!
        if (
          (row as unknown as Record<string, unknown>)[key] !== i ||
          !Number.isFinite(row.sim_time_s) ||
          row.sim_time_s < (records[i - 1]?.sim_time_s ?? 0) ||
          row.sim_time_s > m.committed_sim_time_s + 1e-12
        )
          throw new Error('序号或时间不连续')
      }
    }
    const terminal = ['completed', 'stopped', 'error'].includes(snapshot.status)
    const period = config.timing.sample_period_s
    for (let i = 0; i < samples.length; i++) {
      const t = samples[i]!.sim_time_s
      const expected = i * period
      const finalPartial =
        terminal && i === samples.length - 1 && i > 0 && t > (i - 1) * period && t < expected
      if (Math.abs(t - expected) > 1e-10 && !finalPartial) throw new Error('采样时间存在缺口或偏移')
    }
    if (
      terminal &&
      samples.length &&
      Math.abs(samples.at(-1)!.sim_time_s - snapshot.sim_time_s) > 1e-10
    )
      throw new Error('终止尾部未完整记录')
    if (
      samples.some((sample) =>
        Object.values(sample).some((v) => typeof v === 'number' && !Number.isFinite(v)),
      )
    )
      throw new Error('非法样本数值')
    if (
      samples.length !== m.sample_count ||
      events.length !== m.event_count ||
      snapshot.experiment_id !== id ||
      snapshot.sim_time_s !== m.committed_sim_time_s ||
      json(config) !== json(snapshot.config) ||
      result.experiment_id !== id ||
      result.sample_count !== samples.length ||
      result.sim_time_s !== snapshot.sim_time_s ||
      (m.sealed && !['completed', 'stopped', 'error'].includes(snapshot.status))
    )
      throw new Error('配置、快照、结果或记录不一致')
    return {
      manifest: m,
      output: { ...snapshot, samples, events },
      result,
      integrity: m.sealed ? 'sealed-verified' : 'interrupted-confirmed-prefix',
    }
  }
  return {
    id: identity.workspace_id as string,
    writable,
    experiments,
    load,
    async create(input: ExperimentConfig) {
      const config: ExperimentConfig = {
        ...structuredClone(input),
        execution_mode: 'authorized-directory',
      }
      if (!writable || !(await files.permission('readwrite')))
        throw new Error('只读工作区不能开始新实验')
      const session = createSession(config)
      const id = session.read().experiment_id,
        prefix = `experiments/${id}/`
      const fullConfig = await publish(files, prefix + 'config.json', json(config))
      const configEntry = { ...fullConfig, path: 'config.json' }
      let manifest: Manifest | undefined,
        saving = false,
        fault: string | null = null
      let lastTime = 0,
        sampleCount = 0,
        eventCount = 0,
        revision = 0
      async function commit(sealed = false) {
        if (saving || manifest?.sealed) throw new Error('正在提交或实验已封存')
        saving = true
        try {
          const output = session.read()
          const { samples, events, ...snapshot } = output
          const delta = {
            ...output,
            samples: samples.slice(sampleCount),
            events: events.slice(eventCount),
          }
          const bundle = await buildEvidence(delta)
          revision++
          const suffix = String(revision).padStart(6, '0')
          const contents = {
            [`samples/chunk-${suffix}.csv`]: bundle.files['samples/chunk-000001.csv']!,
            [`events/part-${suffix}.jsonl`]: delta.events.length
              ? bundle.files['events/part-000001.jsonl']!
              : '',
            [`snapshots/snapshot-${suffix}.json`]: json(snapshot),
            [`results/result-${suffix}.json`]: json({
              ...buildResult(output),
              sample_count: samples.length,
              execution_mode: 'authorized-directory',
              limitation: '单实例目录记录；封存仅表示完整性，不表示控制成功。',
            }),
          }
          const entries: Entry[] = []
          for (const [path, text] of Object.entries(contents)) {
            const entry = await publish(files, prefix + path, text)
            entries.push({ ...entry, path })
          }
          const batch: Batch = {
            sample_count: delta.samples.length,
            event_count: delta.events.length,
            first_sample_index: delta.samples[0]?.sample_index ?? null,
            last_sample_index: delta.samples.at(-1)?.sample_index ?? null,
            first_event_index: delta.events[0]?.event_index ?? null,
            last_event_index: delta.events.at(-1)?.event_index ?? null,
            first_time_s: delta.samples[0]?.sim_time_s ?? null,
            last_time_s: delta.samples.at(-1)?.sim_time_s ?? null,
            files: entries.slice(0, 2),
          }
          const next: Manifest = {
            schema_version: 1,
            experiment_id: id,
            revision,
            config: configEntry,
            committed_sim_time_s: output.sim_time_s,
            sample_count: samples.length,
            event_count: events.length,
            sealed: false,
            batches: [...(manifest?.batches ?? []), batch],
            snapshot: entries[2]!,
            result: entries[3]!,
          }
          await publish(files, prefix + 'manifest.json', json(next))
          // Each referenced new file has been closed and verified; cross-check all history before sealing.
          if (sealed) {
            await load(id)
            next.sealed = true
            await publish(files, prefix + 'manifest.json', json(next))
            await load(id)
          }
          manifest = next
          lastTime = output.sim_time_s
          sampleCount = samples.length
          eventCount = events.length
          fault = null
        } catch (error) {
          fault = String(error)
          session.storageError(fault)
          throw error
        } finally {
          saving = false
        }
      }
      await commit()
      return {
        id,
        progress() {
          return {
            ...session.progress(),
            committed_sim_time_s: lastTime,
            saving,
            fault,
            sealed: manifest?.sealed ?? false,
          }
        },
        read() {
          return {
            output: session.read(),
            committed_sim_time_s: lastTime,
            saving,
            fault,
            sealed: manifest?.sealed ?? false,
          }
        },
        async start() {
          if (saving || fault) throw new Error('存储未就绪')
          session.start()
          await commit()
        },
        async advance(seconds: number) {
          const dt = config.timing.physics_step_s
          const steps = Math.round(seconds / dt)
          if (!Number.isSafeInteger(steps) || seconds < 0 || Math.abs(steps * dt - seconds) > 1e-12)
            throw new Error('非法推进时长')
          if (saving || fault) throw new Error('存储未就绪')
          let remaining = steps
          while (remaining > 0 && session.progress().status === 'running') {
            const now = session.progress().sim_time_s
            const untilBatch = Math.round(((Math.floor((now + 1e-10) / 0.5) + 1) * 0.5 - now) / dt)
            const count = Math.min(remaining, untilBatch)
            // One in-flight batch, no backlog: wait at 0.5s, stricter than the 1s ceiling.
            if (now + count * dt - lastTime > 1 + 1e-12) throw new Error('未确认水位将超过1秒')
            session.advance(count * dt)
            remaining -= count
            const output = session.progress()
            if (output.status !== 'running' || count === untilBatch)
              await commit(['completed', 'stopped', 'error'].includes(output.status))
          }
        },
        async pause(reason: 'manual' | 'background' = 'manual') {
          if (saving) throw new Error('正在提交，请等待')
          session.pause(reason)
          await commit()
        },
        resume() {
          if (saving || fault) throw new Error('存储未就绪')
          session.resume()
        },
        async stop() {
          if (saving) throw new Error('正在提交，请等待')
          session.stop()
          await commit(true)
        },
        async retry() {
          await commit(['completed', 'stopped', 'error'].includes(session.read().status))
        },
      }
    },
  }
}
