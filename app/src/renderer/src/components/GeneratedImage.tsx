import { useState } from 'react'
import { CircleAlert, ImageOff, LoaderCircle } from 'lucide-react'
import type { TimelineItem } from '../../../shared/conversation'
import { useImagePreview } from '../lib/attachments'
import { imageContextMenu, type ShownImage } from '../lib/imageActions'
import { ImageViewer } from './ImageViewer'

type ImageItem = Extract<TimelineItem, { kind: 'image' }>

/**
 * Картинка, которую нарисовал агент: пока рисуется — заглушка, потом сама картинка.
 * Клик открывает её на весь экран, правый клик — меню «скопировать / сохранить».
 */
export function GeneratedImage({ item }: { item: ImageItem }) {
  if (item.status === 'failed') {
    return (
      <div className="message message--error" role="alert">
        <CircleAlert className="icon" />
        <span>{item.error ?? 'Could not generate the image.'}</span>
      </div>
    )
  }
  // Готовая картинка без файла ещё сохраняется: файл придёт следующим обновлением элемента.
  if (!item.path) {
    return (
      <div className="generated-image__placeholder" role="status">
        <LoaderCircle className="icon activity__spinner" />
        <span>Generating image…</span>
      </div>
    )
  }
  return <SavedImage path={item.path} />
}

function SavedImage({ path }: { path: string }) {
  const preview = useImagePreview(path)
  const [viewed, setViewed] = useState<ShownImage | null>(null)

  if (preview === undefined) {
    return (
      <div className="generated-image__placeholder" role="status">
        <LoaderCircle className="icon activity__spinner" />
      </div>
    )
  }
  if (preview === null) {
    return (
      <div className="message message--error" title={path}>
        <ImageOff className="icon" />
        <span>The image file is missing.</span>
      </div>
    )
  }
  const image = { src: preview, path }
  return (
    <>
      <button
        type="button"
        className="generated-image"
        aria-label="Open image"
        title={path}
        onClick={() => setViewed(image)}
        onContextMenu={imageContextMenu(image)}
      >
        <img src={preview} alt="" />
      </button>
      {viewed && <ImageViewer image={viewed} onClose={() => setViewed(null)} />}
    </>
  )
}
