import type { AgentId } from './agents'

/** Токены, которые агент потратил: свежий вход, ответ и то, что взято из кэша. */
export interface TokenCounts {
  input: number
  output: number
  cached: number
}

/** Траты агента за сегодня и за всё время. */
export interface AgentTokenSpend {
  today: TokenCounts
  total: TokenCounts
}

/** Траты токенов по агентам; агента нет — через Atox он ещё ничего не тратил. */
export interface TokenSpendSummary {
  agents: Partial<Record<AgentId, AgentTokenSpend>>
  /** День первой записи, `2026-11-10`; `null` — записей ещё нет. */
  since: string | null
}

export const EMPTY_TOKEN_COUNTS: Readonly<TokenCounts> = { input: 0, output: 0, cached: 0 }

export function addTokenCounts(a: TokenCounts, b: TokenCounts): TokenCounts {
  return { input: a.input + b.input, output: a.output + b.output, cached: a.cached + b.cached }
}

export function isEmptyTokenCounts({ input, output, cached }: TokenCounts): boolean {
  return input === 0 && output === 0 && cached === 0
}
