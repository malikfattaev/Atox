import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, Download, X } from 'lucide-react'
import { getOpenMenu } from '../lib/menu'
import { copyImage, imageContextMenu, saveImage, type ShownImage } from '../lib/imageActions'

interface ImageViewerProps {
  image: ShownImage
  onClose(): void
}

/**
 * Во сколько раз можно увеличить маленькую картинку, чтобы её было видно: сильнее она
 * превращается в кашу из пикселей.
 */
const MAX_UPSCALE = 4

/** Сколько кнопка копирования показывает галочку после успешного копирования. */
const COPIED_FEEDBACK_MS = 1500

interface Size {
  width: number
  height: number
}

/**
 * Картинка на весь экран поверх окна, как в Claude: клик по фону или Escape закрывают её.
 * Картинка всегда целиком помещается в окно и стоит ровно по центру; её можно скопировать
 * (⌘C) или сохранить (⌘S) кнопками сверху или из меню по правому клику.
 */
export function ImageViewer({ image, onClose }: ImageViewerProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [natural, setNatural] = useState<Size | null>(null)
  const [size, setSize] = useState<Size | null>(null)
  const [copied, setCopied] = useState(false)

  const copy = useCallback(() => {
    copyImage(image.src)
      .then(() => setCopied(true))
      .catch((error) => console.error('Failed to copy the image', error))
  }, [image.src])

  const save = useCallback(() => {
    saveImage(image).catch((error) => console.error('Failed to save the image', error))
  }, [image])

  useEffect(() => {
    if (!copied) {
      return
    }
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
    return () => clearTimeout(timer)
  }, [copied])

  // Последние версии действий: обработчик клавиш вешается один раз.
  const actionsRef = useRef({ onClose, copy, save })
  actionsRef.current = { onClose, copy, save }

  // Перехват на этапе погружения: Escape закрывает картинку, а не останавливает агента.
  // Пока открыто меню, клавиши достаются ему.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (getOpenMenu()) {
        return
      }
      const command = event.metaKey || event.ctrlKey
      const action =
        event.key === 'Escape'
          ? actionsRef.current.onClose
          : command && event.key.toLowerCase() === 'c' && !window.getSelection()?.toString()
            ? actionsRef.current.copy
            : command && event.key.toLowerCase() === 's'
              ? actionsRef.current.save
              : null
      if (action) {
        event.preventDefault()
        event.stopPropagation()
        action()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
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
        src={image.src}
        alt=""
        data-ready={size !== null || undefined}
        style={size ?? undefined}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={imageContextMenu(image)}
        onLoad={(event) => {
          const { naturalWidth: width, naturalHeight: height } = event.currentTarget
          if (width > 0 && height > 0) {
            setNatural({ width, height })
          }
        }}
      />
      <div className="image-viewer__actions" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="image-viewer__action"
          aria-label={copied ? 'Copied' : 'Copy image'}
          title={copied ? 'Copied' : 'Copy (⌘C)'}
          onClick={copy}
        >
          {copied ? <Check className="icon" /> : <Copy className="icon" />}
        </button>
        {image.path && (
          <button
            type="button"
            className="image-viewer__action"
            aria-label="Save image"
            title="Save… (⌘S)"
            onClick={save}
          >
            <Download className="icon" />
          </button>
        )}
        <button
          type="button"
          className="image-viewer__action"
          aria-label="Close"
          title="Close (Esc)"
          onClick={onClose}
        >
          <X className="icon" />
        </button>
      </div>
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
