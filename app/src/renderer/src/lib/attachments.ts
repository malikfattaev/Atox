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
 * Превью приложенных картинок по пути. Разговоры живут до выхода из Atox, а все их картинки
 * прикладывались в этом окне, поэтому превью для ленты берутся отсюда.
 */
const previews = new Map<string, string>()

export function imagePreview(path: string): string | undefined {
  return previews.get(path)
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
