import { contextBridge, ipcRenderer } from 'electron'
import type { AppCommand } from '../shared/commands'
import type { Settings } from '../shared/settings'
import {
  IpcChannel,
  type AtoxApi,
  type TerminalDataEvent,
  type TerminalExitEvent
} from '../shared/api'

type Listener<Payload> = (payload: Payload) => void

/**
 * Один IPC-слушатель на канал, раздающий события подписчикам конкретного чата:
 * иначе каждый открытый терминал добавлял бы свой слушатель на общий канал.
 */
function createChatEventHub<Event extends { chatId: string }, Payload>(
  channel: string,
  select: (event: Event) => Payload
) {
  const listeners = new Map<string, Set<Listener<Payload>>>()

  ipcRenderer.on(channel, (_event, payload: Event) => {
    listeners.get(payload.chatId)?.forEach((listener) => listener(select(payload)))
  })

  return (chatId: string, listener: Listener<Payload>) => {
    const chatListeners = listeners.get(chatId) ?? new Set()
    chatListeners.add(listener)
    listeners.set(chatId, chatListeners)

    return () => {
      chatListeners.delete(listener)
      if (chatListeners.size === 0) {
        listeners.delete(chatId)
      }
    }
  }
}

const onTerminalData = createChatEventHub<TerminalDataEvent, string>(
  IpcChannel.TerminalData,
  ({ data }) => data
)
const onTerminalExit = createChatEventHub<TerminalExitEvent, void>(
  IpcChannel.TerminalExit,
  () => undefined
)

const api: AtoxApi = {
  projects: {
    list: () => ipcRenderer.invoke(IpcChannel.ProjectsList),
    add: () => ipcRenderer.invoke(IpcChannel.ProjectsAdd),
    remove: (projectId) => ipcRenderer.invoke(IpcChannel.ProjectsRemove, projectId),
    rename: (projectId, name) => ipcRenderer.invoke(IpcChannel.ProjectsRename, projectId, name),
    move: (projectId, toIndex) => ipcRenderer.invoke(IpcChannel.ProjectsMove, projectId, toIndex),
    reveal: (projectId) => ipcRenderer.invoke(IpcChannel.ProjectsReveal, projectId)
  },
  chats: {
    create: (projectId) => ipcRenderer.invoke(IpcChannel.ChatsCreate, projectId),
    remove: (chatId) => ipcRenderer.invoke(IpcChannel.ChatsRemove, chatId),
    rename: (chatId, title) => ipcRenderer.invoke(IpcChannel.ChatsRename, chatId, title),
    move: (chatId, toIndex) => ipcRenderer.invoke(IpcChannel.ChatsMove, chatId, toIndex),
    applyTerminalTitle: (chatId, title) =>
      ipcRenderer.invoke(IpcChannel.ChatsApplyTerminalTitle, chatId, title)
  },
  terminal: {
    attach: (chatId, size) => ipcRenderer.invoke(IpcChannel.TerminalAttach, chatId, size),
    write: (chatId, data) => ipcRenderer.send(IpcChannel.TerminalWrite, chatId, data),
    resize: (chatId, size) => ipcRenderer.send(IpcChannel.TerminalResize, chatId, size),
    onData: onTerminalData,
    onExit: (chatId, listener) => onTerminalExit(chatId, () => listener())
  },
  system: {
    getUserProfile: () => ipcRenderer.invoke(IpcChannel.SystemUserProfile),
    focusWindow: () => ipcRenderer.send(IpcChannel.SystemFocusWindow)
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannel.SettingsGet),
    update: (patch) => ipcRenderer.invoke(IpcChannel.SettingsUpdate, patch),
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, settings: Settings) => listener(settings)
      ipcRenderer.on(IpcChannel.SettingsChanged, handler)
      return () => ipcRenderer.removeListener(IpcChannel.SettingsChanged, handler)
    }
  },
  commands: {
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, command: AppCommand) => listener(command)
      ipcRenderer.on(IpcChannel.AppCommand, handler)
      return () => ipcRenderer.removeListener(IpcChannel.AppCommand, handler)
    }
  },
  showContextMenu: (items) => ipcRenderer.invoke(IpcChannel.ContextMenu, items)
}

contextBridge.exposeInMainWorld('atox', api)
