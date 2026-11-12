import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Project } from '../../shared/models'
import { runCommand } from '../processes'
import type { ShellEnvironment } from '../shellEnvironment'

/**
 * Папка Atox в домашней: сюда клонируются репозитории доски, которых нет среди проектов,
 * и здесь же лежат worktree задач — на виду, чтобы их можно было открыть в редакторе.
 */
const ATOX_HOME = join(homedir(), 'Atox')
const CLONES_DIRECTORY = join(ATOX_HOME, 'repositories')
const WORKTREES_DIRECTORY = join(ATOX_HOME, 'worktrees')

/** Ветка задачи: по ней видно, что её завёл агент доски и к какому issue она. */
const BRANCH_PREFIX = 'atox/issue-'

/** Клонирование и загрузка большого репозитория идут минутами, а не секундами. */
const NETWORK_TIMEOUT_MS = 10 * 60_000

/** `owner/name` из адреса удалённого репозитория GitHub — https или ssh. */
const GITHUB_REMOTE = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/i

export interface IssueWorktree {
  path: string
  branch: string
}

/** Локальные копии репозиториев доски и worktree её задач. */
export class BoardWorktrees {
  /** Репозиторий GitHub папки проекта по пути; `null` — не репозиторий GitHub. */
  private readonly remotes = new Map<string, string | null>()

  constructor(private readonly shell: ShellEnvironment) {}

  /** Проект, папка которого — копия репозитория `fullName`. */
  async findProject(projects: readonly Project[], fullName: string): Promise<Project | undefined> {
    const wanted = fullName.toLowerCase()
    for (const project of projects) {
      if ((await this.remoteOf(project.path))?.toLowerCase() === wanted) {
        return project
      }
    }
    return undefined
  }

  /** Клонирует репозиторий в папку Atox — или возвращает уже склонированный туда раньше. */
  async clone(fullName: string, token: string): Promise<string> {
    const path = join(CLONES_DIRECTORY, ...fullName.split('/'))
    if (!existsSync(join(path, '.git'))) {
      await mkdir(dirname(path), { recursive: true })
      await this.run('gh', ['repo', 'clone', fullName, path], homedir(), token)
    }
    this.remotes.set(path, fullName)
    return path
  }

  /**
   * Worktree задачи в своей ветке от свежей основной ветки репозитория. Если он уже есть —
   * например, задачу вернули в очередь, — агент продолжает в нём.
   */
  async create(repositoryPath: string, fullName: string, issue: number, token: string): Promise<IssueWorktree> {
    const branch = `${BRANCH_PREFIX}${issue}`
    const path = join(WORKTREES_DIRECTORY, ...fullName.split('/'), `issue-${issue}`)
    if (existsSync(join(path, '.git'))) {
      return { path, branch }
    }
    await this.run('git', ['fetch', '--quiet', 'origin'], repositoryPath, token)
    const base = await this.defaultBranch(repositoryPath, token)
    await mkdir(dirname(path), { recursive: true })
    const branchExists = await this.run(
      'git',
      ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
      repositoryPath,
      token
    ).then(
      () => true,
      () => false
    )
    await this.run(
      'git',
      branchExists
        ? ['worktree', 'add', path, branch]
        : ['worktree', 'add', '-b', branch, path, `origin/${base}`],
      repositoryPath,
      token
    )
    return { path, branch }
  }

  /** Основная ветка на GitHub: та, на которую указывает `origin/HEAD`. */
  private async defaultBranch(repositoryPath: string, token: string): Promise<string> {
    const read = () =>
      this.run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], repositoryPath, token)
    // В копии, сделанной не через clone, `origin/HEAD` может не быть — его спрашивают у GitHub.
    const reference = await read().catch(async () => {
      await this.run('git', ['remote', 'set-head', 'origin', '--auto'], repositoryPath, token)
      return read()
    })
    return reference.trim().replace(/^origin\//, '')
  }

  private async remoteOf(path: string): Promise<string | null> {
    if (!this.remotes.has(path)) {
      const url = existsSync(path)
        ? await this.run('git', ['remote', 'get-url', 'origin'], path).catch(() => '')
        : ''
      this.remotes.set(path, GITHUB_REMOTE.exec(url.trim())?.[1] ?? null)
    }
    return this.remotes.get(path) ?? null
  }

  private async run(program: string, args: string[], cwd: string, token?: string): Promise<string> {
    const env = { ...(await this.shell.get()), ...(token && { GH_TOKEN: token }) }
    // С токеном команда ходит в сеть, без него — только читает локальный репозиторий.
    return runCommand(program, args, { cwd, env, ...(token && { timeoutMs: NETWORK_TIMEOUT_MS }) })
  }
}
