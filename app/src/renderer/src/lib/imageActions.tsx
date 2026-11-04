import type { MouseEvent } from 'react'
import { Copy, Download } from 'lucide-react'
import { showMenu, type MenuAnchor, type MenuItem } from './menu'

const { atox } = window

/** Картинка в окне: что показывать и, если она лежит на диске, путь к файлу. */
export interface ShownImage {
  /** Картинка как data URL. */
  src: string
  /** Файл картинки; без него её можно только скопировать. */
  path?: string
}

type ImageAction = 'copy' | 'save'

/**
 * Кладёт картинку в буфер обмена. Любой формат перерисовывается в PNG: буфер обмена
 * Electron не принимает GIF и WebP, а PNG понимают все программы.
 */
export async function copyImage(src: string): Promise<void> {
  const image = new Image()
  image.src = src
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  canvas.getContext('2d')!.drawImage(image, 0, 0)
  const png = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image'))),
      'image/png'
    )
  )
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}

/** Диалог «Сохранить как»; `false` — картинки нет на диске или пользователь передумал. */
export function saveImage(image: ShownImage): Promise<boolean> {
  return image.path ? atox.images.saveAs(image.path) : Promise.resolve(false)
}

/** Обработчик правого клика по картинке: открывает её меню у курсора. */
export function imageContextMenu(image: ShownImage): (event: MouseEvent) => void {
  return (event) => {
    event.preventDefault()
    event.stopPropagation()
    openImageMenu(image, event).catch((error) =>
      console.error('Failed to run the image action', error)
    )
  }
}

/** Контекстное меню картинки: скопировать её или сохранить файлом. */
async function openImageMenu(image: ShownImage, anchor: MenuAnchor): Promise<void> {
  const items: MenuItem<ImageAction>[] = [
    { action: 'copy', label: 'Copy Image', icon: <Copy /> },
    ...(image.path
      ? [{ action: 'save', label: 'Save Image…', icon: <Download /> } as const]
      : [])
  ]
  switch (await showMenu(items, anchor)) {
    case 'copy':
      await copyImage(image.src)
      break
    case 'save':
      await saveImage(image)
      break
  }
}
