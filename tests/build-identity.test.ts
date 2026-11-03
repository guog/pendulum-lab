import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

test('真实构建清单识别未暂存及已暂存的源码删除，恢复后身份回到干净版本', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'pendulum-build-identity-'))
  const sourceRoot = process.cwd()
  // Git hooks export repository-local variables; the fixture must use its own .git.
  const fixtureEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  )
  const run = (command: string, args: string[]) =>
    execFileSync(command, args, {
      cwd: fixture,
      env: fixtureEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    }).trim()
  const build = () => {
    run('npm', ['run', 'build'])
    return JSON.parse(readFileSync(join(fixture, 'dist/build-info.json'), 'utf8'))
  }
  try {
    const paths = execFileSync(
      'git',
      [
        'ls-files',
        '-z',
        '--',
        'src',
        'index.html',
        'package.json',
        'package-lock.json',
        'tsconfig.json',
        'vite.config.ts',
        'scripts/build-identity.ts',
      ],
      { cwd: sourceRoot, encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean)
    for (const path of paths) {
      mkdirSync(dirname(join(fixture, path)), { recursive: true })
      copyFileSync(join(sourceRoot, path), join(fixture, path))
    }
    symlinkSync(resolve(sourceRoot, 'node_modules'), join(fixture, 'node_modules'), 'dir')
    writeFileSync(join(fixture, '.gitignore'), 'node_modules/\ndist/\n')
    writeFileSync(join(fixture, 'src/unused.ts'), 'export const fixtureInput = 1\n')
    run('git', ['init', '--quiet'])
    run('git', ['add', '.'])
    run('git', [
      '-c',
      'user.name=Build Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '--quiet',
      '-m',
      'test: freeze isolated build fixture\n\nAssisted-by: LLM\nAI-Agent: OpenAI Codex',
    ])
    const clean = build()
    assert.equal(clean.source_dirty, false)
    rmSync(join(fixture, 'src/unused.ts'))
    const deleted = build()
    assert.equal(deleted.source_revision, clean.source_revision)
    assert.notEqual(deleted.source_sha256, clean.source_sha256)
    assert.equal(deleted.source_dirty, true, '删除受控源码必须标记为已修改')
    run('git', ['add', '-u', '--', 'src/unused.ts'])
    const staged = build()
    assert.equal(staged.source_dirty, true)
    assert.equal(staged.source_sha256, deleted.source_sha256)
    run('git', ['restore', '--source=HEAD', '--staged', '--worktree', '--', 'src/unused.ts'])
    const restored = build()
    assert.deepEqual(restored, clean)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
