import { actuationCases, type ActuationCaseId } from './actuator-benchmarks.ts'
import { assessActuation } from './actuation-assessment.ts'
import './styles.css'
import { sha256 } from './evidence.ts'
import { saveEvidenceFile } from './save.ts'
import { drawApparatus, drawChart } from './visualization.ts'
import type { Command, Reply, Request } from './protocol.ts'
import type { SessionOutput, DisturbanceOutput } from './session.ts'
import type { BenchmarkId, PresetId } from './config.ts'
import { initializeBenchmarks } from './benchmark-ui.ts'

function element<T extends Element>(id: string, type: new (...args: never[]) => T): T {
  const found = document.getElementById(id)
  if (!(found instanceof type)) throw new Error(`页面缺少 ${id}`)
  return found
}
const runDisturbances = element('run-disturbances', HTMLButtonElement)
const saveDisturbances = element('save-disturbances', HTMLButtonElement)
const resumeDisturbances = element('resume-disturbances', HTMLButtonElement)
const start = element('start', HTMLButtonElement)
const pause = element('pause', HTMLButtonElement)
const stop = element('stop', HTMLButtonElement)
const reset = element('reset', HTMLButtonElement)
const exportButton = element('export', HTMLButtonElement)
const prepareDownload = element('prepare-download', HTMLButtonElement)
const download = element('download', HTMLAnchorElement)
const verifyFile = element('verify-file', HTMLInputElement)
const preset = element('preset', HTMLSelectElement)
const benchmark = element('benchmark', HTMLSelectElement)
const errorBox = element('error', HTMLDivElement)
const exportMessage = element('export-message', HTMLParagraphElement)
const apparatus = element('apparatus', SVGSVGElement)
const views = [
  { field: 'cart_x_m', value: 'value-x', canvas: 'chart-x', color: '#315f9e' },
  { field: 'cart_v_m_s', value: 'value-v', canvas: 'chart-v', color: '#08776b' },
  { field: 'theta_unwrapped_rad', value: 'value-theta', canvas: 'chart-theta', color: '#996018' },
  { field: 'theta_dot_rad_s', value: 'value-omega', canvas: 'chart-omega', color: '#8255a1' },
] as const
const forceViews = [
  { field: 'force_requested_N', label: '请求力', unit: 'N', color: '#996018' },
  { field: 'force_actual_N', label: '实际驱动力', unit: 'N', color: '#08776b' },
  { field: 'force_external_N', label: '水平外力', unit: 'N', color: '#315f9e' },
  { field: 'torque_external_Nm', label: '关节外力矩', unit: 'N·m', color: '#8255a1' },
  { field: 'actuator_power_W', label: '机械功率', unit: 'W', color: '#08776b' },
  { field: 'energy_residual_J', label: '能量收支残差', unit: 'J', color: '#996018' },
  { field: 'saturated', label: '饱和/方向受限', unit: '0/1', color: '#996018' },
  { field: 'overspeed', label: '超速', unit: '0/1', color: '#8255a1' },
] as const
for (const [id, label] of Object.entries(actuationCases)) {
  const option = document.createElement('option')
  option.value = id
  option.textContent = label
  benchmark.append(option)
}
const forceCharts = element('force-charts', HTMLDivElement)
for (const view of forceViews) {
  const figure = document.createElement('figure')
  const caption = document.createElement('figcaption')
  const label = document.createElement('span')
  label.textContent = `${view.label} (${view.unit})`
  const value = document.createElement('output')
  value.id = `value-${view.field}`
  value.textContent = '—'
  const canvas = document.createElement('canvas')
  canvas.id = `chart-${view.field}`
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', `${view.label}随仿真时间变化曲线`)
  caption.append(label, value)
  figure.append(caption, canvas)
  forceCharts.append(figure)
}
const statusText = {
  ready: '准备就绪',
  running: '运行中',
  paused: '已暂停',
  stopped: '已终止',
  completed: '基准已结束',
  error: '计算已冻结',
}
let disturbanceResults: DisturbanceOutput[] | undefined
let disturbanceSaved = false
let disturbancePaused = false
let disturbanceRunning = false
let current: SessionOutput | undefined
let wallMs = 0
let busy = false
let workerFailed = false
let nextRequest = 0
let renderedConfigId = ''
let lastStatus = ''
let renderQueued = false
let verifiedKey = ''
let prepared: { text: string; key: string; hash: string; url: string } | undefined
let benchmarksActive = false
const benchmarkUI = initializeBenchmarks((active) => {
  benchmarksActive = active
  updateControls()
})
const pending = new Map<number, { resolve(reply: Reply): void; reject(error: Error): void }>()
const worker = new Worker(new URL('./experiment.worker.ts', import.meta.url), { type: 'module' })
const key = () =>
  current ? `${current.experiment_id}:${current.samples.length}:${current.events.length}` : ''
