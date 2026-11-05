import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { findAgent, type AgentId } from '../../shared/agents'
import type { MessageAttachments } from '../../shared/attachments'
import {
  applyConversationEvent,
  pendingRequest,
  summarizeConversation,
  titleFromMessage,
  type AgentCatalog,
  type AgentCommand,
  type ChatCommand,
  type ChatConfiguration,
  type ConversationEvent,
  type ConversationSnapshot,
  type ConversationSummary,
  type RequestAnswer,
  type StreamedField,
  type TimelineItem
} from '../../shared/conversation'
import type {
  IntegrationItems,
  IntegrationKind,
  IntegrationList
} from '../../shared/integrations'
import type { AgentDetector } from '../agents'
import type { ProjectStore } from '../store'
import { errorMessage } from './display'
import { handoffMessage } from './handoff'
import type { TranscriptStore } from './transcripts'
import type { AgentDriver, AgentLaunch, AgentSession } from './types'

/**
 * Как часто сохранять ленту, пока агент пишет ответ: если Atox закроют посреди долгого хода,
 * пропадут лишь последние секунды.
 */
const PERSIST_DELAY_MS = 2000

/**
 * Как часто отправлять окну накопленный текст ответа. Агент присылает его по слову, и
 * событие на каждое слово заставляло бы окно перерисовываться сотни раз в секунду.
 */
const STREAM_FLUSH_MS = 50

/** Каким вопросом к драйверу узнаётся каждый список на странице настроек. */
const INTEGRATION_READERS: {
  [Kind in IntegrationKind]: (
    driver: AgentDriver,
    launch: AgentLaunch
  ) => Promise<IntegrationItems[Kind]>
} = {
  plugins: (driver, launch) => driver.plugins(launch),
  skills: (driver, launch) => driver.skills(launch),
  mcp: (driver, launch) => driver.mcpServers(launch)
}

type EventPayload = ConversationEvent extends infer Event
  ? Event extends ConversationEvent
    ? Omit<Event, 'chatId'>
    : never
  : never

interface QueuedMessage {
  itemId: string
  text: string
  images: readonly string[]
  /** Агент чата в момент отправки: его потом не меняет переключение, пока сообщение в очереди. */
  agent: AgentId
}

interface PendingDelta {
  itemId: string
  field: StreamedField
  delta: string
}

interface Conversation {
  snapshot: ConversationSnapshot
  session: AgentSession | null
  /**
   * Разговор на стороне агента (сессия Claude, тред Codex): по нему сессия, перезапущенная
   * ради новой модели или после перезапуска Atox, продолжает тот же разговор.
   */
  sessionId: string | null
  /** Агент, с которым идёт разговор на его стороне; `null` — разговор ещё не начинался. */
  sessionAgent: AgentId | null
  /** Агент последнего отправленного сообщения: по нему видно, что следующее уходит другому. */
  lastAgent: AgentId | null
  /**
   * Чат перешёл к другому агенту: он ничего не знает о разговоре, и с первым сообщением
   * получит переписку прежнего агента — этого.
   */
  handoffFrom: AgentId | null
  /** Чат удалён или приложение закрывается: новых сессий для него не запускают. */
  disposed: boolean
  /** Модель или эффорт сменились: сессию нужно перезапустить, как только агент освободится. */
  stale: boolean
  /** Сообщения, которые агент ещё не начал обрабатывать. */
  queue: QueuedMessage[]
  /** Сообщение, над которым агент работает сейчас. */
  turn: QueuedMessage | null
  /** Сообщение, которое остановили, пока агент ещё запускался: отправлять его не нужно. */
  interruptedTurn: QueuedMessage | null
  /** Текст ответа, который ещё не отправлен окну, по элементу и полю. */
  pendingDeltas: Map<string, PendingDelta>
  /** Последний счётчик токенов хода, который ещё не отправлен окну. */
  pendingTokens: number | null
  streamTimer: ReturnType<typeof setTimeout> | null
  persistTimer: ReturnType<typeof setTimeout> | null
}

