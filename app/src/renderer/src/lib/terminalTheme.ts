import type { ITerminalOptions } from '@xterm/xterm'

type TerminalAppearance = Required<Pick<ITerminalOptions, 'fontFamily' | 'fontSize' | 'theme'>>

/**
 * Оформление терминала берётся из CSS-переменных, чтобы цвета и шрифт задавались в одном
 * месте — в global.css — и следовали за светлой и тёмной темой.
 */
export function readTerminalAppearance(element: HTMLElement): TerminalAppearance {
  const styles = getComputedStyle(element)
  const token = (name: string) => styles.getPropertyValue(name).trim()

  return {
    fontFamily: token('--font-mono'),
    fontSize: Number.parseFloat(token('--terminal-font-size')),
    theme: {
      background: token('--color-surface'),
      foreground: token('--color-text'),
      cursor: token('--color-text'),
      cursorAccent: token('--color-surface'),
      selectionBackground: token('--color-selection')
    }
  }
}
