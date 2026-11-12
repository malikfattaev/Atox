import { DONE_VISIBLE_MS, isBoardColumn, type TaskStart, type BoardColumn, type BoardIssue, type BoardRepository, type BoardState, type AvailableRepository } from '../../shared/board'
import type { ConversationEvent, ConversationSnapshot } from '../../shared/conversation'
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

/** Сообщение агенту, когда задачу снова отдают ему в его же чате без слов от пользователя. */
const CONTINUE_MESSAGE = 'Continue working on the task.'

/** Где карточка задачи и что с ней делал агент. Задачи без записи лежат в бэклоге. */
interface Card {
  column: BoardColumn
  /** Учётная запись, под которой видна задача, — нужна, чтобы прочитать её, когда она закроется. */
  account: string
  /** Когда задачу поставили в очередь: агентам она достаётся по порядку. */
  queuedAt?: number
  chatId?: string
  error?: string
  /** Когда задачу перенесли в Done; через `DONE_VISIBLE_MS` она пропадает с доски. */
  doneAt?: number
  /** С каким агентом и сообщением задачу запустить; нет — с агентом доски из настроек. */
  start?: TaskStart
  /** Папка репозитория, из которой сделан worktree задачи: из неё его и убирают. */
  repositoryPath?: string
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
        // Задачи в Done из прежних версий получают отсчёт с первого запуска.
        if (card.column === 'done' && typeof card.doneAt !== 'number') {
          card.doneAt = Date.now()
        }
        // Ход агента не переживает перезапуск Atox: без работающего агента задача — на проверке.
        if (
          card.column === 'progress' &&
          !(card.chatId && services.conversations.isRunning(card.chatId))
        ) {
          card.column = 'review'
        }
        cards.set(id, card)
      }
    }
    const board = new BoardService(services, new JsonFileWriter(filePath), repositories, cards)
    // Задачи из очереди уходят агентам, только когда прочитаны их issue, — не дожидаясь,
    // пока пользователь откроет доску.
    if ([...cards.values()].some(({ column }) => column === 'queue')) {
      void board.refresh()
    }
    return board
  }

  state(): BoardState {
    const shown = new Set(this.repositories.map(({ fullName }) => fullName))
    return {
      repositories: this.repositories,
      issues: this.issues
        .filter((issue) => shown.has(issue.repository) && !this.isRetired(issue.id))
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

  /** Проект, под которым чат агента появится без выбора: копия репозитория среди проектов. */
  async defaultProjectId(repository: string): Promise<string | null> {
    const project = await this.services.worktrees.findProject(this.services.store.list(), repository)
    return project?.id ?? null
  }

  /** Чат агента задачи; нет — агент над ней не работал. */
  chatOf(issueId: string): string | undefined {
    return this.cards.get(issueId)?.chatId
  }

  move(issueId: string, target: BoardColumn, start?: TaskStart): BoardState {
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
    if (column === 'done') {
      card.doneAt = Date.now()
      void this.retireAgent(card)
    } else {
      delete card.doneAt
    }
    if (column === 'queue') {
      card.queuedAt = Date.now()
      if (start) {
        card.start = start
      } else {
        delete card.start
      }
    } else {
      delete card.queuedAt
    }
    // В бэклоге без чата карточка ничего не помнит: задача там и без неё.
    if (column === 'backlog' && !card.chatId) {
      this.cards.delete(issueId)
    } else {
      this.cards.set(issueId, card)
    }
    this.persist()
    this.changed()
    this.startQueued()
    return this.state()
  }

  /**
   * Агент задачи закончил ход — задача уходит на проверку, а её место — следующей в очереди.
   * Агент задачи на проверке снова взялся за работу (ему написали в чате) — она снова в работе.
   */
  onConversationEvent(event: ConversationEvent): void {
    if (event.type !== 'running') {
      return
    }
    const card = [...this.cards.values()].find(({ chatId }) => chatId === event.chatId)
    if (event.running && card?.column === 'review') {
      card.column = 'progress'
      this.persist()
      this.changed()
    } else if (!event.running && card?.column === 'progress') {
      void this.finishTurn(card, event.chatId)
    }
  }

  /** Число агентов из настроек изменилось — в очереди могли освободиться места. */
  onSettingsChanged(): void {
    this.startQueued()
  }

  private async sync(): Promise<void> {
    try {
      const repositories = this.repositories
      const results = await Promise.allSettled(
        repositories.map((repository) => this.services.github.openIssues(repository))
      )
      const issues: GitHubIssue[] = []
      const failures: string[] = []
      results.forEach((result, index) => {
        const { fullName } = repositories[index]!
        if (result.status === 'fulfilled') {
          issues.push(...result.value)
        } else {
          // Задачи репозитория, который не прочитался, остаются прежними, а не пропадают.
          console.error(`Failed to sync ${fullName} on the board`, result.reason)
          failures.push(`${fullName}: ${errorMessage(result.reason)}`)
          issues.push(...this.issues.filter(({ repository }) => repository === fullName))
        }
      })
      // Закрытые задачи с карточками дочитываются по id: иначе они пропали бы из колонок.
      const known = new Set(issues.map(({ id }) => id))
      const missing = new Map<string, string[]>()
      for (const [id, card] of this.cards) {
        if (!known.has(id) && !this.isRetired(id)) {
          missing.set(card.account, [...(missing.get(card.account) ?? []), id])
        }
      }
      for (const [account, ids] of missing) {
        issues.push(...(await this.services.github.issuesById(account, ids).catch(() => [])))
      }
      if (this.pruneCards(issues, repositories, failures.length === 0)) {
        this.persist()
      }
      const shown = new Set(repositories.map(({ fullName }) => fullName))
      // Закрытая задача видна, только пока у неё есть карточка.
      this.issues = issues
        .filter(
          ({ id, repository, state }) =>
            shown.has(repository) && (state === 'open' || this.cards.has(id))
        )
        .sort((left, right) => right.updatedAt - left.updatedAt)
      this.syncedAt = Date.now()
      this.error = failures.length > 0 ? failures.join('; ') : null
      this.startQueued()
    } catch (error) {
      console.error('Failed to sync the board', error)
      this.error = errorMessage(error)
    }
  }

  /**
   * Убирает карточки, которые доске больше не нужны: задач из убранных с доски репозиториев,
   * закрытых задач в бэклоге и давно ушедших из Done закрытых задач. Ушедшая из Done открытая
   * задача карточку сохраняет — иначе она вернулась бы в бэклог. `true` — что-то убрано.
   */
  private pruneCards(
    issues: readonly GitHubIssue[],
    repositories: readonly BoardRepository[],
    complete: boolean
  ): boolean {
    const before = this.cards.size
    const shown = new Set(repositories.map(({ fullName }) => fullName))
    const byId = new Map(issues.map((issue) => [issue.id, issue]))
    for (const [id, card] of this.cards) {
      const issue = byId.get(id)
      const removed =
        (issue !== undefined && !shown.has(issue.repository)) ||
        (issue?.state === 'closed' && card.column === 'backlog') ||
        // Открытые задачи читаются только целиком: без ошибок видно, что этой среди них нет.
        (complete && issue === undefined && this.isRetired(id))
      if (removed) {
        this.cards.delete(id)
      }
    }
    return this.cards.size !== before
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
    // Задачи репозиториев, убранных с доски, агентам не уходят.
    const shown = new Set(this.repositories.map(({ fullName }) => fullName))
    const queued = [...this.cards.entries()]
      .filter(([id, card]) => card.column === 'queue' && !this.starting.has(id))
      .sort(([, left], [, right]) => (left.queuedAt ?? 0) - (right.queuedAt ?? 0))
      .flatMap(([id]) => this.issues.filter((issue) => issue.id === id && shown.has(issue.repository)))
    for (const issue of queued.slice(0, Math.max(0, limit - working))) {
      void this.start(issue)
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
      const { agent, model, effort } = card.start?.agent ?? settings.get().boardAgent
      if (!(await this.services.agents.list()).includes(agent)) {
        throw new Error(`${findAgent(agent)?.name ?? agent} is not installed.`)
      }
      // Проект, выбранный в окне запуска, мог исчезнуть, пока задача ждала, — тогда проект по умолчанию.
      const chosen = store.list().find(({ id }) => id === card.start?.projectId)
      const { repository, project, worktree } = await worktrees.exclusive(
        issue.repository,
        async () => {
          // Worktree делается из копии репозитория: выбранный проект подходит, если он и есть копия,
          // иначе — из проекта репозитория или свежего клона. Чат встаёт под выбранный проект.
          let repository = await worktrees.findProject(
            chosen ? [chosen, ...store.list()] : store.list(),
            issue.repository
          )
          if (!repository) {
            const path = await worktrees.clone(issue.repository, token)
            repository = store.addProject(path, store.listSpaces().activeSpaceId)
          }
          const worktree = await worktrees.create(
            repository.path,
            issue.repository,
            issue.number,
            token
          )
          return { repository, project: chosen ?? repository, worktree }
        }
      )
      // Агент уже работал над задачей — он продолжает в своём чате, а не начинает в новом.
      const chatId = card.chatId && store.findChat(card.chatId) ? card.chatId : undefined
      const body = chatId ? '' : await github.issueBody(card.account, issue.id)
      // Пока готовили worktree, задачу могли убрать из очереди — агента тогда не запускают,
      // а worktree задачи, перенесённой в Done, убирают, как и при переносе.
      if (this.cards.get(issue.id) !== card || card.column !== 'queue') {
        if (card.column === 'done') {
          await worktrees
            .remove(repository.path, worktree.path)
            .catch((error) => console.error('Failed to remove the task worktree', error))
        }
        return
      }
      card.column = 'progress'
      card.repositoryPath = repository.path
      delete card.queuedAt
      if (chatId) {
        if (card.start) {
          await conversations.configure(chatId, {
            agent,
            model: model ?? null,
            effort: effort ?? null
          })
          this.services.onProjectsChanged()
        }
        await conversations.send(chatId, card.start?.message ?? CONTINUE_MESSAGE)
        return
      }
      const selection = { ...(model && { model }), ...(effort && { effort }) }
      const chat = store.createTaskChat(project.id, agent, selection, {
        title: `#${issue.number} ${issue.title}`,
        worktree: worktree.path,
        githubAccount: card.account
      })
      card.chatId = chat.id
      this.services.onProjectsChanged()
      await conversations.send(
        chat.id,
        formatIssueTask(issue, body, worktree, card.start?.message),
        {},
        // Чат назван по задаче, а не по служебному началу задания.
        { titleFrom: issue.title }
      )
    } catch (error) {
      console.error(`Failed to start an agent for ${issue.repository}#${issue.number}`, error)
      // Задача возвращается в бэклог с причиной: оставшись в очереди, она пробовала бы снова
      // и снова. Задачу, которую тем временем перенесли, не трогают.
      if (card.column === 'queue' || card.column === 'progress') {
        card.column = 'backlog'
        card.error = errorMessage(error)
        delete card.queuedAt
      }
    } finally {
      this.starting.delete(issue.id)
      this.persist()
      this.changed()
      // Место, которое заняла подготовка, освободилось, если агента так и не запустили.
      this.startQueued()
    }
  }

  /** Агент закончил ход: штатно — задача уходит на проверку, с ошибкой — в бэклог с причиной. */
  private async finishTurn(card: Card, chatId: string): Promise<void> {
    const { conversations } = this.services
    const error = turnError(await conversations.snapshot(chatId).catch(() => null))
    // Пока читали ленту, задачу могли перенести, а агент — взяться за следующее сообщение.
    if (card.column !== 'progress' || card.chatId !== chatId || conversations.isRunning(chatId)) {
      return
    }
    if (error) {
      card.column = 'backlog'
      card.error = error
    } else {
      card.column = 'review'
    }
    this.persist()
    this.changed()
    this.startQueued()
  }

  /** Задача давно в Done и с доски ушла. */
  private isRetired(issueId: string): boolean {
    const card = this.cards.get(issueId)
    return card?.column === 'done' && Date.now() - (card.doneAt ?? 0) > DONE_VISIBLE_MS
  }

  /**
   * Задача закрыта — её агент больше не нужен: он останавливается, а его чат и worktree
   * удаляются. Работа агента уже в ветке и pull request'е на GitHub.
   */
  private async retireAgent(card: Card): Promise<void> {
    const chatId = card.chatId
    delete card.chatId
    this.persist()
    if (!chatId) {
      return
    }
    const { store, conversations, worktrees } = this.services
    const location = store.findChat(chatId)
    store.removeChat(chatId)
    await conversations.remove(chatId)
    this.services.onProjectsChanged()
    if (location?.chat.worktree) {
      await worktrees
        .remove(card.repositoryPath ?? location.project.path, location.chat.worktree)
        .catch((error) => console.error('Failed to remove the task worktree', error))
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
      // Пока агента готовят, задача уже не ждёт в очереди — если её оттуда не убрали.
      column:
        this.starting.has(issue.id) && card?.column === 'queue'
          ? 'progress'
          : (card?.column ?? 'backlog'),
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

/** Чем закончился последний ход агента, если ошибкой: лимит, падение агента. */
function turnError(snapshot: ConversationSnapshot | null): string | null {
  const items = snapshot?.items ?? []
  const answer = items.slice(items.findLastIndex(({ kind }) => kind === 'user') + 1)
  const ending = answer.findLast(({ kind }) => kind === 'assistant' || kind === 'error')
  return ending?.kind === 'error' ? ending.message : null
}

function isBoardRepository(value: unknown): value is BoardRepository {
  const { fullName, account } = (value ?? {}) as Partial<BoardRepository>
  return typeof fullName === 'string' && fullName.includes('/') && typeof account === 'string'
}
