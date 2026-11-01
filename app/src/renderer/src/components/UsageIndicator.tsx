import type { ConversationUsage } from '../../../shared/conversation'
import { formatTokens } from '../lib/conversationText'

/** Размер кольца в единицах viewBox: радиус и толщина линии. */
const RING = { size: 20, radius: 8, stroke: 2.5 } as const
const CIRCUMFERENCE = 2 * Math.PI * RING.radius

/** С какой заполненности контекста кольцо предупреждает, что скоро понадобится сжатие. */
const CONTEXT_WARNING_PERCENT = 80

/** Кольцо заполненности контекста в поле ввода; точные числа — в подсказке. */
export function UsageIndicator({ usage: { context } }: { usage: ConversationUsage }) {
  const percent = Math.min(100, Math.round((context.used / context.limit) * 100))
  const title = `Context ${percent}% full · ${formatTokens(context.used)} of ${formatTokens(context.limit)} tokens`

  return (
    <div
      className="usage-indicator"
      title={title}
      aria-label={title}
      role="img"
      data-warning={percent >= CONTEXT_WARNING_PERCENT}
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
          strokeDashoffset={CIRCUMFERENCE * (1 - percent / 100)}
        />
      </svg>
      <span className="usage-indicator__label">{percent}%</span>
    </div>
  )
}
