import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { findAgent, type AgentId } from '../../shared/agents'
import {
  applyConversationEvent,
  titleFromMessage,
  type AgentCatalog,
  type AgentCommand,
  type ChatCommand,
  type ChatConfiguration,
  type ConversationEvent,
  type ConversationSnapshot,
  type RequestAnswer,
  type StreamedField,
  type TimelineItem
} from '../../shared/conversation'
import type { AgentDetector } from '../agents'
import type { ProjectStore } from '../store'
import { errorMessage } from './display'
import type { AgentDriver, AgentLaunch, AgentSession } from './types'

/**
 * Как часто отправлять окну накопленный текст ответа. Агент присылает его по слову, и
 * событие на каждое слово заставляло бы окно перерисовываться сотни раз в секунду.
 */
const STREAM_FLUSH_MS = 50

type EventPayload = ConversationEvent extends infer Event
  ? Event extends ConversationEvent
    ? Omit<Event, 'chatId'>
    : never
  : never

interface QueuedMessage {
  itemId: string
  text: string
  images: readonly string[]
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
   * Разговор на стороне агента (сессия Claude): по нему сессия, перезапущенная
   * ради новой модели, продолжает тот же разговор. Живёт до выхода из Atox.
   */
  sessionId: string | null
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
}

export interface ConversationServices {
  store: ProjectStore
  agents: AgentDetector
  drivers: Record<AgentId, AgentDriver>
  /** Окружение процесса агента; с `chatId` — с переменными для команды `atox` этого чата. */
  environment(chatId?: string): Promise<Record<string, string>>
  onEvent(event: ConversationEvent): void
  /** Список чатов изменился без участия окна — например, чат получил название. */
  onProjectsChanged(): void
}

/**
 * Разговоры в чатах: лента каждого чата, сессия с его агентом и очередь сообщений.
 * Агент получает сообщения по одному — следующее, когда закончит отвечать на предыдущее.
 * Разговоры живут, пока открыт Atox: после перезапуска каждый чат начинается заново,
 * как терминал.
 */
export class ConversationManager {
  private readonly conversations = new Map<string, Conversation>()
  private readonly catalogs = new Map<AgentId, Promise<AgentCatalog>>()
  /** Команды по агенту и папке проекта: у проектов бывают свои команды и навыки. */
  private readonly commandLists = new Map<string, Promise<AgentCommand[]>>()
  /** Приложение закрывается: агенты больше не запускаются. */
  private closing = false

  constructor(private readonly services: ConversationServices) {}

  async snapshot(chatId: string): Promise<ConversationSnapshot> {
    return this.conversation(chatId).snapshot
  }

