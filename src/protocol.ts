import type { BenchmarkId, PresetId } from './config.ts'
import type { EvidenceBundle } from './evidence.ts'
import type { SessionOutput, DisturbanceOutput } from './session.ts'

export type Command =
  | { type: 'configure'; preset: PresetId; benchmark: BenchmarkId }
  | { type: 'start' | 'resume' | 'stop' | 'reset' | 'export' }
  | { type: 'run-disturbances' | 'resume-disturbances' }
  | { type: 'confirm-export'; experiment_id: string; event_count: number }
  | { type: 'pause'; reason: 'manual' | 'background' }

export type Request = { request_id: number; command: Command }
export type Reply =
  | { type: 'snapshot'; output: SessionOutput; running_wall_ms: number; request_id?: number }
  | {
      type: 'disturbance-status'
      paused: boolean
      running: boolean
      sim_time_s: number | null
      request_id?: never
    }
  | { type: 'disturbances'; results: DisturbanceOutput[]; request_id: number }
  | { type: 'evidence'; bundle: EvidenceBundle; request_id: number }
  | { type: 'error'; message: string; request_id?: number }
