import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { findAgent, type AgentId } from '../../shared/agents'
import {
  applyConversationEvent,
  titleFromMessage,
  type AgentCatalog,
  type AgentCommand,
  type ChatConfiguration,
  type ConversationEvent,
  type ConversationSnapshot,
  type TimelineItem
} from '../../shared/conversation'
import type { AgentDetector } from '../agents'
import type { ProjectStore } from '../store'
import { errorMessage } from './display'
import type { TranscriptStore } from './transcripts'
import type { AgentDriver, AgentLaunch, AgentSession } from './types'

/**
 * Как часто сохранять ленту, пока агент пишет ответ: если Atox закроют посреди долгого хода,
 * пропадут лишь последние секунды.
 */
const PERSIST_DELAY_MS = 2000

type EventPayload = ConversationEvent extends infer Event
  ? Event extends ConversationEvent
    ? Omit<Event, 'chatId'>
    : never
  : never

interface QueuedMessage {
  itemId: string
  text: string
}

interface Conversation {
  snapshot: ConversationSnapshot
  session: AgentSession | null
  /** Модель или эффорт сменились: сессию нужно перезапустить, как только агент освободится. */
  stale: boolean
  /** Сообщения, которые агент ещё не начал обрабатывать. */
  queue: QueuedMessage[]
  /** Сообщение, над которым агент работает сейчас. */
  turn: QueuedMessage | null
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
 */
export class ConversationManager {
  private readonly conversations = new Map<string, Promise<Conversation>>()
  /** Разговоры, которые уже загружены: по ним считается, кто сейчас работает. */
  private readonly settled = new Map<string, Conversation>()
  private readonly catalogs = new Map<AgentId, Promise<AgentCatalog>>()
  /** Команды по агенту и папке проекта: у проектов бывают свои команды и навыки. */
  private readonly commandLists = new Map<string, Promise<AgentCommand[]>>()

  constructor(private readonly services: ConversationServices) {}

  async snapshot(chatId: string): Promise<ConversationSnapshot> {
    return (await this.conversation(chatId)).snapshot
  }

  async send(chatId: string, text: string): Promise<void> {
    const message = text.trim()
    if (!message) {
      return
    }
    const conversation = await this.conversation(chatId)
    const isFirst = !conversation.snapshot.items.some(({ kind }) => kind === 'user')
    const item: TimelineItem = {
      kind: 'user',
      id: randomUUID(),
      text: message,
      createdAt: Date.now()
    }
    this.emit(chatId, conversation, { type: 'item', item })
    if (isFirst && this.services.store.applyAutomaticTitle(chatId, titleFromMessage(message))) {
      this.services.onProjectsChanged()
    }
    conversation.queue.push({ itemId: item.id, text: message })
    this.persist(chatId, conversation)
    this.pump(chatId, conversation)
  }

  /** Останавливает текущий ответ агента; сообщения, ждавшие очереди, тоже отменяются. */
  async interrupt(chatId: string): Promise<void> {
    const conversation = await this.conversation(chatId)
    conversation.queue = []
    if (conversation.turn) {
      conversation.session?.interrupt()
    }
    this.updateRunning(chatId, conversation)
  }

  /** Меняет агента, модель или эффорт чата; новая модель вступает в силу со следующего сообщения. */
  async configure(chatId: string, configuration: ChatConfiguration): Promise<void> {
    const conversation = await this.conversation(chatId)
    const changed = this.services.store.configureChat(chatId, configuration)
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
    return [...this.settled.entries()]
      .filter(([, conversation]) => conversation.turn !== null || conversation.queue.length > 0)
      .map(([chatId]) => chatId)
  }

  /** Чат удалён: агент останавливается, лента стирается. */
  async remove(chatId: string): Promise<void> {
    const conversation = await this.conversations.get(chatId)
    this.conversations.delete(chatId)
    this.settled.delete(chatId)
    if (conversation) {
      if (conversation.persistTimer) {
        clearTimeout(conversation.persistTimer)
      }
      conversation.session?.close()
    }
    await this.services.transcripts.remove(chatId)
  }

  closeAll(): void {
    for (const conversation of this.settled.values()) {
      conversation.session?.close()
      conversation.session = null
    }
  }

  /** Записывает отложенные изменения лент и дожидается записи — перед выходом из приложения. */
  flush(): Promise<void> {
    for (const [chatId, conversation] of this.settled) {
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

  private conversation(chatId: string): Promise<Conversation> {
    let conversation = this.conversations.get(chatId)
    if (!conversation) {
      if (!this.services.store.findChat(chatId)) {
        return Promise.reject(new Error(`Chat ${chatId} not found`))
      }
      conversation = this.services.transcripts.load(chatId).then((items) => {
        const loaded: Conversation = {
          snapshot: { items, running: false },
          session: null,
          stale: false,
          queue: [],
          turn: null,
          persistTimer: null
        }
        this.settled.set(chatId, loaded)
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
    }
    this.updateRunning(chatId, conversation)
    if (!next) {
      return
    }
    this.ensureSession(chatId, conversation)
      .then((session) => session.send(next.text))
      .catch((error) => {
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
    const driver = this.services.drivers[chat.agent]
    const session: AgentSession = driver.start(
      {
        ...launch,
        ...(chat.sessionId && { sessionId: chat.sessionId }),
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
        sessionStarted: (sessionId) => this.services.store.setChatSession(chatId, sessionId),
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

  private emit(chatId: string, conversation: Conversation, payload: EventPayload): void {
    const event = { chatId, ...payload } as ConversationEvent
    conversation.snapshot = applyConversationEvent(conversation.snapshot, event)
    this.services.onEvent(event)
    // Лента сохраняется, а состояние работы и лимиты агент сообщит заново.
    if (event.type === 'item' || event.type === 'delta') {
      this.persist(chatId, conversation)
    }
  }

  private updateRunning(chatId: string, conversation: Conversation): void {
    const running = conversation.turn !== null || conversation.queue.length > 0
    if (conversation.snapshot.running !== running) {
      this.emit(chatId, conversation, { type: 'running', running })
    }
  }

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
      // Чат могли удалить, пока ждали записи.
      if (this.settled.get(chatId) === conversation) {
        this.services.transcripts.save(chatId, conversation.snapshot.items)
      }
    }
    if (immediately) {
      save()
    } else {
      conversation.persistTimer = setTimeout(save, PERSIST_DELAY_MS)
    }
  }
}
