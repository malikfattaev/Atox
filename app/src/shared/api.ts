import type { AgentId } from './agents'
import type { AppCommand } from './commands'
import type { Project, SpacesState, UserProfile } from './models'
import type { ProjectColor } from './projectColors'
import type { Settings } from './settings'

export type ContextMenuItem<Action extends string> =
  | {
      type?: 'action'
      action: Action
      label: string
      /** Имя SF Symbol — иконка пункта в системном меню macOS. */
      symbol?: string
      /** Цвет в формате #RRGGBB — вместо иконки у пункта цветной кружок. */
      swatch?: string
      /** Пункт отмечен галочкой, например текущий выбор. */
      checked?: boolean
      /** Сочетание клавиш, которое показывается справа от пункта (само меню его не перехватывает). */
      accelerator?: string
    }
  | {
      type: 'submenu'
      label: string
      symbol?: string
      items: ContextMenuItem<Action>[]
    }
  | { type: 'separator' }

/** Точка в окне в CSS-пикселях. */
export interface MenuPosition {
  x: number
  y: number
}

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
     * Открывает системный диалог выбора папки и добавляет её в пространство. Если папка уже
     * добавлена, возвращает её проект. `null` — пользователь закрыл диалог.
     */
    add(spaceId: string): Promise<{ projects: Project[]; projectId: string } | null>
    /** Переносит проект в другое пространство. */
    moveToSpace(projectId: string, spaceId: string): Promise<Project[]>
    remove(projectId: string): Promise<Project[]>
    rename(projectId: string, name: string): Promise<Project[]>
    /** Цвет папки проекта; `null` — без цвета. */
    setColor(projectId: string, color: ProjectColor | null): Promise<Project[]>
    /** Запоминает чаты проекта, открытые рядом (слева направо); `null` — один чат. */
    setSplit(projectId: string, chatIds: [string, string] | null): Promise<Project[]>
    /** Положение разделителя между чатами — доля ширины левого. */
    setSplitPosition(projectId: string, position: number): Promise<Project[]>
    /** Переносит проект на позицию `toIndex` в списке. */
    move(projectId: string, toIndex: number): Promise<Project[]>
    /** Открывает папку проекта в Finder. */
    reveal(projectId: string): Promise<void>
  }
  spaces: {
    list(): Promise<SpacesState>
    /** Создаёт пространство и открывает его. */
    create(): Promise<SpacesState>
    rename(spaceId: string, name: string): Promise<SpacesState>
    setColor(spaceId: string, color: ProjectColor | null): Promise<SpacesState>
    setActive(spaceId: string): Promise<SpacesState>
    /**
     * Удаляет пространство, переносив его проекты в соседнее (после подтверждения, если они есть).
     * `null` — пользователь передумал.
     */
    remove(spaceId: string): Promise<{ spaces: SpacesState; projects: Project[] } | null>
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
    /** Переносит чат на позицию `toIndex` среди чатов верхнего уровня его проекта. */
    move(chatId: string, toIndex: number): Promise<Project[]>
    /** Заголовок, который выставила программа в терминале; игнорируется, если название задано вручную. */
    applyTerminalTitle(chatId: string, title: string): Promise<Project[]>
    /** Список чатов изменился без участия окна — например, агент запустил помощника. */
    onChanged(listener: (projects: Project[]) => void): () => void
  }
  terminal: {
    /** Запускает терминал чата, если он ещё не запущен, и возвращает уже накопленный вывод. */
    attach(chatId: string, size: TerminalSize): Promise<string>
    write(chatId: string, data: string): void
    resize(chatId: string, size: TerminalSize): void
    onData(chatId: string, listener: (data: string) => void): () => void
    onExit(chatId: string, listener: () => void): () => void
    /** Atox отправил программе сообщение или задание — в любом чате. */
    onSubmit(listener: (chatId: string) => void): () => void
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
  shortcuts: {
    /**
     * Пока в настройках записывают новое сочетание, горячие клавиши меню не срабатывают:
     * иначе нажатое сочетание выполнило бы команду вместо того, чтобы записаться.
     */
    setRecording(recording: boolean): void
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
  /**
   * Системное меню; `position` — точка в окне, где открыть его (например, под кнопкой),
   * без неё меню открывается у курсора.
   */
  showContextMenu<Action extends string>(
    items: ContextMenuItem<Action>[],
    position?: MenuPosition
  ): Promise<Action | null>
}

export const IpcChannel = {
  ProjectsList: 'projects:list',
  ProjectsAdd: 'projects:add',
  ProjectsRemove: 'projects:remove',
  ProjectsRename: 'projects:rename',
  ProjectsSetColor: 'projects:set-color',
  ProjectsMoveToSpace: 'projects:move-to-space',
  SpacesList: 'spaces:list',
  SpacesCreate: 'spaces:create',
  SpacesRename: 'spaces:rename',
  SpacesSetColor: 'spaces:set-color',
  SpacesSetActive: 'spaces:set-active',
  SpacesRemove: 'spaces:remove',
  ProjectsSetSplit: 'projects:set-split',
  ProjectsSetSplitPosition: 'projects:set-split-position',
  ProjectsMove: 'projects:move',
  ProjectsReveal: 'projects:reveal',
  AgentsAvailable: 'agents:available',
  ChatsCreate: 'chats:create',
  ChatsRemove: 'chats:remove',
  ChatsRename: 'chats:rename',
  ChatsMove: 'chats:move',
  ChatsApplyTerminalTitle: 'chats:apply-terminal-title',
  ProjectsChanged: 'projects:changed',
  TerminalAttach: 'terminal:attach',
  TerminalWrite: 'terminal:write',
  TerminalResize: 'terminal:resize',
  TerminalData: 'terminal:data',
  TerminalExit: 'terminal:exit',
  TerminalSubmit: 'terminal:submit',
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
  ShortcutsRecording: 'shortcuts:recording',
  ContextMenu: 'context-menu'
} as const

export interface TerminalDataEvent {
  chatId: string
  data: string
}

export interface TerminalExitEvent {
  chatId: string
}

/** Atox отправил программе в терминале чата сообщение или задание. */
export interface TerminalSubmitEvent {
  chatId: string
}
