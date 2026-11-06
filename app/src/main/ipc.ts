import { basename } from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell
} from 'electron'
import { IpcChannel, type GitBranches, type TerminalSize } from '../shared/api'
import {
  isChatCommand,
  type ChatConfiguration,
  type ConversationEvent,
  type InputValue,
  type RequestAnswer
} from '../shared/conversation'
import { archivedChats, chatGroup } from '../shared/chats'
import { isIntegrationKind } from '../shared/integrations'
import type { Project } from '../shared/models'
import type { PlanLimitsState } from '../shared/planLimits'
import { isProjectColor } from '../shared/projectColors'
import { isProjectIcon } from '../shared/projectIcons'
import type { GitHubCounts, GitHubKind, ListState } from '../shared/repository'
import type { Settings } from '../shared/settings'
import type { UpdateState } from '../shared/update'
import { findAgent, isAgentId, type AgentId } from '../shared/agents'
import type { AgentDetector } from './agents'
import type { WorkingTreeReader } from './changes'
import type { ConversationManager } from './conversations/manager'
import { confirm, describeWorkingAgents } from './dialogs'
import type { GitBranchTracker } from './gitBranches'
import type { SettingsStore } from './settings'
import type { ProjectStore } from './store'
import type { AppMenu } from './menu'
import type { PlanLimitsMonitor } from './planLimits'
import { readImage, saveImageAs } from './images'
import { savePastedImage } from './pastedImages'
import { pickFiles } from './pickedFiles'
import type { RepositoryReader } from './repository'
import { getUserProfile } from './system'
import type { TerminalManager } from './terminals'
import type { AppUpdater } from './updater'

interface AppServices {
  store: ProjectStore
  settings: SettingsStore
  conversations: ConversationManager
  terminals: TerminalManager
  branches: GitBranchTracker
  repository: RepositoryReader
  workingTree: WorkingTreeReader
  agents: AgentDetector
  /** `null` — обновления недоступны, например при запуске из исходников. */
  updater: AppUpdater | null
  menu: AppMenu
  planLimits: PlanLimitsMonitor
}

