import { actuationAssessmentFormat } from './actuation-assessment.ts'
import { actuationCases } from './actuator-benchmarks.ts'
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
const maximumManifestBytes = 16 * 1024 * 1024
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
  sample_schema_version: 1
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
function manifestEntries(manifest: Manifest): Entry[] {
  return [
    manifest.config,
    manifest.snapshot,
    manifest.result,
    ...manifest.batches.flatMap((batch) => batch.files),
  ]
}
// JSON property order does not change a stored value's meaning.
function sameJSON(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (
    !left ||
    !right ||
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    Array.isArray(left) !== Array.isArray(right)
  )
    return false
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameJSON(a[key], b[key]))
  )
}
function validateResultDiagnostics(result: Record<string, unknown>, benchmark: string) {
  const fail = () => {
    throw new Error('不支持的结果格式')
  }
  if (typeof result.limitation !== 'string') fail()
  const assessment = result.actuation_assessment
  if (!Object.hasOwn(actuationCases, benchmark)) {
    if (assessment !== null) fail()
    return
  }
  if (!assessment || typeof assessment !== 'object' || Array.isArray(assessment)) return fail()
  const a = assessment as Record<string, unknown>
  if (
    a.version !== actuationAssessmentFormat.version ||
    a.requirement !== actuationAssessmentFormat.requirement ||
    typeof a.status !== 'string' ||
    !['not_executed', 'invalid', 'blocked', 'passed', 'failed'].includes(a.status) ||
    typeof a.reason !== 'string' ||
    !Array.isArray(a.metrics)
  )
    return fail()
  for (const metric of a.metrics) {
    if (
      !metric ||
      typeof metric !== 'object' ||
      Array.isArray(metric) ||
      ['name', 'unit', 'basis'].some((key) => typeof metric[key] !== 'string') ||
      !Number.isFinite(metric.actual) ||
      !Number.isFinite(metric.limit)
    )
      fail()
  }
}
function sampleCell(field: string, value: string): string | string[] | number | boolean {
  const invalid = () => {
    throw new Error(`非法采样字段 ${field}`)
  }
  if (field === 'control_mode' || field === 'controller_phase') {
    const allowed =
      field === 'control_mode' ? ['free', 'prescribed', 'automatic'] : ['none', 'swing', 'balance']
    if (!allowed.includes(value)) return invalid()
    return value
  }
  if (field === 'saturation_reasons') {
    const reasons = value ? value.split('|') : []
    if (reasons.some((reason) => !['force', 'power', 'speed_direction'].includes(reason)))
      return invalid()
    return reasons
  }
  if (field === 'overspeed' || field === 'saturated') {
    if (value !== 'true' && value !== 'false') return invalid()
    return value === 'true'
  }
  if (
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) ||
    !Number.isFinite(Number(value))
  )
    return invalid()
  return Number(value)
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
  async function loadManifest(id: string, raw: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('非法实验标识')
    const prefix = `experiments/${id}/`
    if (bytes(raw) > maximumManifestBytes) throw new Error('清单过大')
    const m: Manifest = JSON.parse(raw)
    if (m.sample_schema_version !== 1) throw new Error('不支持的采样版本')
    if (
      m.schema_version !== 1 ||
      m.experiment_id !== id ||
      !Number.isSafeInteger(m.revision) ||
      m.revision < 1 ||
      !Array.isArray(m.batches) ||
      !Number.isFinite(m.committed_sim_time_s) ||
      m.committed_sim_time_s < 0 ||
      typeof m.sealed !== 'boolean'
    )
      throw new Error('非法实验清单')
    const configRecord = JSON.parse(
      await checkedRead(files, m.config, prefix),
    ) as ExperimentConfig & {
      experiment_id?: unknown
    }
    if (configRecord.experiment_id !== id) throw new Error('配置的实验标识不一致')
    const config = { ...configRecord }
    delete config.experiment_id
    validateConfig(config)
    const snapshotRecord = JSON.parse(await checkedRead(files, m.snapshot, prefix)) as Omit<
      SessionOutput,
      'samples' | 'events'
    > & { schema_version?: unknown }
    if (snapshotRecord.schema_version !== 1) throw new Error('不支持的快照版本')
    const snapshot = { ...snapshotRecord }
    delete snapshot.schema_version
    const result = JSON.parse(await checkedRead(files, m.result, prefix))
    if (!result || Array.isArray(result) || result.schema_version !== 1)
      throw new Error('不支持的结果格式')
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
          line.split(',').map((value, i) => [columns[i]!, sampleCell(columns[i]!, value)]),
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
    const stateFields = [
      'cart_x_m',
      'cart_v_m_s',
      'theta_unwrapped_rad',
      'theta_dot_rad_s',
    ] as const
    if (
      !['ready', 'running', 'paused', 'stopped', 'completed', 'error'].includes(snapshot.status) ||
      !['physics', 'synthetic'].includes(snapshot.trajectory_source) ||
      config.execution_mode !== 'authorized-directory' ||
      !snapshot.state ||
      Object.keys(snapshot.state).length !== stateFields.length ||
      stateFields.some((field) => !Number.isFinite(snapshot.state[field])) ||
      (terminal &&
        (!samples.length ||
          stateFields.some((field) => samples.at(-1)![field] !== snapshot.state[field])))
    )
      throw new Error('结果与最终记录不一致')
    validateResultDiagnostics(result, config.benchmark)
    const expected = {
      status: snapshot.status,
      trajectory_source: snapshot.trajectory_source,
      execution_mode: 'authorized-directory',
      formal_acceptance: 'not_eligible',
      qualification_reasons: snapshot.qualification_reasons,
      condition_intervals: snapshot.condition_intervals,
      first_stable: snapshot.controller ? snapshot.first_stable : 'not_executed',
      endurance: snapshot.endurance,
      horizontal_disturbance: 'not_executed',
      torque_disturbance: 'not_executed',
      last_state: snapshot.state,
      rules_version: config.versions.rules,
    }
    if (
      Object.entries(expected).some(
        ([key, value]) => !Object.hasOwn(result, key) || !sameJSON(result[key], value),
      )
    )
      throw new Error('结果与配置或快照不一致')
    return {
      manifest: m,
      output: { ...snapshot, samples, events },
      result,
      integrity: m.sealed ? 'sealed-verified' : 'interrupted-confirmed-prefix',
    }
  }
  async function load(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('非法实验标识')
    return loadManifest(id, await files.read(`experiments/${id}/manifest.json`))
  }
  async function recover(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('非法实验标识')
    const prefix = `experiments/${id}/`
    const paths: string[] = []
    const failures: { path: string; error: string }[] = []
    const scanFailures: { path: string; error: string }[] = []
    async function walk(path: string) {
      let names: string[]
      try {
        names = await files.list(path ? prefix + path : prefix.slice(0, -1))
      } catch (error) {
        scanFailures.push({ path: path || '.', error: String(error) })
        if (path) paths.push(path)
        return
      }
      for (const name of names) {
        if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name === '.' || name === '..') continue
        const next = path ? path + '/' + name : name
        // The file API deliberately exposes names only; known record directories are bounded.
        if (
          ['samples', 'events', 'snapshots', 'results', 'confirmed', 'diagnostics'].includes(next)
        )
          await walk(next)
        else paths.push(next)
      }
    }
    await walk('')
    const candidates = paths
      .filter((path) => /^confirmed\/manifest-\d{6,}(?:-sealed)?\.json$/.test(path))
      .sort((a, b) => {
        const revision = (path: string) => Number(path.match(/manifest-(\d+)/)![1])
        return (
          revision(b) - revision(a) || Number(b.includes('-sealed')) - Number(a.includes('-sealed'))
        )
      })
    candidates.push('manifest.json')
    let record: Awaited<ReturnType<typeof load>> | null = null
    let source: string | null = null
    for (const path of candidates) {
      try {
        const candidate = await loadManifest(id, await files.read(prefix + path))
        const m = candidate.manifest
        if (
          path.startsWith('confirmed/') &&
          path !==
            `confirmed/manifest-${String(m.revision).padStart(6, '0')}${m.sealed ? '-sealed' : ''}.json`
        )
          throw new Error('清单文件名与修订或封存状态不一致')
        record = candidate
        source = path
        break
      } catch (error) {
        failures.push({ path, error: String(error) })
      }
    }
    if (record && source !== 'manifest.json') {
      try {
        const mirror = JSON.parse(await files.read(prefix + 'manifest.json'))
        if (!sameJSON(mirror, record.manifest)) throw new Error('便利清单与恢复权威清单不一致')
      } catch (error) {
        failures.push({ path: 'manifest.json', error: String(error) })
      }
    }
    const referenced = new Set<string>(['manifest.json'])
    if (record) {
      const m = record.manifest
      for (const entry of manifestEntries(m)) referenced.add(entry.path)
    }
    // Older commit records are history, not orphan data. Their referenced files remain protected.
    for (const path of candidates.filter((p) => p.startsWith('confirmed/'))) {
      referenced.add(path)
      try {
        const old = JSON.parse(await files.read(prefix + path)) as Manifest
        if (old.schema_version !== 1 || old.experiment_id !== id) continue
        for (const entry of manifestEntries(old))
          if (entry && safePath(entry.path)) referenced.add(entry.path)
      } catch {
        /* A damaged commit is reported above if needed for recovery. */
      }
    }
    const workspaceOrphans: string[] = []
    try {
      if ((await files.list('')).includes('tmp'))
        for (const name of await files.list('tmp')) workspaceOrphans.push(`tmp/${name}`)
    } catch (error) {
      scanFailures.push({ path: 'workspace:tmp', error: String(error) })
    }
    const diagnostics = {
      schema_version: 1,
      experiment_id: id,
      status: !record
        ? 'unverifiable'
        : record.manifest.sealed && !failures.length
          ? 'sealed'
          : 'interrupted',
      confirmed_sim_time_s: record?.manifest.committed_sim_time_s ?? null,
      confirmed_revision: record?.manifest.revision ?? null,
      source,
      failures,
      scan_failures: scanFailures,
      orphan_files: paths.filter((path) => !referenced.has(path)),
      workspace_orphan_files: workspaceOrphans,
      unconfirmed_tail:
        record && (!record.manifest.sealed || failures.length)
          ? { after_sim_time_s: record.manifest.committed_sim_time_s, end_sim_time_s: null }
          : null,
      formal_acceptance: 'not_eligible',
      limitation:
        '只查看已核验历史；未知尾部终点不推测，不补样本，不续跑。浏览器强退证据不证明断电耐久。',
    }
    return { record, diagnostics }
  }
  return {
    id: identity.workspace_id as string,
    writable,
    experiments,
    load,
    recover,
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
      const fullConfig = await publish(
        files,
        prefix + 'config.json',
        json({ ...config, experiment_id: id }),
      )
      const configEntry = { ...fullConfig, path: 'config.json' }
      let manifest: Manifest | undefined,
        saving = false,
        fault: string | null = null
      let storageFault: {
        name: string
        message: string
        sim_time_s: number
        committed_sim_time_s: number
        last_valid_state: SessionOutput['state']
      } | null = null
      function requireReady() {
        if (saving || fault || manifest?.sealed) throw new Error('存储未就绪或实验已封存')
      }
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
            [`snapshots/snapshot-${suffix}.json`]: json({ schema_version: 1, ...snapshot }),
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
            sample_schema_version: 1,
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
          if (bytes(json(next)) > maximumManifestBytes) throw new Error('清单过大')
          // Immutable commit records are the recovery authority. A torn convenience manifest
          // can never destroy an earlier acknowledged revision. No existing record is rewritten.
          if (sealed) await loadManifest(id, json(next))
          await publish(files, prefix + `confirmed/manifest-${suffix}.json`, json(next))
          await publish(files, prefix + 'manifest.json', json(next))
          if (sealed) {
            next.sealed = true
            await loadManifest(id, json(next))
            await publish(files, prefix + `confirmed/manifest-${suffix}-sealed.json`, json(next))
            await publish(files, prefix + 'manifest.json', json(next))
          }
          manifest = next
          lastTime = output.sim_time_s
          sampleCount = samples.length
          eventCount = events.length
          fault = null
          storageFault = null
        } catch (error) {
          fault = String(error)
          const output = session.read()
          storageFault = {
            name: error instanceof Error || error instanceof DOMException ? error.name : 'Error',
            message: fault,
            sim_time_s: output.sim_time_s,
            committed_sim_time_s: lastTime,
            last_valid_state: output.state,
          }
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
            experiment_id: id,
            committed_sim_time_s: lastTime,
            saving,
            fault,
            storage_fault: structuredClone(storageFault),
            sealed: manifest?.sealed ?? false,
          }
        },
        read() {
          return {
            output: session.read(),
            committed_sim_time_s: lastTime,
            saving,
            fault,
            storage_fault: structuredClone(storageFault),
            sealed: manifest?.sealed ?? false,
          }
        },
        async start() {
          requireReady()
          session.start()
          await commit()
        },
        async advance(seconds: number) {
          const dt = config.timing.physics_step_s
          const steps = Math.round(seconds / dt)
          if (!Number.isSafeInteger(steps) || seconds < 0 || Math.abs(steps * dt - seconds) > 1e-12)
            throw new Error('非法推进时长')
          requireReady()
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
          requireReady()
          session.pause(reason)
          await commit()
        },
        resume() {
          requireReady()
          session.resume()
        },
        async stop() {
          requireReady()
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
