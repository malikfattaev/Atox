import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { AGENTS, type AgentId } from '../shared/agents'
import type { ShellEnvironment } from './shellEnvironment'

/**
 * Какие агенты установлены и где лежат их программы. Программы ищутся по PATH оболочки входа —
 * тому же, что видит пользователь в терминале. Ответ отдаётся из кеша и обновляется в фоне:
 * меню нового чата открывается без задержки, а только что установленный агент появится в нём
 * со следующего раза.
 */
export class AgentDetector {
  private executables: Promise<Map<AgentId, string>> | null = null

  constructor(private readonly shell: ShellEnvironment) {}

  async list(): Promise<AgentId[]> {
    return [...(await this.refresh()).keys()]
  }

  /** Путь к программе агента; `null` — агент не установлен. */
  async executable(agent: AgentId): Promise<string | null> {
    return (await this.refresh()).get(agent) ?? null
  }

  private refresh(): Promise<Map<AgentId, string>> {
    const cached = this.executables
    const fresh = this.detect()
    // Первый запрос ждёт поиска, следующие получают прошлый ответ, пока идёт новый.
    fresh.then(
      (executables) => {
        this.executables = Promise.resolve(executables)
      },
      () => undefined
    )
    return cached ?? fresh
  }

  private async detect(): Promise<Map<AgentId, string>> {
    const directories = ((await this.shell.get())['PATH'] ?? '').split(delimiter).filter(Boolean)
    const found = new Map<AgentId, string>()
    for (const agent of AGENTS) {
      const path = await findProgram(agent.program, directories)
      if (path) {
        found.set(agent.id, path)
      }
    }
    return found
  }
}

async function findProgram(name: string, directories: readonly string[]): Promise<string | null> {
  for (const directory of directories) {
    const candidate = join(directory, name)
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // В этом каталоге программы нет — ищем дальше.
    }
  }
  return null
}
