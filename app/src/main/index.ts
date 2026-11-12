import { tmpdir } from 'node:os'
import { basename, delimiter, join } from 'node:path'
import { app, BrowserWindow, nativeTheme, shell as electronShell } from 'electron'
import { AgentDetector } from './agents'
import { WorkingTreeReader } from './changes'
import { claudeDriver } from './conversations/claude'
import { createCodexDriver } from './conversations/codex'
import { ConversationManager } from './conversations/manager'
import { TranscriptStore } from './conversations/transcripts'
import { installDesktopEntry } from './desktopEntry'
import { GitBranchTracker } from './gitBranches'
import { handleImageProtocol, registerImageScheme } from './imageProtocol'
import {
  broadcastGitBranches,
  broadcastConversationEvent,
  broadcastAgentListsStale,
  broadcastPlanLimits,
  broadcastTokenSpend,
  broadcastProjectsChanged,
  broadcastTerminalData,
  broadcastTerminalExit,
  broadcastUpdateState,
  registerIpcHandlers
} from './ipc'
import { AppMenu } from './menu'
import { installCli, installCodexRules, installSkills } from './orchestration/install'
import { OrchestrationServer } from './orchestration/server'
import { PlanLimitsMonitor } from './planLimits'
import { TokenSpendLedger } from './tokenSpend'
import { setupQuitHandling } from './quit'
import { RepositoryReader } from './repository'
import { SettingsStore } from './settings'
import { ShellEnvironment } from './shellEnvironment'
import { EXTERNAL_LINK_PROTOCOLS } from '../shared/links'
import { ProjectStore } from './store'
import { TerminalManager } from './terminals'
import { checkForUpdatesFromMenu } from './updateCheck'
import { createUpdateInstaller } from './updateInstallers'
import { AppUpdater } from './updater'
import { UsageStats } from './usageStats'
import { createMainWindow } from './window'

const STORE_FILE_NAME = 'projects.json'
const SETTINGS_FILE_NAME = 'settings.json'
const USAGE_STATS_FILE_NAME = 'usage-stats.json'
const TOKEN_SPEND_FILE_NAME = 'token-spend.json'
const PLAN_LIMITS_FILE_NAME = 'plan-limits.json'
const PLAN_LIMITS_LOG_NAME = 'plan-limits.log'
/** Каталог с лентами чатов: у каждого чата свой файл. */
const TRANSCRIPTS_DIRECTORY_NAME = 'conversations'

/** Собранная команда `atox` для агентов — рядом с main-процессом. */
const CLI_SCRIPT = join('out', 'main', 'atox.js')

/** Путь к AppImage, если приложение запущено из него: его задаёт среда запуска AppImage. */
const appImage = process.env['APPIMAGE']

/** Сборка для разработки хранит данные отдельно и не трогает проекты установленного приложения. */
const DEV_USER_DATA_SUFFIX = '-dev'

if (!app.isPackaged) {
  app.setPath('userData', app.getPath('userData') + DEV_USER_DATA_SUFFIX)
}

/**
 * Второй экземпляр перехватил бы сокет команды `atox` у агентов первого и писал бы
 * в те же файлы данных. Поэтому повторный запуск только показывает окно уже открытого.
 */
const isPrimaryInstance = app.requestSingleInstanceLock()

registerImageScheme()

