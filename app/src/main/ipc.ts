import {
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  type IpcMainInvokeEvent
} from 'electron'
import {
  IpcChannel,
  type ContextMenuItem,
  type TerminalDataEvent,
  type TerminalExitEvent,
  type TerminalSize
} from '../shared/api'
import type { Settings } from '../shared/settings'
import { confirm, describeRunningPrograms } from './dialogs'
import type { SettingsStore } from './settings'
import type { ProjectStore } from './store'
import { getUserProfile } from './system'
import { normalizeTerminalTitle } from './terminalTitle'
import type { TerminalManager } from './terminals'

export function registerIpcHandlers(
  store: ProjectStore,
  settings: SettingsStore,
  terminals: TerminalManager
): void {
  ipcMain.handle(IpcChannel.ProjectsList, () => store.list())

  ipcMain.handle(IpcChannel.ProjectsAdd, async (event) => {
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
    const project = store.addProject(path)
    return { projects: store.list(), projectId: project.id }
  })

  ipcMain.handle(IpcChannel.ProjectsRemove, async (event, projectId: string) => {
    const project = store.getProject(projectId)
    const programs = project.chats.flatMap((chat) => terminals.getRunningProgram(chat.id) ?? [])
    const confirmed =
      programs.length === 0 ||
      (await confirm(BrowserWindow.fromWebContents(event.sender), {
        message: `Remove “${project.name}” from the list?`,
        detail: `${describeRunningPrograms(programs, 'in this project', 'Removing the project')} The folder stays on disk.`,
        confirmLabel: 'Remove'
      }))
    if (confirmed) {
      store.removeProject(projectId)
      project.chats.forEach((chat) => terminals.kill(chat.id))
    }
    return store.list()
  })

  ipcMain.handle(IpcChannel.ProjectsRename, (_event, projectId: string, name: string) => {
    store.renameProject(projectId, name)
    return store.list()
  })

  ipcMain.handle(IpcChannel.ProjectsReveal, async (_event, projectId: string) => {
    const error = await shell.openPath(store.getProject(projectId).path)
    if (error) {
      throw new Error(error)
    }
  })

  ipcMain.handle(IpcChannel.ChatsCreate, (_event, projectId: string) => {
    const chat = store.createChat(projectId)
    return { projects: store.list(), chatId: chat.id }
  })

  ipcMain.handle(IpcChannel.ChatsRemove, async (event, chatId: string) => {
    const program = terminals.getRunningProgram(chatId)
    const confirmed =
      program === null ||
      (await confirm(BrowserWindow.fromWebContents(event.sender), {
        message: `Delete “${store.findChat(chatId)?.chat.title ?? 'chat'}”?`,
        detail: describeRunningPrograms([program], 'in this chat', 'Deleting the chat'),
        confirmLabel: 'Delete'
      }))
    if (confirmed) {
      terminals.kill(chatId)
      store.removeChat(chatId)
    }
    return store.list()
  })

  ipcMain.handle(IpcChannel.ChatsRename, (_event, chatId: string, title: string) => {
    store.renameChat(chatId, title)
    return store.list()
  })

  ipcMain.handle(IpcChannel.ChatsApplyTerminalTitle, (_event, chatId: string, title: string) => {
    store.applyTerminalTitle(chatId, normalizeTerminalTitle(title))
    return store.list()
  })

  ipcMain.handle(IpcChannel.TerminalAttach, (_event, chatId: string, size: TerminalSize) => {
    const location = store.findChat(chatId)
    if (!location) {
      throw new Error(`Chat ${chatId} not found`)
    }
    return terminals.attach(chatId, location.project.path, size)
  })

  ipcMain.on(IpcChannel.TerminalWrite, (_event, chatId: string, data: string) => {
    terminals.write(chatId, data)
  })

  ipcMain.on(IpcChannel.TerminalResize, (_event, chatId: string, size: TerminalSize) => {
    terminals.resize(chatId, size)
  })

  ipcMain.handle(IpcChannel.SystemUserProfile, getUserProfile)

  ipcMain.handle(IpcChannel.SettingsGet, () => settings.get())
  ipcMain.handle(IpcChannel.SettingsUpdate, (_event, patch: Partial<Settings>) =>
    settings.update(patch)
  )
  settings.onChange((next) => broadcast(IpcChannel.SettingsChanged, next))

  ipcMain.handle(IpcChannel.ContextMenu, showContextMenu)
}

function showContextMenu(
  event: IpcMainInvokeEvent,
  items: ContextMenuItem<string>[]
): Promise<string | null> {
  return new Promise((resolve) => {
    const menu = Menu.buildFromTemplate(
      items.map((item) =>
        item.type === 'separator'
          ? { type: 'separator' as const }
          : {
              label: item.label,
              icon: item.symbol ? nativeImage.createMenuSymbol(item.symbol) : undefined,
              click: () => resolve(item.action)
            }
      )
    )
    menu.popup({
      window: BrowserWindow.fromWebContents(event.sender) ?? undefined,
      // На macOS закрытие меню приходит раньше клика по пункту, поэтому «ничего не выбрано»
      // фиксируем в следующем тике: если клик был, промис к этому моменту уже разрешён.
      callback: () => setTimeout(() => resolve(null))
    })
  })
}

export function broadcastTerminalData(payload: TerminalDataEvent): void {
  broadcast(IpcChannel.TerminalData, payload)
}

export function broadcastTerminalExit(payload: TerminalExitEvent): void {
  broadcast(IpcChannel.TerminalExit, payload)
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}
