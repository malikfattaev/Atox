import { execFile } from 'node:child_process'
import { watch, type FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'
import { promisify } from 'node:util'
import type { GitBranches } from '../shared/api'

const execFileAsync = promisify(execFile)

/** Git меняет HEAD несколькими операциями подряд — ветку читаем, когда они закончились. */
const HEAD_CHANGE_DELAY_MS = 100

interface Repository {
  branch: string | null
  /** Файл HEAD репозитория; у worktree он свой, поэтому путь спрашиваем у git. */
  headPath: string | null
  watcher?: FSWatcher
  refreshTimer?: ReturnType<typeof setTimeout>
}

/**
 * Текущие ветки git в папках проектов. Следит за файлом HEAD, поэтому смена ветки —
 * в том числе агентом в терминале — видна сразу, без опроса.
 */
export class GitBranchTracker {
  private readonly repositories = new Map<string, Repository>()

  constructor(private readonly onChange: (branches: GitBranches) => void) {}

  list(): GitBranches {
    return Object.fromEntries(
      Array.from(this.repositories, ([path, { branch }]) => [path, branch])
    )
  }

  /** Приводит отслеживаемые папки к списку проектов. */
  async track(paths: readonly string[]): Promise<void> {
    const wanted = new Set(paths)
    for (const path of this.repositories.keys()) {
      if (!wanted.has(path)) {
        this.untrack(path)
      }
    }
    const added = paths.filter((path) => !this.repositories.has(path))
    added.forEach((path) => this.repositories.set(path, { branch: null, headPath: null }))
    await Promise.all(added.map((path) => this.refresh(path)))
  }

  /** Перечитывает все папки: репозиторий могли создать или удалить, пока приложение не следило. */
  async refreshAll(): Promise<void> {
    await Promise.all(Array.from(this.repositories.keys(), (path) => this.refresh(path)))
  }

  dispose(): void {
    Array.from(this.repositories.keys()).forEach((path) => this.untrack(path))
  }

  private async refresh(path: string): Promise<void> {
    const [branch, headPath] = await Promise.all([readBranch(path), readHeadPath(path)])
    const repository = this.repositories.get(path)
    // Проект могли убрать из списка, пока git отвечал.
    if (!repository) {
      return
    }
    if (repository.headPath !== headPath) {
      repository.watcher?.close()
      repository.headPath = headPath
      repository.watcher = headPath ? this.watchHead(path, headPath) : undefined
    }
    if (repository.branch !== branch) {
      repository.branch = branch
      this.onChange(this.list())
    }
  }

  /**
   * Следим за папкой, а не за самим файлом: git не переписывает HEAD, а подменяет его новым
   * файлом, и наблюдение за старым прекратилось бы после первой же смены ветки.
   */
  private watchHead(path: string, headPath: string): FSWatcher | undefined {
    const headName = basename(headPath)
    try {
      const watcher = watch(dirname(headPath), (_event, fileName) => {
        if (fileName === headName) {
          this.scheduleRefresh(path)
        }
      })
      watcher.on('error', () => watcher.close())
      return watcher
    } catch {
      return undefined
    }
  }

  private scheduleRefresh(path: string): void {
    const repository = this.repositories.get(path)
    if (repository) {
      clearTimeout(repository.refreshTimer)
      repository.refreshTimer = setTimeout(() => void this.refresh(path), HEAD_CHANGE_DELAY_MS)
    }
  }

  private untrack(path: string): void {
    const repository = this.repositories.get(path)
    clearTimeout(repository?.refreshTimer)
    repository?.watcher?.close()
    this.repositories.delete(path)
  }
}

/** Имя ветки; в состоянии detached HEAD — короткий хеш коммита, вне репозитория — `null`. */
async function readBranch(path: string): Promise<string | null> {
  return (
    (await git(path, ['symbolic-ref', '--short', '--quiet', 'HEAD'])) ??
    (await git(path, ['rev-parse', '--short', 'HEAD']))
  )
}

function readHeadPath(path: string): Promise<string | null> {
  return git(path, ['rev-parse', '--path-format=absolute', '--git-path', 'HEAD'])
}

/** Вывод команды git в папке или `null`, если она завершилась ошибкой или ничего не вывела. */
async function git(path: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', path, ...args])
    return stdout.trim() || null
  } catch {
    return null
  }
}