export interface ConversationServices {
  store: ProjectStore
  agents: AgentDetector
  drivers: Record<AgentId, AgentDriver>
  transcripts: TranscriptStore
  /** Окружение процесса агента; с `chatId` — с переменными для команды `atox` этого чата. */
  environment(chatId?: string): Promise<Record<string, string>>
  onEvent(event: ConversationEvent): void
  /** Список чатов изменился без участия окна — например, чат получил название. */
  onProjectsChanged(): void
}

/**
 * Разговоры в чатах: лента каждого чата, сессия с его агентом и очередь сообщений.
 * Агент получает сообщения по одному — следующее, когда закончит отвечать на предыдущее.
 * Лента и разговор на стороне агента сохраняются: после перезапуска Atox чат продолжается.
 */
export class ConversationManager {
  private readonly conversations = new Map<string, Promise<Conversation>>()
  /** Разговоры, которые уже загружены: по ним считается, кто сейчас работает. */
  private readonly loaded = new Map<string, Conversation>()
  private readonly catalogs = new Map<AgentId, Promise<AgentCatalog>>()
  /** Команды по агенту и папке проекта: у проектов бывают свои команды и навыки. */
  private readonly commandLists = new Map<string, Promise<AgentCommand[]>>()
  /** Приложение закрывается: агенты больше не запускаются. */
  private closing = false

  constructor(private readonly services: ConversationServices) {}

  async snapshot(chatId: string): Promise<ConversationSnapshot> {
    return (await this.conversation(chatId)).snapshot
  }

  async send(
    chatId: string,
    text: string,
    { images = [], files = [] }: MessageAttachments = {}
  ): Promise<void> {
    const message = text.trim()
    if (!message && images.length === 0 && files.length === 0) {
      return
    }
    const conversation = await this.conversation(chatId)
    const { agent } = this.findChat(chatId).chat
    const isFirst = !conversation.snapshot.items.some(({ kind }) => kind === 'user')
    if (conversation.lastAgent && conversation.lastAgent !== agent) {
      this.emit(chatId, conversation, {
        type: 'item',
        item: { kind: 'agent-switch', id: randomUUID(), agent }
      })
    }
    conversation.lastAgent = agent
    const item: TimelineItem = {
      kind: 'user',
      id: randomUUID(),
      text: message,
      ...(images.length > 0 && { images: [...images] }),
      ...(files.length > 0 && { files: [...files] }),
      agent,
      createdAt: Date.now()
    }
    this.emit(chatId, conversation, { type: 'item', item })
    if (
      isFirst &&
      message &&
      this.services.store.applyAutomaticTitle(chatId, titleFromMessage(message))
    ) {
      this.services.onProjectsChanged()
    }
    conversation.queue.push({
      itemId: item.id,
      text: withAttachedFiles(message, files),
      images,
      agent
    })
    this.pump(chatId, conversation)
  }

  /** Останавливает текущий ответ агента; сообщения, ждавшие очереди, тоже отменяются. */
  async interrupt(chatId: string): Promise<void> {
    const conversation = await this.conversation(chatId)
    conversation.queue = []
    if (conversation.turn) {
      // Пока агент запускается, сессии ещё нет: сообщение просто не уйдёт ему.
      conversation.interruptedTurn = conversation.turn
      conversation.session?.interrupt()
    }
    this.updateRunning(chatId, conversation)
  }

  /**
   * Команда, которую Atox выполняет сам: `/usage` и `/context` показывают карточку в ленте,
   * `/clear` начинает разговор заново.
   */
  async runCommand(chatId: string, command: ChatCommand): Promise<void> {
    const conversation = await this.conversation(chatId)
    if (command === 'clear') {
      this.clear(chatId, conversation)
      return
    }
    const id = randomUUID()
    let item: TimelineItem
    try {
      item =
        command === 'usage'
          ? {
              kind: 'limits',
              id,
              limits: await this.readLimits(chatId, conversation)
            }
          : {
              kind: 'context',
              id,
              context: await this.readContext(chatId, conversation)
            }
    } catch (error) {
      const subject = command === 'usage' ? 'usage limits' : 'context usage'
      item = {
        kind: 'error',
        id,
        message: `Could not read ${subject}. ${errorMessage(error)}`
      }
    }
    if (conversation.disposed) {
      return
    }
    this.emit(chatId, conversation, { type: 'item', item })
    if (item.kind === 'context') {
      const { used, limit } = item.context
      this.emit(chatId, conversation, {
        type: 'usage',
        usage: { context: { used, limit } }
      })
    }
  }

