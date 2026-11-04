import type { DirectoryHandle } from './workspace-files.ts'
import type { openWorkspace } from './workspace.ts'
import type { ExperimentConfig } from './session.ts'

type Workspace = Awaited<ReturnType<typeof openWorkspace>>
type Run = Awaited<ReturnType<Workspace['create']>>
export type WorkspaceCommand =
  | { type: 'open'; handle: DirectoryHandle; readonly: boolean }
  | { type: 'start'; config: ExperimentConfig }
  | { type: 'pause'; reason: 'manual' | 'background' }
  | { type: 'resume' | 'stop' | 'retry' }
  | { type: 'load'; id: string }
export type WorkspaceReply =
  | { type: 'opened'; id: string; writable: boolean; experiments: string[] }
  | { type: 'list'; experiments: string[] }
  | ({ type: 'progress' } & ReturnType<Run['progress']>)
  | {
      type: 'history'
      recovery: Awaited<ReturnType<Workspace['recover']>>
      live_fault?: ReturnType<Run['read']>
    }
  | { type: 'error'; message: string; hasRun: boolean }
