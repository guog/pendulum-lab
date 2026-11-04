import type { WorkspaceCommand, WorkspaceReply } from './workspace-protocol.ts'
import { createConfig } from './session.ts'
import { drawChart, signalColors } from './visualization.ts'
import type { SessionOutput } from './session.ts'

export function initializeWorkspace() {
  const host = document.createElement('section')
  host.className = 'workspace-panel'
  host.setAttribute('aria-label', '本地目录实验')
  host.innerHTML = `<h2>本地目录实验</h2>
  <p>每次使用请明确选择目录。当前仅支持单实例；请勿用其他页面或浏览器同时打开此目录。</p>
  <button id="workspace-open">选择并授权目录</button> <button id="workspace-read">选择只读目录</button>
  <p id="workspace-identity">尚未选择目录；上方内存研究可独立使用。</p>
  <label>实验 <select id="workspace-benchmark"><option value="equilibrium">静止下垂（60秒记录负载）</option><option value="release">零阻力释放</option><option value="swing-up">自动起摆与耐久</option></select></label>
  <label>工况 <select id="workspace-preset"><option value="standard">标准</option><option value="simple">简单</option></select></label>
  <label>采样周期 <select id="workspace-sampling"><option value="0.01">10 ms</option><option value="0.001">1 ms</option><option value="0.1">100 ms</option></select></label>
  <button id="workspace-start" disabled>开始目录实验</button> <button id="workspace-pause" disabled>暂停目录实验</button> <button id="workspace-resume" disabled>继续目录实验</button> <button id="workspace-stop" disabled>终止并封存</button> <button id="workspace-retry" disabled>重试保存</button>
  <p id="workspace-progress" role="status">未运行。每0.5秒仿真时间提交；等待磁盘时暂停推进。</p>
  <p id="workspace-error" role="alert"></p>
  <label>已保存实验 <select id="workspace-history"></select></label> <button id="workspace-load" disabled>核验并查看</button>
  <div id="workspace-record"></div>`
  document.querySelector('.page-footer')!.before(host)
  const get = (id: string) => host.querySelector<HTMLElement>('#workspace-' + id)!
  const button = (id: string) => get(id) as HTMLButtonElement
  const select = (id: string) => get(id) as HTMLSelectElement
  const worker = new Worker(new URL('./workspace.worker.ts', import.meta.url), { type: 'module' })
  let writable = false,
    active = false,
    running = false,
    pending = false
  function controls() {
    for (const id of ['open', 'read']) button(id).disabled = active || pending
    button('start').disabled = !writable || active || pending || document.hidden
    button('pause').disabled = !running || pending
    button('resume').disabled = !active || running || pending || document.hidden
    button('stop').disabled = !active || pending
    button('load').disabled = active || pending || !select('history').value
    for (const id of ['benchmark', 'preset', 'sampling']) select(id).disabled = active || pending
  }
  function send(command: WorkspaceCommand) {
    pending = true
    get('error').textContent = ''
    controls()
    worker.postMessage(command)
  }
  async function choose(mode: 'read' | 'readwrite') {
    try {
      if (!window.showDirectoryPicker) throw new Error('请使用支持目录授权的桌面 Chrome。')
      const handle = await window.showDirectoryPicker({ mode })
      send({ type: 'open', handle, readonly: mode === 'read' })
    } catch (error) {
      get('error').textContent =
        error instanceof DOMException && error.name === 'AbortError'
          ? '已取消选择，未初始化目录。'
          : String(error)
    }
  }
  button('open').onclick = () => void choose('readwrite')
  button('read').onclick = () => void choose('read')
  button('start').onclick = () => {
    const config = createConfig(
      select('preset').value === 'simple' ? 'simple' : 'standard',
      select('benchmark').value as 'equilibrium' | 'release' | 'swing-up',
    )
    if (config.benchmark === 'equilibrium') config.timing.duration_s = 60
    config.timing.sample_period_s = Number(select('sampling').value)
    active = true
    send({ type: 'start', config })
  }
  button('pause').onclick = () => send({ type: 'pause', reason: 'manual' })
  for (const type of ['resume', 'stop', 'retry'] as const)
    button(type).onclick = () => send({ type })
  button('load').onclick = () => send({ type: 'load', id: select('history').value })
  worker.onmessage = ({ data }: MessageEvent<WorkspaceReply>) => {
    pending = false
    if (data.type === 'opened') {
      writable = data.writable
      active = running = false
      get('identity').textContent = `工作区 ${data.id} · ${writable ? '可写' : '只读'}`
    }
    if (data.type === 'list' || data.type === 'opened') {
      const previous = select('history').value
      select('history').replaceChildren(...data.experiments.map((id: string) => new Option(id, id)))
      if (data.experiments.includes(previous)) select('history').value = previous
    }
    if (data.type === 'progress') {
      active = !data.sealed
      running = data.status === 'running'
      pending = data.saving
      get('progress').textContent =
        `状态 ${data.status} · 仿真 ${data.sim_time_s.toFixed(3)} s · 已确认 ${data.committed_sim_time_s.toFixed(3)} s · 样本 ${data.sample_count} · 事件 ${data.event_count} · ${data.sealed ? '已封存（完整性确认）' : data.saving ? '等待磁盘；物理推进已暂停' : '未封存'}`
      button('retry').disabled = !data.fault
    }
    if (data.type === 'error') {
      get('error').textContent = data.message
      running = false
      if (!data.hasRun) active = false
      // Keep the run protected until retry/stop succeeds; never silently fall back to memory.
      button('retry').disabled = false
    }
    if (data.type === 'history') {
      const output: SessionOutput = data.record.output
      const target = get('record')
      target.replaceChildren()
      const summary = document.createElement('p')
      summary.textContent = `${output.experiment_id} · ${data.record.integrity} · 已确认至 ${data.record.manifest.committed_sim_time_s.toFixed(3)} s · ${output.samples.length}条原始样本 · ${data.record.manifest.sealed ? '完整性已核验；封存不等同控制成功' : '上次实验未封存，仅显示已确认前缀；未确认尾部范围未知，不补造数据'}`
      target.append(summary)
      for (const field of [
        'cart_x_m',
        'cart_v_m_s',
        'theta_unwrapped_rad',
        'theta_dot_rad_s',
      ] as const) {
        const label = document.createElement('p')
        label.textContent = field
        const chart = document.createElement('canvas')
        chart.setAttribute('role', 'img')
        chart.setAttribute('aria-label', `${field}原始轨迹`)
        chart.style.width = '100%'
        chart.style.height = '150px'
        target.append(label, chart)
        drawChart(chart, output.samples, field, signalColors[field], output.sim_time_s || 1)
      }
      for (const [name, value] of [
        ['原配置', output.config],
        ['独立结果', data.record.result],
        ['原始轨迹', output.samples],
        ['全部事件', output.events],
      ]) {
        const details = document.createElement('details'),
          title = document.createElement('summary'),
          pre = document.createElement('pre')
        title.textContent = String(name)
        details.addEventListener('toggle', () => {
          if (details.open && !pre.textContent) pre.textContent = JSON.stringify(value, null, 2)
        })
        details.append(title, pre)
        target.append(details)
      }
    }
    controls()
  }
  worker.onerror = (event) => {
    get('error').textContent =
      `目录计算模块中断：${event.message}。请重新打开页面并选择目录核验已确认记录。`
    pending = true
    controls()
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && active) send({ type: 'pause', reason: 'background' })
    controls()
  })
  window.addEventListener('beforeunload', (event) => {
    if (active) event.preventDefault()
  })
}
