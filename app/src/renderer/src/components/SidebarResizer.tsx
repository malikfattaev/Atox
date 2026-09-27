import { useRef, type PointerEvent } from 'react'
import { clampSidebarWidth, SIDEBAR_WIDTH } from '../../../shared/settings'

interface SidebarResizerProps {
  width: number
  /** Ширина меняется на лету, пока тянут край; `null` — перетаскивание закончилось. */
  onDrag(width: number | null): void
  onCommit(width: number): void
}

/** Край сайдбара: перетаскивание меняет ширину, двойной клик возвращает её по умолчанию. */
export function SidebarResizer({ width, onDrag, onCommit }: SidebarResizerProps) {
  const dragRef = useRef<{ startX: number; startWidth: number; width: number } | null>(null)

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { startX: event.clientX, startWidth: width, width }
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag) {
      drag.width = clampSidebarWidth(drag.startWidth + event.clientX - drag.startX)
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
      className="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_WIDTH.min}
      aria-valuemax={SIDEBAR_WIDTH.max}
      aria-valuenow={width}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={() => onCommit(SIDEBAR_WIDTH.default)}
    />
  )
}
