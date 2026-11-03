import type { PresetId } from './config.ts'
import type { BenchmarkBundle, BenchmarkOutput } from './benchmarks.ts'

export type BenchmarkCommand =
  | { type: 'configure'; preset: PresetId }
  | { type: 'start' | 'resume' | 'stop' | 'export' }
  | { type: 'pause'; reason: 'manual' | 'background' }
export type BenchmarkReply =
  | { type: 'snapshot'; output: BenchmarkOutput }
  | { type: 'evidence'; bundle: BenchmarkBundle }
  | { type: 'error'; message: string }
