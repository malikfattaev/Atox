import { isBoardColumn, type BoardColumn, type BoardIssue, type BoardRepository, type BoardState, type AvailableRepository } from '../../shared/board'
import type { ConversationEvent } from '../../shared/conversation'
import { findAgent } from '../../shared/agents'
import type { AgentDetector } from '../agents'
import type { ConversationManager } from '../conversations/manager'
import type { GitHubAccounts } from '../githubAccounts'
import { JsonFileWriter, readVersionedJson } from '../jsonFile'
import { errorMessage } from '../processes'
import type { SettingsStore } from '../settings'
import type { ProjectStore } from '../store'
import type { BoardGitHub, GitHubIssue } from './github'
import { formatIssueTask } from './prompt'
import type { BoardWorktrees } from './worktrees'

const BOARD_VERSION = 1

/** Где карточка задачи и что с ней делал агент. Задачи без записи лежат в бэклоге. */
interface Card {
  column: BoardColumn
  /** Учётная запись, под которой видна задача, — нужна, чтобы прочитать её, когда она закроется. */
  account: string
  /** Когда задачу поставили в очередь: агентам она достаётся по порядку. */
  queuedAt?: number
  chatId?: string
  error?: string
}

interface BoardFile {
  version: typeof BOARD_VERSION
  repositories: BoardRepository[]
  cards: Record<string, Card>
}

export interface BoardServices {
  github: BoardGitHub
  worktrees: BoardWorktrees
  accounts: GitHubAccounts
  store: ProjectStore
  settings: SettingsStore
  conversations: ConversationManager
  agents: AgentDetector
  onChange(state: BoardState): void
  /** Появился проект или чат: окну нужен новый список. */
  onProjectsChanged(): void
}

/**
 * Доска задач. Задачи — открытые issue выбранных репозиториев; колонку каждой помнит Atox.
 * Задача в очереди уходит агенту, как только работающих агентов доски меньше предела из
 * настроек, а когда агент закончит ход — переходит на проверку.
 */
export class BoardService {
  private issues: GitHubIssue[] = []
  private syncedAt: number | null = null
  private syncing: Promise<void> | null = null
  private error: string | null = null
  /** Задачи, агентов которых сейчас готовят: клонируют репозиторий, создают worktree. */
  private readonly starting = new Set<string>()

  private constructor(
    private readonly services: BoardServices,
    private readonly file: JsonFileWriter,
    private repositories: BoardRepository[],
    private readonly cards: Map<string, Card>
  ) {}

  static async load(services: BoardServices, filePath: string): Promise<BoardService> {
    const data = await readVersionedJson<BoardFile>(filePath, BOARD_VERSION)
    const repositories = Array.isArray(data?.repositories)
      ? data.repositories.filter(isBoardRepository)
      : []
    const cards = new Map<string, Card>()
    for (const [id, card] of Object.entries(data?.cards ?? {})) {
      if (isBoardColumn(card?.column) && typeof card.account === 'string') {
        cards.set(id, card)
      }
    }
    return new BoardService(services, new JsonFileWriter(filePath), repositories, cards)
  }

  state(): BoardState {
    const shown = new Set(this.repositories.map(({ fullName }) => fullName))
    return {
      repositories: this.repositories,
      issues: this.issues
        .filter((issue) => shown.has(issue.repository))
        .map((issue) => this.toBoardIssue(issue)),
      syncedAt: this.syncedAt,
      syncing: this.syncing !== null,
      error: this.error
    }
  }

  /** Перечитывает задачи с GitHub; идущее чтение не начинается заново, а дожидается. */
  refresh(): Promise<BoardState> {
    this.syncing ??= this.sync().finally(() => {
      this.syncing = null
      this.changed()
    })
    this.changed()
    return this.syncing.then(() => this.state())
  }

  availableRepositories(): Promise<AvailableRepository[]> {
    return this.services.github.availableRepositories()
  }

  setRepositories(repositories: BoardRepository[]): Promise<BoardState> {
    this.repositories = repositories.filter(isBoardRepository)
    this.persist()
    return this.refresh()
  }

  move(issueId: string, target: BoardColumn): BoardState {
    const issue = this.issues.find(({ id }) => id === issueId)
    if (!issue) {
      throw new Error('The task is no longer on the board.')
    }
    const card: Card = this.cards.get(issueId) ?? { column: target, account: this.accountOf(issue) }
    const agentRunning =
      card.chatId !== undefined && this.services.conversations.isRunning(card.chatId)
    // «В работу» без работающего агента — значит запустить его: задача встаёт в очередь
    // и уходит агенту сразу, если есть свободное место.
    const column = target === 'progress' && !agentRunning ? 'queue' : target
    // Задачу вернули в бэклог — её агента останавливают; чат и worktree остаются.
    if (column === 'backlog' && agentRunning && card.chatId) {
      void this.services.conversations.interrupt(card.chatId)
    }
    card.column = column
    delete card.error
    if (column === 'queue') {
      card.queuedAt = Date.now()
    } else {
      delete card.queuedAt
    }
    this.cards.set(issueId, card)
    this.persist()
    this.changed()
    this.startQueued()
    return this.state()
  }

  /** Агент задачи закончил ход — задача уходит на проверку, а её место — следующей в очереди. */
  onConversationEvent(event: ConversationEvent): void {
    if (event.type !== 'running' || event.running) {
      return
    }
    for (const card of this.cards.values()) {
      if (card.chatId === event.chatId && card.column === 'progress') {
        card.column = 'review'
        this.persist()
        this.changed()
        this.startQueued()
        return
      }
    }
  }

