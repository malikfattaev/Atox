import { useRef, type PointerEvent, type RefObject } from 'react'

/** Каждый из двух чатов остаётся не уже этой ширины. */
const MIN_PANE_WIDTH = 320

/** Положение разделителя по умолчанию — чаты поровну. */
export const DEFAULT_SPLIT = 0.5

interface SplitResizerProps {
  /** Доля ширины рабочей области, которую занимает левый чат. */
  split: number
  containerRef: RefObject<HTMLElement | null>
  onChange(split: number): void
}

/** Разделитель между двумя чатами: перетаскивание меняет их ширину, двойной клик делит поровну. */
export function SplitResizer({ split, containerRef, onChange }: SplitResizerProps) {
  const draggingRef = useRef(false)

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    draggingRef.current = true
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!draggingRef.current || !container) {
      return
    }
    const { left, width } = container.getBoundingClientRect()
    // В узком окне ограничение ширины невыполнимо — тогда чаты просто делят его поровну.
    const margin = Math.min(MIN_PANE_WIDTH / width, DEFAULT_SPLIT)
    onChange(Math.min(1 - margin, Math.max(margin, (event.clientX - left) / width)))
  }

  const handlePointerUp = () => {
    draggingRef.current = false
  }

  return (
    <div
      className="split-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chats"
      aria-valuenow={Math.round(split * 100)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={() => onChange(DEFAULT_SPLIT)}
    />
  )
}