  /** Ответ пользователя на разрешение, вопросы или форму от агента чата. */
  async answerRequest(chatId: string, itemId: string, answer: RequestAnswer): Promise<void> {
    const conversation = await this.conversation(chatId)
    conversation.session?.answer(itemId, answer)
  }

  /**
   * Меняет агента, модель или эффорт чата; всё это вступает в силу со следующего сообщения,
   * а начатый ответ доводит до конца прежний агент. Агента можно сменить и посреди разговора:
   * новый получит переписку и продолжит её.
   */
  async configure(chatId: string, configuration: ChatConfiguration): Promise<void> {
    const conversation = await this.conversation(chatId)
    if (this.services.store.configureChat(chatId, configuration) && conversation.session) {
      conversation.stale = true
      this.restartIfIdle(conversation)
    }
  }

  /** Сводки всех разговоров, в которых пользователь уже что-то писал. */
  summaries(): ConversationSummary[] {
    return [...this.loaded.entries()].flatMap(([chatId, { snapshot }]) => {
      const summary = summarizeConversation(chatId, snapshot)
      return summary ? [summary] : []
    })
  }

  isRunning(chatId: string): boolean {
    return this.runningChatIds().includes(chatId)
  }

  /** Чаты, в которых агент работает или ждёт очереди: о них спрашивают перед выходом. */
  runningChatIds(): string[] {
    return [...this.loaded.entries()]
      .filter(([, conversation]) => conversation.turn !== null || conversation.queue.length > 0)
      .map(([chatId]) => chatId)
  }

  /**
   * Чат убран с глаз (в архив): агент останавливается, лента дописывается на диск и уходит
   * из памяти. Когда чат откроют снова, разговор загрузится из файла.
   */
  async close(chatId: string): Promise<void> {
    const conversation = await this.conversations.get(chatId)?.catch(() => null)
    if (conversation && this.loaded.get(chatId) === conversation) {
      this.flushStream(chatId, conversation)
      this.dispose(conversation)
      this.persist(chatId, conversation, { immediately: true })
    }
    this.conversations.delete(chatId)
    this.loaded.delete(chatId)
    await this.services.transcripts.close(chatId)
  }

  /** Чат удалён: агент останавливается, лента стирается. */
  async remove(chatId: string): Promise<void> {
    const conversation = await this.conversations.get(chatId)?.catch(() => null)
    this.conversations.delete(chatId)
    this.loaded.delete(chatId)
    if (conversation) {
      this.dispose(conversation)
      if (conversation.persistTimer) {
        clearTimeout(conversation.persistTimer)
      }
    }
    await this.services.transcripts.remove(chatId)
  }

  closeAll(): void {
    this.closing = true
    for (const [chatId, conversation] of this.loaded) {
      this.flushStream(chatId, conversation)
      this.dispose(conversation)
    }
  }

  /** Записывает отложенные изменения лент и дожидается записи — перед выходом из приложения. */
  flush(): Promise<void> {
    for (const [chatId, conversation] of this.loaded) {
      this.flushStream(chatId, conversation)
      if (conversation.persistTimer) {
        this.persist(chatId, conversation, { immediately: true })
      }
    }
    return this.services.transcripts.flush()
  }

  /** Команды агента чата для подсказок после «/»; пустой список — агент их не сообщил. */
  async commands(chatId: string): Promise<AgentCommand[]> {
    const location = this.services.store.findChat(chatId)
    if (!location) {
      return []
    }
    const { chat, project } = location
    const key = `${chat.agent}\0${project.path}`
    let commands = this.commandLists.get(key)
    if (!commands) {
      commands = this.launch(chat.agent, project.path).then((launch) =>
        this.services.drivers[chat.agent].commands(launch)
      )
      this.commandLists.set(key, commands)
      commands.catch(() => this.commandLists.delete(key))
    }
    return commands.catch((error) => {
      console.error(`Failed to list ${chat.agent} commands`, error)
      return []
    })
  }

