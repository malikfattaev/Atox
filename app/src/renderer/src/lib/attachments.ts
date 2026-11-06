import { useEffect, useState } from 'react'
import { isImageType, type PickedFile } from '../../../shared/attachments'
import { imageUrl } from '../../../shared/imageProtocol'
import { ipcErrorMessage } from './ipcError'

const { atox } = window

/** Что приложено к сообщению: картинку агент видит сам, файл открывает по пути. */
export type Attachment =
  | {
      kind: 'image'
      /** Путь к файлу картинки: его получает агент. */
      path: string
      /** Адрес картинки для превью в окне (`atox-image://`). */
      preview: string
    }
  | { kind: 'file'; path: string }

/**
 * Сколько путей помнить как уже открывавшиеся картинки. Хранятся только пути, сами картинки
 * кэширует Chromium; предел не даёт списку расти вечно в долгой сессии.
 */
const KNOWN_IMAGES_LIMIT = 500

/**
 * Пути картинок, которые уже открывались: их превью показывается сразу, без проверки файла.
 * Set помнит порядок добавления, поэтому первыми вытесняются самые давние.
 */
const knownImages = new Set<string>()

function rememberImage(path: string): void {
  knownImages.delete(path)
  knownImages.add(path)
  if (knownImages.size > KNOWN_IMAGES_LIMIT) {
    const oldest = knownImages.values().next().value
    if (oldest !== undefined) {
      knownImages.delete(oldest)
    }
  }
}

/** Картинки, которые сейчас проверяются: одна проверка на путь. */
const checking = new Map<string, Promise<boolean>>()

/** Открывается ли файл как картинка: его нет, он битый или это не картинка — `false`. */
function checkImage(path: string): Promise<boolean> {
  let pending = checking.get(path)
  if (!pending) {
    const image = new Image()
    image.src = imageUrl(path)
    pending = image.decode().then(
      () => true,
      () => false
    )
    void pending.then((loadable) => {
      checking.delete(path)
      if (loadable) {
        rememberImage(path)
      }
    })
    checking.set(path, pending)
  }
  return pending
}

/**
 * Превью картинки по пути к файлу: адрес для `<img>`; `undefined` — файл ещё проверяется,
 * `null` — файла нет или это не картинка.
 */
export function useImagePreview(path: string): string | null | undefined {
  const [checked, setChecked] = useState<{ path: string; loadable: boolean }>()
  const known = knownImages.has(path)
  useEffect(() => {
    if (known) {
      return
    }
    let current = true
    void checkImage(path).then((loadable) => current && setChecked({ path, loadable }))
    return () => {
      current = false
    }
  }, [path, known])
  if (known) {
    return imageUrl(path)
  }
  if (checked?.path !== path) {
    return undefined
  }
  return checked.loadable ? imageUrl(path) : null
}

export function isAttachableImage(file: File): boolean {
  return isImageType(file.type)
}

/** Имя файла из пути — подпись вложения. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1) || path
}

/** Файл, который не удалось приложить, и почему. */
export interface AttachFailure {
  name: string
  message: string
}

/** Итог приложения файлов: ошибка одного файла не мешает приложиться остальным. */
export interface AttachResult {
  attachments: Attachment[]
  failures: AttachFailure[]
}

/**
 * Прикладывает вставленные или перетащенные файлы: картинки — картинками, остальные — путями.
 * Картинка из буфера обмена сохраняется во временный файл. Файлы без пути на диске
 * (например, текст из буфера) пропускаются.
 */
export async function attachFiles(files: readonly File[]): Promise<AttachResult> {
  const results = await Promise.allSettled(files.map(attachFile))
  const attachments: Attachment[] = []
  const failures: AttachFailure[] = []
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      if (result.value) {
        attachments.push(result.value)
      }
    } else {
      failures.push({
        name: files[index].name,
        message: ipcErrorMessage(result.reason)
      })
    }
  })
  return { attachments, failures }
}

async function attachFile(file: File): Promise<Attachment | null> {
  if (isAttachableImage(file)) {
    return attachImage(file)
  }
  const path = atox.files.getPath(file)
  return path ? { kind: 'file', path } : null
}

/** Файл, выбранный в системном диалоге: с превью — картинка, без него — файл. */
export function attachPicked({ path, preview }: PickedFile): Attachment {
  if (!preview) {
    return { kind: 'file', path }
  }
  rememberImage(path)
  return { kind: 'image', path, preview: imageUrl(path) }
}

async function attachImage(file: File): Promise<Attachment> {
  const path = atox.files.getPath(file) || (await atox.files.savePastedImage(file))
  rememberImage(path)
  return { kind: 'image', path, preview: imageUrl(path) }
}