  async send(chatId: string, text: string, images: readonly string[] = []): Promise<void> {
    const message = text.trim()
    if (!message && images.length === 0) {
      return
    }
    const conversation = this.conversation(chatId)
    const isFirst = !conversation.snapshot.items.some(({ kind }) => kind === 'user')
    const item: TimelineItem = {
      kind: 'user',
      id: randomUUID(),
      text: message,
      ...(images.length > 0 && { images: [...images] }),
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
    conversation.queue.push({ itemId: item.id, text: message, images })
    this.pump(chatId, conversation)
  }

  /** Останавливает текущий ответ агента; сообщения, ждавшие очереди, тоже отменяются. */
  async interrupt(chatId: string): Promise<void> {
    const conversation = this.conversation(chatId)
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
    const conversation = this.conversation(chatId)
    if (command === 'clear') {
      this.clear(chatId, conversation)
      return
    }
    const id = randomUUID()
    let item: TimelineItem
    try {
      item =
        command === 'usage'
          ? { kind: 'limits', id, limits: await this.readLimits(chatId, conversation) }
          : { kind: 'context', id, context: await this.readContext(chatId, conversation) }
    } catch (error) {
      const subject = command === 'usage' ? 'usage limits' : 'context usage'
      item = { kind: 'error', id, message: `Could not read ${subject}. ${errorMessage(error)}` }
    }
    if (conversation.disposed) {
      return
    }
    this.emit(chatId, conversation, { type: 'item', item })
    if (item.kind === 'context') {
      const { used, limit } = item.context
      this.emit(chatId, conversation, { type: 'usage', usage: { context: { used, limit } } })
    }
  }

  /** Ответ пользователя на разрешение, вопросы или форму от агента чата. */
  async answerRequest(chatId: string, itemId: string, answer: RequestAnswer): Promise<void> {
    this.conversation(chatId).session?.answer(itemId, answer)
  }

  /** Меняет агента, модель или эффорт чата; новая модель вступает в силу со следующего сообщения. */
  async configure(chatId: string, configuration: ChatConfiguration): Promise<void> {
    const conversation = this.conversation(chatId)
    const started = conversation.snapshot.items.some(({ kind }) => kind === 'user')
    const changed = this.services.store.configureChat(chatId, configuration, started)
    if (changed && conversation.session) {
      conversation.stale = true
      this.restartIfIdle(conversation)
    }
  }

  isRunning(chatId: string): boolean {
    return this.runningChatIds().includes(chatId)
  }

  /** Чаты, в которых агент работает или ждёт очереди: о них спрашивают перед выходом. */
  runningChatIds(): string[] {
    return [...this.conversations.entries()]
      .filter(([, conversation]) => conversation.turn !== null || conversation.queue.length > 0)
      .map(([chatId]) => chatId)
  }

  /** Чат удалён: агент останавливается, лента стирается. */
  async remove(chatId: string): Promise<void> {
    const conversation = this.conversations.get(chatId)
    this.conversations.delete(chatId)
    if (conversation) {
      this.dispose(conversation)
    }
  }

  closeAll(): void {
    this.closing = true
    for (const conversation of this.conversations.values()) {
      this.dispose(conversation)
    }
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
    conversation.stale = false
    conversation.pendingDeltas.clear()
    conversation.pendingTokens = null
    this.emit(chatId, conversation, { type: 'reset' })
    this.updateRunning(chatId, conversation)
  }

  private findChat(chatId: string) {
    const location = this.services.store.findChat(chatId)
    if (!location) {
      throw new Error('The chat was deleted.')
    }
    return location
  }

  private conversation(chatId: string): Conversation {
    let conversation = this.conversations.get(chatId)
    if (!conversation) {
      if (!this.services.store.findChat(chatId)) {
        throw new Error(`Chat ${chatId} not found`)
      }
      conversation = {
        snapshot: { items: [], running: false },
        session: null,
        sessionId: null,
        disposed: false,
        stale: false,
        queue: [],
        turn: null,
        interruptedTurn: null,
        pendingDeltas: new Map(),
        pendingTokens: null,
        streamTimer: null
      }
      this.conversations.set(chatId, conversation)
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
    this.ensureSession(chatId, conversation)
      .then((session) => {
        if (conversation.interruptedTurn === next) {
          this.finishTurn(chatId, conversation)
        } else {
          session.send(next.text, next.images)
        }
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

  private async ensureSession(chatId: string, conversation: Conversation): Promise<AgentSession> {
    if (conversation.session) {
      return conversation.session
    }
    const location = this.services.store.findChat(chatId)
    if (!location) {
      throw new Error('The chat was deleted.')
    }
    const { chat, project } = location
    const launch = await this.launch(chat.agent, project.path, chatId)
    // Чат удалили или приложение закрывается, пока агент запускался: запускать его уже незачем.
    if (conversation.disposed || this.closing) {
      throw new Error('The chat was closed.')
    }
    const driver = this.services.drivers[chat.agent]
    const session: AgentSession = driver.start(
      {
        ...launch,
        ...(conversation.sessionId && { sessionId: conversation.sessionId }),
        selection: {
          ...(chat.model && { model: chat.model }),
          ...(chat.effort && { effort: chat.effort })
        }
      },
      {
        item: (item) => this.emit(chatId, conversation, { type: 'item', item }),
        delta: (itemId, field, delta) =>
          this.emit(chatId, conversation, {
            type: 'delta',
            itemId,
            field,
            delta
          }),
        turnFinished: () => {
          if (conversation.session === session) {
            this.finishTurn(chatId, conversation)
          }
        },
        usage: (usage) => this.emit(chatId, conversation, { type: 'usage', usage }),
        tokens: (turnTokens) => this.emit(chatId, conversation, { type: 'tokens', turnTokens }),
        sessionStarted: (sessionId) => {
          conversation.sessionId = sessionId
        },
        closed: () => {
          if (conversation.session === session) {
            conversation.session = null
            this.finishTurn(chatId, conversation)
          }
        }
      }
    )
    conversation.session = session
    return session
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
      this.dispatch(chatId, conversation, { type: 'delta', itemId, field, delta })
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
  }

  private updateRunning(chatId: string, conversation: Conversation): void {
    const running = conversation.turn !== null || conversation.queue.length > 0
    if (conversation.snapshot.running !== running) {
      this.emit(chatId, conversation, { type: 'running', running })
    }
  }
}
