const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS
/** Дальше месяца относительное время читается хуже, чем дата. */
const RELATIVE_LIMIT_MS = 4 * WEEK_MS

const SAME_YEAR_DATE = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
const OTHER_YEAR_DATE = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric'
})
const FULL_DATE = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

/** Короткое время в списках, как в GitHub и Linear: `now`, `5m`, `3h`, `2d`, `3w`, `Oct 12`. */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < MINUTE_MS) {
    return 'now'
  }
  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)}m`
  }
  if (elapsed < DAY_MS) {
    return `${Math.floor(elapsed / HOUR_MS)}h`
  }
  if (elapsed < WEEK_MS) {
    return `${Math.floor(elapsed / DAY_MS)}d`
  }
  if (elapsed < RELATIVE_LIMIT_MS) {
    return `${Math.floor(elapsed / WEEK_MS)}w`
  }
  const date = new Date(timestamp)
  const format =
    date.getFullYear() === new Date(now).getFullYear() ? SAME_YEAR_DATE : OTHER_YEAR_DATE
  return format.format(date)
}

/** Полная дата для подсказки при наведении. */
export function formatFullDate(timestamp: number): string {
  return FULL_DATE.format(timestamp)
}
