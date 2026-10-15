import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { AgentDetector } from './agents'
import { GitBranchTracker } from './gitBranches'
import {
  broadcastGitBranches,
  broadcastProjectsChanged,
  broadcastTerminalData,
  broadcastTerminalExit,
  broadcastUpdateReady,
  registerIpcHandlers
} from './ipc'
import { AppMenu } from './menu'
import { installCli, installCodexRules, installSkills } from './orchestration/install'
import { OrchestrationServer } from './orchestration/server'
import { setupQuitHandling } from './quit'
import { SettingsStore } from './settings'
import { ProjectStore } from './store'
import { TerminalManager } from './terminals'
import { AppUpdater } from './updater'
import { createMainWindow } from './window'

const STORE_FILE_NAME = 'projects.json'
const SETTINGS_FILE_NAME = 'settings.json'

/** Собранная команда `atox` для агентов — рядом с main-процессом. */
const CLI_SCRIPT = join('out', 'main', 'atox.js')

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
  const binDirectory = join(userData, 'bin')
  const cliPath = await installCli(
    binDirectory,
    process.execPath,
    join(app.getAppPath(), CLI_SCRIPT)
  )
  // Команду `atox` агенты находят по PATH; оболочка входа дописывает к нему свои каталоги.
  const terminalPath = [binDirectory, process.env['PATH']].filter(Boolean).join(':')
  const terminals = new TerminalManager(
    {
      appName: app.getName(),
      environment: (chatId) => ({ ...orchestration.environment(chatId), PATH: terminalPath })
    },
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
  const agents = new AgentDetector(() => settings.get().agentCommands)
  const orchestration = new OrchestrationServer({
    store,
    settings,
    terminals,
    agents,
    // Путь к сокету ограничен ~100 символами, поэтому он во временном каталоге пользователя,
    // а не в длинном пути данных приложения. Имя различает сборку для разработки.
    socketPath: join(tmpdir(), `${basename(userData)}.sock`),
    tasksDirectory: join(userData, 'tasks'),
    cliPath,
    onProjectsChanged: () => broadcastProjectsChanged(store.list())
  })
  // Без сервера приложение работает как раньше, только команда `atox` сообщит, что Atox недоступен.
  await orchestration
    .start()
    .catch((error) => console.error('Failed to start orchestration', error))
  app.on('will-quit', () => orchestration.stop())
  void installSkills().catch((error) => console.error('Failed to install agent skills', error))
  void installCodexRules().catch((error) => console.error('Failed to install Codex rules', error))
  const menu = new AppMenu(settings)
  registerIpcHandlers({ store, settings, terminals, branches, updater, agents, menu })
  // Ветку могли сменить или создать репозиторий в другом приложении, пока окно было не в фокусе.
  app.on('browser-window-focus', () => void branches.refreshAll())
  app.on('will-quit', () => branches.dispose())
  menu.install()

  const quitHandling = setupQuitHandling({ terminals, stores: [store, settings] })
  if (updater) {
    quitHandling.onQuitCancelled(() => updater.cancelRelaunch())
    app.on('will-quit', () => updater.installOnQuit())
    app.on('browser-window-focus', () => updater.checkOnFocus())
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