  /** Модели агента; `null` — агент не установлен или не ответил. */
  async catalog(agent: AgentId): Promise<AgentCatalog | null> {
    let catalog = this.catalogs.get(agent)
    if (!catalog) {
      catalog = this.loadCatalog(agent)
      this.catalogs.set(agent, catalog)
      // Неудачный запрос не запоминается: агента могли установить или войти в него позже.
      catalog.catch(() => this.catalogs.delete(agent))
    }
    return catalog.catch((error) => {
      console.error(`Failed to list ${agent} models`, error)
      return null
    })
  }

  /**
   * Плагины, скиллы или серверы MCP агента. Агента спрашивают в папке проекта, чтобы в ответ
   * попали и настройки проекта; без проекта — в домашней папке.
   */
  async integrations<Kind extends IntegrationKind>(
    agent: AgentId,
    kind: Kind,
    projectId: string | null
  ): Promise<IntegrationList<Kind>> {
    const executable = await this.services.agents.executable(agent)
    if (!executable) {
      return { status: 'not-installed' }
    }
    const projectPath = projectId ? this.services.store.findProject(projectId)?.path : undefined
    const cwd = projectPath && existsSync(projectPath) ? projectPath : homedir()
    const read: (typeof INTEGRATION_READERS)[Kind] = INTEGRATION_READERS[kind]
    try {
      const launch = { executable, cwd, env: await this.services.environment() }
      return { status: 'ok', items: await read(this.services.drivers[agent], launch) }
    } catch (error) {
      console.error(`Failed to list ${agent} ${kind}`, error)
      return { status: 'failed', message: errorMessage(error) }
    }
  }

  /** Без запущенной сессии лимиты и контекст читает отдельный процесс агента. */
  private async readLimits(chatId: string, conversation: Conversation) {
    if (conversation.session) {
      return conversation.session.limits()
    }
    const { chat, project } = this.findChat(chatId)
    return this.services.drivers[chat.agent].limits(await this.launch(chat.agent, project.path))
  }

  private async readContext(chatId: string, conversation: Conversation) {
    if (conversation.session) {
      return conversation.session.context()
    }
    const { chat, project } = this.findChat(chatId)
    const launch = await this.launch(chat.agent, project.path)
    return this.services.drivers[chat.agent].context(launch, conversation.sessionId ?? undefined)
  }

  /** Останавливает агента и забывает разговор: следующее сообщение начнёт новый. */
  private clear(chatId: string, conversation: Conversation): void {
    conversation.queue = []
    conversation.turn = null
    conversation.interruptedTurn = null
    conversation.session?.close()
    conversation.session = null
    conversation.sessionId = null
    conversation.sessionAgent = null
    conversation.lastAgent = null
    conversation.handoffFrom = null
    conversation.stale = false
    conversation.pendingDeltas.clear()
    conversation.pendingTokens = null
    this.emit(chatId, conversation, { type: 'reset' })
    this.updateRunning(chatId, conversation)
    this.persist(chatId, conversation, { immediately: true })
  }

  private findChat(chatId: string) {
    const location = this.services.store.findChat(chatId)
    if (!location) {
      throw new Error('The chat was deleted.')
    }
    return location
  }

  private conversation(chatId: string): Promise<Conversation> {
    let conversation = this.conversations.get(chatId)
    if (!conversation) {
      if (!this.services.store.findChat(chatId)) {
        return Promise.reject(new Error(`Chat ${chatId} not found`))
      }
      conversation = this.services.transcripts
        .load(chatId)
        .then(({ items, sessionId, sessionAgent, lastAgent }) => {
          const loaded: Conversation = {
            snapshot: { items, running: false },
            session: null,
            sessionId,
            sessionAgent,
            lastAgent,
            handoffFrom: null,
            disposed: false,
            stale: false,
            queue: [],
            turn: null,
            interruptedTurn: null,
            pendingDeltas: new Map(),
            pendingTokens: null,
            streamTimer: null,
            persistTimer: null
          }
          this.loaded.set(chatId, loaded)
          return loaded
        })
      this.conversations.set(chatId, conversation)
      conversation.catch(() => this.conversations.delete(chatId))
    }
    return conversation
  }

