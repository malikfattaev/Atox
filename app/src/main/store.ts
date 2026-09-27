import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Chat, Project } from '../shared/models'

const STORE_VERSION = 1

/** Изменения копятся и пишутся на диск одной операцией, чтобы частые правки не били по файлу. */
const SAVE_DELAY_MS = 300

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
  private saveTimer: NodeJS.Timeout | null = null

  private constructor(
    private readonly filePath: string,
    private projects: Project[]
  ) {}

  static async load(filePath: string): Promise<ProjectStore> {
    let raw: string
    try {
      raw = await readFile(filePath, 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return new ProjectStore(filePath, [])
      }
      throw error
    }

    try {
      const data = JSON.parse(raw) as StoreFile
      if (data.version !== STORE_VERSION || !Array.isArray(data.projects)) {
        throw new Error(`Неподдерживаемая версия хранилища: ${String(data.version)}`)
      }
      return new ProjectStore(filePath, data.projects)
    } catch (error) {
      // Повреждённый файл не удаляем: откладываем в сторону, чтобы данные можно было восстановить.
      const backupPath = `${filePath}.corrupt-${Date.now()}`
      await rename(filePath, backupPath)
      console.error(`Хранилище проектов повреждено, копия сохранена в ${backupPath}`, error)
      return new ProjectStore(filePath, [])
    }
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
    this.scheduleSave()
    return project
  }

  /** Удаляет проект из списка (папка на диске не трогается) и возвращает его. */
  removeProject(projectId: string): Project | undefined {
    const project = this.findProject(projectId)
    if (project) {
      this.projects = this.projects.filter(({ id }) => id !== projectId)
      this.scheduleSave()
    }
    return project
  }

  /** Меняет отображаемое имя проекта; папка на диске не переименовывается. */
  renameProject(projectId: string, name: string): void {
    const project = this.getProject(projectId)
    const trimmed = name.trim()
    if (trimmed && project.name !== trimmed) {
      project.name = trimmed
      this.scheduleSave()
    }
  }

  createChat(projectId: string): Chat {
    const project = this.getProject(projectId)

    const chat: Chat = {
      id: randomUUID(),
      title: `Чат ${project.chats.length + 1}`,
      createdAt: Date.now()
    }
    // Новые чаты сверху, как в Codex и Cursor.
    project.chats.unshift(chat)
    this.scheduleSave()
    return chat
  }

  removeChat(chatId: string): void {
    const location = this.findChat(chatId)
    if (location) {
      location.project.chats = location.project.chats.filter(({ id }) => id !== chatId)
      this.scheduleSave()
    }
  }

  renameChat(chatId: string, title: string): void {
    const chat = this.findChat(chatId)?.chat
    const trimmed = title.trim()
    if (chat && trimmed) {
      chat.title = trimmed
      chat.hasCustomTitle = true
      this.scheduleSave()
    }
  }

  /** Название из заголовка терминала применяется, только пока пользователь не задал своё. */
  applyTerminalTitle(chatId: string, title: string): void {
    const chat = this.findChat(chatId)?.chat
    if (chat && !chat.hasCustomTitle && title && chat.title !== title) {
      chat.title = title
      this.scheduleSave()
    }
  }

  findProject(projectId: string): Project | undefined {
    return this.projects.find(({ id }) => id === projectId)
  }

  getProject(projectId: string): Project {
    const project = this.findProject(projectId)
    if (!project) {
      throw new Error(`Проект ${projectId} не найден`)
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

  /** Немедленно записывает отложенные изменения — вызывается перед выходом из приложения. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
      await this.save()
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.save().catch((error) => console.error('Не удалось сохранить проекты', error))
    }, SAVE_DELAY_MS)
  }

  /** Пишет во временный файл и переименовывает его, чтобы сбой не оставил файл наполовину записанным. */
  private async save(): Promise<void> {
    const data: StoreFile = { version: STORE_VERSION, projects: this.projects }
    const tempPath = `${this.filePath}.tmp`
    await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8')
    await rename(tempPath, this.filePath)
  }
}