const write = (id: string, text: string) => {
  const target = document.getElementById(id)
  if (target) target.textContent = text
}

function showError(error: unknown) {
  errorBox.textContent = error instanceof Error ? error.message : String(error)
  errorBox.hidden = false
}
function clearPrepared() {
  if (prepared) URL.revokeObjectURL(prepared.url)
  prepared = undefined
  download.hidden = true
  download.removeAttribute('href')
  verifyFile.disabled = true
  verifyFile.value = ''
}
function updateControls() {
  const status = workerFailed ? undefined : current?.status
  runDisturbances.disabled =
    busy ||
    workerFailed ||
    !current ||
    current.status === 'running' ||
    current.first_stable.disturbance_eligibility !== 'eligible'
  saveDisturbances.disabled = busy || !disturbanceResults
  resumeDisturbances.disabled = !disturbancePaused || document.hidden
  start.disabled = busy || benchmarksActive || status !== 'ready'
  pause.disabled = busy || (status !== 'running' && status !== 'paused')
  pause.textContent = status === 'paused' ? '继续' : '暂停'
  stop.disabled = busy || (status !== 'running' && status !== 'paused')
  reset.disabled = busy || workerFailed || !current || status === 'ready'
  preset.disabled = busy || workerFailed || status === 'running'
  benchmark.disabled = busy || workerFailed || status === 'running'
  const exportable = !workerFailed && !!current?.samples.length && status !== 'running'
  exportButton.disabled = busy || !exportable
  prepareDownload.disabled = busy || !exportable
  verifyFile.disabled = busy || !prepared
  benchmarkUI.setOtherActive(busy || status === 'running' || status === 'paused')
  write(
    'record-state',
    !current?.samples.length
      ? '尚无实验记录'
      : verifiedKey === key()
        ? '当前证据已导出并校验'
        : '当前记录尚未确认导出',
  )
}
function render() {
  renderQueued = false
  if (!current) return
  const { config, state } = current
  write(
    'disturbance-current',
    disturbancePaused
      ? '扰动实验已暂停；回到页面后可继续。'
      : current.first_stable.disturbance_eligibility === 'eligible'
        ? `${config.preset === 'simple' ? '简单' : '标准'}工况：已有合格快照，可运行水平外力与关节力矩实验。`
        : `${config.preset === 'simple' ? '简单' : '标准'}工况：水平外力阻塞；关节力矩阻塞（无已确认合格快照）。`,
  )
  if (renderedConfigId !== current.experiment_id) {
    renderedConfigId = current.experiment_id
    write('benchmark-description', config.benchmark_description)
    write('config', JSON.stringify(config, null, 2))
    preset.value = config.preset
    benchmark.value = config.benchmark
    const entries = [
      ['杆长', `${config.physics.rod_length_m} m`],
      ['杆质量', `${config.physics.rod_mass_kg} kg`],
      ['滑块质量', `${config.physics.cart_mass_kg} kg`],
      ['配重质量', `${config.physics.counterweight_mass_kg} kg`],
      ['配重位置', `${config.physics.counterweight_position_m} m`],
      ['导轨总长', `${config.physics.track_length_m} m`],
      ['重力加速度', `${config.physics.gravity_m_s2} m/s²`],
      ['最大驱动力', `${config.physics.force_max_N} N`],
      ['最大速度', `${config.physics.speed_max_m_s} m/s`],
      ['最大机械功率', `${config.physics.power_max_W} W`],
      ['安全缓冲区', `${config.physics.safety_buffer_m} m`],
      ['滑块库仑阻力', `${config.physics.cart_coulomb_N} N`],
      ['滑块粘性阻力', `${config.physics.cart_viscous_N_s_m} N·s/m`],
      ['关节粘性阻力', `${config.physics.joint_viscous_Nm_s_rad} N·m·s/rad`],
    ]
    const list = element('parameters', HTMLDListElement)
    list.replaceChildren(
      ...entries.flatMap(([label, value]) => {
        const dt = document.createElement('dt')
        dt.textContent = label!
        const dd = document.createElement('dd')
        dd.textContent = value!
        return [dt, dd]
      }),
    )
  }
  if (lastStatus !== current.status) {
    write('status', statusText[current.status])
    lastStatus = current.status
  }
  write('time', current.sim_time_s.toFixed(config.control_mode === 'prescribed' ? 6 : 3))
  write(
    'duration',
    String(
      current.endurance.start_s === null
        ? config.timing.duration_s
        : Number((current.endurance.start_s + 20).toFixed(3)),
    ),
  )
  write('sample-count', String(current.samples.length))
  write('sampling', String(config.timing.sample_period_s * 1000))
  write('step-size', String(config.timing.physics_step_s * 1000))
  write('ratio', wallMs > 0 ? `${(current.sim_time_s / (wallMs / 1000)).toFixed(2)}×` : '—')
  const last = current.events.findLast((event) =>
    ['boundary', 'numerical_error', 'controller_error'].includes(event.event_type),
  )
  write(
    'end-reason',
    config.control_mode === 'automatic' && current.first_stable.snapshot
      ? `首次稳定：${current.first_stable.disturbance_eligibility === 'eligible' ? '通过，快照证据已导出校验' : '已达成，候选快照待导出校验'} · ${last?.event_type === 'boundary' ? '触边终止 · ' : last?.event_type === 'controller_error' ? '控制器异常 · ' : last?.event_type === 'numerical_error' ? '数值异常 · ' : current.status === 'stopped' ? '用户终止 · ' : ''}可在下方运行独立扰动测试`
      : config.control_mode === 'automatic'
        ? `${current.controller?.state.phase === 'balance' ? '稳摆' : '起摆'} · ${last?.event_type === 'boundary' ? '触边终止；首次稳定失败，扰动测试阻塞' : last?.event_type === 'numerical_error' ? '数值异常；首次稳定失败，扰动测试阻塞' : last?.event_type === 'controller_error' ? '控制器异常或超出预算；首次稳定失败，扰动测试阻塞' : current.first_stable.reason === 'user_stopped' ? '用户终止；首次稳定未完成，扰动测试阻塞' : current.first_stable.physical_status === 'passed' && !current.first_stable.snapshot ? '物理稳定曾达成，但配置或资格无效；扰动测试阻塞' : current.first_stable.physical_status === 'passed' ? (current.first_stable.disturbance_eligibility === 'eligible' ? '首次连续5秒稳定；快照证据已导出校验，扰动功能尚未执行' : '首次连续5秒稳定，候选快照待导出校验；扰动测试阻塞') : ['failed', 'invalid'].includes(current.first_stable.status) ? `首次稳定失败（${current.qualification_reasons.join('、') || '超过时限'}），扰动测试阻塞` : '等待首次稳定；无合格快照，扰动测试阻塞'}`
        : last?.event_type === 'boundary'
          ? '触边终止；无碰撞反弹'
          : last?.event_type === 'numerical_error'
            ? '数值异常，保留最后有效状态'
            : current.status === 'completed'
              ? `${config.timing.duration_s}秒观察窗口结束，未做控制判定`
              : '自动起摆及控制验收未执行',
  )
  const enduranceText: Record<string, string> = {
    not_executed: '未执行',
    blocked: '阻塞（无合格快照）',
    running: '进行中',
    passed: '通过',
    failed: '失败',
    invalid: '中止',
  }
  write(
    'endurance-result',
    `耐久：${enduranceText[current.endurance.status]}${current.endurance.start_s === null ? '' : ` · 起点 ${current.endurance.start_s.toFixed(3)} s${current.endurance.end_s === null ? '' : ` · 终点 ${current.endurance.end_s.toFixed(3)} s`}`}`,
  )
  for (const view of views) {
    write(view.value, state[view.field].toFixed(4))
    drawChart(
      element(view.canvas, HTMLCanvasElement),
      current.samples,
      view.field,
      view.color,
      current.endurance.start_s === null
        ? config.timing.duration_s
        : Math.max(config.timing.duration_s, current.endurance.start_s + 20),
    )
  }
  write(
    'observation-title',
    config.control_mode === 'automatic'
      ? '自动起摆与稳摆'
      : config.control_mode === 'prescribed'
        ? '受限执行器与外扰'
        : '自由运动',
  )
  write(
    'input-note',
    config.control_mode === 'automatic'
      ? '版本化控制器 · 允许连续旋转'
      : config.control_mode === 'prescribed'
        ? '冻结受力输入 · 允许连续旋转'
        : '无驱动力 · 允许连续旋转',
  )
  const lastSample = current.samples.at(-1)
  for (const view of forceViews) {
    write(`value-${view.field}`, lastSample ? Number(lastSample[view.field]).toFixed(4) : '—')
    drawChart(
      element(`chart-${view.field}`, HTMLCanvasElement),
      current.samples,
      view.field,
      view.color,
      current.endurance.start_s === null
        ? config.timing.duration_s
        : Math.max(config.timing.duration_s, current.endurance.start_s + 20),
    )
  }
  const reasons: Record<string, string> = {
    force: '限力',
    power: '限功率',
    speed_direction: '速度方向受限',
  }
  write(
    'force-observation',
    lastSample
      ? [
          lastSample.saturation_reasons.map((reason) => reasons[reason] ?? reason).join('、') ||
            '执行器未限幅',
          lastSample.overspeed ? '超速；正式资格已取消' : '当前未超速',
          current.qualification_reasons.length
            ? `资格取消原因：${current.qualification_reasons.join('、')}`
            : '本实验仅诊断，不具备正式控制资格',
        ].join(' · ')
      : '开始后显示逐步约束与能量记录。',
  )
  const ledger = element('force-ledger', HTMLDListElement)
  ledger.replaceChildren(
    ...(
      [
        ['kinetic_energy_J', '动能'],
        ['potential_energy_J', '势能'],
        ['actuator_work_J', '执行器做功'],
        ['force_external_work_J', '水平外力做功'],
        ['torque_external_work_J', '关节外力矩做功'],
        ['dissipated_energy_J', '累计耗散'],
        ['energy_residual_J', '能量收支残差'],
      ] as const
    ).flatMap(([field, label]) => {
      const term = document.createElement('dt'),
        value = document.createElement('dd')
      term.textContent = label
      value.textContent = lastSample ? `${lastSample[field].toExponential(6)} J` : '—'
      return [term, value]
    }),
  )
  const assessment = assessActuation(current)
  const labels = {
    not_executed: '未执行',
    blocked: '阻塞',
    passed: '通过',
    failed: '失败',
    invalid: '无效',
  }
  write(
    'actuation-result',
    assessment
      ? `受力基准：${labels[assessment.status]} · ${assessment.reason}`
      : '自由运动基准；完整物理基准见下方独立批次。',
  )
  write(
    'actuation-metrics',
    assessment ? JSON.stringify(assessment.metrics, null, 2) : '尚无受力基准结论。',
  )
  write(
    'force-events',
    JSON.stringify(
      { condition_intervals: current.condition_intervals, events: current.events },
      null,
      2,
    ),
  )
  drawApparatus(apparatus, current)
  updateControls()
}
function scheduleRender() {
  if (!renderQueued) {
    renderQueued = true
    requestAnimationFrame(render)
  }
}
worker.onmessage = ({ data }: MessageEvent<Reply>) => {
  if (data.type === 'disturbance-status') {
    disturbanceRunning = data.running
    disturbancePaused = data.running && data.paused
    if (disturbancePaused) write('disturbance-current', '扰动实验已暂停；回到页面后可继续。')
    updateControls()
  }
  if (data.type === 'snapshot') {
    if (
      current &&
      (data.output.experiment_id !== current.experiment_id ||
        data.output.samples.length !== current.samples.length ||
        data.output.events.length !== current.events.length)
    ) {
      if (verifiedKey === key()) exportMessage.textContent = '记录已更新，请重新导出当前证据。'
      if (prepared) clearPrepared()
    }
    current = data.output
    wallMs = data.running_wall_ms
    scheduleRender()
  }
  if (data.type === 'error') showError(data.message)
  if (data.request_id !== undefined) {
    const request = pending.get(data.request_id)
    pending.delete(data.request_id)
    if (data.type === 'error') request?.reject(new Error(data.message))
    else request?.resolve(data)
  }
}
worker.onerror = (event) => {
  workerFailed = true
  write('status', '计算模块已中断')
  updateControls()
  showError(`计算模块未能运行：${event.message}。请刷新后重试。`)
  for (const request of pending.values()) request.reject(new Error('计算模块已中断'))
  pending.clear()
}
function call(command: Command): Promise<Reply> {
  if (workerFailed) return Promise.reject(new Error('计算模块已中断，请刷新后重试。'))
  const request_id = ++nextRequest
  return new Promise((resolve, reject) => {
    pending.set(request_id, { resolve, reject })
    worker.postMessage({ request_id, command } satisfies Request)
  })
}
async function action(task: () => Promise<unknown>) {
  if (busy) return
  busy = true
  errorBox.hidden = true
  updateControls()
  try {
    await task()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError')
      exportMessage.textContent = '已取消导出，记录仍在内存中。'
    else showError(error)
  } finally {
    busy = false
    updateControls()
  }
}
async function evidence() {
  const reply = await call({ type: 'export' })
  if (reply.type !== 'evidence') throw new Error('未收到证据包')
  return JSON.stringify(reply.bundle, null, 2) + '\n'
}
function discardAllowed() {
  return (
    !current?.samples.length ||
    verifiedKey === key() ||
    window.confirm('当前源实验记录尚未确认导出。继续将清空这次内存记录，是否继续？')
  )
}
function renderDisturbances() {
  if (!disturbanceResults?.length) {
    write('disturbance-result', '阻塞：等待已确认的合格快照。')
    return
  }
  const labels: Record<string, string> = {
    suppressed: '抑扰成功',
    recovered: '失稳恢复成功',
    failed: '失败或违规',
    error: '异常',
    running: '证据不完整',
  }
  write(
    'disturbance-result',
    disturbanceResults
      .map((result) => {
        const conditions =
          result.condition_intervals
            .map(
              (item) =>
                `${item.condition} ${item.start_time_s.toFixed(3)}–${item.end_time_s?.toFixed(3) ?? '未结束'} s`,
            )
            .join('、') || '无约束或超速区间'
        return `${result.snapshot.config.preset === 'simple' ? '简单' : '标准'}工况 · ${result.kind === 'horizontal' ? '水平外力' : '关节外力矩'} · ${result.experiment_id}\n状态：${labels[result.disturbance?.status ?? 'running']}；脉冲 ${result.disturbance?.pulse_start_s.toFixed(3)}–${result.disturbance?.pulse_end_s.toFixed(3)} s；恢复截止 ${result.disturbance?.deadline_s.toFixed(3)} s\n限制：${conditions}；资格原因：${result.qualification_reasons.join('、') || '无'}`
      })
      .join('\n\n') + `\n\n扰动证据${disturbanceSaved ? '已导出并校验' : '尚未导出校验'}`,
  )
}
resumeDisturbances.onclick = () => void call({ type: 'resume-disturbances' }).catch(showError)
runDisturbances.onclick = () =>
  void action(async () => {
    const reply = await call({ type: 'run-disturbances' })
    if (reply.type !== 'disturbances') throw new Error('未收到扰动结果')
    disturbanceResults = [...(disturbanceResults ?? []), ...reply.results]
    disturbanceSaved = false
    renderDisturbances()
  })
