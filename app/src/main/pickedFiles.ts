import { readFile, stat } from 'node:fs/promises'
import { dialog, type BrowserWindow } from 'electron'
import { imageTypeOfPath, type PickedFile } from '../shared/attachments'

/** Превью огромной картинки не строим: агент всё равно получит её путём к файлу. */
const PREVIEW_LIMIT_BYTES = 20 * 1024 * 1024

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
  const type = imageTypeOfPath(path)
  if (!type) {
    return { path }
  }
  try {
    if ((await stat(path)).size > PREVIEW_LIMIT_BYTES) {
      return { path }
    }
    const data = await readFile(path)
    return { path, preview: `data:${type};base64,${data.toString('base64')}` }
  } catch {
    return { path }
  }
}
