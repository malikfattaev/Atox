import { useEffect, useState } from 'react'
import { AGENTS } from '../../../shared/agents'
import type { PlanLimit } from '../../../shared/conversation'
import { usePlanLimits } from '../hooks/usePlanLimits'
import { formatReset, formatResetShort } from '../lib/planLimits'
import { AgentIcon } from './AgentIcon'
import { Meter } from './UsageCards'

/** Как часто обновлять «через сколько сброс»: точнее минуты он не показывается. */
const CLOCK_INTERVAL_MS = 60 * 1000

/** Текущее время, которое обновляется раз в минуту, — для отсчёта до сброса. */
function useMinuteClock(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])
  return now
}

/** Все окна агента с точным временем сброса — для подсказки. */
function limitsTitle(agentName: string, limits: readonly PlanLimit[], now: number): string {
  return [
    `${agentName} plan limits`,
    ...limits.map(
      ({ label, percent, resetsAt }) =>
        `${label}: ${Math.round(percent)}%` +
        (resetsAt === undefined ? '' : ` · ${formatReset(resetsAt, now)}`)
    )
  ].join('\n')
}

/**
 * Лимиты подписки агентов над профилем в сайдбаре: всегда видно, сколько осталось
 * и когда окно сбросится. Агенты без подписки и с ещё неизвестными лимитами не показываются.
 */
export function PlanLimits() {
  const state = usePlanLimits()
  const now = useMinuteClock()
  const agents = AGENTS.flatMap(({ id, name }) => {
    const limits = state[id]?.limits ?? []
    // В сайдбаре только общие окна (5 часов, неделя); окна отдельных моделей — в подсказке.
    const shown = limits.filter(({ model }) => model === undefined)
    return shown.length > 0 ? [{ id, name, limits, shown }] : []
  })
  if (agents.length === 0) {
    return null
  }

  return (
    <ul className="plan-limits" aria-label="Plan limits">
      {agents.flatMap(({ id, name, limits, shown }) => {
        const title = limitsTitle(name, limits, now)
        return shown.map(({ label, shortLabel, percent, resetsAt }, index) => (
          <li key={`${id}:${label}`} className="plan-limits__window" title={title}>
            {/* Знак агента — у его первого окна, остальные окна идут под ним. */}
            <span className="plan-limits__agent">
              {index === 0 && (
                <AgentIcon agent={id} className="plan-limits__icon" aria-label={name} role="img" />
              )}
            </span>
            <span className="plan-limits__label">{shortLabel}</span>
            <Meter percent={percent} />
            <span className="plan-limits__value">{Math.round(percent)}%</span>
            <span className="plan-limits__reset">
              {resetsAt === undefined ? '' : formatResetShort(resetsAt, now)}
            </span>
          </li>
        ))
      })}
    </ul>
  )
}
