/**
 * Символы в начале заголовка, которые не являются частью названия: программы вроде
 * агентов ставят туда индикаторы статуса и спиннеры (✳, ⠂, ●), меняющиеся по ходу работы.
 */
const LEADING_DECORATION = /^[^\p{L}\p{N}]+/u

export function normalizeTerminalTitle(title: string): string {
  return title.replace(LEADING_DECORATION, '').trim()
}