  /** Отдаёт агенту следующее сообщение из очереди, если он свободен. */
  private pump(chatId: string, conversation: Conversation): void {
    const next = conversation.turn ? undefined : conversation.queue.shift()
    if (next) {
      conversation.turn = next
      this.emit(chatId, conversation, { type: 'tokens', turnTokens: 0 })
    }
    this.updateRunning(chatId, conversation)
    if (!next) {
      return
    }
    this.ensureSession(chatId, conversation, next.agent)
      .then((session) => {
        if (conversation.interruptedTurn === next) {
          this.finishTurn(chatId, conversation)
          return
        }
        session.send(this.messageForAgent(conversation, next), next.images)
      })
      .catch((error) => {
        if (conversation.disposed) {
          return
        }
        this.emit(chatId, conversation, {
          type: 'item',
          item: {
            kind: 'error',
            id: randomUUID(),
            message: errorMessage(error)
          }
        })
        this.finishTurn(chatId, conversation)
      })
  }

  /**
   * Текст сообщения для агента; первое после смены агента или потери прежнего разговора
   * несёт с собой переписку.
   */
  private messageForAgent(conversation: Conversation, message: QueuedMessage): string {
    const previousAgent = conversation.handoffFrom
    if (!previousAgent) {
      return message.text
    }
    conversation.handoffFrom = null
    const { items } = conversation.snapshot
    const index = items.findIndex(({ id }) => id === message.itemId)
    const history = index < 0 ? items : items.slice(0, index)
    return handoffMessage(previousAgent, message.agent, history, message.text)
  }

  private finishTurn(chatId: string, conversation: Conversation): void {
    const turn = conversation.turn
    if (!turn) {
      return
    }
    conversation.turn = null
    conversation.interruptedTurn = null
    const item = conversation.snapshot.items.find(({ id }) => id === turn.itemId)
    if (item?.kind === 'user') {
      this.emit(chatId, conversation, {
        type: 'item',
        item: { ...item, finishedAt: Date.now() }
      })
    }
    this.persist(chatId, conversation, { immediately: true })
    this.restartIfIdle(conversation)
    this.pump(chatId, conversation)
  }

  /** Закрывает сессию со старыми настройками, если агент сейчас ничего не делает. */
  private restartIfIdle(conversation: Conversation): void {
    if (conversation.stale && !conversation.turn) {
      conversation.session?.close()
      conversation.session = null
      conversation.stale = false
    }
  }

