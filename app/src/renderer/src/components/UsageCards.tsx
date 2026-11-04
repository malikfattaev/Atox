import type { CSSProperties } from 'react'
import type { ContextReport, PlanLimit } from '../../../shared/conversation'
import { formatTokens } from '../lib/conversationText'

/** С какого расхода лимит или контекст подсвечивается как почти исчерпанный. */
const WARNING_PERCENT = 80

/** Сколько частей контекста показывать отдельно; остальные собираются в «Other». */
const CONTEXT_CATEGORY_LIMIT = 5

/** Ближе этого до сброса показывается «через сколько», дальше — дата и время. */
const RELATIVE_RESET_MS = 24 * 60 * 60 * 1000

const MINUTE_MS = 60 * 1000

const resetDateFormat = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
})

/** Лимиты подписки по команде `/usage`: по полосе на каждое окно. */
export function LimitsCard({ limits }: { limits: readonly PlanLimit[] }) {
  return (
    <section className="usage-card" aria-label="Usage limits">
      <h2 className="usage-card__title">Usage limits</h2>
      {limits.length === 0 ? (
        <p className="usage-card__note">
          The agent is signed in with an API key, so there are no plan limits to show.
        </p>
      ) : (
        <ul className="usage-card__rows">
          {limits.map((limit) => (
            <li key={limit.label} className="usage-card__row">
              <div className="usage-card__line">
                <span>{limit.label}</span>
                <span className="usage-card__value">
                  {limit.percent === undefined ? '—' : `${Math.round(limit.percent)}%`}
                </span>
              </div>
              <Meter percent={limit.percent ?? 0} />
              {limit.percent === undefined ? (
                <span className="usage-card__note">Not reported by Anthropic right now</span>
              ) : (
                limit.resetsAt !== undefined && (
                  <span className="usage-card__note">{formatReset(limit.resetsAt)}</span>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Заполненность контекста по команде `/context`: общая полоса и крупнейшие части. */
export function ContextCard({ context }: { context: ContextReport }) {
  const percent = context.limit > 0 ? (context.used / context.limit) * 100 : 0
  const shown = context.categories.slice(0, CONTEXT_CATEGORY_LIMIT)
  const otherTokens = context.categories
    .slice(CONTEXT_CATEGORY_LIMIT)
    .reduce((sum, { tokens }) => sum + tokens, 0)
  const rows = otherTokens > 0 ? [...shown, { name: 'Other', tokens: otherTokens }] : shown

  return (
    <section className="usage-card" aria-label="Context">
      <div className="usage-card__line">
        <h2 className="usage-card__title">Context</h2>
        <span className="usage-card__value">
          {formatTokens(context.used)} of {formatTokens(context.limit)} · {Math.round(percent)}%
        </span>
      </div>
      <Meter percent={percent} />
      {rows.length > 0 && (
        <ul className="usage-card__rows usage-card__rows--compact">
          {rows.map(({ name, tokens }) => (
            <li key={name} className="usage-card__line">
              <span>{name}</span>
              <span className="usage-card__value">{formatTokens(tokens)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Meter({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent))
  return (
    <div
      className="usage-card__meter"
      data-warning={clamped >= WARNING_PERCENT}
      style={{ '--meter-fill': `${clamped}%` } as CSSProperties}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
    />
  )
}

/** «Resets in 2h 14m», а если до сброса больше суток — «Resets Thu, Nov 5, 9:00 AM». */
function formatReset(resetsAt: number): string {
  const remaining = resetsAt - Date.now()
  if (remaining <= 0) {
    return 'Resets now'
  }
  if (remaining >= RELATIVE_RESET_MS) {
    return `Resets ${resetDateFormat.format(resetsAt)}`
  }
  const minutes = Math.max(1, Math.round(remaining / MINUTE_MS))
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `Resets in ${hours}h ${minutes % 60}m` : `Resets in ${minutes}m`
}
