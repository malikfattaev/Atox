import { appendFile } from 'node:fs/promises'
import type { AgentId } from '../shared/agents'
import type { PlanLimit } from '../shared/conversation'
import type { PlanLimitsState } from '../shared/planLimits'
import { JsonFileWriter, readVersionedJson } from './jsonFile'

/** Первый запрос лимитов ждёт, пока приложение запустится: он запускает процессы агентов. */
const STARTUP_DELAY_MS = 5_000

/**
 * Как часто обновлять лимиты, пока агенты не работают. Пока работают, лимиты приходят
 * после каждого их ответа, и отдельный запрос не нужен.
 */
const REFRESH_INTERVAL_MS = 10 * 60 * 1000

/**
 * Как часто пробовать снова, если прошлый запрос провалился или вернул пустой ответ:
 * агент мог ещё не войти в аккаунт, и 10 минут — слишком долго, чтобы индикатор пустовал.
 */
const RETRY_INTERVAL_MS = 60 * 1000

/**
 * Сколько раз подряд пробовать часто. Пустой ответ бывает и постоянным — агент работает по
 * ключу API или не установлен вход, — и запускать его процесс каждую минуту вечно незачем.
 */
const FAST_RETRIES = 5

/** Лимиты свежее этого не перечитываются: ни по таймеру, ни при возвращении в окно. */
const FRESH_MS = 2 * 60 * 1000

const STATE_VERSION = 1

interface PlanLimitsFile {
  version: typeof STATE_VERSION
  state: PlanLimitsState
}

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
 * Последнее известное состояние хранится на диске: после перезапуска индикатор не пустует
 * те секунды, пока агент отвечает заново.
 */
export class PlanLimitsMonitor {
  private readonly reading = new Set<AgentId>()
  /** Сколько раз подряд агент ответил пусто или ошибкой: первые разы его перечитываем чаще. */
  private readonly misses = new Map<AgentId, number>()
  /** Когда агента спрашивали в последний раз — удачно или нет. */
  private readonly attemptedAt = new Map<AgentId, number>()
  /** Последняя записанная в лог ошибка агента: одна и та же беда не пишется каждую минуту. */
  private readonly loggedErrors = new Map<AgentId, string>()
  private timer: ReturnType<typeof setTimeout> | null = null

  private constructor(
    private state: PlanLimitsState,
    private readonly sources: PlanLimitsSources,
    private readonly file: JsonFileWriter,
    private readonly logPath: string
  ) {}

  static async load(
    sources: PlanLimitsSources,
    filePath: string,
    logPath: string
  ): Promise<PlanLimitsMonitor> {
    const saved = await readVersionedJson<PlanLimitsFile>(filePath, STATE_VERSION)
    const file = new JsonFileWriter(filePath, { compact: true })
    return new PlanLimitsMonitor(saved?.state ?? {}, sources, file, logPath)
  }

  start(): void {
    // Что уже прочли с диска, окно видит сразу, не дожидаясь первого запроса к агенту.
    if (Object.keys(this.state).length > 0) {
      this.sources.onChange(this.state)
    }
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
    if (limits.length === 0) {
      this.miss(agent)
    } else {
      this.misses.delete(agent)
      this.loggedErrors.delete(agent)
    }
    this.file.write({ version: STATE_VERSION, state: this.state } satisfies PlanLimitsFile)
    this.sources.onChange(this.state)
  }

  /** Перечитывает устаревшие лимиты — например, когда пользователь вернулся в окно. */
  async refreshStale(): Promise<void> {
    const agents = await this.sources.installed().catch(() => [])
    await Promise.all(agents.filter((agent) => this.isStale(agent)).map((agent) => this.read(agent)))
  }

  /** Перечитывает лимиты, даже если они ещё свежие — после `/login` или кнопки «Refresh». */
  async refreshAll(): Promise<void> {
    const agents = await this.sources.installed().catch(() => [])
    // Аккаунт мог смениться: частые попытки начинаются заново.
    this.misses.clear()
    await Promise.all(
      agents.filter((agent) => !this.reading.has(agent)).map((agent) => this.read(agent))
    )
  }

  flush(): Promise<void> {
    return this.file.flush()
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      void this.refreshStale().finally(() => {
        if (this.timer) {
          // Если какие-то агенты не ответили лимитами, перечитываем их чаще — вход в аккаунт
          // мог ещё не завершиться.
          const retrying = [...this.misses.keys()].some((agent) => this.retriesSoon(agent))
          this.schedule(retrying ? RETRY_INTERVAL_MS : REFRESH_INTERVAL_MS)
        }
      })
    }, delay)
  }

  private isStale(agent: AgentId): boolean {
    if (this.reading.has(agent)) {
      return false
    }
    // Неудачная попытка тоже считается: иначе агента, который не отвечает, спрашивали бы
    // при каждом возвращении в окно.
    const last = Math.max(this.state[agent]?.updatedAt ?? 0, this.attemptedAt.get(agent) ?? 0)
    // Пустой ответ устаревает быстрее: агент только что мог войти в аккаунт.
    const fresh = this.retriesSoon(agent) ? RETRY_INTERVAL_MS : FRESH_MS
    return Date.now() - last >= fresh
  }

  private miss(agent: AgentId): void {
    this.misses.set(agent, (this.misses.get(agent) ?? 0) + 1)
  }

  private retriesSoon(agent: AgentId): boolean {
    const misses = this.misses.get(agent) ?? 0
    return misses > 0 && misses <= FAST_RETRIES
  }

  private async read(agent: AgentId): Promise<void> {
    this.reading.add(agent)
    this.attemptedAt.set(agent, Date.now())
    try {
      this.report(agent, await this.sources.read(agent))
    } catch (error) {
      // Агент не вошёл в аккаунт или недоступен: индикатор показывает последние известные лимиты.
      this.miss(agent)
      const text = errorText(error)
      if (this.loggedErrors.get(agent) !== text) {
        this.loggedErrors.set(agent, text)
        await this.log(`Failed to read ${agent} plan limits: ${text}`)
      }
    } finally {
      this.reading.delete(agent)
    }
  }

  private async log(line: string): Promise<void> {
    try {
      await appendFile(this.logPath, `${new Date().toISOString()} ${line}\n`)
    } catch {
      // Если лог записать не удалось, пусть ошибка не ломает основной поток.
    }
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
}
