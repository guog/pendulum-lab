import type { WorkspaceFiles } from './workspace.ts'

export type DirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  keys(): AsyncIterableIterator<string>
}
declare global {
  interface Window {
    showDirectoryPicker?: (options: { mode: 'read' | 'readwrite' }) => Promise<DirectoryHandle>
  }
}
export function directoryFiles(root: DirectoryHandle, readonly = false): WorkspaceFiles {
  async function directory(path: string, create = false) {
    let current: FileSystemDirectoryHandle = root
    for (const name of path.split('/').filter(Boolean))
      current = await current.getDirectoryHandle(name, { create })
    return current
  }
  async function file(path: string, create = false) {
    const parts = path.split('/'),
      name = parts.pop()!
    return (await directory(parts.join('/'), create)).getFileHandle(name, { create })
  }
  return {
    async permission(mode) {
      if (readonly && mode === 'readwrite') return false
      return (await root.queryPermission({ mode })) === 'granted'
    },
    async list(path) {
      const handle = (await directory(path)) as DirectoryHandle
      const names: string[] = []
      for await (const name of handle.keys()) names.push(name)
      return names
    },
    async read(path) {
      const saved = await (await file(path)).getFile()
      if (saved.size > 64 * 1024 * 1024) throw new Error('文件超过64MiB限制')
      return saved.text()
    },
    async write(path, text) {
      const writer = await (await file(path, true)).createWritable()
      try {
        await writer.write(text)
        await writer.close()
      } catch (error) {
        await writer.abort().catch(() => undefined)
        throw error
      }
    },
  }
}
