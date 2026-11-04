import { dialog, type BrowserWindow } from 'electron'
import type { PickedFile } from '../shared/attachments'
import { readImage } from './images'

/** Системный диалог выбора файлов для сообщения; пустой список — пользователь передумал. */
export async function pickFiles(window: BrowserWindow | null): Promise<PickedFile[]> {
  const options: Electron.OpenDialogOptions = {
    title: 'Attach Files',
    buttonLabel: 'Attach',
    properties: ['openFile', 'multiSelections']
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? [] : Promise.all(result.filePaths.map(describeFile))
}

async function describeFile(path: string): Promise<PickedFile> {
  const preview = await readImage(path)
  return preview ? { path, preview } : { path }
}
