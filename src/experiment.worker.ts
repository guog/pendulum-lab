import { createConfig, createSession } from './session.ts'
import type { Request, Reply } from './protocol.ts'

// DOM and worker share message data; no browser UI is used inside this worker.
const context = globalThis as unknown as {
  postMessage(message: Reply): void
  onmessage: (event: MessageEvent<Request>) => void
}
let session = createSession(createConfig('standard', 'release'))
let timer: ReturnType<typeof setTimeout> | undefined
let runningWallMs = 0
let startedAt: number | undefined

function suspendPump() {
  clearTimeout(timer)
  if (startedAt !== undefined) runningWallMs += performance.now() - startedAt
  startedAt = undefined
}

function snapshot(request_id?: number) {
  context.postMessage({
    type: 'snapshot',
    output: session.read(),
    request_id,
    running_wall_ms: runningWallMs + (startedAt === undefined ? 0 : performance.now() - startedAt),
  })
}

function pump() {
  try {
    session.advance(0.016)
    if (session.read().status !== 'running') suspendPump()
    snapshot()
    if (session.read().status === 'running') timer = setTimeout(pump, 16)
  } catch (error) {
    suspendPump()
    session.pause()
    context.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
    snapshot()
  }
}

context.onmessage = async ({ data: { request_id, command } }) => {
  try {
    switch (command.type) {
      case 'configure':
        suspendPump()
        session = createSession(createConfig(command.preset, command.benchmark))
        runningWallMs = 0
        break
      case 'start':
        session.start()
        startedAt = performance.now()
        timer = setTimeout(pump, 16)
        break
      case 'resume':
        session.resume()
        startedAt = performance.now()
        timer = setTimeout(pump, 16)
        break
      case 'pause':
        suspendPump()
        session.pause(command.reason)
        break
      case 'stop':
        suspendPump()
        session.stop()
        break
      case 'reset':
        suspendPump()
        session.reset()
        runningWallMs = 0
        break
      case 'export': {
        const bundle = await session.exportEvidence()
        snapshot()
        context.postMessage({
          type: 'evidence',
          request_id,
          bundle,
        })
        return
      }
    }
    snapshot(request_id)
  } catch (error) {
    context.postMessage({
      type: 'error',
      request_id,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
snapshot()