  /** Сессия с агентом, которому ушло сообщение; сессию прежнего агента закрывает. */
  private async ensureSession(
    chatId: string,
    conversation: Conversation,
    agent: AgentId
  ): Promise<AgentSession> {
    if (conversation.session && conversation.sessionAgent === agent) {
      return conversation.session
    }
    // Сессия с другим агентом свободна: сообщения отдаются по одному, и прежнее уже отвечено.
    conversation.session?.close()
    conversation.session = null
    conversation.stale = false
    const { project } = this.findChat(chatId)
    // Разговор шёл с другим агентом: его сессию новый продолжить не может — начинает свою
    // и получает прежнюю переписку с первым сообщением.
    if (conversation.sessionAgent && conversation.sessionAgent !== agent) {
      conversation.handoffFrom = conversation.sessionAgent
      conversation.sessionId = null
    }
    conversation.sessionAgent = agent
    const launch = await this.launch(agent, project.path, chatId)
    // Чат удалили или приложение закрывается, пока агент запускался: запускать его уже незачем.
    if (conversation.disposed || this.closing) {
      throw new Error('The chat was closed.')
    }
    // Модель и эффорт берутся последние: их могли сменить, пока агент запускался.
    const { chat } = this.findChat(chatId)
    const sameAgent = chat.agent === agent
    const driver = this.services.drivers[agent]
    // Разговор, который сессия должна продолжить. Если агент его потерял, Codex сообщает
    // другой, только что начатый, а Claude заканчивает работу, так и не начав разговор.
    const resumedId = conversation.sessionId
    let started = false
    /** Сессия не смогла продолжить разговор, и её сменила новая: её события больше не нужны. */
    let abandoned = false
    const resumeFailed = () => {
      // Остановленное сообщение ничего не говорит о разговоре: его проверит следующее.
      const turn = conversation.turn
      if (resumedId === null || started || !turn || conversation.interruptedTurn === turn) {
        return false
      }
      abandoned = true
      this.restartWithHistory(chatId, conversation)
      return true
    }
    const session: AgentSession = driver.start(
      {
        ...launch,
        ...(resumedId && { sessionId: resumedId }),
        selection: {
          ...(sameAgent && chat.model && { model: chat.model }),
          ...(sameAgent && chat.effort && { effort: chat.effort })
        }
      },
      {
        item: (item) => {
          if (!abandoned) {
            this.emit(chatId, conversation, { type: 'item', item })
          }
        },
        delta: (itemId, field, delta) => {
          if (!abandoned) {
            this.emit(chatId, conversation, {
              type: 'delta',
              itemId,
              field,
              delta
            })
          }
        },
        turnFinished: () => {
          if (conversation.session === session && !resumeFailed()) {
            this.finishTurn(chatId, conversation)
          }
        },
        usage: (usage) => this.emit(chatId, conversation, { type: 'usage', usage }),
        tokens: (turnTokens) => this.emit(chatId, conversation, { type: 'tokens', turnTokens }),
        sessionStarted: (sessionId) => {
          // Сессия, которую уже сменил другой агент, свой разговор не навязывает.
          if (conversation.session !== session) {
            return
          }
          if (resumedId !== null && sessionId !== resumedId && resumeFailed()) {
            return
          }
          started = true
          if (conversation.sessionId !== sessionId) {
            conversation.sessionId = sessionId
            this.persist(chatId, conversation, { immediately: true })
          }
        },
        closed: () => {
          if (conversation.session === session && !resumeFailed()) {
            conversation.session = null
            this.finishTurn(chatId, conversation)
          }
        }
      }
    )
    conversation.session = session
    return session
  }

  /**
   * Агент не смог продолжить сохранённый разговор — например, его файлы удалили. Чат от этого
   * не ломается: сообщение уходит новой сессии вместе с прежней перепиской.
   */
  private restartWithHistory(chatId: string, conversation: Conversation): void {
    conversation.session?.close()
    conversation.session = null
    conversation.stale = false
    conversation.sessionId = null
    conversation.handoffFrom = conversation.sessionAgent
    if (conversation.turn) {
      conversation.queue.unshift(conversation.turn)
      conversation.turn = null
    }
    this.persist(chatId, conversation, { immediately: true })
    this.pump(chatId, conversation)
  }

  private async launch(agent: AgentId, cwd: string, chatId?: string): Promise<AgentLaunch> {
    if (!existsSync(cwd)) {
      throw new Error(`The project folder was not found: ${cwd}`)
    }
    const executable = await this.services.agents.executable(agent)
    if (!executable) {
      const name = findAgent(agent)?.name ?? agent
      throw new Error(
        `${name} is not installed. Install the ${name} CLI, sign in, and send the message again.`
      )
    }
    return { executable, cwd, env: await this.services.environment(chatId) }
  }

  private async loadCatalog(agent: AgentId): Promise<AgentCatalog> {
    return this.services.drivers[agent].catalog(await this.launch(agent, homedir()))
  }

  /** Останавливает агента чата и больше не даёт запустить его снова. */
  private dispose(conversation: Conversation): void {
    conversation.disposed = true
    if (conversation.streamTimer) {
      clearTimeout(conversation.streamTimer)
      conversation.streamTimer = null
    }
    conversation.session?.close()
    conversation.session = null
  }

