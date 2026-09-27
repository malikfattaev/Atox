export interface Settings {
  /** Размер шрифта терминалов в пикселях. */
  terminalFontSize: number
  /** Команда, которая запускается в каждом новом терминале чата (например, `claude`); пусто — ничего. */
  startupCommand: string
  /** Ширина сайдбара в пикселях; меняется перетаскиванием его края. */
  sidebarWidth: number
}

export const TERMINAL_FONT_SIZE = {
  default: 13,
  min: 9,
  max: 28
} as const

/** Сайдбар по умолчанию самый узкий: его можно только расширить. */
export const SIDEBAR_WIDTH = {
  default: 280,
  min: 280,
  max: 480
} as const

export const DEFAULT_SETTINGS: Settings = {
  terminalFontSize: TERMINAL_FONT_SIZE.default,
  startupCommand: '',
  sidebarWidth: SIDEBAR_WIDTH.default
}

/** Приводит ширину сайдбара к целому числу пикселей в допустимых пределах. */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return SIDEBAR_WIDTH.default
  }
  return Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, Math.round(width)))
}
