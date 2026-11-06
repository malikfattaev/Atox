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
import { CommandError, errorMessage, runGit } from './processes'
import type { ShellEnvironment } from './shellEnvironment'

/** Строки нового файла считаются, только пока он не больше этого: огромный файл — не код. */
const UNTRACKED_COUNT_LIMIT_BYTES = 2 * 1024 * 1024

/**
 * Сколько новых файлов читать одновременно. Агент может создать тысячи файлов разом
 * (зависимости, сборка), и чтение всех сразу упёрлось бы в лимит открытых файлов.
 */
const UNTRACKED_COUNT_CONCURRENCY = 16

const NEWLINE = 0x0a

type LineCounts = Pick<FileChange, 'additions' | 'deletions'>

/** Посчитанные строки нового файла и то, по чему видно, что файл с тех пор не менялся. */
interface CountedFile {
  size: number
  modifiedAt: number
  counts: LineCounts
}

/** Так git отвечает в папке вне репозитория (`fatal: not a git repository …`). */
const NOT_REPOSITORY_MESSAGE = 'not a git repository'

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
  /**
   * Строки новых файлов каждого репозитория с прошлого прохода. Новые файлы перечитываются
   * только когда изменились: иначе каждое обновление панели читало бы их все целиком.
   */
  private readonly lineCounts = new Map<string, ReadonlyMap<string, CountedFile>>()

  constructor(private readonly shellEnvironment: ShellEnvironment) {}

  async list(projectPath: string): Promise<ChangesResult> {
    try {
      return { ok: true, files: await this.files(await this.scope(projectPath)) }
    } catch (error) {
      // Не репозиторий — только когда так говорит сам git: таймаут или отсутствие git
      // пользователь должен увидеть как есть, а не как «это не репозиторий».
      return isNotRepository(error)
        ? { ok: false, error: { kind: 'not-git' } }
        : { ok: false, error: { kind: 'failed', message: errorMessage(error) } }
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
    const output = await runGit(['rev-parse', '--show-toplevel', '--show-prefix'], {
      cwd: projectPath,
      env
    })
    const [root = '', prefix = ''] = output.split('\n')
    const head = await runGit(['rev-parse', '--verify', '--quiet', 'HEAD'], {
      cwd: root,
      env,
      successCodes: [0, 1]
    })
    const hasCommits = head.trim() !== ''
    // Пустое дерево зависит от формата хешей репозитория, поэтому его считает сам git.
    const base = hasCommits
      ? 'HEAD'
      : (
          await runGit(['hash-object', '-t', 'tree', '--stdin'], {
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
    const untracked = await this.countUntracked(
      scope,
      changes.filter((change) => change.kind === 'untracked').map((change) => change.path)
    )
    return changes.map((change) => {
      const counts =
        change.kind === 'untracked' ? untracked.get(change.path)?.counts : stats.get(change.path)
      return { ...change, ...(counts ?? { additions: 0, deletions: 0 }) }
    })
  }

  /**
   * Строки новых файлов. Файл, у которого с прошлого прохода не изменились размер и время
   * изменения, не перечитывается. Запоминаются только файлы этого прохода — закоммиченные
   * и удалённые из памяти уходят.
   */
  private async countUntracked(
    scope: Scope,
    paths: readonly string[]
  ): Promise<ReadonlyMap<string, CountedFile>> {
    const previous = this.lineCounts.get(scope.root)
    const counted = new Map<string, CountedFile>()
    for (let start = 0; start < paths.length; start += UNTRACKED_COUNT_CONCURRENCY) {
      const batch = paths.slice(start, start + UNTRACKED_COUNT_CONCURRENCY)
      const results = await Promise.all(
        batch.map((path) => countFileLines(join(scope.root, path), previous?.get(path)))
      )
      batch.forEach((path, index) => counted.set(path, results[index]!))
    }
    this.lineCounts.set(scope.root, counted)
    return counted
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
    return runGit(args, {
      cwd: scope.root,
      env: await this.shellEnvironment.get(),
      ...(successCodes && { successCodes })
    })
  }
}

/** Строки нового файла, которого git ещё не знает: все они — добавленные. */
async function countFileLines(
  fullPath: string,
  previous: CountedFile | undefined
): Promise<CountedFile> {
  const binary = { additions: null, deletions: null }
  try {
    const { size, mtimeMs } = await stat(fullPath)
    if (previous && previous.size === size && previous.modifiedAt === mtimeMs) {
      return previous
    }
    const counted = (counts: LineCounts): CountedFile => ({ size, modifiedAt: mtimeMs, counts })
    if (size > UNTRACKED_COUNT_LIMIT_BYTES) {
      return counted(binary)
    }
    const content = await readFile(fullPath)
    // Так же определяет двоичные файлы и git: по нулевому байту.
    if (content.includes(0)) {
      return counted(binary)
    }
    return counted({ additions: countLines(content), deletions: 0 })
  } catch {
    // Файл успели удалить или его не прочитать: запоминать нечего, в следующий раз — заново.
    return { size: -1, modifiedAt: -1, counts: binary }
  }
}

/**
 * Строки текста. Переводы строк считаются по байтам, без декодирования: в UTF-8 байт 0x0a
 * бывает только переводом строки. Последняя строка без перевода строки — тоже строка.
 */
function countLines(content: Buffer): number {
  let lines = 0
  let index = content.indexOf(NEWLINE)
  while (index >= 0) {
    lines++
    index = content.indexOf(NEWLINE, index + 1)
  }
  return content.length > 0 && content.at(-1) !== NEWLINE ? lines + 1 : lines
}

function isNotRepository(error: unknown): boolean {
  return error instanceof CommandError && error.stderr.includes(NOT_REPOSITORY_MESSAGE)
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
