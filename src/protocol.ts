import type { BenchmarkId, PresetId } from './config.ts'
import type { EvidenceBundle } from './evidence.ts'
import type { SessionOutput } from './session.ts'

export type Command =
  | { type: 'configure'; preset: PresetId; benchmark: BenchmarkId }
  | { type: 'start' | 'resume' | 'stop' | 'reset' | 'export' }
  | { type: 'pause'; reason: 'manual' | 'background' }

export type Request = { request_id: number; command: Command }
export type Reply =
  | { type: 'snapshot'; output: SessionOutput; running_wall_ms: number; request_id?: number }
  | { type: 'evidence'; bundle: EvidenceBundle; request_id: number }
  | { type: 'error'; message: string; request_id?: number }
