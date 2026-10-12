import { useRef, type PointerEvent, type RefObject } from 'react'
import { DEFAULT_SPLIT_POSITION } from '../../../shared/split'

/** Каждый из двух чатов остаётся не уже этой ширины. */
const MIN_PANE_WIDTH = 320

interface SplitResizerProps {
  /** Доля ширины рабочей области, которую занимает левый чат. */
  position: number
  containerRef: RefObject<HTMLElement | null>
  /** Положение меняется на лету, пока тянут разделитель; `null` — перетаскивание закончилось. */
  onDrag(position: number | null): void
  onCommit(position: number): void
}

/** Разделитель между двумя чатами: перетаскивание меняет их ширину, двойной клик делит поровну. */
export function SplitResizer({ position, containerRef, onDrag, onCommit }: SplitResizerProps) {
  const dragRef = useRef<{ start: number; position: number } | null>(null)

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { start: position, position }
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const container = containerRef.current
    if (!drag || !container) {
      return
    }
    const { left, width } = container.getBoundingClientRect()
    // В узком окне ограничение ширины невыполнимо — тогда чаты просто делят его поровну.
    const margin = Math.min(MIN_PANE_WIDTH / width, DEFAULT_SPLIT_POSITION)
    drag.position = Math.min(1 - margin, Math.max(margin, (event.clientX - left) / width))
    onDrag(drag.position)
  }

  const handlePointerUp = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag) {
      onDrag(null)
      if (drag.position !== drag.start) {
        onCommit(drag.position)
      }
    }
  }

  return (
    <div
      className="split-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chats"
      aria-valuenow={Math.round(position * 100)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={() => onCommit(DEFAULT_SPLIT_POSITION)}
    />
  )
}
