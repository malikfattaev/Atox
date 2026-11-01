import { useRef } from 'react'
import type { ContextMenuItem } from '../../../shared/api'
import type { ConversationUsage } from '../../../shared/conversation'
import { formatResetTime, formatTokens } from '../lib/conversationText'

const { atox } = window

/** Размер кольца в единицах viewBox: радиус и толщина линии. */
const RING = { size: 20, radius: 8, stroke: 2.5 } as const
const CIRCUMFERENCE = 2 * Math.PI * RING.radius

/** С какой заполненности контекста кольцо предупреждает, что скоро понадобится сжатие. */
const CONTEXT_WARNING_PERCENT = 80

/** Пункты меню индикатора только для чтения: выбрать в них нечего. */
type InfoAction = 'info'

/** Кольцо заполненности контекста в поле ввода; по клику — подробности и лимиты подписки. */
export function UsageIndicator({ usage }: { usage: ConversationUsage }) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const context = usage.context
  const percent = context ? Math.min(100, Math.round((context.used / context.limit) * 100)) : null

  const openDetails = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    void atox.showContextMenu<InfoAction>(
      describeUsage(usage),
      rect && { x: rect.left, y: rect.bottom }
    )
  }

  const title =
    percent === null
      ? 'Usage limits'
      : `Context ${percent}% full · ${formatTokens(context!.used)} of ${formatTokens(context!.limit)} tokens`

  return (
    <button
      ref={buttonRef}
      type="button"
      className="usage-indicator"
      title={title}
      aria-label={title}
      data-warning={percent !== null && percent >= CONTEXT_WARNING_PERCENT}
      onClick={openDetails}
    >
      <svg viewBox={`0 0 ${RING.size} ${RING.size}`} className="usage-indicator__ring">
        <circle
          className="usage-indicator__track"
          cx={RING.size / 2}
          cy={RING.size / 2}
          r={RING.radius}
          strokeWidth={RING.stroke}
        />
        <circle
          className="usage-indicator__fill"
          cx={RING.size / 2}
          cy={RING.size / 2}
          r={RING.radius}
          strokeWidth={RING.stroke}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - (percent ?? 0) / 100)}
        />
      </svg>
      {percent !== null && <span className="usage-indicator__label">{percent}%</span>}
    </button>
  )
}

function describeUsage({ context, limits }: ConversationUsage): ContextMenuItem<InfoAction>[] {
  const items: ContextMenuItem<InfoAction>[] = []
  if (context) {
    const percent = Math.round((context.used / context.limit) * 100)
    items.push({
      action: 'info',
      label: `Context: ${formatTokens(context.used)} of ${formatTokens(context.limit)} tokens (${percent}%)`,
      enabled: false
    })
  }
  if (context && limits.length > 0) {
    items.push({ type: 'separator' })
  }
  for (const limit of limits) {
    const resets = limit.resetsAt ? ` · resets ${formatResetTime(limit.resetsAt)}` : ''
    items.push({
      action: 'info',
      label: `${limit.label}: ${Math.round(limit.usedPercent)}% used${resets}`,
      enabled: false
    })
  }
  return items
}
