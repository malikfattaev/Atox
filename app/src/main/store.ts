import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { AgentId } from '../shared/agents'
import { moveItem } from '../shared/list'
import type { Chat, Project } from '../shared/models'
import { JsonFileWriter, readVersionedJson } from './jsonFile'

const STORE_VERSION = 1

interface StoreFile {
  version: typeof STORE_VERSION
  projects: Project[]
}

interface ChatLocation {
  project: Project
  chat: Chat
}

/** Список проектов и их чатов, сохраняемый в JSON-файл. */
export class ProjectStore {
  private constructor(
    private readonly file: JsonFileWriter,
    private projects: Project[]
  ) {}

  static async load(filePath: string): Promise<ProjectStore> {
    const data = await readVersionedJson<StoreFile>(filePath, STORE_VERSION)
    const projects = Array.isArray(data?.projects) ? data.projects : []
    return new ProjectStore(new JsonFileWriter(filePath), projects)
  }

  list(): Project[] {
    return this.projects
  }

  addProject(path: string): Project {
    const existing = this.projects.find((project) => project.path === path)
    if (existing) {
      return existing
    }

    const project: Project = { id: randomUUID(), name: basename(path), path, chats: [] }
    this.projects.push(project)
    this.persist()
    return project
  }

  /** Удаляет проект из списка (папка на диске не трогается) и возвращает его. */
  removeProject(projectId: string): Project | undefined {
    const project = this.findProject(projectId)
    if (project) {
      this.projects = this.projects.filter(({ id }) => id !== projectId)
      this.persist()
    }
    return project
  }

  /** Меняет отображаемое имя проекта; папка на диске не переименовывается. */
  renameProject(projectId: string, name: string): void {
    const project = this.getProject(projectId)
    const trimmed = name.trim()
    if (trimmed && project.name !== trimmed) {
      project.name = trimmed
      this.persist()
    }
  }

  /** Переносит проект на позицию `toIndex` в списке. */
  moveProject(projectId: string, toIndex: number): void {
    const fromIndex = this.projects.findIndex(({ id }) => id === projectId)
    const projects = moveItem(this.projects, fromIndex, toIndex)
    if (projects) {
      this.projects = projects
      this.persist()
    }
  }

  createChat(projectId: string, agent: AgentId): Chat {
    const project = this.getProject(projectId)

    const chat: Chat = {
      id: randomUUID(),
      title: `Chat ${project.chats.length + 1}`,
      agent,
      createdAt: Date.now()
    }
    // Новые чаты сверху, как в Codex и Cursor.
    project.chats.unshift(chat)
    this.persist()
    return chat
  }

  removeChat(chatId: string): void {
    const location = this.findChat(chatId)
    if (location) {
      location.project.chats = location.project.chats.filter(({ id }) => id !== chatId)
      this.persist()
    }
  }

  /** Переносит чат на позицию `toIndex` внутри его проекта: терминал чата привязан к папке проекта. */
  moveChat(chatId: string, toIndex: number): void {
    const location = this.findChat(chatId)
    if (!location) {
      return
    }
    const { project, chat } = location
    const chats = moveItem(project.chats, project.chats.indexOf(chat), toIndex)
    if (chats) {
      project.chats = chats
      this.persist()
    }
  }

  renameChat(chatId: string, title: string): void {
    const chat = this.findChat(chatId)?.chat
    const trimmed = title.trim()
    if (chat && trimmed) {
      chat.title = trimmed
      chat.hasCustomTitle = true
      this.persist()
    }
  }

  /** Запоминает время последней работы в чате; более ранняя отметка не затирает свежую. */
  recordChatActivity(chatId: string, at: number): void {
    const chat = this.findChat(chatId)?.chat
    if (chat && Number.isFinite(at) && at > (chat.lastActiveAt ?? 0)) {
      chat.lastActiveAt = at
      this.persist()
    }
  }

  /** Название из заголовка терминала применяется, только пока пользователь не задал своё. */
  applyTerminalTitle(chatId: string, title: string): void {
    const chat = this.findChat(chatId)?.chat
    if (chat && !chat.hasCustomTitle && title && chat.title !== title) {
      chat.title = title
      this.persist()
    }
  }

  findProject(projectId: string): Project | undefined {
    return this.projects.find(({ id }) => id === projectId)
  }

  getProject(projectId: string): Project {
    const project = this.findProject(projectId)
    if (!project) {
      throw new Error(`Project ${projectId} not found`)
    }
    return project
  }

  findChat(chatId: string): ChatLocation | undefined {
    for (const project of this.projects) {
      const chat = project.chats.find(({ id }) => id === chatId)
      if (chat) {
        return { project, chat }
      }
    }
    return undefined
  }

  /** Дожидается окончания всех начатых записей — вызывается перед выходом из приложения. */
  flush(): Promise<void> {
    return this.file.flush()
  }

  /**
   * Сохраняет состояние сразу, без задержки: изменение, сделанное за мгновение до выхода,
   * тоже должно попасть на диск.
   */
  private persist(): void {
    const data: StoreFile = { version: STORE_VERSION, projects: this.projects }
    this.file.write(data)
  }
}
