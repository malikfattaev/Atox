import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { shell } from 'electron'
import {
  parseDiff,
  type ChangesResult,
  type FileChange,
  type FileChangeKind,
  type FileDiff
} from '../shared/changes'
import { errorMessage, runCommand } from './processes'
import type { ShellEnvironment } from './shellEnvironment'

/** Строки нового файла считаются, только пока он не больше этого: огромный файл — не код. */
const UNTRACKED_COUNT_LIMIT_BYTES = 2 * 1024 * 1024

/** Репозиторий проекта: его корень и папка проекта в нём. */
interface Scope {
  root: string
  /** Папка проекта относительно корня; `.` — проект и есть репозиторий. */
  pathspec: string
  /** С чем сравнивать: HEAD или пустое дерево, если коммитов ещё нет. */
  base: string
  hasCommits: boolean
}

/**
 * Незакоммиченные изменения в папке проекта: что агенты поменяли в файлах. Сравнивается
 * с последним коммитом, без разницы, добавлены изменения в индекс или нет.
 */
export class WorkingTreeReader {
  constructor(private readonly shellEnvironment: ShellEnvironment) {}

  async list(projectPath: string): Promise<ChangesResult> {
    let scope: Scope
    try {
      scope = await this.scope(projectPath)
    } catch {
      return { ok: false, error: { kind: 'not-git' } }
    }
    try {
      return { ok: true, files: await this.files(scope) }
    } catch (error) {
      return { ok: false, error: { kind: 'failed', message: errorMessage(error) } }
    }
  }

  /** Изменения одного файла; `null` — файл уже не изменён. */
  async diff(projectPath: string, path: string): Promise<FileDiff | null> {
    const scope = await this.scope(projectPath)
    const change = (await this.files(scope)).find((file) => file.path === path)
    if (!change) {
      return null
    }
    const patch =
      change.kind === 'untracked'
        ? await this.git(
            scope,
            ['diff', '--no-index', '--no-color', '--', '/dev/null', path],
            [0, 1]
          )
        : await this.git(scope, [
            'diff',
            scope.base,
            '--no-color',
            '-M',
            '--',
            path,
            ...(change.previousPath ? [change.previousPath] : [])
          ])
    return parseDiff(patch)
  }

  /** Файл из списка изменений; `undefined` — он уже не изменён. */
  async find(projectPath: string, path: string): Promise<FileChange | undefined> {
    const scope = await this.scope(projectPath)
    return (await this.files(scope)).find((file) => file.path === path)
  }

  /**
   * Возвращает файл к последнему коммиту. Новые файлы уходят в Корзину, а не удаляются:
   * так случайно отменённую работу агента ещё можно вернуть.
   */
  async discard(projectPath: string, change: FileChange): Promise<void> {
    const scope = await this.scope(projectPath)
    const restore = (path: string) =>
      this.git(scope, ['restore', '--source=HEAD', '--staged', '--worktree', '--', path])
    const unstageAndTrash = async (path: string) => {
      await this.git(scope, ['rm', '--cached', '--force', '--quiet', '--', path])
      await this.trash(scope, path)
    }
    switch (change.kind) {
      case 'untracked':
        await this.trash(scope, change.path)
        break
      case 'added':
        await unstageAndTrash(change.path)
        break
      case 'renamed':
        if (change.previousPath) {
          await restore(change.previousPath)
        }
        await unstageAndTrash(change.path)
        break
      case 'modified':
      case 'deleted':
        await restore(change.path)
        break
    }
  }

