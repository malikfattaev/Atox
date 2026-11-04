import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { IMAGE_FORMATS } from '../shared/attachments'

/** Картинки лежат во временном каталоге системы — macOS сама удаляет из него старые файлы. */
const PASTED_IMAGES_DIR = 'pasted-images'


/**
 * Сохраняет вставленную картинку во временный файл и возвращает путь к нему.
 * Агент получает картинку из файла: буфер обмена приложения ему недоступен.
 */
export async function savePastedImage(
  data: ArrayBuffer | Uint8Array,
  type: string
): Promise<string> {
  // Буфер обмена Chromium отдаёт картинки как PNG, перетащенные — в их собственном формате.
  const extension = IMAGE_FORMATS.find((format) => format.type === type)?.extensions[0]
  if (!extension) {
    throw new Error(`Unsupported image type: ${type}`)
  }
  const directory = join(app.getPath('temp'), app.getName(), PASTED_IMAGES_DIR)
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${randomUUID()}.${extension}`)
  await writeFile(path, data instanceof Uint8Array ? data : Buffer.from(data))
  return path
}
