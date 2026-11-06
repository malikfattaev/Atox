import { app, BrowserWindow, dialog } from 'electron'
import { inform } from './dialogs'
import type { AppUpdater } from './updater'

/**
 * «Check for Updates…» из меню: пока идёт проверка, на экране сообщение о ней, — иначе
 * без сети меню молчало бы до ответа. Новая версия появляется кольцом загрузки в сайдбаре,
 * а если её нет или обновиться нельзя — об этом говорит системное сообщение.
 */
export async function checkForUpdatesFromMenu(updater: AppUpdater): Promise<void> {
  const window = BrowserWindow.getFocusedWindow()
  const progress = showCheckingMessage(window)
  try {
    const result = await updater.checkNow()
    // Сообщение о проверке закрыли сами — ответ проверки больше не ждут.
    if (await progress.close()) {
      return
    }
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
    if (await progress.close()) {
      return
    }
    await inform(window, {
      type: 'warning',
      message: 'Couldn’t check for updates',
      detail: error instanceof Error ? error.message : String(error)
    })
  }
}

interface CheckingMessage {
  /** Закрывает сообщение; `true` — его уже закрыл пользователь. */
  close(): Promise<boolean>
}

/** Сообщение «Checking for updates…» с кнопкой «Cancel»; закрывается, когда проверка закончилась. */
function showCheckingMessage(window: BrowserWindow | null): CheckingMessage {
  const controller = new AbortController()
  const options: Electron.MessageBoxOptions = {
    type: 'info',
    message: 'Checking for updates…',
    buttons: ['Cancel'],
    signal: controller.signal
  }
  let closing = false
  let closedByUser = false
  const shown = (
    window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options)
  ).then(() => {
    closedByUser = !closing
  })
  return {
    async close() {
      closing = true
      controller.abort()
      // Следующее сообщение — только когда это закрылось: два sheet сразу окно не покажет.
      await shown
      return closedByUser
    }
  }
}
