import type { ITerminalOptions, ITheme } from '@xterm/xterm'

type TerminalAppearance = Pick<ITerminalOptions, 'fontFamily' | 'fontSize' | 'theme'>

/**
 * Оформление терминала берётся из CSS-переменных, чтобы цвета и шрифт
 * задавались в одном месте — в global.css — и следовали за светлой и тёмной темой.
 */
export function readTerminalAppearance(element: HTMLElement): TerminalAppearance {
  const styles = getComputedStyle(element)
  const token = (name: string) => styles.getPropertyValue(name).trim()

  const theme: ITheme = {
    background: token('--color-surface'),
    foreground: token('--color-text'),
    cursor: token('--color-text'),
    cursorAccent: token('--color-surface'),
    selectionBackground: token('--color-selection')
  }

  return {
    fontFamily: token('--font-mono'),
    fontSize: Number.parseFloat(token('--terminal-font-size')),
    theme
  }
}

export const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
