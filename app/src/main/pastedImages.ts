import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

/** Картинки лежат во временном каталоге системы — macOS сама удаляет из него старые файлы. */
const PASTED_IMAGES_DIR = 'pasted-images'

/** Форматы, которые принимают агенты; буфер обмена Chromium отдаёт картинки как PNG. */
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

/**
 * Сохраняет вставленную картинку во временный файл и возвращает путь к нему.
 * Агенты в терминале не видят буфер обмена приложения, но принимают путь к картинке.
 */
export async function savePastedImage(data: ArrayBuffer, type: string): Promise<string> {
  const extension = IMAGE_EXTENSIONS[type]
  if (!extension) {
    throw new Error(`Unsupported image type: ${type}`)
  }
  const directory = join(app.getPath('temp'), app.getName(), PASTED_IMAGES_DIR)
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${randomUUID()}.${extension}`)
  await writeFile(path, Buffer.from(data))
  return path
}
