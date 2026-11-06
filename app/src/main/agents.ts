import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { AGENTS, type AgentId } from '../shared/agents'
import type { ShellEnvironment } from './shellEnvironment'

/**
 * Не найден какой-то агент — окружение оболочки перечитывается, если оно старше этого:
 * агента могли поставить, а PATH к нему дописать в профиле уже после запуска Atox. Чаще не
 * нужно — иначе каждое открытие меню без установленного агента запускало бы оболочку.
 */
const MISSING_AGENT_REFRESH_INTERVAL_MS = 60_000

/**
 * Какие агенты установлены и где лежат их программы. Программы ищутся по PATH оболочки входа —
 * тому же, что видит пользователь в терминале. Ответ отдаётся из кеша и обновляется в фоне:
 * меню нового чата открывается без задержки, а только что установленный агент появится в нём
 * со следующего раза. Запуск агента, которого в кеше нет, ждёт нового поиска.
 */
export class AgentDetector {
  private executables: Promise<Map<AgentId, string>> | null = null
  /** Идущий поиск: просьбы во время него дожидаются его, а не запускают второй. */
  private detecting: Promise<Map<AgentId, string>> | null = null

  constructor(private readonly shell: ShellEnvironment) {}

  async list(): Promise<AgentId[]> {
    return [...(await this.known()).keys()]
  }

  /** Путь к программе агента; `null` — агент не установлен. */
  async executable(agent: AgentId): Promise<string | null> {
    const path = (await this.known()).get(agent)
    if (path) {
      return path
    }
    // Агента нет в прошлом ответе — возможно, его только что поставили.
    return (await this.startDetection()).get(agent) ?? null
  }

  /** Прошлый ответ; первый запрос ждёт поиска. Заодно в фоне начинается новый поиск. */
  private known(): Promise<Map<AgentId, string>> {
    const fresh = this.startDetection()
    if (!this.executables) {
      return fresh
    }
    // Фоновый поиск не удался — остаётся прошлый ответ.
    fresh.catch(() => undefined)
    return this.executables
  }

  private startDetection(): Promise<Map<AgentId, string>> {
    this.detecting ??= this.detect()
      .then((executables) => {
        this.executables = Promise.resolve(executables)
        return executables
      })
      .finally(() => {
        this.detecting = null
      })
    return this.detecting
  }

  private async detect(): Promise<Map<AgentId, string>> {
    const environment = await this.shell.get()
    const found = await findAgents(environment)
    if (found.size === AGENTS.length) {
      return found
    }
    const fresh = await this.shell.fresh(MISSING_AGENT_REFRESH_INTERVAL_MS)
    return fresh === environment ? found : findAgents(fresh)
  }
}

async function findAgents(environment: Record<string, string>): Promise<Map<AgentId, string>> {
  const directories = (environment['PATH'] ?? '').split(delimiter).filter(Boolean)
  const found = new Map<AgentId, string>()
  for (const agent of AGENTS) {
    const path = await findProgram(agent.program, directories)
    if (path) {
      found.set(agent.id, path)
    }
  }
  return found
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
