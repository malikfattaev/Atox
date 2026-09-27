import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { GitBranchTracker } from './gitBranches'
import {
  broadcastGitBranches,
  broadcastTerminalData,
  broadcastTerminalExit,
  broadcastUpdateReady,
  registerIpcHandlers
} from './ipc'
import { installAppMenu } from './menu'
import { setupQuitHandling } from './quit'
import { SettingsStore } from './settings'
import { ProjectStore } from './store'
import { TerminalManager } from './terminals'
import { AppUpdater } from './updater'
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
  const branches = new GitBranchTracker(broadcastGitBranches)
  // Обновляется только собранное приложение; адрес релизов можно подменить для проверки обновлений.
  const updater = app.isPackaged
    ? new AppUpdater({
        feedUrl: process.env['ATOX_UPDATE_FEED_URL'] ?? __UPDATE_FEED_URL__,
        onReady: broadcastUpdateReady
      })
    : null
  registerIpcHandlers(store, settings, terminals, branches, updater)
  // Ветку могли сменить или создать репозиторий в другом приложении, пока окно было не в фокусе.
  app.on('browser-window-focus', () => void branches.refreshAll())
  app.on('will-quit', () => branches.dispose())
  installAppMenu(settings)

  const quitHandling = setupQuitHandling({ terminals, stores: [store, settings] })
  if (updater) {
    quitHandling.onQuitCancelled(() => updater.cancelRelaunch())
    app.on('will-quit', () => updater.installOnQuit())
    updater.start()
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