  private async scope(projectPath: string): Promise<Scope> {
    const env = await this.shellEnvironment.get()
    const output = await runCommand('git', ['rev-parse', '--show-toplevel', '--show-prefix'], {
      cwd: projectPath,
      env
    })
    const [root = '', prefix = ''] = output.split('\n')
    const head = await runCommand('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], {
      cwd: root,
      env,
      successCodes: [0, 1]
    })
    const hasCommits = head.trim() !== ''
    // Пустое дерево зависит от формата хешей репозитория, поэтому его считает сам git.
    const base = hasCommits
      ? 'HEAD'
      : (
          await runCommand('git', ['hash-object', '-t', 'tree', '--stdin'], {
            cwd: root,
            env,
            input: ''
          })
        ).trim()
    return { root, pathspec: prefix || '.', base, hasCommits }
  }

  private async files(scope: Scope): Promise<FileChange[]> {
    const [status, numstat] = await Promise.all([
      this.git(scope, [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--',
        scope.pathspec
      ]),
      this.git(scope, ['diff', scope.base, '--numstat', '-z', '-M', '--', scope.pathspec])
    ])
    const stats = parseNumstat(numstat)
    const changes = parseStatus(status)
    return Promise.all(
      changes.map(async (change) => {
        const counts =
          change.kind === 'untracked'
            ? await this.countLines(scope, change.path)
            : (stats.get(change.path) ?? { additions: 0, deletions: 0 })
        return { ...change, ...counts }
      })
    )
  }

  /** Строки нового файла, которого git ещё не знает: все они — добавленные. */
  private async countLines(
    scope: Scope,
    path: string
  ): Promise<Pick<FileChange, 'additions' | 'deletions'>> {
    const binary = { additions: null, deletions: null }
    const fullPath = join(scope.root, path)
    try {
      if ((await stat(fullPath)).size > UNTRACKED_COUNT_LIMIT_BYTES) {
        return binary
      }
      const content = await readFile(fullPath)
      // Так же определяет двоичные файлы и git: по нулевому байту.
      if (content.includes(0)) {
        return binary
      }
      const text = content.toString('utf8')
      const lines = text.split('\n').length - (text.endsWith('\n') || text === '' ? 1 : 0)
      return { additions: lines, deletions: 0 }
    } catch {
      return binary
    }
  }

  private async trash(scope: Scope, path: string): Promise<void> {
    const fullPath = join(scope.root, path)
    const exists = await stat(fullPath).then(
      () => true,
      () => false
    )
    if (exists) {
      await shell.trashItem(fullPath)
    }
  }

  private async git(scope: Scope, args: string[], successCodes?: number[]): Promise<string> {
    return runCommand('git', args, {
      cwd: scope.root,
      env: await this.shellEnvironment.get(),
      ...(successCodes && { successCodes })
    })
  }
}

type StatusEntry = Pick<FileChange, 'path' | 'previousPath' | 'kind'>

/** Разбирает `git status --porcelain=v1 -z`: у переименования следом идёт прежний путь. */
function parseStatus(output: string): StatusEntry[] {
  const records = output.split('\0')
  const entries: StatusEntry[] = []
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!
    if (record.length < 4) {
      continue
    }
    const code = record.slice(0, 2)
    const path = record.slice(3)
    if (code === '!!') {
      continue
    }
    const kind = statusKind(code)
    if (code.includes('R') || code.includes('C')) {
      const previousPath = records[++index]
      entries.push({ path, kind, ...(previousPath && { previousPath }) })
    } else {
      entries.push({ path, kind })
    }
  }
  return entries
}

function statusKind(code: string): FileChangeKind {
  if (code === '??') {
    return 'untracked'
  }
  if (code.includes('R')) {
    return 'renamed'
  }
  if (code[0] === 'A' || code[0] === 'C') {
    return 'added'
  }
  return code.includes('D') ? 'deleted' : 'modified'
}

/**
 * Разбирает `git diff --numstat -z`: «добавлено, удалено, путь», а у переименования вместо
 * пути — пустое поле, прежний путь и новый. У двоичных файлов вместо чисел `-`.
 */
function parseNumstat(output: string): Map<string, Pick<FileChange, 'additions' | 'deletions'>> {
  const stats = new Map<string, Pick<FileChange, 'additions' | 'deletions'>>()
  const records = output.split('\0')
  for (let index = 0; index < records.length; index++) {
    const [added, deleted, inlinePath] = records[index]!.split('\t')
    if (added === undefined || deleted === undefined || inlinePath === undefined) {
      continue
    }
    let path = inlinePath
    if (!path) {
      index += 2
      path = records[index] ?? ''
    }
    stats.set(path, {
      additions: added === '-' ? null : Number(added),
      deletions: deleted === '-' ? null : Number(deleted)
    })
  }
  return stats
}
