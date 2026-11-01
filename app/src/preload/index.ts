import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppCommand } from '../shared/commands'
import type { Settings } from '../shared/settings'
import type { ConversationEvent } from '../shared/conversation'
import { IpcChannel, type AtoxApi, type GitBranches } from '../shared/api'

type Listener<Payload> = (payload: Payload) => void

/**
 * Один IPC-слушатель событий разговоров, раздающий их подписчикам конкретного чата:
 * иначе каждый открытый чат добавлял бы свой слушатель на общий канал.
 */
function createConversationEventHub() {
  const listeners = new Map<string, Set<Listener<ConversationEvent>>>()
  const runningListeners = new Set<(chatId: string, running: boolean) => void>()

  ipcRenderer.on(IpcChannel.ConversationsEvent, (_event, payload: ConversationEvent) => {
    listeners.get(payload.chatId)?.forEach((listener) => listener(payload))
    if (payload.type === 'running') {
      runningListeners.forEach((listener) => listener(payload.chatId, payload.running))
    }
  })

  const onRunningChange = (listener: (chatId: string, running: boolean) => void) => {
    runningListeners.add(listener)
    return () => {
      runningListeners.delete(listener)
    }
  }

  const onEvent = (chatId: string, listener: Listener<ConversationEvent>) => {
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

  return { onEvent, onRunningChange }
}

const conversationEvents = createConversationEventHub()

/** Подписка на событие main-процесса; возвращает отписку. */
function subscribe<Payload>(channel: string, listener: Listener<Payload>): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: Payload) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: AtoxApi = {
  projects: {
    list: () => ipcRenderer.invoke(IpcChannel.ProjectsList),
    add: (spaceId) => ipcRenderer.invoke(IpcChannel.ProjectsAdd, spaceId),
    moveToSpace: (projectId, spaceId) =>
      ipcRenderer.invoke(IpcChannel.ProjectsMoveToSpace, projectId, spaceId),
    remove: (projectId) => ipcRenderer.invoke(IpcChannel.ProjectsRemove, projectId),
    rename: (projectId, name) => ipcRenderer.invoke(IpcChannel.ProjectsRename, projectId, name),
    setColor: (projectId, color) =>
      ipcRenderer.invoke(IpcChannel.ProjectsSetColor, projectId, color),
    setSplit: (projectId, chatIds) =>
      ipcRenderer.invoke(IpcChannel.ProjectsSetSplit, projectId, chatIds),
    setSplitPosition: (projectId, position) =>
      ipcRenderer.invoke(IpcChannel.ProjectsSetSplitPosition, projectId, position),
    move: (projectId, toIndex) => ipcRenderer.invoke(IpcChannel.ProjectsMove, projectId, toIndex),
    reveal: (projectId) => ipcRenderer.invoke(IpcChannel.ProjectsReveal, projectId)
  },
  spaces: {
    list: () => ipcRenderer.invoke(IpcChannel.SpacesList),
    create: () => ipcRenderer.invoke(IpcChannel.SpacesCreate),
    rename: (spaceId, name) => ipcRenderer.invoke(IpcChannel.SpacesRename, spaceId, name),
    setColor: (spaceId, color) => ipcRenderer.invoke(IpcChannel.SpacesSetColor, spaceId, color),
    setActive: (spaceId) => ipcRenderer.invoke(IpcChannel.SpacesSetActive, spaceId),
    remove: (spaceId) => ipcRenderer.invoke(IpcChannel.SpacesRemove, spaceId)
  },
  agents: {
    available: () => ipcRenderer.invoke(IpcChannel.AgentsAvailable),
    catalog: (agent) => ipcRenderer.invoke(IpcChannel.AgentsCatalog, agent)
  },
  chats: {
    create: (projectId, agent) => ipcRenderer.invoke(IpcChannel.ChatsCreate, projectId, agent),
    remove: (chatId) => ipcRenderer.invoke(IpcChannel.ChatsRemove, chatId),
    rename: (chatId, title) => ipcRenderer.invoke(IpcChannel.ChatsRename, chatId, title),
    move: (chatId, toIndex) => ipcRenderer.invoke(IpcChannel.ChatsMove, chatId, toIndex),
    configure: (chatId, configuration) =>
      ipcRenderer.invoke(IpcChannel.ChatsConfigure, chatId, configuration),
    onChanged: (listener) => subscribe(IpcChannel.ProjectsChanged, listener)
  },
  conversations: {
    snapshot: (chatId) => ipcRenderer.invoke(IpcChannel.ConversationsSnapshot, chatId),
    send: (chatId, text, images = []) =>
      ipcRenderer.invoke(IpcChannel.ConversationsSend, chatId, text, images),
    commands: (chatId) => ipcRenderer.invoke(IpcChannel.ConversationsCommands, chatId),
    interrupt: (chatId) => ipcRenderer.invoke(IpcChannel.ConversationsInterrupt, chatId),
    onEvent: conversationEvents.onEvent,
    onRunningChange: conversationEvents.onRunningChange
  },
  files: {
    getPath: (file) => webUtils.getPathForFile(file),
    savePastedImage: async (image) =>
      ipcRenderer.invoke(IpcChannel.FilesSavePastedImage, await image.arrayBuffer(), image.type)
  },
  git: {
    branches: () => ipcRenderer.invoke(IpcChannel.GitBranches),
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, branches: GitBranches) =>
        listener(branches)
      ipcRenderer.on(IpcChannel.GitBranchesChanged, handler)
      return () => ipcRenderer.removeListener(IpcChannel.GitBranchesChanged, handler)
    }
  },
  repository: {
    commits: (projectId) => ipcRenderer.invoke(IpcChannel.RepositoryCommits, projectId),
    github: (projectId) => ipcRenderer.invoke(IpcChannel.RepositoryGitHub, projectId)
  },
  updates: {
    readyVersion: () => ipcRenderer.invoke(IpcChannel.UpdatesReadyVersion),
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, version: string | null) =>
        listener(version)
      ipcRenderer.on(IpcChannel.UpdatesReady, handler)
      return () => ipcRenderer.removeListener(IpcChannel.UpdatesReady, handler)
    },
    install: () => ipcRenderer.send(IpcChannel.UpdatesInstall)
  },
  shortcuts: {
    setRecording: (recording) => ipcRenderer.send(IpcChannel.ShortcutsRecording, recording)
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
  showContextMenu: (items, position) => ipcRenderer.invoke(IpcChannel.ContextMenu, items, position)
}

contextBridge.exposeInMainWorld('atox', api)