  /**
   * Текст ответа и счётчик токенов копятся и уходят окну пачкой; остальные события сначала
   * отправляют накопленное, чтобы окно получало всё в том же порядке.
   */
  private emit(chatId: string, conversation: Conversation, payload: EventPayload): void {
    if (payload.type === 'delta') {
      const key = `${payload.itemId}\0${payload.field}`
      const pending = conversation.pendingDeltas.get(key)
      if (pending) {
        pending.delta += payload.delta
      } else {
        conversation.pendingDeltas.set(key, { ...payload })
      }
      this.scheduleStreamFlush(chatId, conversation)
      return
    }
    if (payload.type === 'tokens') {
      conversation.pendingTokens = payload.turnTokens
      this.scheduleStreamFlush(chatId, conversation)
      return
    }
    this.flushStream(chatId, conversation)
    this.dispatch(chatId, conversation, payload)
  }

  private scheduleStreamFlush(chatId: string, conversation: Conversation): void {
    conversation.streamTimer ??= setTimeout(
      () => this.flushStream(chatId, conversation),
      STREAM_FLUSH_MS
    )
  }

  private flushStream(chatId: string, conversation: Conversation): void {
    if (conversation.streamTimer) {
      clearTimeout(conversation.streamTimer)
      conversation.streamTimer = null
    }
    const deltas = [...conversation.pendingDeltas.values()]
    conversation.pendingDeltas.clear()
    for (const { itemId, field, delta } of deltas) {
      this.dispatch(chatId, conversation, {
        type: 'delta',
        itemId,
        field,
        delta
      })
    }
    if (conversation.pendingTokens !== null) {
      const turnTokens = conversation.pendingTokens
      conversation.pendingTokens = null
      this.dispatch(chatId, conversation, { type: 'tokens', turnTokens })
    }
  }

  /** Применяет событие к ленте чата и отправляет его окну. */
  private dispatch(chatId: string, conversation: Conversation, payload: EventPayload): void {
    const event = { chatId, ...payload } as ConversationEvent
    conversation.snapshot = applyConversationEvent(conversation.snapshot, event)
    this.services.onEvent(event)
    if (event.type === 'item' || event.type === 'reset') {
      this.updateWaiting(chatId, conversation)
    }
    // Сохраняется лента, а состояние работы и заполненность контекста агент сообщит заново.
    if (event.type === 'item' || event.type === 'delta' || event.type === 'reset') {
      this.persist(chatId, conversation)
    }
  }

  /** Сообщает, когда агент начинает или перестаёт ждать ответа пользователя. */
  private updateWaiting(chatId: string, conversation: Conversation): void {
    const waitingFor = pendingRequest(conversation.snapshot.items)
    if ((conversation.snapshot.waitingFor ?? null) !== waitingFor) {
      this.dispatch(chatId, conversation, { type: 'waiting', waitingFor })
    }
  }

  private updateRunning(chatId: string, conversation: Conversation): void {
    const running = conversation.turn !== null || conversation.queue.length > 0
    if (conversation.snapshot.running !== running) {
      this.emit(chatId, conversation, { type: 'running', running })
    }
  }

  /** Сохраняет ленту и разговор на стороне агента — сразу или через `PERSIST_DELAY_MS`. */
  private persist(
    chatId: string,
    conversation: Conversation,
    { immediately = false }: { immediately?: boolean } = {}
  ): void {
    if (conversation.persistTimer) {
      if (!immediately) {
        return
      }
      clearTimeout(conversation.persistTimer)
    }
    const save = () => {
      conversation.persistTimer = null
      // Чат могли удалить или закрыть, пока ждали записи.
      if (this.loaded.get(chatId) === conversation) {
        this.services.transcripts.save(chatId, {
          items: conversation.snapshot.items,
          sessionId: conversation.sessionId,
          sessionAgent: conversation.sessionAgent,
          lastAgent: conversation.lastAgent
        })
      }
    }
    if (immediately) {
      save()
    } else {
      conversation.persistTimer = setTimeout(save, PERSIST_DELAY_MS)
    }
  }
}

/** Пути приложенных файлов агент получает в конце сообщения и открывает их сам. */
function withAttachedFiles(text: string, files: readonly string[]): string {
  if (files.length === 0) {
    return text
  }
  const list = files.map((path) => `- ${path}`).join('\n')
  return [text, `Attached files:\n${list}`].filter(Boolean).join('\n\n')
}
