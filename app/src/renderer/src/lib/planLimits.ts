/** С какого расхода лимит или контекст подсвечивается как почти исчерпанный. */
export const LIMIT_WARNING_PERCENT = 80

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** Ближе этого до сброса показывается «через сколько», дальше — дата и время. */
const RELATIVE_RESET_MS = DAY_MS

const resetDateFormat = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
})

/** «Resets in 2h 14m», а если до сброса больше суток — «Resets Thu, Nov 5, 9:00 AM». */
export function formatReset(resetsAt: number, now = Date.now()): string {
  const remaining = resetsAt - now
  if (remaining <= 0) {
    return 'Resets now'
  }
  if (remaining >= RELATIVE_RESET_MS) {
    return `Resets ${resetDateFormat.format(resetsAt)}`
  }
  return `Resets in ${formatDuration(remaining)}`
}

/** Сколько осталось до сброса, коротко: «2h 14m», «35m», «6d». */
export function formatResetShort(resetsAt: number, now = Date.now()): string {
  const remaining = resetsAt - now
  if (remaining <= 0) {
    return 'now'
  }
  return remaining >= DAY_MS ? `${Math.round(remaining / DAY_MS)}d` : formatDuration(remaining)
}

function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MINUTE_MS))
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}
