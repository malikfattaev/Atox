import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type NativeImage
} from 'electron'
import { IpcChannel, type ContextMenuItem, type MenuPosition, type GitBranches } from '../shared/api'
import type { ChatConfiguration, ConversationEvent } from '../shared/conversation'
import type { Project } from '../shared/models'
import { IS_MAC } from '../shared/platform'
import { isProjectColor } from '../shared/projectColors'
import type { Settings } from '../shared/settings'
import { findAgent, isAgentId, type AgentId } from '../shared/agents'
import type { AgentDetector } from './agents'
import type { ConversationManager } from './conversations/manager'
import { confirm, describeWorkingAgents } from './dialogs'
import type { GitBranchTracker } from './gitBranches'
import type { SettingsStore } from './settings'
import type { ProjectStore } from './store'
import type { AppMenu } from './menu'
import { createColorSwatch } from './menuSwatch'
import { savePastedImage } from './pastedImages'
import { getUserProfile } from './system'
import type { AppUpdater } from './updater'

interface AppServices {
  store: ProjectStore
  settings: SettingsStore
  conversations: ConversationManager
  branches: GitBranchTracker
  agents: AgentDetector
  /** `null` — обновления недоступны, например при запуске из исходников. */
  updater: AppUpdater | null
  menu: AppMenu
}