saveDisturbances.onclick = () =>
  void action(async () => {
    if (!disturbanceResults) return
    if (!window.showSaveFilePicker)
      throw new Error('当前浏览器无法保存扰动证据，请使用支持保存对话框的桌面 Chrome。')
    const text =
      JSON.stringify(
        {
          schema_version: 1,
          limitation: '内存研究证据；不承诺崩溃恢复或正式工作区验收。',
          results: disturbanceResults,
        },
        null,
        2,
      ) + '\n'
    const name = await saveEvidenceFile(async () => text, 'pendulum-disturbances.json')
    disturbanceSaved = true
    renderDisturbances()
    exportMessage.textContent = `扰动证据已写入并读回校验：${name}`
  })
start.onclick = () => void action(() => call({ type: 'start' }))
pause.onclick = () =>
  void action(() =>
    call(current?.status === 'paused' ? { type: 'resume' } : { type: 'pause', reason: 'manual' }),
  )
stop.onclick = () => void action(() => call({ type: 'stop' }))
reset.onclick = () => {
  if (discardAllowed())
    void action(async () => {
      await call({ type: 'reset' })
      exportMessage.textContent = ''
    })
}
async function configure() {
  if (!discardAllowed()) {
    if (current) {
      preset.value = current.config.preset
      benchmark.value = current.config.benchmark
    }
    return
  }
  const selectedPreset: PresetId = preset.value === 'simple' ? 'simple' : 'standard'
  const selectedBenchmark: BenchmarkId = Object.hasOwn(actuationCases, benchmark.value)
    ? (benchmark.value as ActuationCaseId)
    : benchmark.value === 'swing-up'
      ? 'swing-up'
      : benchmark.value === 'equilibrium'
        ? 'equilibrium'
        : 'release'
  await action(async () => {
    await call({ type: 'configure', preset: selectedPreset, benchmark: selectedBenchmark })
    exportMessage.textContent = ''
  })
}
preset.onchange = () => void configure()
benchmark.onchange = () => void configure()
exportButton.onclick = () =>
  void action(async () => {
    if (!current) return
    let targetKey = ''
    const name = await saveEvidenceFile(async () => {
      const text = await evidence()
      targetKey = key()
      return text
    }, `pendulum-${current.experiment_id}.json`)
    if (!current || targetKey !== key()) throw new Error('证据已过期，请重新导出')
    await call({
      type: 'confirm-export',
      experiment_id: current.experiment_id,
      event_count: current.events.length,
    })
    verifiedKey = targetKey
    scheduleRender()
    exportMessage.textContent = `已写入并读回校验：${name}`
  })
