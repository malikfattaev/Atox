import { copyFile, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { app, dialog, type BrowserWindow } from 'electron'
import { imageTypeOfPath } from '../shared/attachments'

/** Огромную картинку в окно не грузим: агент всё равно получит её путём к файлу. */
const PREVIEW_LIMIT_BYTES = 20 * 1024 * 1024

/**
 * Картинка с диска как data URL — так её показывает окно. `null` — файла нет, он слишком
 * большой или это не картинка.
 */
export async function readImage(path: string): Promise<string | null> {
  const type = imageTypeOfPath(path)
  if (!type) {
    return null
  }
  try {
    if ((await stat(path)).size > PREVIEW_LIMIT_BYTES) {
      return null
    }
    const data = await readFile(path)
    return `data:${type};base64,${data.toString('base64')}`
  } catch {
    return null
  }
}

/**
 * Системный диалог «Сохранить как» для картинки: по умолчанию — в «Загрузки» под её
 * собственным именем. `false` — пользователь передумал.
 */
export async function saveImageAs(window: BrowserWindow | null, path: string): Promise<boolean> {
  if (!imageTypeOfPath(path)) {
    throw new Error(`Not an image: ${path}`)
  }
  const options: Electron.SaveDialogOptions = {
    title: 'Save Image',
    defaultPath: join(app.getPath('downloads'), basename(path))
  }
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) {
    return false
  }
  await copyFile(path, result.filePath)
  return true
}
