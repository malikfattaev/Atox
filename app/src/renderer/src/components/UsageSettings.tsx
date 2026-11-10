import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { AGENTS, type AgentId } from '../../../shared/agents'
import type { PlanLimit } from '../../../shared/conversation'
import type { TokenCounts } from '../../../shared/tokenSpend'
import { usePlanLimits } from '../hooks/usePlanLimits'
import { useTokenSpend } from '../hooks/useTokenSpend'
import { formatTokens } from '../lib/conversationText'
import { formatReset } from '../lib/planLimits'
import { AgentIcon } from './AgentIcon'
import { Meter } from './UsageCards'

const { atox } = window

const MINUTE_MS = 60 * 1000

const sinceFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** «Nov 10, 2026» из дня записи `2026-11-10`. */
function formatSince(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return sinceFormat.format(new Date(year, month - 1, date))
}

/** Страница Usage в настройках: лимиты подписки и сколько токенов съел каждый агент. */
export function UsageSettings() {
  const limits = usePlanLimits()
  const spend = useTokenSpend()
  const [refreshing, setRefreshing] = useState(false)
  // Отсчёт до сброса обновляется раз в минуту, как и в сайдбаре.
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE_MS)
    return () => clearInterval(timer)
  }, [])

  const refresh = async () => {
    setRefreshing(true)
    try {
      await atox.planLimits.refresh()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="settings__group usage-page">
      <div className="usage-page__header">
        <button
          type="button"
          className="settings__button settings__button--secondary"
          onClick={refresh}
          disabled={refreshing}
          title="Re-read plan limits — use this after signing into a different account."
        >
          <RefreshCw className={`icon${refreshing ? ' usage-page__spin' : ''}`} />
          Refresh limits
        </button>
      </div>
      {AGENTS.map(({ id, name }) => (
        <AgentUsage
          key={id}
          agent={id}
          name={name}
          limits={limits[id]?.limits}
          spend={spend?.agents[id]}
          now={now}
        />
      ))}
      <p className="usage-page__note">
        {spend?.since
          ? `Tokens are counted from chats in Atox since ${formatSince(spend.since)}. Usage in other apps isn’t included.`
          : 'Tokens are counted from chats in Atox. Usage in other apps isn’t included.'}
      </p>
    </div>
  )
}

interface AgentUsageProps {
  agent: AgentId
  name: string
  /** `undefined` — лимиты ещё не известны, пустой список — агент работает не по подписке. */
  limits: readonly PlanLimit[] | undefined
  spend: { today: TokenCounts; total: TokenCounts } | undefined
  now: number
}

function AgentUsage({ agent, name, limits, spend, now }: AgentUsageProps) {
  return (
    <section className="usage-agent" aria-label={`${name} usage`}>
      <header className="usage-agent__header">
        <AgentIcon agent={agent} className="usage-agent__icon" aria-hidden />
        <h3 className="usage-agent__name">{name}</h3>
      </header>

      <div className="usage-agent__limits">
        {limits === undefined ? (
          <p className="usage-card__note">Plan limits will appear after the first reply.</p>
        ) : limits.length === 0 ? (
          <p className="usage-card__note">Signed in with an API key, so there are no plan limits.</p>
        ) : (
          <ul className="usage-card__rows">
            {limits.map(({ label, percent, resetsAt }) => (
              <li key={label} className="usage-card__row">
                <div className="usage-card__line">
                  <span>{label}</span>
                  <span className="usage-card__value">{Math.round(percent)}%</span>
                </div>
                <Meter percent={percent} />
                {resetsAt !== undefined && (
                  <span className="usage-card__note">{formatReset(resetsAt, now)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="usage-agent__tokens">
        <TokenTile title="Today" counts={spend?.today} />
        <TokenTile title="All time" counts={spend?.total} />
      </div>
    </section>
  )
}

function TokenTile({ title, counts }: { title: string; counts: TokenCounts | undefined }) {
  const { input, output, cached } = counts ?? { input: 0, output: 0, cached: 0 }
  return (
    <div className="token-tile">
      <span className="token-tile__title">{title}</span>
      <span className="token-tile__total">{formatTokens(input + output)}</span>
      <span className="token-tile__unit">tokens</span>
      <dl className="token-tile__parts">
        <div>
          <dt>In</dt>
          <dd>{formatTokens(input)}</dd>
        </div>
        <div>
          <dt>Out</dt>
          <dd>{formatTokens(output)}</dd>
        </div>
        <div>
          <dt>Cached</dt>
          <dd>{formatTokens(cached)}</dd>
        </div>
      </dl>
    </div>
  )
}
