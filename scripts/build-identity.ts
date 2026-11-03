import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { normalizePath, type Plugin } from 'vite'
import type { BuildIdentity } from '../src/build-info.ts'

const buildFiles = [
  'index.html',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'scripts/build-identity.ts',
]
function sourceFiles(root: string): string[] {
  function walk(directory: string): string[] {
    return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
      const path = `${directory}/${entry.name}`
      if (entry.isSymbolicLink()) throw new Error(`构建输入不支持符号链接：${path}`)
      return entry.isDirectory() ? walk(path) : [path]
    })
  }
  return [...buildFiles, ...walk('src')].sort()
}

export function readBuildIdentity(root: string): BuildIdentity {
  const paths = sourceFiles(root)
  const hash = createHash('sha256')
  for (const path of paths) {
    const bytes = readFileSync(join(root, path))
    hash.update(JSON.stringify([path, bytes.length]) + '\n').update(bytes)
  }
  let source_revision: string | null = null
  let source_dirty: boolean | null = null
  try {
    const git = (args: string[]) =>
      execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    source_revision = git(['rev-parse', 'HEAD'])
    source_dirty = git(['status', '--porcelain', '--untracked-files=all', '--', ...paths]) !== ''
  } catch {
    /* An archive still has a source digest, but no verified Git origin. */
  }
  return { source_revision, source_sha256: hash.digest('hex'), source_dirty }
}

export function buildIdentityPlugin(emitManifest = true): Plugin {
  let root = ''
  let serving = false
  let identity: BuildIdentity
  return {
    name: 'pendulum-build-identity',
    enforce: 'pre',
    configResolved(config) {
      root = config.root
      serving = config.command === 'serve'
    },
    buildStart() {
      identity = readBuildIdentity(root)
      for (const path of sourceFiles(root)) this.addWatchFile(join(root, path))
    },
    load(id) {
      if (normalizePath(id.split('?')[0]!) === normalizePath(resolve(root, 'src/build-info.ts'))) {
        const current = serving ? readBuildIdentity(root) : identity
        return `export const buildIdentity = ${JSON.stringify(current)};`
      }
    },
    hotUpdate({ file }) {
      const relative = normalizePath(file).slice(normalizePath(root).length + 1)
      if (relative.startsWith('src/') || buildFiles.includes(relative)) {
        this.environment.moduleGraph.invalidateAll()
        this.environment.hot.send({ type: 'full-reload' })
        return []
      }
    },
    generateBundle() {
      if (readBuildIdentity(root).source_sha256 !== identity.source_sha256)
        this.error('构建期间输入已改变，请在源码固定后重新构建。')
      if (emitManifest)
        this.emitFile({
          type: 'asset',
          fileName: 'build-info.json',
          source: JSON.stringify(identity, null, 2) + '\n',
        })
    },
  }
}
