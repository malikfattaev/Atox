import type { ITheme } from '@xterm/xterm'
import type { ISearchDecorationOptions } from '@xterm/addon-search'

interface TerminalAppearance {
  fontFamily: string
  theme: ITheme
  searchDecorations: ISearchDecorationOptions
}

/**
 * Оформление терминала берётся из CSS-переменных, чтобы цвета и шрифт
 * задавались в одном месте — в global.css — и следовали за светлой и тёмной темой.
 */
export function readTerminalAppearance(element: HTMLElement): TerminalAppearance {
  const styles = getComputedStyle(element)
  const token = (name: string) => styles.getPropertyValue(name).trim()

  return {
    fontFamily: token('--font-mono'),
    theme: {
      background: token('--color-surface'),
      foreground: token('--color-text'),
      cursor: token('--color-text'),
      cursorAccent: token('--color-surface'),
      selectionBackground: token('--color-selection')
    },
    searchDecorations: {
      matchBackground: token('--color-search-match'),
      matchOverviewRuler: token('--color-search-match'),
      activeMatchBackground: token('--color-search-active'),
      activeMatchColorOverviewRuler: token('--color-search-active')
    }
  }
}

export const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
