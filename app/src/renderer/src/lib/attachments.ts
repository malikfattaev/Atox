const { atox } = window

/** Картинки, которые агенты принимают в сообщении. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export interface Attachment {
  /** Путь к файлу картинки: его получает агент. */
  path: string
  /** Картинка как data URL — для превью в окне. */
  preview: string
}

/**
 * Превью приложенных картинок по пути. Разговоры живут до выхода из Atox, а все их картинки
 * прикладывались в этом окне, поэтому превью для ленты берутся отсюда.
 */
const previews = new Map<string, string>()

export function imagePreview(path: string): string | undefined {
  return previews.get(path)
}

export function isAttachableImage(file: File): boolean {
  return IMAGE_TYPES.has(file.type)
}

/**
 * Готовит картинку к отправке: файл с диска остаётся на месте, картинка из буфера обмена
 * сохраняется во временный файл.
 */
export async function attachImage(file: File): Promise<Attachment> {
  const [path, preview] = await Promise.all([
    atox.files.getPath(file) || atox.files.savePastedImage(file),
    readAsDataUrl(file)
  ])
  previews.set(path, preview)
  return { path, preview }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image'))
    reader.readAsDataURL(file)
  })
}
