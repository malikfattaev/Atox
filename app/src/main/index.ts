import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { broadcastTerminalData, broadcastTerminalExit, registerIpcHandlers } from './ipc'
import { installAppMenu } from './menu'
import { setupQuitHandling } from './quit'
import { SettingsStore } from './settings'
import { ProjectStore } from './store'
import { TerminalManager } from './terminals'
import { createMainWindow } from './window'

const STORE_FILE_NAME = 'projects.json'
const SETTINGS_FILE_NAME = 'settings.json'

/** Сборка для разработки хранит данные отдельно и не трогает проекты установленного приложения. */
const DEV_USER_DATA_SUFFIX = '-dev'

if (!app.isPackaged) {
  app.setPath('userData', app.getPath('userData') + DEV_USER_DATA_SUFFIX)
}

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

  setupQuitHandling({ terminals, stores: [store, settings] })

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
