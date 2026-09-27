import { app, BrowserWindow } from 'electron'
import { confirm, describeRunningPrograms } from './dialogs'
import type { TerminalManager } from './terminals'

interface Flushable {
  flush(): Promise<void>
}

interface QuitHandlingOptions {
  terminals: TerminalManager
  /** Хранилища, чьи записи на диск нужно дождаться перед выходом. */
  stores: Flushable[]
}

/**
 * Выход из приложения: подтверждение, если в чатах что-то работает, остановка терминалов
 * и ожидание записи данных на диск.
 */
export function setupQuitHandling({ terminals, stores }: QuitHandlingOptions): void {
  let quitConfirmed = false
  let storesFlushed = false

  app.on('before-quit', (event) => {
    if (!quitConfirmed) {
      const running = terminals.listRunningPrograms()
      if (running.length > 0) {
        event.preventDefault()
        void confirmQuit(running.map(({ program }) => program)).then((confirmed) => {
          if (confirmed) {
            quitConfirmed = true
            app.quit()
          }
        })
        return
      }
      quitConfirmed = true
    }
    terminals.killAll()
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

  // Ctrl+C в терминале и остановка процесса — явная команда выйти, без вопросов.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      quitConfirmed = true
      app.quit()
    })
  }
}

function confirmQuit(programs: string[]): Promise<boolean> {
  const location = programs.length === 1 ? 'in a chat' : `in ${programs.length} chats`
  return confirm(BrowserWindow.getFocusedWindow(), {
    message: 'Quit Atox?',
    detail: describeRunningPrograms(programs, location, 'Quitting'),
    confirmLabel: 'Quit'
  })
}
