import { useRef, type PointerEvent } from 'react'
import { clampWidth, type WidthBounds } from '../../../shared/settings'

interface PanelResizerProps {
  width: number
  bounds: WidthBounds
  /** Край панели, за который её тянут: у сайдбара — правый, у панели справа от чатов — левый. */
  edge: 'left' | 'right'
  label: string
  /** Ширина меняется на лету, пока тянут край; `null` — перетаскивание закончилось. */
  onDrag(width: number | null): void
  onCommit(width: number): void
}

/** Край панели: перетаскивание меняет её ширину, двойной клик возвращает ширину по умолчанию. */
export function PanelResizer({ width, bounds, edge, label, onDrag, onCommit }: PanelResizerProps) {
  const dragRef = useRef<{ startX: number; startWidth: number; width: number } | null>(null)

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    // В узком окне раскладка ужимает панель уже сохранённой ширины: тянуть начинаем от видимой.
    const panel = event.currentTarget.parentElement
    const startWidth = panel ? clampWidth(panel.getBoundingClientRect().width, bounds) : width
    dragRef.current = { startX: event.clientX, startWidth, width: startWidth }
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag) {
      // Левый край панель расширяет движением влево, правый — вправо.
      const delta = (event.clientX - drag.startX) * (edge === 'right' ? 1 : -1)
      drag.width = clampWidth(drag.startWidth + delta, bounds)
      onDrag(drag.width)
    }
  }

  const handlePointerUp = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag) {
      onDrag(null)
      if (drag.width !== drag.startWidth) {
        onCommit(drag.width)
      }
    }
  }

  return (
    <div
      className="panel-resizer"
      data-edge={edge}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={width}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={() => onCommit(bounds.default)}
    />
  )
}