export function registerIpcHandlers({
  store,
  settings,
  conversations,
  branches,
  agents,
  updater,
  menu
}: AppServices): void {
  const trackProjectBranches = () => void branches.track(store.list().map(({ path }) => path))
  trackProjectBranches()

  ipcMain.handle(IpcChannel.ProjectsList, () => store.list())

  ipcMain.handle(IpcChannel.ProjectsAdd, async (event, spaceId: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Open Project',
      buttonLabel: 'Open',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)

    const [path] = result.filePaths
    if (result.canceled || !path) {
      return null
    }
    const project = store.addProject(path, spaceId)
    trackProjectBranches()
    return { projects: store.list(), projectId: project.id }
  })

  ipcMain.handle(IpcChannel.ProjectsRemove, async (event, projectId: string) => {
    const project = store.getProject(projectId)
    const working = project.chats.filter((chat) => conversations.isRunning(chat.id))
    const confirmed =
      working.length === 0 ||
      (await confirm(BrowserWindow.fromWebContents(event.sender), {
        message: `Remove “${project.name}” from the list?`,
        detail: `${describeWorkingAgents(working.length, 'in this project', 'Removing the project')} The folder stays on disk.`,
        confirmLabel: 'Remove'
      }))
    if (confirmed) {
      store.removeProject(projectId)
      await Promise.all(project.chats.map((chat) => conversations.remove(chat.id)))
      trackProjectBranches()
    }
    return store.list()
  })

  ipcMain.handle(IpcChannel.ProjectsMoveToSpace, (_event, projectId: string, spaceId: string) => {
    store.moveProjectToSpace(projectId, spaceId)
    return store.list()
  })

  ipcMain.handle(IpcChannel.SpacesList, () => store.listSpaces())

  ipcMain.handle(IpcChannel.SpacesCreate, () => {
    store.createSpace()
    return store.listSpaces()
  })

  ipcMain.handle(IpcChannel.SpacesRename, (_event, spaceId: string, name: string) => {
    store.renameSpace(spaceId, name)
    return store.listSpaces()
  })

  ipcMain.handle(IpcChannel.SpacesSetColor, (_event, spaceId: string, color: unknown) => {
    store.setSpaceColor(spaceId, isProjectColor(color) ? color : null)
    return store.listSpaces()
  })

  ipcMain.handle(IpcChannel.SpacesSetActive, (_event, spaceId: string) => {
    store.setActiveSpace(spaceId)
    return store.listSpaces()
  })

  ipcMain.handle(IpcChannel.SpacesRemove, async (event, spaceId: string) => {
    const space = store.findSpace(spaceId)
    const heir = store.findSpaceHeir(spaceId)
    if (!space || !heir) {
      return null
    }
    const projectCount = store.list().filter((project) => project.spaceId === spaceId).length
    // Проекты не пропадают, а переезжают — но о переезде лучше спросить заранее.
    const confirmed =
      projectCount === 0 ||
      (await confirm(BrowserWindow.fromWebContents(event.sender), {
        message: `Delete “${space.name}”?`,
        detail: `Its ${projectCount === 1 ? 'project moves' : `${projectCount} projects move`} to “${heir.name}” with all chats.`,
        confirmLabel: 'Delete'
      }))
    if (!confirmed) {
      return null
    }
    store.removeSpace(spaceId)
    return { spaces: store.listSpaces(), projects: store.list() }
  })

  ipcMain.handle(IpcChannel.ProjectsRename, (_event, projectId: string, name: string) => {
    store.renameProject(projectId, name)
    return store.list()
  })

  ipcMain.handle(IpcChannel.ProjectsSetColor, (_event, projectId: string, color: unknown) => {
    store.setProjectColor(projectId, isProjectColor(color) ? color : null)
    return store.list()
  })

  ipcMain.handle(IpcChannel.ProjectsSetSplit, (_event, projectId: string, chatIds: unknown) => {
    store.setProjectSplit(projectId, Array.isArray(chatIds) ? chatIds.map(String) : null)
    return store.list()
  })

  ipcMain.handle(
    IpcChannel.ProjectsSetSplitPosition,
    (_event, projectId: string, position: number) => {
      store.setProjectSplitPosition(projectId, Number(position))
      return store.list()
    }
  )

  ipcMain.handle(IpcChannel.ProjectsMove, (_event, projectId: string, toIndex: number) => {
    store.moveProject(projectId, toIndex)
    return store.list()
  })

  ipcMain.handle(IpcChannel.ProjectsReveal, async (_event, projectId: string) => {
    const error = await shell.openPath(store.getProject(projectId).path)
    if (error) {
      throw new Error(error)
    }
  })

  ipcMain.handle(IpcChannel.AgentsAvailable, () => agents.list())
  ipcMain.handle(IpcChannel.AgentsCatalog, (_event, agent: unknown) =>
    isAgentId(agent) ? conversations.catalog(agent) : null
  )

  /** Агент по умолчанию, если он установлен, иначе первый установленный. */
  const resolveDefaultAgent = async (): Promise<AgentId> => {
    const { defaultAgent } = settings.get()
    const installed = await agents.list()
    return installed.includes(defaultAgent) ? defaultAgent : (installed[0] ?? defaultAgent)
  }

  ipcMain.handle(IpcChannel.ChatsCreate, async (_event, projectId: string, agent?: unknown) => {
    // Агента выбрали явно — он становится агентом по умолчанию для следующих чатов.
    if (isAgentId(agent) && agent !== settings.get().defaultAgent) {
      settings.update({ defaultAgent: agent })
    }
    const chosen = isAgentId(agent) ? agent : await resolveDefaultAgent()
    const chat = store.createChat(projectId, chosen, settings.get().agentModels[chosen])
    return { projects: store.list(), chatId: chat.id }
  })

  ipcMain.handle(IpcChannel.ChatsRemove, async (event, chatId: string) => {
    const location = store.findChat(chatId)
    const confirmed =
      !location ||
      !conversations.isRunning(chatId) ||
      (await confirm(BrowserWindow.fromWebContents(event.sender), {
        message: `Delete “${location.chat.title}”?`,
        detail: describeWorkingAgents(1, 'in this chat', 'Deleting the chat', findAgent(location.chat.agent)?.name),
        confirmLabel: 'Delete'
      }))
    if (confirmed) {
      store.removeChat(chatId)
      await conversations.remove(chatId)
    }
    return store.list()
  })

  ipcMain.handle(IpcChannel.ChatsRename, (_event, chatId: string, title: string) => {
    store.renameChat(chatId, title)
    return store.list()
  })

  ipcMain.handle(IpcChannel.ChatsMove, (_event, chatId: string, toIndex: number) => {
    store.moveChat(chatId, toIndex)
    return store.list()
  })

  ipcMain.handle(
    IpcChannel.ChatsConfigure,
    async (_event, chatId: string, configuration: unknown) => {
      await conversations.configure(chatId, parseConfiguration(configuration))
      const chat = store.findChat(chatId)?.chat
      if (chat) {
        // Выбор запоминается: следующий чат начнётся с того же агента, модели и эффорта.
        const { defaultAgent, agentModels } = settings.get()
        const selection = {
          ...(chat.model && { model: chat.model }),
          ...(chat.effort && { effort: chat.effort })
        }
        if (
          defaultAgent !== chat.agent ||
          JSON.stringify(agentModels[chat.agent] ?? {}) !== JSON.stringify(selection)
        ) {
          settings.update({
            defaultAgent: chat.agent,
            agentModels: { ...agentModels, [chat.agent]: selection }
          })
        }
      }
      return store.list()
    }
  )

  ipcMain.handle(IpcChannel.ConversationsSnapshot, (_event, chatId: string) =>
    conversations.snapshot(chatId)
  )
  ipcMain.handle(IpcChannel.ConversationsSend, (_event, chatId: string, text: unknown) =>
    conversations.send(chatId, String(text))
  )
  ipcMain.handle(IpcChannel.ConversationsCommands, (_event, chatId: string) =>
    conversations.commands(chatId)
  )
  ipcMain.handle(IpcChannel.ConversationsInterrupt, (_event, chatId: string) =>
    conversations.interrupt(chatId)
  )

  ipcMain.handle(IpcChannel.FilesSavePastedImage, (_event, data: ArrayBuffer, type: string) =>
    savePastedImage(data, type)
  )

  ipcMain.handle(IpcChannel.GitBranches, () => branches.list())

  ipcMain.handle(IpcChannel.UpdatesReadyVersion, () => updater?.readyVersion ?? null)
  ipcMain.on(IpcChannel.UpdatesInstall, () => updater?.installAndRelaunch())

  ipcMain.handle(IpcChannel.SystemUserProfile, getUserProfile)

  ipcMain.on(IpcChannel.SystemFocusWindow, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) {
      if (window.isMinimized()) {
        window.restore()
      }
      window.show()
      app.focus({ steal: true })
    }
  })

  ipcMain.handle(IpcChannel.SettingsGet, () => settings.get())
  ipcMain.handle(IpcChannel.SettingsUpdate, (_event, patch: Partial<Settings>) =>
    settings.update(patch)
  )
  settings.onChange((next) => broadcast(IpcChannel.SettingsChanged, next))

  ipcMain.on(IpcChannel.ShortcutsRecording, (_event, recording: boolean) =>
    menu.setRecordingShortcut(recording === true)
  )

  ipcMain.handle(IpcChannel.ContextMenu, showContextMenu)
}

