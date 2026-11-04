import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface ImageViewerProps {
  src: string
  onClose(): void
}

/**
 * Во сколько раз можно увеличить маленькую картинку, чтобы её было видно: сильнее она
 * превращается в кашу из пикселей.
 */
const MAX_UPSCALE = 4

interface Size {
  width: number
  height: number
}

/**
 * Картинка на весь экран поверх окна, как в Claude: клик или Escape закрывают её.
 * Картинка всегда целиком помещается в окно и стоит ровно по центру.
 */
export function ImageViewer({ src, onClose }: ImageViewerProps) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const overlayRef = useRef<HTMLDivElement>(null)
  const [natural, setNatural] = useState<Size | null>(null)
  const [size, setSize] = useState<Size | null>(null)

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

  const fit = useCallback(() => {
    const overlay = overlayRef.current
    if (overlay && natural) {
      setSize(fitInto(natural, contentBox(overlay)))
    }
  }, [natural])

  // Размер считается сам, а не через max-width/max-height: в сетке проценты от высоты
  // не работают, и высокая картинка вылезала за окно и съезжала с центра.
  useLayoutEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) {
      return
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(overlay)
    return () => observer.disconnect()
  }, [fit])

  return createPortal(
    <div
      ref={overlayRef}
      className="image-viewer"
      role="dialog"
      aria-label="Image"
      onClick={onClose}
    >
      <img
        className="image-viewer__image"
        src={src}
        alt=""
        data-ready={size !== null || undefined}
        style={size ?? undefined}
        onLoad={(event) => {
          const { naturalWidth: width, naturalHeight: height } = event.currentTarget
          if (width > 0 && height > 0) {
            setNatural({ width, height })
          }
        }}
      />
    </div>,
    document.body
  )
}

/** Место под картинку: окно без отступов по краям. */
function contentBox(element: HTMLElement): Size {
  const style = getComputedStyle(element)
  return {
    width: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    height: element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
  }
}

/** Наибольший размер картинки, при котором она целиком помещается в `box`. */
function fitInto(image: Size, box: Size): Size {
  const scale = Math.min(box.width / image.width, box.height / image.height, MAX_UPSCALE)
  return {
    width: Math.round(image.width * scale),
    height: Math.round(image.height * scale)
  }
}
