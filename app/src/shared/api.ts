import type { Project, UserProfile } from './models'

export type ContextMenuItem<Action extends string> =
  | { type?: 'action'; action: Action; label: string }
  | { type: 'separator' }

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
    /** Открывает папку проекта в Finder. */
    reveal(projectId: string): Promise<void>
  }
  chats: {
    create(projectId: string): Promise<{ projects: Project[]; chatId: string }>
    remove(chatId: string): Promise<Project[]>
    /** Переименование пользователем: после него заголовок терминала название не меняет. */
    rename(chatId: string, title: string): Promise<Project[]>
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
  system: {
    getUserProfile(): Promise<UserProfile>
  }
  showContextMenu<Action extends string>(items: ContextMenuItem<Action>[]): Promise<Action | null>
}

export const IpcChannel = {
  ProjectsList: 'projects:list',
  ProjectsAdd: 'projects:add',
  ProjectsRemove: 'projects:remove',
  ProjectsRename: 'projects:rename',
  ProjectsReveal: 'projects:reveal',
  ChatsCreate: 'chats:create',
  ChatsRemove: 'chats:remove',
  ChatsRename: 'chats:rename',
  ChatsApplyTerminalTitle: 'chats:apply-terminal-title',
  TerminalAttach: 'terminal:attach',
  TerminalWrite: 'terminal:write',
  TerminalResize: 'terminal:resize',
  TerminalData: 'terminal:data',
  TerminalExit: 'terminal:exit',
  SystemUserProfile: 'system:user-profile',
  ContextMenu: 'context-menu'
} as const

export interface TerminalDataEvent {
  chatId: string
  data: string
}

export interface TerminalExitEvent {
  chatId: string
}
