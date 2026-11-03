export type BuildIdentity = {
  source_revision: string | null
  source_sha256: string
  source_dirty: boolean | null
}

// Vite supplies this module for the browser and Worker. Native Node sessions
// remain explicitly unbundled instead of inventing a verified build identity.
export const buildIdentity: BuildIdentity | null = null
