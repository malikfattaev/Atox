import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { AgentId } from '../shared/agents'
import { insertWorkerChat, moveChatGroup, removeChatFromList } from '../shared/chats'
import { moveItemWithinGroup } from '../shared/list'
import type { Chat, Project, Space, SpacesState } from '../shared/models'
import type { ProjectColor } from '../shared/projectColors'
import { clampSplitPosition, DEFAULT_SPLIT_POSITION } from '../shared/split'
import { JsonFileWriter, readVersionedJson } from './jsonFile'

const STORE_VERSION = 1

/**
 * Пространства добавлены в файл той же версии: данные прежнего формата просто получают
 * пространство по умолчанию, а смена версии отложила бы их файл как несовместимый.
 */
interface StoreFile {
  version: typeof STORE_VERSION
  spaces?: Space[]
  activeSpaceId?: string
  projects: Project[]
}

/** Пространство, которое создаётся при первом запуске и в которое попадают прежние проекты. */
const DEFAULT_SPACE_NAME = 'Main'

/** Начало названия нового пространства; пользователь сразу может его переименовать. */
const NEW_SPACE_NAME = 'Space'

export interface ChatLocation {
  project: Project
  chat: Chat
}

/** Пространства, проекты и их чаты, сохраняемые в JSON-файл. */
export class ProjectStore {
  private constructor(
    private readonly file: JsonFileWriter,
    private spaces: Space[],
    private activeSpaceId: string,
    private projects: Project[]
  ) {}

  static async load(filePath: string): Promise<ProjectStore> {
    const data = await readVersionedJson<StoreFile>(filePath, STORE_VERSION)
    const projects = Array.isArray(data?.projects) ? data.projects : []
    const saved = Array.isArray(data?.spaces) ? data.spaces : []
    const spaces = saved.length > 0 ? saved : [createSpace(DEFAULT_SPACE_NAME)]
    // Проект без существующего пространства (в том числе из прежнего формата) — в первом.
    const spaceIds = new Set(spaces.map(({ id }) => id))
    for (const project of projects) {
      if (!spaceIds.has(project.spaceId)) {
        project.spaceId = spaces[0]!.id
      }
    }
    const activeSpaceId =
      data?.activeSpaceId && spaceIds.has(data.activeSpaceId) ? data.activeSpaceId : spaces[0]!.id
    return new ProjectStore(new JsonFileWriter(filePath), spaces, activeSpaceId, projects)
  }

  list(): Project[] {
    return this.projects
  }

  listSpaces(): SpacesState {
    return { spaces: this.spaces, activeSpaceId: this.activeSpaceId }
  }

  /** Создаёт пространство с названием по порядку («Space 2») и сразу открывает его. */
  createSpace(): Space {
    const space = createSpace(`${NEW_SPACE_NAME} ${this.spaces.length + 1}`)
    this.spaces.push(space)
    this.activeSpaceId = space.id
    this.persist()
    return space
  }

  renameSpace(spaceId: string, name: string): void {
    const space = this.getSpace(spaceId)
    const trimmed = name.trim()
    if (trimmed && space.name !== trimmed) {
      space.name = trimmed
      this.persist()
    }
  }

  setSpaceColor(spaceId: string, color: ProjectColor | null): void {
    const space = this.getSpace(spaceId)
    if ((space.color ?? null) === color) {
      return
    }
    if (color) {
      space.color = color
    } else {
      delete space.color
    }
    this.persist()
  }

  setActiveSpace(spaceId: string): void {
    if (this.activeSpaceId !== this.getSpace(spaceId).id) {
      this.activeSpaceId = spaceId
      this.persist()
    }
  }

  /**
   * Удаляет пространство; его проекты переходят в соседнее, ничего не теряется.
   * Последнее пространство удалить нельзя. Возвращает пространство, куда ушли проекты.
   */
  removeSpace(spaceId: string): Space {
    const heir = this.findSpaceHeir(spaceId)
    if (!heir) {
      throw new Error(`Space ${spaceId} cannot be removed`)
    }
    this.spaces = this.spaces.filter(({ id }) => id !== spaceId)
    this.projects
      .filter((project) => project.spaceId === spaceId)
      .forEach((project) => (project.spaceId = heir.id))
    if (this.activeSpaceId === spaceId) {
      this.activeSpaceId = heir.id
    }
    this.persist()
    return heir
  }

  /** Переносит проект в другое пространство — в конец его списка. */
  moveProjectToSpace(projectId: string, spaceId: string): void {
    const project = this.getProject(projectId)
    if (project.spaceId === this.getSpace(spaceId).id) {
      return
    }
    project.spaceId = spaceId
    this.projects = [...this.projects.filter((other) => other !== project), project]
    this.persist()
  }

  /** Куда перейдут проекты при удалении пространства: в предыдущее, а у первого — в следующее. */
  findSpaceHeir(spaceId: string): Space | undefined {
    const index = this.spaces.findIndex(({ id }) => id === spaceId)
    return index < 0 ? undefined : this.spaces[index === 0 ? 1 : index - 1]
  }