/** Настройки чата из окна: берутся только известные поля нужных типов. */
function parseConfiguration(value: unknown): ChatConfiguration {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const optionalString = (field: unknown) =>
    field === null ? null : typeof field === 'string' && field ? field : undefined
  const model = optionalString(source['model'])
  const effort = optionalString(source['effort'])
  return {
    ...(isAgentId(source['agent']) && { agent: source['agent'] }),
    ...(model !== undefined && { model }),
    ...(effort !== undefined && { effort })
  }
}

function showContextMenu(
  event: IpcMainInvokeEvent,
  items: ContextMenuItem<string>[],
  position?: MenuPosition
): Promise<string | null> {
  return new Promise((resolve) => {
    const menu = Menu.buildFromTemplate(buildMenuTemplate(items, resolve))
    menu.popup({
      window: BrowserWindow.fromWebContents(event.sender) ?? undefined,
      // Меню принимает только целые координаты.
      ...(position && { x: Math.round(position.x), y: Math.round(position.y) }),
      // На macOS закрытие меню приходит раньше клика по пункту, поэтому «ничего не выбрано»
      // фиксируем в следующем тике: если клик был, промис к этому моменту уже разрешён.
      callback: () => setTimeout(() => resolve(null))
    })
  })
}

/** Значок пункта меню из SF Symbols; на Linux пункты меню без значков. */
function menuSymbol(symbol: string | undefined): NativeImage | undefined {
  return symbol && IS_MAC ? nativeImage.createMenuSymbol(symbol) : undefined
}

function buildMenuTemplate(
  items: ContextMenuItem<string>[],
  onSelect: (action: string) => void
): MenuItemConstructorOptions[] {
  return items.map((item) => {
    switch (item.type) {
      case 'separator':
        return { type: 'separator' }
      case 'submenu':
        return {
          label: item.label,
          icon: menuSymbol(item.symbol),
          submenu: buildMenuTemplate(item.items, onSelect)
        }
      default:
        return {
          label: item.label,
          icon: item.swatch ? createColorSwatch(item.swatch) : menuSymbol(item.symbol),
          type: item.checked === undefined ? 'normal' : 'checkbox',
          checked: item.checked,
          enabled: item.enabled ?? true,
          accelerator: item.accelerator,
          // Сочетание только подписано у пункта: срабатывать оно должно у главного меню и окна.
          registerAccelerator: false,
          click: () => onSelect(item.action)
        }
    }
  })
}

export function broadcastUpdateReady(version: string): void {
  broadcast(IpcChannel.UpdatesReady, version)
}

export function broadcastProjectsChanged(projects: Project[]): void {
  broadcast(IpcChannel.ProjectsChanged, projects)
}

export function broadcastGitBranches(branches: GitBranches): void {
  broadcast(IpcChannel.GitBranchesChanged, branches)
}

export function broadcastConversationEvent(event: ConversationEvent): void {
  broadcast(IpcChannel.ConversationsEvent, event)
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}
