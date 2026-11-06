import type { AgentId } from '../shared/agents'
import type { PlanLimit } from '../shared/conversation'
import type { PlanLimitsState } from '../shared/planLimits'

/** Первый запрос лимитов ждёт, пока приложение запустится: он запускает процессы агентов. */
const STARTUP_DELAY_MS = 5_000

/**
 * Как часто обновлять лимиты, пока агенты не работают. Пока работают, лимиты приходят
 * после каждого их ответа, и отдельный запрос не нужен.
 */
const REFRESH_INTERVAL_MS = 10 * 60 * 1000

/** Лимиты свежее этого не перечитываются: ни по таймеру, ни при возвращении в окно. */
const FRESH_MS = 2 * 60 * 1000

export interface PlanLimitsSources {
  /** Агенты, установленные на компьютере. */
  installed(): Promise<AgentId[]>
  /** Лимиты агента без его запущенной сессии — отдельным процессом агента. */
  read(agent: AgentId): Promise<PlanLimit[]>
  onChange(state: PlanLimitsState): void
}

/**
 * Лимиты подписки агентов для постоянного индикатора: приходят от работающих сессий после
 * каждого ответа, а в остальное время перечитываются изредка и при возвращении в окно.
 */
export class PlanLimitsMonitor {
  private state: PlanLimitsState = {}
  private readonly reading = new Set<AgentId>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly sources: PlanLimitsSources) {}

  start(): void {
    this.schedule(STARTUP_DELAY_MS)
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  get(): PlanLimitsState {
    return this.state
  }

  /** Лимиты, которые сообщила сессия агента. */
  report(agent: AgentId, limits: PlanLimit[]): void {
    this.state = { ...this.state, [agent]: { limits, updatedAt: Date.now() } }
    this.sources.onChange(this.state)
  }

  /** Перечитывает устаревшие лимиты — например, когда пользователь вернулся в окно. */
  async refreshStale(): Promise<void> {
    const agents = await this.sources.installed().catch(() => [])
    await Promise.all(agents.filter((agent) => this.isStale(agent)).map((agent) => this.read(agent)))
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      void this.refreshStale().finally(() => {
        if (this.timer) {
          this.schedule(REFRESH_INTERVAL_MS)
        }
      })
    }, delay)
  }

  private isStale(agent: AgentId): boolean {
    const known = this.state[agent]
    return !this.reading.has(agent) && (!known || Date.now() - known.updatedAt >= FRESH_MS)
  }

  private async read(agent: AgentId): Promise<void> {
    this.reading.add(agent)
    try {
      this.report(agent, await this.sources.read(agent))
    } catch (error) {
      // Агент не вошёл в аккаунт или недоступен: индикатор показывает последние известные лимиты.
      console.error(`Failed to read ${agent} plan limits`, error)
    } finally {
      this.reading.delete(agent)
    }
  }
}
