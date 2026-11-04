import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface ImageViewerProps {
  src: string
  onClose(): void
}

/** Картинка на весь экран поверх окна, как в Claude: клик или Escape закрывают её. */
export function ImageViewer({ src, onClose }: ImageViewerProps) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Перехват на этапе погружения: Escape закрывает картинку, а не останавливает агента.
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', closeOnEscape, true)
    return () => window.removeEventListener('keydown', closeOnEscape, true)
  }, [])

  return createPortal(
    <div className="image-viewer" role="dialog" aria-label="Image" onClick={onClose}>
      <img className="image-viewer__image" src={src} alt="" />
    </div>,
    document.body
  )
}
