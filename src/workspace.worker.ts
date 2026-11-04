import { openWorkspace } from './workspace.ts'
import { directoryFiles } from './workspace-files.ts'
import type { WorkspaceCommand, WorkspaceReply } from './workspace-protocol.ts'

type Workspace = Awaited<ReturnType<typeof openWorkspace>>
let workspace: Workspace | undefined
let run: Awaited<ReturnType<Workspace['create']>> | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let queue = Promise.resolve()
const context = globalThis as unknown as {
  postMessage(data: WorkspaceReply): void
  onmessage: (event: MessageEvent<WorkspaceCommand>) => void
}
function report() {
  if (run) context.postMessage({ type: 'progress', ...run.progress() })
}
function enqueue(task: () => Promise<void>) {
  queue = queue.then(task).catch((error) => {
    clearTimeout(timer)
    report()
    context.postMessage({ type: 'error', message: String(error), hasRun: !!run })
  })
}
function schedule() {
  clearTimeout(timer)
  if (run?.progress().status !== 'running') return
  timer = setTimeout(
    () =>
      enqueue(async () => {
        if (!run || run.progress().status !== 'running') return
        const advancing = run.advance(0.016)
        report()
        await advancing
        report()
        if (run.progress().sealed)
          context.postMessage({ type: 'history', record: await workspace!.load(run.id) })
        else schedule()
      }),
    16,
  )
}
context.onmessage = ({ data }) => {
  // Clear a pending pump immediately; an in-flight write finishes before the next command.
  clearTimeout(timer)
  enqueue(async () => {
    switch (data.type) {
      case 'open':
        if (run && !run.progress().sealed) throw new Error('请先终止并封存当前实验')
        workspace = await openWorkspace(directoryFiles(data.handle, data.readonly))
        run = undefined
        context.postMessage({
          type: 'opened',
          id: workspace.id,
          writable: workspace.writable,
          experiments: await workspace.experiments(),
        })
        break
      case 'start':
        if (!workspace || (run && !run.progress().sealed))
          throw new Error('请先选择目录并结束当前实验')
        run = await workspace.create(data.config)
        await run.start()
        report()
        schedule()
        break
      case 'pause':
        if (run?.progress().status === 'running') await run.pause(data.reason)
        report()
        break
      case 'resume':
        run?.resume()
        report()
        schedule()
        break
      case 'stop':
        await run?.stop()
        report()
        context.postMessage({ type: 'history', record: await workspace!.load(run!.id) })
        break
      case 'retry':
        await run?.retry()
        report()
        break
      case 'load':
        context.postMessage({ type: 'history', record: await workspace!.load(data.id) })
        break
    }
    if (workspace) context.postMessage({ type: 'list', experiments: await workspace.experiments() })
  })
}
