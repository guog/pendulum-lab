import type { BenchmarkOutput, VerificationStatus } from './benchmarks.ts'
import type { BenchmarkCommand, BenchmarkReply } from './benchmark-protocol.ts'
import { saveEvidenceFile } from './save.ts'
import { sha256 } from './evidence.ts'

const statuses: Record<VerificationStatus, string> = {
  not_executed: '未执行',
  blocked: '阻塞',
  passed: '通过',
  failed: '失败',
  invalid: '无效',
}

export function initializeBenchmarks(activityChanged: (active: boolean) => void) {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const run = get<HTMLButtonElement>('bench-run')
  const pause = get<HTMLButtonElement>('bench-pause')
  const stop = get<HTMLButtonElement>('bench-stop')
  const preset = get<HTMLSelectElement>('bench-preset')
  const download = get<HTMLAnchorElement>('bench-download')
  const verify = get<HTMLInputElement>('bench-verify')
  const save = get<HTMLButtonElement>('bench-save')
  const prepare = get<HTMLButtonElement>('bench-prepare')
  const message = get<HTMLParagraphElement>('bench-message')
  const rows = get<HTMLDivElement>('bench-results')
  const worker = new Worker(new URL('./benchmarks.worker.ts', import.meta.url), { type: 'module' })
  let output: BenchmarkOutput | undefined
  let verified = false
  let failed = false
  let otherActive = false
  let exporting = false
  let commandPending = false
  let lastActivity = false
  let prepared: { text: string; hash: string; url: string } | undefined
  let pending: { resolve(text: string): void; reject(error: Error): void } | undefined
  const send = (command: BenchmarkCommand) => worker.postMessage(command)
  function setMessage(text: string, error = false) {
    message.textContent = text
    message.setAttribute('role', error ? 'alert' : 'status')
    message.classList.toggle('error-message', error)
  }
  function begin(type: 'start' | 'resume') {
    commandPending = true
    controls()
    send({ type })
  }
  function clearPrepared() {
    if (prepared) URL.revokeObjectURL(prepared.url)
    prepared = undefined
    download.hidden = true
    verify.disabled = true
    verify.value = ''
  }
  function controls() {
    const active = commandPending || output?.status === 'running' || output?.status === 'paused'
    run.disabled =
      failed || exporting || active || otherActive || !output || output.status !== 'ready'
    pause.disabled = failed || exporting || commandPending || !active
    pause.textContent = output?.status === 'paused' ? '继续物理基准' : '暂停物理基准'
    stop.disabled = failed || exporting || commandPending || !active
    preset.disabled = failed || exporting || active
    get<HTMLButtonElement>('bench-new').disabled = failed || exporting || active
    const exportable =
      output && output.cases.some((item) => item.experiment_id) && output.status !== 'running'
    save.disabled = failed || exporting || !exportable
    prepare.disabled = save.disabled
    verify.disabled = exporting || !prepared
    if (active !== lastActivity) {
      lastActivity = active
      activityChanged(active)
    }
  }
  function render() {
    if (!output) return
    const counts = Object.fromEntries(
      Object.keys(statuses).map((status) => [
        status,
        output!.cases.filter((item) => item.status === status).length,
      ]),
    )
    get('bench-status').textContent =
      `${output.status === 'completed' ? '批次已完成' : output.status === 'running' ? '正在计算 ' + output.active_case : output.status === 'paused' ? '批次已暂停' : output.status === 'stopped' ? '批次已终止' : '准备就绪'} · ${Object.entries(
        statuses,
      )
        .map(([status, label]) => `${label} ${counts[status]}`)
        .join(' / ')}`
    get('bench-record').textContent = verified ? '基准证据已导出并校验' : '基准记录尚未确认导出'
    // Preserve open input disclosures across progress updates.
    const open = new Set(
      [...rows.querySelectorAll<HTMLDetailsElement>('details[open]')].map(
        (item) => item.dataset.id,
      ),
    )
    rows.replaceChildren(
      ...output.cases.map((item) => {
        const details = document.createElement('details')
        details.dataset.id = item.id
        details.open = open.has(item.id)
        const summary = document.createElement('summary')
        summary.textContent = `${item.title} · ${statuses[item.status]}`
        summary.dataset.status = item.status
        const reason = document.createElement('p')
        reason.className = 'explanation'
        reason.textContent = `${item.requirement} · ${item.reason}`
        const list = document.createElement('ul')
        if (item.assessment) {
          for (const text of [item.assessment.error, item.assessment.threshold]) {
            const row = document.createElement('li')
            row.textContent = text
            list.append(row)
          }
        }
        for (const metric of item.metrics) {
          const row = document.createElement('li')
          row.textContent = `${metric.name}：${metric.actual.toExponential(6)} ${metric.unit}；阈值 ≤ ${metric.limit.toExponential(6)} ${metric.unit}。${metric.basis}`
          list.append(row)
        }
        const config = document.createElement('pre')
        config.tabIndex = 0
        config.setAttribute('aria-label', `${item.title}的完整冻结输入`)
        config.textContent = JSON.stringify(item.config, null, 2)
        details.append(summary, reason, list, config)
        if (item.ledger) {
          const ledger = document.createElement('dl')
          ledger.className = 'parameters benchmark-ledger'
          ledger.setAttribute('aria-label', `${item.title}的机械能账本`)
          for (const [field, label] of [
            ['initial_energy_J', '初始机械能'],
            ['kinetic_energy_J', '末采样动能'],
            ['potential_energy_J', '末采样势能'],
            ['mechanical_energy_J', '末采样机械能'],
            ['dissipated_energy_J', '累计耗散'],
            ['actuator_work_J', '执行器做功'],
            ['force_external_work_J', '水平外力做功'],
            ['torque_external_work_J', '关节外力矩做功'],
            ['energy_residual_J', '能量收支残差'],
          ] as const) {
            const term = document.createElement('dt')
            const amount = document.createElement('dd')
            term.textContent = label
            amount.textContent = `${item.ledger[field].toExponential(6)} J`
            ledger.append(term, amount)
          }
          details.insertBefore(ledger, list)
        }
        return details
      }),
    )
    controls()
  }
  worker.onmessage = ({ data }: MessageEvent<BenchmarkReply>) => {
    if (data.type === 'snapshot') {
      commandPending = false
      if (output && JSON.stringify(output) !== JSON.stringify(data.output)) {
        verified = false
        clearPrepared()
      }
      output = data.output
      render()
    } else if (data.type === 'evidence') {
      pending?.resolve(JSON.stringify(data.bundle, null, 2) + '\n')
      pending = undefined
    } else {
      commandPending = false
      setMessage(data.message, true)
      pending?.reject(new Error(data.message))
      pending = undefined
      exporting = false
      controls()
    }
  }
  worker.onerror = () => {
    failed = true
    commandPending = false
    setMessage('物理基准计算模块中断，请刷新后重试。', true)
    pending?.reject(new Error(message.textContent))
    pending = undefined
    controls()
  }
  async function evidence() {
    if (pending) throw new Error('正在生成证据，请稍候')
    verified = false
    render()
    return new Promise<string>((resolve, reject) => {
      pending = { resolve, reject }
      send({ type: 'export' })
    })
  }
  async function action(task: () => Promise<void>) {
    if (exporting) return
    exporting = true
    setMessage('')
    controls()
    try {
      await task()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), true)
    } finally {
      exporting = false
      controls()
    }
  }
  const discard = () =>
    !output?.cases.some((item) => item.experiment_id) ||
    verified ||
    window.confirm('基准证据尚未确认导出。继续将清空当前批次，是否继续？')
  const configure = () => {
    if (discard()) {
      commandPending = true
      controls()
      send({ type: 'configure', preset: preset.value === 'simple' ? 'simple' : 'standard' })
      verified = false
      clearPrepared()
      setMessage('')
    } else if (output) preset.value = output.cases[0]!.config.preset
  }
  run.onclick = () => begin('start')
  pause.onclick = () =>
    output?.status === 'paused' ? begin('resume') : send({ type: 'pause', reason: 'manual' })
  stop.onclick = () => send({ type: 'stop' })
  preset.onchange = configure
  get<HTMLButtonElement>('bench-new').onclick = configure
  save.onclick = () =>
    void action(async () => {
      const name = await saveEvidenceFile(evidence, `physics-${output?.batch_id}.json`)
      verified = true
      setMessage(`已写入并读回校验：${name}`)
      render()
    })
  prepare.onclick = () =>
    void action(async () => {
      const text = await evidence()
      clearPrepared()
      prepared = {
        text,
        hash: await sha256(text),
        url: URL.createObjectURL(new Blob([text], { type: 'application/json' })),
      }
      download.href = prepared.url
      download.download = `physics-${output?.batch_id}.json`
      download.hidden = false
      setMessage('下载后选取实际文件校验，才确认本次导出。')
    })
  download.onclick = () => {
    setMessage('下载已发起，尚未确认写入。')
  }
  verify.onchange = () =>
    void action(async () => {
      const file = verify.files?.[0]
      if (!file || !prepared) return
      if (file.size > 64 * 1024 * 1024) throw new Error('文件超过64MiB校验上限。')
      if ((await sha256(await file.text())) !== prepared.hash)
        throw new Error('文件与当前基准证据不一致，请重新选择。')
      verified = true
      setMessage(`已读回校验：${file.name}`)
      render()
    })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) send({ type: 'pause', reason: 'background' })
  })
  window.addEventListener('beforeunload', (event) => {
    if (output?.cases.some((item) => item.experiment_id) && !verified) event.preventDefault()
  })
  return {
    setOtherActive(active: boolean) {
      if (otherActive !== active) {
        otherActive = active
        controls()
      }
    },
  }
}
