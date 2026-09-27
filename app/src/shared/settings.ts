export interface Settings {
  /** Размер шрифта терминалов в пикселях. */
  terminalFontSize: number
}

export const TERMINAL_FONT_SIZE = {
  default: 13,
  min: 9,
  max: 28
} as const

export const DEFAULT_SETTINGS: Settings = {
  terminalFontSize: TERMINAL_FONT_SIZE.default
}
