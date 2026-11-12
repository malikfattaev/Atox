import { existsSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
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

/** Папка, в которую идёт клонирование, пока оно не закончилось. */
const PARTIAL_CLONE_SUFFIX = '.cloning'

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
  /**
   * Репозиторий GitHub папки проекта по пути. Папки без него не запоминаются: удалённый
   * репозиторий у проекта может появиться позже.
   */
  private readonly remotes = new Map<string, string>()
  /** Последняя работа с каждым репозиторием: следующая ждёт её, а не идёт вперемешку. */
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(private readonly shell: ShellEnvironment) {}

  /**
   * Выполняет `task` после прежних задач того же репозитория. Две задачи одного репозитория,
   * запущенные вместе, иначе клонировали бы его в одну папку и делили блокировку git.
   */
  exclusive<T>(fullName: string, task: () => Promise<T>): Promise<T> {
    const key = fullName.toLowerCase()
    const result = (this.queues.get(key) ?? Promise.resolve()).then(task)
    const settled = result.catch(() => undefined)
    this.queues.set(key, settled)
    void settled.then(() => {
      if (this.queues.get(key) === settled) {
        this.queues.delete(key)
      }
    })
    return result
  }

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
      // Клон собирается рядом и встаёт на место, только когда готов: оборванное клонирование
      // (Atox закрыли посреди) не оставит битую копию, которую потом приняли бы за целую.
      const partial = `${path}${PARTIAL_CLONE_SUFFIX}`
      await rm(partial, { recursive: true, force: true })
      // По https и через `gh`: под учётной записью `GH_TOKEN`, а не ssh-ключом или другой
      // учётной записью из связки ключей. Помощник остаётся в настройках копии, так что
      // агент пушит из неё под той же учётной записью.
      await this.run(
        'git',
        [
          'clone',
          '-c',
          'credential.helper=',
          '-c',
          'credential.helper=!gh auth git-credential',
          `https://github.com/${fullName}.git`,
          partial
        ],
        homedir(),
        token
      )
      await rename(partial, path)
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

  /**
   * Убирает worktree задачи вместе с несохранёнными в нём правками: задача закрыта, её работа
   * уже в ветке на GitHub. Локальная ветка задачи удаляется, только если она запушена или
   * влита, — иначе `git branch -d` её не тронет.
   */
  async remove(repositoryPath: string, worktreePath: string): Promise<void> {
    if (!existsSync(worktreePath)) {
      return
    }
    const branch = await this.run('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], worktreePath)
      .then((name) => name.trim())
      .catch(() => '')
    await this.run('git', ['worktree', 'remove', '--force', worktreePath], repositoryPath)
    if (branch.startsWith(BRANCH_PREFIX)) {
      await this.run('git', ['branch', '-d', branch], repositoryPath).catch(() => undefined)
    }
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
    const known = this.remotes.get(path)
    if (known) {
      return known
    }
    const url = existsSync(path)
      ? await this.run('git', ['remote', 'get-url', 'origin'], path).catch(() => '')
      : ''
    const remote = GITHUB_REMOTE.exec(url.trim())?.[1]
    if (remote) {
      this.remotes.set(path, remote)
    }
    return remote ?? null
  }

  private async run(program: string, args: string[], cwd: string, token?: string): Promise<string> {
    // С токеном команда ходит в сеть, без него — только читает локальный репозиторий. Спросить
    // пароль git здесь не у кого: без доступа команда должна упасть, а не ждать ввода.
    const env = {
      ...(await this.shell.get()),
      ...(token && { GH_TOKEN: token, GIT_TERMINAL_PROMPT: '0' })
    }
    return runCommand(program, args, { cwd, env, ...(token && { timeoutMs: NETWORK_TIMEOUT_MS }) })
  }
}