  /** Число агентов из настроек изменилось — в очереди могли освободиться места. */
  onSettingsChanged(): void {
    this.startQueued()
  }

  private async sync(): Promise<void> {
    try {
      const open = await Promise.all(
        this.repositories.map((repository) => this.services.github.openIssues(repository))
      )
      const issues = open.flat()
      // Закрытые задачи с карточками дочитываются по id: иначе они пропали бы из колонок.
      const known = new Set(issues.map(({ id }) => id))
      const missing = new Map<string, string[]>()
      for (const [id, card] of this.cards) {
        if (!known.has(id)) {
          missing.set(card.account, [...(missing.get(card.account) ?? []), id])
        }
      }
      for (const [account, ids] of missing) {
        issues.push(...(await this.services.github.issuesById(account, ids).catch(() => [])))
      }
      this.issues = issues.sort((left, right) => right.updatedAt - left.updatedAt)
      this.syncedAt = Date.now()
      this.error = null
      this.startQueued()
    } catch (error) {
      console.error('Failed to sync the board', error)
      this.error = errorMessage(error)
    }
  }

  /** Отдаёт агентам задачи из очереди, пока работающих меньше предела. */
  private startQueued(): void {
    const limit = this.services.settings.get().boardMaxAgents
    const working = [...this.cards.entries()].filter(
      ([id, card]) =>
        this.starting.has(id) ||
        (card.column === 'progress' &&
          card.chatId !== undefined &&
          this.services.conversations.isRunning(card.chatId))
    ).length
    const queued = [...this.cards.entries()]
      .filter(([id, card]) => card.column === 'queue' && !this.starting.has(id))
      .sort(([, left], [, right]) => (left.queuedAt ?? 0) - (right.queuedAt ?? 0))
    for (const [id] of queued.slice(0, Math.max(0, limit - working))) {
      const issue = this.issues.find((candidate) => candidate.id === id)
      if (issue) {
        void this.start(issue)
      }
    }
  }

  private async start(issue: GitHubIssue): Promise<void> {
    const card = this.cards.get(issue.id)
    if (!card) {
      return
    }
    this.starting.add(issue.id)
    this.changed()
    try {
      const { store, settings, worktrees, accounts, github, conversations } = this.services
      const token = await accounts.token(card.account)
      if (!token) {
        throw new Error(`GitHub account ${card.account} is not signed in to gh.`)
      }
      const { defaultAgent: agent, agentModels } = settings.get()
      if (!(await this.services.agents.list()).includes(agent)) {
        throw new Error(`${findAgent(agent)?.name ?? agent} is not installed.`)
      }
      let project = await worktrees.findProject(store.list(), issue.repository)
      if (!project) {
        const path = await worktrees.clone(issue.repository, token)
        project = store.addProject(path, store.listSpaces().activeSpaceId)
      }
      const worktree = await worktrees.create(project.path, issue.repository, issue.number, token)
      const body = await github.issueBody(card.account, issue.id)
      // Пока готовили worktree, задачу могли убрать из очереди — агента тогда не запускают.
      if (card.column !== 'queue') {
        return
      }
      const chat = store.createTaskChat(project.id, agent, agentModels[agent] ?? {}, {
        title: `#${issue.number} ${issue.title}`,
        worktree: worktree.path,
        githubAccount: card.account
      })
      card.column = 'progress'
      card.chatId = chat.id
      delete card.queuedAt
      this.services.onProjectsChanged()
      await conversations.send(chat.id, formatIssueTask(issue, body, worktree))
    } catch (error) {
      console.error(`Failed to start an agent for ${issue.repository}#${issue.number}`, error)
      // Задача возвращается в бэклог с причиной: оставшись в очереди, она пробовала бы снова и снова.
      card.column = 'backlog'
      card.error = errorMessage(error)
      delete card.queuedAt
    } finally {
      this.starting.delete(issue.id)
      this.persist()
      this.changed()
    }
  }

  /** Учётная запись репозитория задачи на доске. */
  private accountOf(issue: GitHubIssue): string {
    const repository = this.repositories.find(({ fullName }) => fullName === issue.repository)
    if (!repository) {
      throw new Error('The repository is no longer on the board.')
    }
    return repository.account
  }

  private toBoardIssue(issue: GitHubIssue): BoardIssue {
    const card = this.cards.get(issue.id)
    return {
      ...issue,
      // Пока агента готовят, задача уже не ждёт в очереди.
      column: this.starting.has(issue.id) ? 'progress' : (card?.column ?? 'backlog'),
      ...(card?.chatId && { chatId: card.chatId }),
      ...(card?.error && { error: card.error })
    }
  }

  private persist(): void {
    const data: BoardFile = {
      version: BOARD_VERSION,
      repositories: this.repositories,
      cards: Object.fromEntries(this.cards)
    }
    this.file.write(data)
  }

  private changed(): void {
    this.services.onChange(this.state())
  }

  flush(): Promise<void> {
    return this.file.flush()
  }
}

function isBoardRepository(value: unknown): value is BoardRepository {
  const { fullName, account } = (value ?? {}) as Partial<BoardRepository>
  return typeof fullName === 'string' && fullName.includes('/') && typeof account === 'string'
}
