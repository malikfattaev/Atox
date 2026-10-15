import type { CSSProperties, MouseEvent } from 'react'
import { Plus } from 'lucide-react'
import type { Space } from '../../../shared/models'
import { findProjectColor } from '../../../shared/projectColors'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { colorSubmenu, parseColorAction } from '../lib/colorMenu'

const { atox } = window

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

interface SpaceSwitcherProps {
  /** Начать переименование пространства — в заголовке над его проектами. */
  onRename(spaceId: string): void
}

/** Значки пространств внизу сайдбара, как в Arc: клик открывает пространство, «+» создаёт новое. */
export function SpaceSwitcher({ onRename }: SpaceSwitcherProps) {
  const { spaces, activeSpaceId, selectSpace, createSpace, setSpaceColor, removeSpace } =
    useProjectsContext()

  const openContextMenu = async (event: MouseEvent, space: Space) => {
    event.preventDefault()
    const action = await atox.showContextMenu([
      { action: 'rename', label: 'Rename', symbol: 'pencil' },
      colorSubmenu(space.color),
      ...(spaces.length > 1
        ? [
            { type: 'separator' as const },
            { action: 'remove', label: 'Delete Space', symbol: 'trash' }
          ]
        : [])
    ])
    const color = parseColorAction(action)
    if (color !== undefined) {
      void setSpaceColor(space.id, color)
    } else if (action === 'rename') {
      selectSpace(space.id)
      onRename(space.id)
    } else if (action === 'remove') {
      void removeSpace(space.id)
    }
  }

  return (
    <nav className="space-switcher" aria-label="Spaces">
      {spaces.map((space, index) => {
        const color = findProjectColor(space.color)
        // Цвет задаётся сразу для обеих тем, а нужный выбирает CSS по текущей теме.
        const style = color
          ? ({ '--space-color': `light-dark(${color.light}, ${color.dark})` } as CSSProperties)
          : undefined
        const [initial] = graphemes.segment(space.name)
        return (
          <button
            key={space.id}
            type="button"
            className="space-button"
            data-active={space.id === activeSpaceId}
            style={style}
            title={index < 9 ? `${space.name}  ⌃${index + 1}` : space.name}
            aria-label={space.name}
            aria-pressed={space.id === activeSpaceId}
            onClick={() => selectSpace(space.id)}
            onContextMenu={(event) => void openContextMenu(event, space)}
          >
            {initial?.segment.toUpperCase()}
          </button>
        )
      })}
      <button
        type="button"
        className="space-button space-button--add"
        title="New Space"
        aria-label="New Space"
        onClick={() => void createSpace().then(onRename)}
      >
        <Plus className="icon" />
      </button>
    </nav>
  )
}