  findSpace(spaceId: string): Space | undefined {
    return this.spaces.find(({ id }) => id === spaceId)
  }

  /** Добавляет папку в пространство; уже добавленная папка остаётся там, где была. */
  addProject(path: string, spaceId: string): Project {
    const existing = this.projects.find((project) => project.path === path)
    if (existing) {
      return existing
    }

    const project: Project = {
      id: randomUUID(),
      name: basename(path),
      path,
      spaceId: this.getSpace(spaceId).id,
      chats: []
    }
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

  /** Задаёт цвет папки проекта; `null` возвращает обычную. */
  setProjectColor(projectId: string, color: ProjectColor | null): void {
    const project = this.getProject(projectId)
    if ((project.color ?? null) === color) {
      return
    }
    if (color) {
      project.color = color
    } else {
      delete project.color
    }
    this.persist()
  }

  /**
   * Запоминает два чата проекта, открытые рядом; `null` — рядом ничего не открыто.
   * Положение разделителя сохраняется, когда меняется один из чатов.
   */
  setProjectSplit(projectId: string, chatIds: readonly string[] | null): void {
    const project = this.getProject(projectId)
    if (!chatIds) {
      if (project.split) {
        delete project.split
        this.persist()
      }
      return
    }
    const [left, right] = chatIds
    const belongsToProject = (id: string | undefined) =>
      project.chats.some((chat) => chat.id === id)
    if (
      chatIds.length !== 2 ||
      left === right ||
      !belongsToProject(left) ||
      !belongsToProject(right)
    ) {
      throw new Error(`Invalid chats to open side by side: ${chatIds.join(', ')}`)
    }
    project.split = {
      chatIds: [left!, right!],
      position: project.split?.position ?? DEFAULT_SPLIT_POSITION
    }
    this.persist()
  }

  setProjectSplitPosition(projectId: string, position: number): void {
    const split = this.getProject(projectId).split
    if (split) {
      split.position = clampSplitPosition(position)
      this.persist()
    }
  }

  /** Переносит проект на позицию `toIndex` в списке его пространства. */
  moveProject(projectId: string, toIndex: number): void {
    const fromIndex = this.projects.findIndex(({ id }) => id === projectId)
    const projects = moveItemWithinGroup(
      this.projects,
      fromIndex,
      toIndex,
      (a, b) => a.spaceId === b.spaceId
    )
    if (projects) {
      this.projects = projects
      this.persist()
    }
  }

  createChat(projectId: string, agent: AgentId): Chat {
    const project = this.getProject(projectId)
    const chat = newChat(project, agent)
    // Новые чаты сверху, как в Codex и Cursor.
    project.chats.unshift(chat)
    this.persist()
    return chat
  }

  /**
   * Создаёт чат помощника, которого запустил агент чата `parentChatId`: в той же папке,
   * сразу под ним и его прежними помощниками. `title` — название, которое дал агент.
   */
  createWorkerChat(parentChatId: string, agent: AgentId, title?: string): ChatLocation {
    const location = this.findChat(parentChatId)
    if (!location) {
      throw new Error(`Chat ${parentChatId} not found`)
    }
    const { project } = location
    const trimmed = title?.trim()
    const chat: Chat = {
      ...newChat(project, agent),
      ...(trimmed && { title: trimmed, hasCustomTitle: true }),
      parentChatId
    }
    project.chats = insertWorkerChat(project.chats, chat)
    this.persist()
    return { project, chat }
  }

  removeChat(chatId: string): void {
    const location = this.findChat(chatId)
    if (location) {
      const { project } = location
      project.chats = removeChatFromList(project.chats, chatId)
      // Без удалённого чата открывать рядом больше нечего.
      if (project.split?.chatIds.includes(chatId)) {
        delete project.split
      }
      this.persist()
    }
  }

  /**
   * Переносит чат на позицию `toIndex` среди чатов верхнего уровня его проекта (терминал чата
   * привязан к папке проекта); помощники переезжают вместе с ним.
   */
  moveChat(chatId: string, toIndex: number): void {
    const project = this.findChat(chatId)?.project
    if (!project) {
      return
    }
    const chats = moveChatGroup(project.chats, chatId, toIndex)
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

  private getSpace(spaceId: string): Space {
    const space = this.findSpace(spaceId)
    if (!space) {
      throw new Error(`Space ${spaceId} not found`)
    }
    return space
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
    const data: StoreFile = {
      version: STORE_VERSION,
      spaces: this.spaces,
      activeSpaceId: this.activeSpaceId,
      projects: this.projects
    }
    this.file.write(data)
  }
}

function newChat(project: Project, agent: AgentId): Chat {
  return {
    id: randomUUID(),
    title: `Chat ${project.chats.length + 1}`,
    agent,
    createdAt: Date.now()
  }
}

function createSpace(name: string): Space {
  return { id: randomUUID(), name }
}
