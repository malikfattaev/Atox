import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { broadcastTerminalData, broadcastTerminalExit, registerIpcHandlers } from './ipc'
import { ProjectStore } from './store'
import { TerminalManager } from './terminals'
import { createMainWindow } from './window'

const STORE_FILE_NAME = 'projects.json'

async function bootstrap(): Promise<void> {
  await app.whenReady()

  const store = await ProjectStore.load(join(app.getPath('userData'), STORE_FILE_NAME))
  const terminals = new TerminalManager(app.getName(), {
    onData: (chatId, data) => broadcastTerminalData({ chatId, data }),
    onExit: (chatId) => broadcastTerminalExit({ chatId })
  })
  registerIpcHandlers(store, terminals)

  app.on('before-quit', () => {
    terminals.killAll()
    void store.flush()
  })

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