export function registerIpcHandlers({
  store,
  settings,
  conversations,
  terminals,
  branches,
  repository,
  workingTree,
  agents,
  updater,
  menu,
  planLimits
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
      terminals.kill(projectId)
      // История чатов из архива удаляется вместе с проектом.
      const chats = [...project.chats, ...archivedChats(project)]
      await Promise.all(chats.map((chat) => conversations.remove(chat.id)))
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

  ipcMain.handle(IpcChannel.ProjectsSetIcon, (_event, projectId: string, icon: unknown) => {
    store.setProjectIcon(projectId, isProjectIcon(icon) ? icon : null)
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
  ipcMain.handle(
    IpcChannel.AgentsIntegrations,
    (_event, agent: unknown, kind: unknown, projectId: unknown) => {
      if (!isAgentId(agent) || !isIntegrationKind(kind)) {
        throw new Error('Unknown agent or list')
      }
      return conversations.integrations(
        agent,
        kind,
        typeof projectId === 'string' ? projectId : null
      )
    }
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
        detail: describeWorkingAgents(
          1,
          'in this chat',
          'Deleting the chat',
          findAgent(location.chat.agent)?.name
        ),
        confirmLabel: 'Delete'
      }))
    if (confirmed) {
      store.removeChat(chatId)
      await conversations.remove(chatId)
    }
    return store.list()
  })

  ipcMain.handle(IpcChannel.ChatsArchive, async (event, chatId: string) => {
    const location = store.findChat(chatId)
    const working = location
      ? chatGroup(location.project.chats, chatId).filter((chat) => conversations.isRunning(chat.id))
      : []
    const confirmed =
      !location ||
      working.length === 0 ||
      (await confirm(BrowserWindow.fromWebContents(event.sender), {
        message: `Archive “${location.chat.title}”?`,
        detail: describeWorkingAgents(
          working.length,
          'in this chat',
          'Archiving the chat',
          findAgent(working[0]!.agent)?.name
        ),
        confirmLabel: 'Archive'
      }))
    if (confirmed) {
      // Агенты останавливаются, а история остаётся на диске — чат можно будет вернуть.
      const archived = store.archiveChat(chatId)
      await Promise.all(archived.map((chat) => conversations.close(chat.id)))
    }
    return store.list()
  })

  ipcMain.handle(IpcChannel.ChatsRestore, (_event, chatId: string) => {
    store.restoreChat(chatId)
    return store.list()
  })

  ipcMain.handle(IpcChannel.ChatsRemoveArchived, async (event, chatId: string) => {
    const location = store.findArchivedChat(chatId)
    // Удаление из архива необратимо: спрашиваем всегда, а не только когда агент работает.
    const confirmed =
      location &&
      (await confirm(BrowserWindow.fromWebContents(event.sender), {
        message: `Delete “${location.chat.title}”?`,
        detail: 'The chat and its history will be deleted. This can’t be undone.',
        confirmLabel: 'Delete'
      }))
    if (confirmed) {
      store.removeArchivedChat(chatId)
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
        // Модель и эффорт агента запоминаются для следующих чатов; агент по умолчанию —
        // нет: смена агента касается только этого чата.
        const { agentModels } = settings.get()
        const selection = {
          ...(chat.model && { model: chat.model }),
          ...(chat.effort && { effort: chat.effort })
        }
        if (JSON.stringify(agentModels[chat.agent] ?? {}) !== JSON.stringify(selection)) {
          settings.update({
            agentModels: { ...agentModels, [chat.agent]: selection }
          })
        }
      }
      return store.list()
    }
  )

  ipcMain.handle(IpcChannel.ConversationsSummaries, () => conversations.summaries())

  ipcMain.handle(IpcChannel.ConversationsSnapshot, (_event, chatId: string) =>
    conversations.snapshot(chatId)
  )
  ipcMain.handle(
    IpcChannel.ConversationsSend,
    (_event, chatId: string, text: unknown, attachments: unknown) => {
      const record = typeof attachments === 'object' && attachments !== null ? attachments : {}
      return conversations.send(chatId, String(text), {
        images: 'images' in record ? stringList(record.images) : [],
        files: 'files' in record ? stringList(record.files) : []
      })
    }
  )
  ipcMain.handle(IpcChannel.ConversationsCommands, (_event, chatId: string) =>
    conversations.commands(chatId)
  )
  ipcMain.handle(IpcChannel.ConversationsRunCommand, (_event, chatId: string, command: unknown) => {
    if (!isChatCommand(command)) {
      throw new Error(`Unknown command: ${String(command)}`)
    }
    return conversations.runCommand(chatId, command)
  })
  ipcMain.handle(IpcChannel.ConversationsInterrupt, (_event, chatId: string) =>
    conversations.interrupt(chatId)
  )
  ipcMain.handle(
    IpcChannel.ConversationsAnswerRequest,
    (_event, chatId: string, itemId: unknown, answer: unknown) =>
      conversations.answerRequest(chatId, String(itemId), parseRequestAnswer(answer))
  )

  ipcMain.handle(IpcChannel.TerminalsAttach, (_event, projectId: string, size: unknown) =>
    terminals.attach(projectId, store.getProject(projectId).path, parseTerminalSize(size))
  )
  ipcMain.on(IpcChannel.TerminalsWrite, (_event, projectId: string, data: unknown) => {
    if (typeof data === 'string') {
      terminals.write(projectId, data)
    }
  })
  ipcMain.on(IpcChannel.TerminalsResize, (_event, projectId: string, size: unknown) =>
    terminals.resize(projectId, parseTerminalSize(size))
  )

  ipcMain.handle(IpcChannel.FilesPick, (event) =>
    pickFiles(BrowserWindow.fromWebContents(event.sender))
  )
  ipcMain.handle(IpcChannel.FilesSavePastedImage, (_event, data: ArrayBuffer, type: string) =>
    savePastedImage(data, type)
  )

  ipcMain.handle(IpcChannel.ImagesRead, (_event, path: string) => readImage(path))
  ipcMain.handle(IpcChannel.ImagesSaveAs, (event, path: string) =>
    saveImageAs(BrowserWindow.fromWebContents(event.sender), path)
  )

  ipcMain.handle(IpcChannel.GitBranches, () => branches.list())

  ipcMain.handle(IpcChannel.ChangesList, (_event, projectId: string) =>
    workingTree.list(store.getProject(projectId).path)
  )
  ipcMain.handle(IpcChannel.ChangesDiff, (_event, projectId: string, path: string) =>
    workingTree.diff(store.getProject(projectId).path, path)
  )
  ipcMain.handle(IpcChannel.ChangesDiscard, async (event, projectId: string, path: string) => {
    const projectPath = store.getProject(projectId).path
    // Путь сверяется со списком изменений: окно не может откатить произвольный файл.
    const change = await workingTree.find(projectPath, path)
    if (!change) {
      return false
    }
    const created = change.kind === 'untracked' || change.kind === 'added'
    const confirmed = await confirm(BrowserWindow.fromWebContents(event.sender), {
      message: `Discard changes to “${basename(change.path)}”?`,
      detail: created
        ? 'The new file will be moved to the Trash.'
        : 'The file will go back to the last commit. Changes in it will be lost.',
      confirmLabel: 'Discard'
    })
    if (confirmed) {
      await workingTree.discard(projectPath, change)
    }
    return confirmed
  })

  ipcMain.handle(IpcChannel.RepositoryCommits, (_event, projectId: string, loaded?: number) =>
    repository.commits(store.getProject(projectId).path, loaded)
  )
  ipcMain.handle(IpcChannel.RepositoryMoreCommits, (_event, projectId: string, cursor: string) =>
    repository.moreCommits(store.getProject(projectId).path, cursor)
  )
  ipcMain.handle(IpcChannel.RepositoryGitHub, (_event, projectId: string, loaded?: GitHubCounts) =>
    repository.github(store.getProject(projectId).path, loaded)
  )
  ipcMain.handle(
    IpcChannel.RepositoryMoreGitHub,
    (_event, projectId: string, kind: GitHubKind, state: ListState, cursor: string) =>
      repository.moreGitHub(store.getProject(projectId).path, kind, state, cursor)
  )

  ipcMain.handle(IpcChannel.UpdatesState, () => updater?.state ?? null)
  ipcMain.on(IpcChannel.UpdatesInstall, () => updater?.installAndRelaunch())
  ipcMain.handle(IpcChannel.UpdatesCurrentVersion, () => app.getVersion())
  ipcMain.handle(IpcChannel.UpdatesCheck, () => updater?.checkNow() ?? 'unsupported')

  ipcMain.handle(IpcChannel.SystemUserProfile, getUserProfile)

  ipcMain.on(IpcChannel.SystemBadgeCount, (_event, count: unknown) => {
    const valid = typeof count === 'number' && Number.isSafeInteger(count) && count > 0
    app.setBadgeCount(valid ? count : 0)
  })

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

  ipcMain.handle(IpcChannel.PlanLimitsGet, () => planLimits.get())

  ipcMain.handle(IpcChannel.SettingsGet, () => settings.get())
  ipcMain.handle(IpcChannel.SettingsUpdate, (_event, patch: Partial<Settings>) =>
    settings.update(patch)
  )
  settings.onChange((next) => broadcast(IpcChannel.SettingsChanged, next))

  ipcMain.on(IpcChannel.ShortcutsRecording, (_event, recording: boolean) =>
    menu.setRecordingShortcut(recording === true)
  )

}

