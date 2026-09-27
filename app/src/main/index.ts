import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { broadcastTerminalData, broadcastTerminalExit, registerIpcHandlers } from './ipc'
import { installAppMenu } from './menu'
import { SettingsStore } from './settings'
import { ProjectStore } from './store'
import { TerminalManager } from './terminals'
import { createMainWindow } from './window'

const STORE_FILE_NAME = 'projects.json'
const SETTINGS_FILE_NAME = 'settings.json'

async function bootstrap(): Promise<void> {
  await app.whenReady()

  const userData = app.getPath('userData')
  const store = await ProjectStore.load(join(userData, STORE_FILE_NAME))
  const settings = await SettingsStore.load(join(userData, SETTINGS_FILE_NAME))
  const terminals = new TerminalManager(
    { appName: app.getName(), getStartupCommand: () => settings.get().startupCommand },
    {
      onData: (chatId, data) => broadcastTerminalData({ chatId, data }),
      onExit: (chatId) => broadcastTerminalExit({ chatId })
    }
  )
  registerIpcHandlers(store, settings, terminals)
  installAppMenu(settings)

  app.on('before-quit', () => terminals.killAll())

  // Выход откладывается, пока не допишутся изменения: последние из них приходят из окна,
  // которое закрывается уже после начала выхода.
  let storeFlushed = false
  app.on('will-quit', (event) => {
    if (storeFlushed) {
      return
    }
    event.preventDefault()
    void Promise.all([store.flush(), settings.flush()]).finally(() => {
      storeFlushed = true
      // Повторный выход — в следующем тике: пока Electron обрабатывает прерванный will-quit,
      // app.quit() молча игнорируется, а запись могла завершиться ещё до конца обработки.
      setImmediate(() => app.quit())
    })
  })

  // Ctrl+C в терминале и остановка процесса должны закрывать приложение так же, как Cmd+Q.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => app.quit())
  }

  createMainWindow()

  // На macOS приложение живёт без окон: клик по иконке в доке открывает окно заново.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

bootstrap().catch((error) => {
  console.error('Failed to start the app', error)
  app.quit()
})
