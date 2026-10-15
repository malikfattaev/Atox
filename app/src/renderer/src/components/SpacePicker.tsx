import { useState, type CSSProperties, type MouseEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ContextMenuItem, MenuPosition } from '../../../shared/api'
import type { Space } from '../../../shared/models'
import { findProjectColor } from '../../../shared/projectColors'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { colorSubmenu, parseColorAction } from '../lib/colorMenu'
import { colorSchemeQuery } from '../lib/terminalTheme'
import { InlineRename } from './InlineRename'

const { atox } = window

/** Пункт списка пространств: `space:<id>`. */
const SPACE_ACTION_PREFIX = 'space:'

/** Сколько пространств доступно по ⌃1…⌃9. */
const NUMBERED_SPACES = 9

/** Зазор между строкой и меню, которое открывается под ней. */
const MENU_OFFSET = 4

/**
 * Текущее пространство — заголовок над списком проектов, как разделы в Finder. Клик открывает меню со всеми пространствами
 * и действиями над текущим; новое пространство сразу предлагают назвать прямо в строке.
 */
export function SpacePicker() {
  const {
    spaces,
    activeSpaceId,
    selectSpace,
    createSpace,
    renameSpace,
    setSpaceColor,
    removeSpace
  } = useProjectsContext()
  const [renaming, setRenaming] = useState(false)
  const space = spaces.find(({ id }) => id === activeSpaceId)

  if (!space) {
    return null
  }

  const openMenu = async (position?: MenuPosition) => {
    const isDark = colorSchemeQuery.matches
    const items: ContextMenuItem<string>[] = [
      ...spaces.map((other, index) => ({
        action: `${SPACE_ACTION_PREFIX}${other.id}`,
        label: other.name,
        checked: other.id === space.id,
        swatch: findProjectColor(other.color)?.[isDark ? 'dark' : 'light'],
        accelerator: index < NUMBERED_SPACES ? `Ctrl+${index + 1}` : undefined
      })),
      { type: 'separator' },
      { action: 'create', label: 'New Space', symbol: 'plus' },
      { type: 'separator' },
      { action: 'rename', label: 'Rename Space', symbol: 'pencil' },
      colorSubmenu(space.color),
      ...(spaces.length > 1
        ? [{ action: 'remove', label: 'Delete Space', symbol: 'trash' } as const]
        : [])
    ]
    const action = await atox.showContextMenu(items, position)
    handleAction(space, action)
  }

  const handleAction = (target: Space, action: string | null) => {
    const color = parseColorAction(action)
    if (color !== undefined) {
      void setSpaceColor(target.id, color)
    } else if (action?.startsWith(SPACE_ACTION_PREFIX)) {
      selectSpace(action.slice(SPACE_ACTION_PREFIX.length))
    } else if (action === 'create') {
      void createSpace().then(() => setRenaming(true))
    } else if (action === 'rename') {
      setRenaming(true)
    } else if (action === 'remove') {
      void removeSpace(target.id)
    }
  }

  const openBelow = (event: MouseEvent<HTMLElement>) => {
    const { left, bottom } = event.currentTarget.getBoundingClientRect()
    void openMenu({ x: left, y: bottom + MENU_OFFSET })
  }

  const openAtCursor = (event: MouseEvent) => {
    event.preventDefault()
    void openMenu()
  }

  const color = findProjectColor(space.color)
  // Цвет задаётся сразу для обеих тем, а нужный выбирает CSS по текущей теме.
  const colorStyle = color
    ? ({ '--space-color': `light-dark(${color.light}, ${color.dark})` } as CSSProperties)
    : undefined

  return (
    <div className="space-picker" style={colorStyle} onContextMenu={openAtCursor}>
      {renaming ? (
        <div className="space-picker__rename">
          <InlineRename
            // Новое пространство переименовывают уже открытым — поле создаётся заново под него.
            key={space.id}
            value={space.name}
            label="Space name"
            onSubmit={(name) => {
              setRenaming(false)
              void renameSpace(space.id, name)
            }}
            onCancel={() => setRenaming(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          className="space-picker__button"
          aria-haspopup="menu"
          aria-label={`Space: ${space.name}`}
          onClick={openBelow}
        >
          {color && <span className="space-picker__dot" aria-hidden />}
          <span className="space-picker__name">{space.name}</span>
          <ChevronDown className="space-picker__chevron" aria-hidden />
        </button>
      )}
    </div>
  )
}
