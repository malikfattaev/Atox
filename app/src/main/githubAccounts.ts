import { homedir } from 'node:os'
import { GITHUB_HOST, type GitHubAccount } from '../shared/github'
import { runCommand } from './processes'
import type { ShellEnvironment } from './shellEnvironment'

/** Учётная запись в ответе `gh auth status --json hosts`. */
interface StatusEntry {
  login: string
  active: boolean
  state: string
}

/** Учётные записи github.com, в которые выполнен вход в `gh`, и их токены. */
export class GitHubAccounts {
  constructor(private readonly shell: ShellEnvironment) {}

  /** Учётные записи с действующим входом; пусто, если `gh` нет или он их не сообщил. */
  async list(): Promise<GitHubAccount[]> {
    try {
      const output = await this.gh(['auth', 'status', '--hostname', GITHUB_HOST, '--json', 'hosts'])
      const { hosts } = JSON.parse(output) as { hosts?: Record<string, StatusEntry[]> }
      return (hosts?.[GITHUB_HOST] ?? [])
        .filter(({ state }) => state === 'success')
        .map(({ login, active }) => ({ login, active }))
        // `gh` ставит активную первой; постоянный порядок не даёт строкам прыгать при переключении.
        .sort((left, right) => left.login.localeCompare(right.login, undefined, { sensitivity: 'base' }))
    } catch {
      return []
    }
  }

  /** Токен учётной записи; `null` — `gh` его не выдал. */
  async token(login: string): Promise<string | null> {
    try {
      const token = await this.gh(['auth', 'token', '--hostname', GITHUB_HOST, '--user', login])
      return token.trim() || null
    } catch {
      return null
    }
  }

  /** Делает учётную запись активной: под ней `gh` и git работают по умолчанию везде. */
  async activate(login: string): Promise<void> {
    if (!(await this.list()).some((account) => account.login === login)) {
      throw new Error(`${login} is not signed in to gh`)
    }
    await this.gh(['auth', 'switch', '--hostname', GITHUB_HOST, '--user', login])
  }

  private async gh(args: string[]): Promise<string> {
    return runCommand('gh', args, { cwd: homedir(), env: await this.shell.get() })
  }
}
