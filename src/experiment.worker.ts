import { createActuationConfig } from './actuator-benchmarks.ts'
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
let disturbanceRunning = false
let disturbancePaused = false
let disturbanceStopRequested = false
let disturbancePauseRequested: 'manual' | 'background' | null = null
let disturbanceTime: number | null = null
let resumeDisturbances: (() => void) | undefined
const disturbanceStatus = () =>
  context.postMessage({
    type: 'disturbance-status',
    running: disturbanceRunning,
    paused: disturbancePaused,
    sim_time_s: disturbanceTime,
  })
async function disturbanceCheckpoint(progress: { sim_time_s: number }) {
  disturbanceTime = progress.sim_time_s
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  if (disturbanceStopRequested) return { action: 'stop' as const }
  const reason = disturbancePauseRequested
  if (reason) {
    disturbancePaused = true
    disturbanceStatus()
    while (disturbancePauseRequested)
      await new Promise<void>((resolve) => {
        resumeDisturbances = resolve
      })
    if (disturbanceStopRequested) return { action: 'stop' as const, reason }
    return { reason }
  }
}

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
        session = createSession(
          command.benchmark === 'release' ||
            command.benchmark === 'equilibrium' ||
            command.benchmark === 'swing-up'
            ? createConfig(command.preset, command.benchmark)
            : createActuationConfig(command.preset, command.benchmark),
        )
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
        if (disturbanceRunning) disturbancePauseRequested = command.reason
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
      case 'run-disturbances': {
        if (disturbanceRunning) throw new Error('扰动实验已运行')
        disturbanceRunning = true
        disturbancePaused = false
        disturbanceStopRequested = false
        disturbancePauseRequested = null
        disturbanceTime = null
        disturbanceStatus()
        try {
          const kinds =
            command.kind === 'both' ? (['horizontal', 'torque'] as const) : [command.kind]
          const results = []
          for (const kind of kinds) {
            results.push(await session.forkDisturbance(kind, disturbanceCheckpoint))
            if (disturbanceStopRequested) break
          }
          context.postMessage({ type: 'disturbances', results, request_id })
        } finally {
          disturbanceRunning = false
          disturbancePaused = false
          disturbancePauseRequested = null
          disturbanceStatus()
        }
        return
      }
      case 'pause-disturbances':
        if (!disturbanceRunning || disturbancePaused) throw new Error('扰动实验未运行')
        disturbancePauseRequested = 'manual'
        break
      case 'stop-disturbances':
        if (!disturbanceRunning) throw new Error('扰动实验未运行')
        disturbanceStopRequested = true
        disturbancePauseRequested = null
        resumeDisturbances?.()
        resumeDisturbances = undefined
        break
      case 'resume-disturbances':
        if (!disturbanceRunning || !disturbancePaused) throw new Error('扰动实验未暂停')
        disturbancePaused = false
        disturbancePauseRequested = null
        resumeDisturbances?.()
        resumeDisturbances = undefined
        disturbanceStatus()
        break
      case 'confirm-export':
        session.confirmExport(command.experiment_id, command.event_count)
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
