/** Положение разделителя по умолчанию — чаты поровну. */
export const DEFAULT_SPLIT_POSITION = 0.5

/** Разделитель не уходит к самому краю, даже если сохранённое значение повреждено. */
const SPLIT_POSITION_LIMIT = { min: 0.1, max: 0.9 } as const

/** Приводит долю ширины левого чата к допустимым пределам. */
export function clampSplitPosition(position: number): number {
  if (!Number.isFinite(position)) {
    return DEFAULT_SPLIT_POSITION
  }
  return Math.min(SPLIT_POSITION_LIMIT.max, Math.max(SPLIT_POSITION_LIMIT.min, position))
}
