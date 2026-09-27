const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS
const YEAR_MS = 365 * DAY_MS

/** Крупнейшая подходящая единица и её короткая подпись: «5m», «3h», «2d», «4w», «1y». */
const UNITS: ReadonlyArray<readonly [durationMs: number, suffix: string]> = [
  [YEAR_MS, 'y'],
  [WEEK_MS, 'w'],
  [DAY_MS, 'd'],
  [HOUR_MS, 'h'],
  [MINUTE_MS, 'm']
]

/** Короткая подпись прошедшего времени, как в списках чатов Codex и Cursor; меньше минуты — «now». */
export function formatElapsed(elapsedMs: number): string {
  const unit = UNITS.find(([durationMs]) => elapsedMs >= durationMs)
  return unit ? `${Math.floor(elapsedMs / unit[0])}${unit[1]}` : 'now'
}