prepareDownload.onclick = () =>
  void action(async () => {
    const text = await evidence()
    clearPrepared()
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    prepared = { text, key: key(), hash: await sha256(text), url }
    download.href = url
    download.download = `pendulum-${current?.experiment_id}.json`
    download.hidden = false
    exportMessage.textContent = '证据包已生成。下载后选取实际文件校验，才确认本次导出。'
  })
download.onclick = () => {
  exportMessage.textContent = '下载已发起，尚未确认写入。请选择已下载的文件进行校验。'
}
verifyFile.onchange = () =>
  void action(async () => {
    const file = verifyFile.files?.[0]
    if (!file || !prepared) return
    if (file.size > 64 * 1024 * 1024)
      throw new Error('文件超过64MiB校验上限，请选择当前导出的证据包。')
    const text = await file.text()
    if ((await sha256(text)) !== prepared.hash || prepared.key !== key())
      throw new Error('文件与当前证据包不一致，请重新导出后校验。')
    if (!current) throw new Error('实验不可用')
    await call({
      type: 'confirm-export',
      experiment_id: current.experiment_id,
      event_count: current.events.length,
    })
    verifiedKey = prepared.key
    scheduleRender()
    exportMessage.textContent = `已读回校验：${file.name}`
  })
document.addEventListener('visibilitychange', () => {
  updateControls()
  if (document.hidden) void call({ type: 'pause', reason: 'background' }).catch(showError)
})
window.addEventListener('beforeunload', (event) => {
  if (
    (current?.samples.length && verifiedKey !== key()) ||
    (disturbanceResults && !disturbanceSaved) ||
    disturbanceRunning
  )
    event.preventDefault()
})
window.addEventListener('resize', scheduleRender)
