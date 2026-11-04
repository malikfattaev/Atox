import { app, BrowserWindow } from 'electron'
import { inform } from './dialogs'
import type { AppUpdater } from './updater'

/**
 * «Check for Updates…» из меню: новая версия появляется кольцом загрузки в сайдбаре,
 * а если её нет или обновиться нельзя — об этом говорит системное сообщение.
 */
export async function checkForUpdatesFromMenu(updater: AppUpdater): Promise<void> {
  const window = BrowserWindow.getFocusedWindow()
  try {
    const result = await updater.checkNow()
    if (result === 'current') {
      await inform(window, {
        type: 'info',
        message: 'You’re up to date',
        detail: `Atox ${app.getVersion()} is the latest version.`
      })
    } else if (result === 'unsupported') {
      await inform(window, {
        type: 'warning',
        message: 'Atox can’t update itself here',
        detail: 'Move Atox to the Applications folder and open it from there.'
      })
    }
  } catch (error) {
    console.error('Update check failed', error)
    await inform(window, {
      type: 'warning',
      message: 'Couldn’t check for updates',
      detail: error instanceof Error ? error.message : String(error)
    })
  }
}
