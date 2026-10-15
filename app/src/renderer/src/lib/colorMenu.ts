import type { ContextMenuItem } from '../../../shared/api'
import { isProjectColor, PROJECT_COLORS, type ProjectColor } from '../../../shared/projectColors'
import { colorSchemeQuery } from './terminalTheme'

/** Пункт меню цвета: `color:red`, `color:none` и т. д. */
const COLOR_ACTION_PREFIX = 'color:'
const NO_COLOR = 'none'

/** Подменю «Color» с цветными кружками; галочка — на текущем цвете. */
export function colorSubmenu(selected: ProjectColor | undefined): ContextMenuItem<string> {
  return {
    type: 'submenu',
    label: 'Color',
    symbol: 'paintpalette',
    items: [
      { action: `${COLOR_ACTION_PREFIX}${NO_COLOR}`, label: 'None', checked: !selected },
      { type: 'separator' },
      ...PROJECT_COLORS.map(({ id, name, light, dark }) => ({
        action: `${COLOR_ACTION_PREFIX}${id}`,
        label: name,
        // Кружок в меню — в цвете текущей темы, как его покажет сайдбар.
        swatch: colorSchemeQuery.matches ? dark : light,
        checked: selected === id
      }))
    ]
  }
}

/**
 * Цвет из выбранного пункта меню: `null` — «None», `undefined` — пункт не из подменю цвета.
 */
export function parseColorAction(action: string | null): ProjectColor | null | undefined {
  if (!action?.startsWith(COLOR_ACTION_PREFIX)) {
    return undefined
  }
  const color = action.slice(COLOR_ACTION_PREFIX.length)
  return isProjectColor(color) ? color : null
}
