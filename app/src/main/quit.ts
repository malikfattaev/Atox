import { app, BrowserWindow } from 'electron'
import type { ConversationManager } from './conversations/manager'
import { confirm, describeWorkingAgents } from './dialogs'

interface Flushable {
  flush(): Promise<void>
}

export interface QuitHandling {
  /** Пользователь отказался выходить в окне подтверждения. */
  onQuitCancelled(listener: () => void): void
}

interface QuitHandlingOptions {
  conversations: ConversationManager
  /** Хранилища, чьи записи на диск нужно дождаться перед выходом. */
  stores: Flushable[]
}

/**
 * Выход из приложения: подтверждение, если в чатах работают агенты, их остановка
 * и ожидание записи данных на диск.
 */
export function setupQuitHandling({ conversations, stores }: QuitHandlingOptions): QuitHandling {
  let quitConfirmed = false
  let storesFlushed = false
  const cancelListeners = new Set<() => void>()

  app.on('before-quit', (event) => {
    if (!quitConfirmed) {
      const working = conversations.runningChatIds().length
      if (working > 0) {
        event.preventDefault()
        void confirmQuit(working).then((confirmed) => {
          if (confirmed) {
            quitConfirmed = true
            app.quit()
          } else {
            cancelListeners.forEach((listener) => listener())
          }
        })
        return
      }
      quitConfirmed = true
    }
    conversations.closeAll()
  })

  // Выход откладывается, пока не допишутся изменения: последние из них приходят из окна,
  // которое закрывается уже после начала выхода.
  app.on('will-quit', (event) => {
    if (storesFlushed) {
      return
    }
    event.preventDefault()
    void Promise.all(stores.map((store) => store.flush())).finally(() => {
      storesFlushed = true
      // Повторный выход — в следующем тике: пока Electron обрабатывает прерванный will-quit,
      // app.quit() молча игнорируется, а запись могла завершиться ещё до конца обработки.
      setImmediate(() => app.quit())
    })
  })

  // Ctrl+C в терминале, из которого запущен Atox, и остановка процесса — явная команда выйти, без вопросов.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      quitConfirmed = true
      app.quit()
    })
  }

  return { onQuitCancelled: (listener) => cancelListeners.add(listener) }
}

function confirmQuit(working: number): Promise<boolean> {
  const location = working === 1 ? 'in a chat' : `in ${working} chats`
  return confirm(BrowserWindow.getFocusedWindow(), {
    message: 'Quit Atox?',
    detail: describeWorkingAgents(working, location, 'Quitting'),
    confirmLabel: 'Quit'
  })
}