/** Настройки чата из окна: берутся только известные поля нужных типов. */
function parseConfiguration(value: unknown): ChatConfiguration {
  const source =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
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

/** Размер терминала из окна: целое число символов, не меньше одного. */
function parseTerminalSize(value: unknown): TerminalSize {
  const source =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const dimension = (field: unknown) =>
    typeof field === 'number' && Number.isFinite(field) ? Math.max(1, Math.floor(field)) : 1
  return { cols: dimension(source['cols']), rows: dimension(source['rows']) }
}

export function broadcastUpdateState(state: UpdateState): void {
  broadcast(IpcChannel.UpdatesStateChanged, state)
}

export function broadcastProjectsChanged(projects: Project[]): void {
  broadcast(IpcChannel.ProjectsChanged, projects)
}

export function broadcastGitBranches(branches: GitBranches): void {
  broadcast(IpcChannel.GitBranchesChanged, branches)
}

/** Строки из списка, который прислало окно; всё остальное отбрасывается. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
}

/** Ответ окна на запрос агента: всё, кроме явного согласия, — отказ. */
function parseRequestAnswer(answer: unknown): RequestAnswer {
  const record = typeof answer === 'object' && answer !== null ? answer : {}
  if (!('accepted' in record) || record.accepted !== true) {
    return { accepted: false }
  }
  const values = 'values' in record ? record.values : undefined
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    return { accepted: true }
  }
  return {
    accepted: true,
    values: Object.fromEntries(Object.entries(values).filter(([, value]) => isInputValue(value)))
  }
}

function isInputValue(value: unknown): value is InputValue {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  )
}

export function broadcastTerminalData(projectId: string, data: string): void {
  broadcast(IpcChannel.TerminalsData, projectId, data)
}

export function broadcastTerminalExit(projectId: string): void {
  broadcast(IpcChannel.TerminalsExit, projectId)
}

export function broadcastPlanLimits(state: PlanLimitsState): void {
  broadcast(IpcChannel.PlanLimitsChanged, state)
}

export function broadcastConversationEvent(event: ConversationEvent): void {
  broadcast(IpcChannel.ConversationsEvent, event)
}

function broadcast(channel: string, ...payload: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, ...payload)
  }
}
