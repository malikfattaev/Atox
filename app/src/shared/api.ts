import type { Project } from './models'

export interface ContextMenuItem<Action extends string> {
  action: Action
  label: string
}

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
  }
  chats: {
    create(projectId: string): Promise<{ projects: Project[]; chatId: string }>
    remove(chatId: string): Promise<Project[]>
    rename(chatId: string, title: string): Promise<Project[]>
  }
  terminal: {
    /** Запускает терминал чата, если он ещё не запущен, и возвращает уже накопленный вывод. */
    attach(chatId: string, size: TerminalSize): Promise<string>
    write(chatId: string, data: string): void
    resize(chatId: string, size: TerminalSize): void
    onData(chatId: string, listener: (data: string) => void): () => void
    onExit(chatId: string, listener: () => void): () => void
  }
  showContextMenu<Action extends string>(items: ContextMenuItem<Action>[]): Promise<Action | null>
}

export const IpcChannel = {
  ProjectsList: 'projects:list',
  ProjectsAdd: 'projects:add',
  ProjectsRemove: 'projects:remove',
  ChatsCreate: 'chats:create',
  ChatsRemove: 'chats:remove',
  ChatsRename: 'chats:rename',
  TerminalAttach: 'terminal:attach',
  TerminalWrite: 'terminal:write',
  TerminalResize: 'terminal:resize',
  TerminalData: 'terminal:data',
  TerminalExit: 'terminal:exit',
  ContextMenu: 'context-menu'
} as const

export interface TerminalDataEvent {
  chatId: string
  data: string
}

export interface TerminalExitEvent {
  chatId: string
}