async function bootstrap(): Promise<void> {
  await app.whenReady()
  handleImageProtocol()

  const userData = app.getPath('userData')
  const store = await ProjectStore.load(join(userData, STORE_FILE_NAME))
  const settings = await SettingsStore.load(join(userData, SETTINGS_FILE_NAME))
  // Тема окна: `prefers-color-scheme` в окне и системный vibrancy следуют за ней.
  nativeTheme.themeSource = settings.get().theme
  settings.onChange(({ theme }) => {
    nativeTheme.themeSource = theme
  })
  const tokenSpend = await TokenSpendLedger.load(join(userData, TOKEN_SPEND_FILE_NAME))
  tokenSpend.onChange(broadcastTokenSpend)
  const transcripts = await TranscriptStore.open(join(userData, TRANSCRIPTS_DIRECTORY_NAME))
  const binDirectory = join(userData, 'bin')
  const cliPath = await installCli(
    binDirectory,
    process.execPath,
    join(app.getAppPath(), CLI_SCRIPT)
  )
  const shell = new ShellEnvironment()
  const agents = new AgentDetector(shell)
  // Агенты получают окружение оболочки входа пользователя, а команду `atox` находят по PATH.
  const agentEnvironment = async (chatId?: string): Promise<Record<string, string>> => {
    const environment = await shell.get()
    return {
      ...environment,
      PATH: [binDirectory, environment['PATH']].filter(Boolean).join(delimiter),
      ...(chatId && orchestration.environment(chatId))
    }
  }
  const conversations = new ConversationManager({
    store,
    agents,
    drivers: {
      claude: claudeDriver,
      codex: createCodexDriver({
        name: 'atox',
        title: app.getName(),
        version: app.getVersion()
      })
    },
    transcripts,
    environment: agentEnvironment,
    onEvent: broadcastConversationEvent,
    onPlanLimits: (agent, limits) => planLimits.report(agent, limits),
    onTokensSpent: (agent, counts) => tokenSpend.record(agent, counts),
    onProjectsChanged: () => broadcastProjectsChanged(store.list()),
    openLink: (url) => {
      if (URL.canParse(url) && EXTERNAL_LINK_PROTOCOLS.has(new URL(url).protocol)) {
        void electronShell.openExternal(url)
      }
    },
    onAgentListsStale: broadcastAgentListsStale,
    onAccountChanged: () => void planLimits.refreshAll()
  })
  const planLimits = await PlanLimitsMonitor.load(
    {
      installed: () => agents.list(),
      read: (agent) => conversations.planLimits(agent),
      onChange: broadcastPlanLimits
    },
    join(userData, PLAN_LIMITS_FILE_NAME),
    join(userData, PLAN_LIMITS_LOG_NAME)
  )
  const terminals = new TerminalManager(app.getName(), {
    onData: broadcastTerminalData,
    onExit: broadcastTerminalExit
  })
  const branches = new GitBranchTracker(broadcastGitBranches)
  // Обновляется только собранное приложение; адрес релизов можно подменить для проверки обновлений.
  const updateInstaller = app.isPackaged ? createUpdateInstaller() : null
  const updater = updateInstaller
    ? new AppUpdater({
        feedUrl: process.env['ATOX_UPDATE_FEED_URL'] ?? __UPDATE_FEED_URL__,
        installer: updateInstaller,
        onStateChange: broadcastUpdateState
      })
    : null
  const orchestration = new OrchestrationServer({
    store,
    conversations,
    agents,
    // Путь к сокету ограничен ~100 символами, поэтому он во временном каталоге пользователя,
    // а не в длинном пути данных приложения. Имя различает сборку для разработки.
    socketPath: join(tmpdir(), `${basename(userData)}.sock`),
    cliPath,
    modelSelection: (agent) => settings.get().agentModels[agent] ?? {},
    onProjectsChanged: () => broadcastProjectsChanged(store.list())
  })
  // Без сервера приложение работает как раньше, только команда `atox` сообщит, что Atox недоступен.
  await orchestration
    .start()
    .catch((error) => console.error('Failed to start orchestration', error))
  app.on('will-quit', () => orchestration.stop())
  void installSkills().catch((error) => console.error('Failed to install agent skills', error))
  void installCodexRules().catch((error) => console.error('Failed to install Codex rules', error))
  if (app.isPackaged && appImage) {
    void installDesktopEntry(appImage).catch((error) =>
      console.error('Failed to install the desktop entry', error)
    )
  }
  const menu = new AppMenu(
    settings,
    updater ? () => void checkForUpdatesFromMenu(updater) : undefined
  )
  registerIpcHandlers({
    store,
    settings,
    conversations,
    terminals,
    branches,
    repository: new RepositoryReader(shell),
    workingTree: new WorkingTreeReader(shell),
    updater,
    agents,
    menu,
    planLimits,
    tokenSpend
  })
  // Ветку могли сменить или создать репозиторий в другом приложении, пока окно было не в фокусе.
  app.on('browser-window-focus', () => void branches.refreshOnFocus())
  // Пока окно было не в фокусе, в терминале могли поставить программу или поправить профиль.
  app.on('browser-window-focus', () => shell.refreshOnFocus())
  app.on('will-quit', () => branches.dispose())
  // Лимиты тратятся и в других программах агентов: вернувшись в окно, пользователь видит свежие.
  planLimits.start()
  app.on('browser-window-focus', () => void planLimits.refreshStale())
  app.on('will-quit', () => planLimits.stop())
  menu.install()

  // Статистика не должна мешать запуску: без неё приложение работает как обычно.
  const usageStats = await UsageStats.load({
    appKey: process.env['ATOX_USAGE_STATS_APP_KEY'] ?? __USAGE_STATS_APP_KEY__,
    filePath: join(userData, USAGE_STATS_FILE_NAME),
    settings
  }).catch((error) => {
    console.error('Failed to load usage stats', error)
    return null
  })
  usageStats?.start()
  app.on('will-quit', () => usageStats?.stop())

  const quitHandling = setupQuitHandling({
    conversations,
    terminals,
    stores: usageStats
      ? [store, settings, conversations, tokenSpend, planLimits, usageStats]
      : [store, settings, conversations, tokenSpend, planLimits]
  })
  if (updater) {
    quitHandling.onQuitCancelled(() => updater.cancelRelaunch())
    app.on('will-quit', () => updater.installOnQuit())
    app.on('browser-window-focus', () => updater.checkOnFocus())
    updater.start()
  }

  createMainWindow()

  // На macOS приложение живёт без окон: клик по иконке в доке открывает окно заново.
  app.on('activate', showMainWindow)
  app.on('second-instance', showMainWindow)
  // Выход отменили, когда окон уже не было (закрыли последнее, пока работал агент): без окна
  // приложение на Linux осталось бы работать, но вернуться в него было бы нельзя.
  quitHandling.onQuitCancelled(() => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
}

/** Показывает окно приложения, а если его нет — открывает новое. */
function showMainWindow(): void {
  const [window] = BrowserWindow.getAllWindows()
  if (!window) {
    createMainWindow()
    return
  }
  if (window.isMinimized()) {
    window.restore()
  }
  window.show()
  window.focus()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

if (isPrimaryInstance) {
  bootstrap().catch((error) => {
    console.error('Failed to start the app', error)
    app.quit()
  })
} else {
  app.quit()
}
