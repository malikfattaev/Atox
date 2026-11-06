import type { CSSProperties } from 'react'
import type { ContextReport, PlanLimit } from '../../../shared/conversation'
import { formatTokens } from '../lib/conversationText'
import { formatReset, LIMIT_WARNING_PERCENT } from '../lib/planLimits'

/** Сколько частей контекста показывать отдельно; остальные собираются в «Other». */
const CONTEXT_CATEGORY_LIMIT = 5

/** Лимиты подписки по команде `/usage`: по полосе на каждое окно. */
export function LimitsCard({ limits }: { limits: readonly PlanLimit[] }) {
  // В карточках, сохранённых прежними версиями, бывает окно без процента: его не показываем.
  const reported = limits.filter(({ percent }) => typeof percent === 'number')
  return (
    <section className="usage-card" aria-label="Usage limits">
      <h2 className="usage-card__title">Usage limits</h2>
      {reported.length === 0 ? (
        <p className="usage-card__note">
          The agent is signed in with an API key, so there are no plan limits to show.
        </p>
      ) : (
        <ul className="usage-card__rows">
          {reported.map((limit) => (
            <li key={limit.label} className="usage-card__row">
              <div className="usage-card__line">
                <span>{limit.label}</span>
                <span className="usage-card__value">{Math.round(limit.percent)}%</span>
              </div>
              <Meter percent={limit.percent} />
              {limit.resetsAt !== undefined && (
                <span className="usage-card__note">{formatReset(limit.resetsAt)}</span>
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

export function Meter({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent))
  return (
    <div
      className="usage-card__meter"
      data-warning={clamped >= LIMIT_WARNING_PERCENT}
      style={{ '--meter-fill': `${clamped}%` } as CSSProperties}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
    />
  )
}
