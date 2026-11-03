import { createPhysicsBenchmarks } from './benchmarks.ts'
import type { BenchmarkCommand, BenchmarkReply } from './benchmark-protocol.ts'

const context = globalThis as unknown as {
  postMessage(message: BenchmarkReply): void
  onmessage: (event: MessageEvent<BenchmarkCommand>) => void
}
let suite = createPhysicsBenchmarks('standard')
let timer: ReturnType<typeof setTimeout> | undefined
const snapshot = () => context.postMessage({ type: 'snapshot', output: suite.read() })
function pump() {
  try {
    suite.advance()
    snapshot()
    if (suite.read().status === 'running') timer = setTimeout(pump, 0)
  } catch (error) {
    suite.stop()
    context.postMessage({ type: 'error', message: String(error) })
    snapshot()
  }
}
context.onmessage = async ({ data }) => {
  try {
    switch (data.type) {
      case 'configure':
        if (suite.read().status === 'running' || suite.read().status === 'paused')
          throw new Error('请先结束当前批次')
        clearTimeout(timer)
        suite = createPhysicsBenchmarks(data.preset)
        break
      case 'start':
        suite.start()
        timer = setTimeout(pump, 0)
        break
      case 'pause':
        clearTimeout(timer)
        suite.pause(data.reason)
        break
      case 'resume':
        suite.resume()
        timer = setTimeout(pump, 0)
        break
      case 'stop':
        clearTimeout(timer)
        suite.stop()
        break
      case 'export':
        context.postMessage({ type: 'evidence', bundle: await suite.exportEvidence() })
        return
    }
    snapshot()
  } catch (error) {
    context.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
snapshot()
