import { useRef, type PointerEvent, type RefObject } from 'react'
import { DEFAULT_SPLIT_POSITION } from '../../../shared/split'

/** Каждый из двух чатов остаётся не уже этой ширины. */
const MIN_PANE_WIDTH = 320

interface SplitResizerProps {
  /** Доля ширины рабочей области, которую занимает левый чат. */
  position: number
  containerRef: RefObject<HTMLElement | null>
  /**
   * Положение меняется на лету, пока тянут разделитель; `null` — черновик больше не нужен:
   * перетаскивание закончилось, а сохранённое положение уже вернулось.
   */
  onDrag(position: number | null): void
  /** Сохраняет положение; промис завершается, когда новое значение уже пришло в интерфейс. */
  onCommit(position: number): Promise<unknown>
}

/** Разделитель между двумя чатами: перетаскивание меняет их ширину, двойной клик делит поровну. */
export function SplitResizer({ position, containerRef, onDrag, onCommit }: SplitResizerProps) {
  const dragRef = useRef<{ start: number; position: number } | null>(null)
  // Номер перетаскивания: черновик прежнего не сбрасывается, когда разделитель уже тянут заново.
  const gestureRef = useRef(0)

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    gestureRef.current += 1
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
    if (!drag) {
      return
    }
    if (drag.position === drag.start) {
      onDrag(null)
      return
    }
    // Черновик держится, пока сохранённое положение не вернётся из main-процесса: иначе чаты
    // на миг вернулись бы к прежней ширине.
    const gesture = gestureRef.current
    void onCommit(drag.position).finally(() => {
      if (gestureRef.current === gesture) {
        onDrag(null)
      }
    })
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
      onDoubleClick={() => void onCommit(DEFAULT_SPLIT_POSITION)}
    />
  )
}
