import { useEffect, useState } from 'react'
import { isImageType, type PickedFile } from '../../../shared/attachments'

const { atox } = window

/** Что приложено к сообщению: картинку агент видит сам, файл открывает по пути. */
export type Attachment =
  | {
      kind: 'image'
      /** Путь к файлу картинки: его получает агент. */
      path: string
      /** Картинка как data URL — для превью в окне. */
      preview: string
    }
  | { kind: 'file'; path: string }

/**
 * Превью картинок по пути: приложенные в этом окне попадают сюда сразу, остальные (например,
 * нарисованные агентом) читаются с диска один раз.
 */
const previews = new Map<string, string>()

/** Картинки, которые сейчас читаются с диска: одна загрузка на путь. */
const loading = new Map<string, Promise<string | null>>()

function loadPreview(path: string): Promise<string | null> {
  let pending = loading.get(path)
  if (!pending) {
    pending = atox.images.read(path).then((preview) => {
      loading.delete(path)
      if (preview) {
        previews.set(path, preview)
      }
      return preview
    })
    loading.set(path, pending)
  }
  return pending
}

/**
 * Превью картинки по пути к файлу: `undefined` — ещё читается, `null` — файла нет или это
 * не картинка.
 */
export function useImagePreview(path: string): string | null | undefined {
  const [loaded, setLoaded] = useState<{ path: string; preview: string | null }>()
  const cached = previews.get(path)
  useEffect(() => {
    if (cached) {
      return
    }
    let current = true
    loadPreview(path)
      .catch(() => null)
      .then((preview) => current && setLoaded({ path, preview }))
    return () => {
      current = false
    }
  }, [path, cached])
  return cached ?? (loaded?.path === path ? loaded.preview : undefined)
}

export function isAttachableImage(file: File): boolean {
  return isImageType(file.type)
}

/** Имя файла из пути — подпись вложения. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1) || path
}

/**
 * Прикладывает вставленные или перетащенные файлы: картинки — картинками, остальные — путями.
 * Картинка из буфера обмена сохраняется во временный файл. Файлы без пути на диске
 * (например, текст из буфера) пропускаются.
 */
export async function attachFiles(files: readonly File[]): Promise<Attachment[]> {
  const attachments = await Promise.all(
    files.map(async (file): Promise<Attachment | null> => {
      if (isAttachableImage(file)) {
        return attachImage(file)
      }
      const path = atox.files.getPath(file)
      return path ? { kind: 'file', path } : null
    })
  )
  return attachments.filter((attachment) => attachment !== null)
}

/** Файл, выбранный в системном диалоге: с превью — картинка, без него — файл. */
export function attachPicked({ path, preview }: PickedFile): Attachment {
  if (!preview) {
    return { kind: 'file', path }
  }
  previews.set(path, preview)
  return { kind: 'image', path, preview }
}

async function attachImage(file: File): Promise<Attachment> {
  const [path, preview] = await Promise.all([
    atox.files.getPath(file) || atox.files.savePastedImage(file),
    readAsDataUrl(file)
  ])
  previews.set(path, preview)
  return { kind: 'image', path, preview }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image'))
    reader.readAsDataURL(file)
  })
}
