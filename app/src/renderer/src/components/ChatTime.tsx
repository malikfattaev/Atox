import { useNow } from '../hooks/useNow'
import { formatElapsed } from '../lib/elapsedTime'

interface ChatTimeProps {
  /** Момент последней работы в чате (мс с начала эпохи). */
  at: number
}

/** Сколько прошло с последней работы в чате; точное время — в подсказке. */
export function ChatTime({ at }: ChatTimeProps) {
  const now = useNow()
  const date = new Date(at)
  return (
    <time className="chat-time" dateTime={date.toISOString()} title={date.toLocaleString()}>
      {formatElapsed(Math.max(0, now - at))}
    </time>
  )
}
