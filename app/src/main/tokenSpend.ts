import { isAgentId, type AgentId } from '../shared/agents'
import {
  addTokenCounts,
  EMPTY_TOKEN_COUNTS,
  isEmptyTokenCounts,
  type TokenCounts,
  type TokenSpendSummary
} from '../shared/tokenSpend'
import { JsonFileWriter, readVersionedJson } from './jsonFile'

const FILE_VERSION = 1

type DayRecord = Partial<Record<AgentId, TokenCounts>>

interface TokenSpendFile {
  version: typeof FILE_VERSION
  /** Траты по дням: `2026-11-10` → агент → токены. День — по часам компьютера. */
  days: Record<string, DayRecord>
}

/** Календарный день по местному времени: «сегодня» у человека меняется в его полночь, а не в UTC. */
export function dayKey(time: number): string {
  const date = new Date(time)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Сколько токенов потратили агенты в чатах Atox — по дням, на диске. Только числа: ни текста,
 * ни проектов, ни чатов. Траты в самих программах агентов вне Atox сюда не попадают.
 */
export class TokenSpendLedger {
  private readonly listeners = new Set<(summary: TokenSpendSummary) => void>()

  private constructor(
    private readonly file: JsonFileWriter,
    private days: Record<string, DayRecord>,
    private readonly now: () => number
  ) {}

  static async load(filePath: string, now: () => number = Date.now): Promise<TokenSpendLedger> {
    const saved = await readVersionedJson<TokenSpendFile>(filePath, FILE_VERSION)
    return new TokenSpendLedger(new JsonFileWriter(filePath, { compact: true }), normalize(saved), now)
  }

  /** Записывает траты агента за только что завершённую работу. */
  record(agent: AgentId, counts: TokenCounts): void {
    if (isEmptyTokenCounts(counts)) {
      return
    }
    const key = dayKey(this.now())
    const day = this.days[key] ?? {}
    day[agent] = addTokenCounts(day[agent] ?? EMPTY_TOKEN_COUNTS, counts)
    this.days[key] = day
    this.file.write({ version: FILE_VERSION, days: this.days } satisfies TokenSpendFile)
    const summary = this.summary()
    this.listeners.forEach((listener) => listener(summary))
  }

  summary(): TokenSpendSummary {
    const today = dayKey(this.now())
    const agents: TokenSpendSummary['agents'] = {}
    const keys = Object.keys(this.days).sort()
    for (const key of keys) {
      for (const [agent, counts] of Object.entries(this.days[key])) {
        if (!isAgentId(agent)) {
          continue
        }
        const spend = (agents[agent] ??= {
          today: { ...EMPTY_TOKEN_COUNTS },
          total: { ...EMPTY_TOKEN_COUNTS }
        })
        spend.total = addTokenCounts(spend.total, counts)
        if (key === today) {
          spend.today = addTokenCounts(spend.today, counts)
        }
      }
    }
    return { agents, since: keys[0] ?? null }
  }

  onChange(listener: (summary: TokenSpendSummary) => void): void {
    this.listeners.add(listener)
  }

  flush(): Promise<void> {
    return this.file.flush()
  }
}

/** Оставляет в файле только осмысленные числа: его могли отредактировать вручную. */
function normalize(file: TokenSpendFile | undefined): Record<string, DayRecord> {
  const days: Record<string, DayRecord> = {}
  const count = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
  for (const [key, record] of Object.entries(file?.days ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || typeof record !== 'object' || record === null) {
      continue
    }
    const day: DayRecord = {}
    for (const [agent, counts] of Object.entries(record)) {
      if (isAgentId(agent) && counts) {
        day[agent] = { input: count(counts.input), output: count(counts.output), cached: count(counts.cached) }
      }
    }
    days[key] = day
  }
  return days
}
