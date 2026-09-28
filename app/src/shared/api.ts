import type { AgentId } from './agents'
import type { AppCommand } from './commands'
import type { Project, UserProfile } from './models'
import type { Settings } from './settings'

export type ContextMenuItem<Action extends string> =
  | {
      type?: 'action'
      action: Action
      label: string
      /** Имя SF Symbol — иконка пункта в системном меню macOS. */
      symbol?: string
      /** Пункт отмечен галочкой, например текущий выбор. */
      checked?: boolean
    }
  | { type: 'separator' }

/** Текущая ветка git по пути папки проекта; `null` — папка не репозиторий git. */
export type GitBranches = Record<string, string | null>

export interface TerminalSize {
  cols: number
  rows: number
}

/** API, который preload пробрасывает в renderer как `window.atox`. */
export interface AtoxApi {
  projects: {
    list(): Promise<Project[]>
    /**
     * Открывает системный диалог выбора папки. Если папка уже добавлена, возвращает её проект.
     * `null` — пользователь закрыл диалог.
     */
    add(): Promise<{ projects: Project[]; projectId: string } | null>
    remove(projectId: string): Promise<Project[]>
    rename(projectId: string, name: string): Promise<Project[]>
    /** Переносит проект на позицию `toIndex` в списке. */
    move(projectId: string, toIndex: number): Promise<Project[]>
    /** Открывает папку проекта в Finder. */
    reveal(projectId: string): Promise<void>
  }
  agents: {
    /** Агенты, которые установлены на компьютере; пустой терминал доступен всегда. */
    available(): Promise<AgentId[]>
  }
  chats: {
    /**
     * Создаёт чат с агентом. Выбранный агент становится агентом по умолчанию; без агента
     * берётся агент по умолчанию (если он установлен) или пустой терминал.
     */
    create(projectId: string, agent?: AgentId): Promise<{ projects: Project[]; chatId: string }>
    remove(chatId: string): Promise<Project[]>
    /** Переименование пользователем: после него заголовок терминала название не меняет. */
    rename(chatId: string, title: string): Promise<Project[]>
    /** Переносит чат на позицию `toIndex` внутри его проекта. */
    move(chatId: string, toIndex: number): Promise<Project[]>
    /** Отмечает, что программа в чате закончила работу в момент `at`. */
    recordActivity(chatId: string, at: number): Promise<Project[]>
    /** Заголовок, который выставила программа в терминале; игнорируется, если название задано вручную. */
    applyTerminalTitle(chatId: string, title: string): Promise<Project[]>
  }
  terminal: {
    /** Запускает терминал чата, если он ещё не запущен, и возвращает уже накопленный вывод. */
    attach(chatId: string, size: TerminalSize): Promise<string>
    write(chatId: string, data: string): void
    resize(chatId: string, size: TerminalSize): void
    onData(chatId: string, listener: (data: string) => void): () => void
    onExit(chatId: string, listener: () => void): () => void
  }
  files: {
    /** Путь на диске к файлу, перетащенному в окно. */
    getPath(file: File): string
    /** Сохраняет вставленную картинку во временный файл и возвращает путь к нему. */
    savePastedImage(image: File): Promise<string>
  }
  git: {
    branches(): Promise<GitBranches>
    subscribe(listener: (branches: GitBranches) => void): () => void
  }
  updates: {
    /** Версия, которая скачана и готова к установке; `null` — обновлений нет. */
    readyVersion(): Promise<string | null>
    subscribe(listener: (version: string | null) => void): () => void
    /** Перезапускает приложение с установкой обновления. */
    install(): void
  }
  system: {
    getUserProfile(): Promise<UserProfile>
    /** Выводит окно приложения на передний план, например по клику на уведомление. */
    focusWindow(): void
  }
  settings: {
    get(): Promise<Settings>
    update(patch: Partial<Settings>): Promise<Settings>
    subscribe(listener: (settings: Settings) => void): () => void
  }
  commands: {
    subscribe(listener: (command: AppCommand) => void): () => void
  }
  showContextMenu<Action extends string>(items: ContextMenuItem<Action>[]): Promise<Action | null>
}

export const IpcChannel = {
  ProjectsList: 'projects:list',
  ProjectsAdd: 'projects:add',
  ProjectsRemove: 'projects:remove',
  ProjectsRename: 'projects:rename',
  ProjectsMove: 'projects:move',
  ProjectsReveal: 'projects:reveal',
  AgentsAvailable: 'agents:available',
  ChatsCreate: 'chats:create',
  ChatsRemove: 'chats:remove',
  ChatsRename: 'chats:rename',
  ChatsMove: 'chats:move',
  ChatsRecordActivity: 'chats:record-activity',
  ChatsApplyTerminalTitle: 'chats:apply-terminal-title',
  TerminalAttach: 'terminal:attach',
  TerminalWrite: 'terminal:write',
  TerminalResize: 'terminal:resize',
  TerminalData: 'terminal:data',
  TerminalExit: 'terminal:exit',
  FilesSavePastedImage: 'files:save-pasted-image',
  GitBranches: 'git:branches',
  GitBranchesChanged: 'git:branches-changed',
  UpdatesReadyVersion: 'updates:ready-version',
  UpdatesReady: 'updates:ready',
  UpdatesInstall: 'updates:install',
  SystemUserProfile: 'system:user-profile',
  SystemFocusWindow: 'system:focus-window',
  AppCommand: 'app:command',
  SettingsGet: 'settings:get',
  SettingsUpdate: 'settings:update',
  SettingsChanged: 'settings:changed',
  ContextMenu: 'context-menu'
} as const

export interface TerminalDataEvent {
  chatId: string
  data: string
}

export interface TerminalExitEvent {
  chatId: string
}
