import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, rm } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { findAgent, isAgentId } from '../../shared/agents'
import type { Chat } from '../../shared/models'
import {
  OrchestrationEnv,
  PARENT_ADDRESS,
  type OrchestrationMethod,
  type OrchestrationMethods,
  type OrchestrationRequest,
  type OrchestrationResponse
} from '../../shared/orchestration'
import type { AgentDetector } from '../agents'
import { errorMessage } from '../conversations/display'
import type { ConversationManager } from '../conversations/manager'
import type { ChatLocation, ProjectStore } from '../store'
import { formatMessage, formatReport, formatWorkerTask } from './prompts'

/**
 * Сколько помощников одного агента могут работать одновременно. Каждый тратит лимит
 * подписки — агент не должен случайно запустить их десятки.
 */
const MAX_ACTIVE_WORKERS = 4

/** Запрос — одна строка JSON; больше этого — не команда, а ошибка или мусор. */
const MAX_REQUEST_BYTES = 1024 * 1024

/** Права на сокет: только для текущего пользователя. */
const OWNER_ONLY = 0o600

interface OrchestrationServices {
  store: ProjectStore
  conversations: ConversationManager
  agents: AgentDetector
  /** Путь к сокету, через который команда `atox` обращается к приложению. */
  socketPath: string
  /** Путь к команде `atox`, которую получают агенты. */
  cliPath: string
  /** Список чатов изменился без участия окна — например, агент запустил помощника. */
  onProjectsChanged(): void
}

/** Ошибка, понятная агенту: её текст уходит в ответ команды как есть. */
class CommandError extends Error {}

type Handlers = {
  [Method in OrchestrationMethod]: (
    caller: ChatLocation,
    params: OrchestrationMethods[Method]['params']
  ) => Promise<OrchestrationMethods[Method]['result']> | OrchestrationMethods[Method]['result']
}

/**
 * Принимает команды `atox` от агентов чатов: агент может запустить помощника в соседнем
 * чате, переписываться с ним и получить его отчёт. Помощники одного уровня: свои помощники
 * им запускать нельзя, чтобы агенты не плодили друг друга бесконечно.
 */
export class OrchestrationServer {
  /**
   * Из секрета выводится свой токен каждого чата: агент может действовать только от имени
   * своего чата, даже если узнает id чужого — например, помощник id своего агента.
   */
  private readonly secret = randomBytes(32)
  /** Помощники, которые отчитались и с тех пор не получали новых сообщений от агента. */
  private readonly reportedChatIds = new Set<string>()
  /** Помощники, которых уже создали, но которые ещё не начали работать. */
  private readonly startingChatIds = new Set<string>()
  private server: Server | null = null

  constructor(private readonly services: OrchestrationServices) {}

  async start(): Promise<void> {
    // Сокет прошлого запуска остаётся файлом и не даёт занять адрес.
    await rm(this.services.socketPath, { force: true })
    const server = createServer((socket) => this.accept(socket))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.services.socketPath, resolve)
    })
    await chmod(this.services.socketPath, OWNER_ONLY)
    this.server = server
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  /** Переменные, по которым команда `atox`, запущенная агентом чата, находит приложение и себя. */
  environment(chatId: string): Record<string, string> {
    return {
      [OrchestrationEnv.Socket]: this.services.socketPath,
      [OrchestrationEnv.Token]: this.chatToken(chatId),
      [OrchestrationEnv.ChatId]: chatId,
      [OrchestrationEnv.Cli]: this.services.cliPath
    }
  }

  private chatToken(chatId: string): string {
    return createHmac('sha256', this.secret).update(chatId).digest('hex')
  }

  private isAuthorized({ token, chatId }: OrchestrationRequest): boolean {
    const expected = Buffer.from(this.chatToken(chatId))
    const received = Buffer.from(token)
    return received.length === expected.length && timingSafeEqual(received, expected)
  }

  private accept(socket: Socket): void {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('error', () => socket.destroy())
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline < 0) {
        if (buffer.length > MAX_REQUEST_BYTES) {
          socket.destroy()
        }
        return
      }
      socket.removeAllListeners('data')
      void this.respond(buffer.slice(0, newline)).then((response) =>
        socket.end(`${JSON.stringify(response)}\n`)
      )
    })
  }

  private async respond(line: string): Promise<OrchestrationResponse> {
    try {
      const request = parseRequest(line)
      if (!this.isAuthorized(request)) {
        throw new CommandError('Not authorized: run atox from an agent inside Atox.')
      }
      const caller = this.services.store.findChat(request.chatId)
      if (!caller) {
        throw new CommandError('This agent does not belong to an Atox chat.')
      }
      // Только свои методы: имя из запроса не должно находить методы прототипа объекта.
      const handler = Object.hasOwn(this.handlers, request.method)
        ? (this.handlers[request.method] as (caller: ChatLocation, params: unknown) => unknown)
        : undefined
      if (!handler) {
        throw new CommandError(`Unknown command: ${request.method}`)
      }
      return { ok: true, result: (await handler(caller, request.params)) as never }
    } catch (error) {
      const message =
        error instanceof CommandError ? error.message : 'Atox could not run the command.'
      if (!(error instanceof CommandError)) {
        console.error('Orchestration command failed', error)
      }
      return { ok: false, error: message }
    }
  }

  private readonly handlers: Handlers = {
    agents: async () => {
      const installed = await this.services.agents.list()
      return installed.map((id) => ({ id, name: findAgent(id)?.name ?? id }))
    },

    start: async (caller, { agent, task, title }) => {
      if (caller.chat.parentChatId) {
        throw new CommandError('A worker cannot start workers of its own.')
      }
      if (!task?.trim()) {
        throw new CommandError('The task is empty.')
      }
      const installed = await this.services.agents.list()
      if (!isAgentId(agent) || !installed.includes(agent)) {
        const available = installed.join(', ') || 'none'
        throw new CommandError(`Agent "${agent}" is not installed. Available agents: ${available}.`)
      }
      // Подсчёт и создание идут без ожидания между ними: параллельные команды не обойдут лимит.
      const active = this.workersOf(caller).filter(
        (chat) =>
          !this.reportedChatIds.has(chat.id) &&
          (this.startingChatIds.has(chat.id) || this.services.conversations.isRunning(chat.id))
      )
      if (active.length >= MAX_ACTIVE_WORKERS) {
        throw new CommandError(
          `You already have ${active.length} workers in progress. Wait for their reports before starting more.`
        )
      }
      const { chat } = this.services.store.createWorkerChat(caller.chat.id, agent, title)
      this.startingChatIds.add(chat.id)
      try {
        // Задание — первое сообщение помощнику: он сразу начинает работать. Чат без своего
        // названия называется по заданию, а не по служебному началу сообщения.
        await this.services.conversations.send(
          chat.id,
          formatWorkerTask(caller.chat, task),
          {},
          { titleFrom: task }
        )
      } finally {
        this.startingChatIds.delete(chat.id)
      }
      this.services.onProjectsChanged()
      return { chatId: chat.id, title: chat.title }
    },

    send: async (caller, { to, message }) => {
      if (!message?.trim()) {
        throw new CommandError('The message is empty.')
      }
      const target = this.resolveRecipient(caller.chat, to)
      await this.deliver(target, formatMessage(caller.chat, message))
      // Новое сообщение от агента — новая работа: помощник снова может отчитаться.
      if (target.parentChatId === caller.chat.id) {
        this.reportedChatIds.delete(target.id)
      }
      return { chatId: target.id }
    },

    report: async (caller, { summary }) => {
      const parentId = caller.chat.parentChatId
      if (!parentId) {
        throw new CommandError('Only a worker started with "atox start" can report.')
      }
      const parent = this.recipient(parentId, 'The parent chat')
      if (!summary?.trim()) {
        throw new CommandError('The report is empty.')
      }
      if (this.reportedChatIds.has(caller.chat.id)) {
        throw new CommandError(
          'You already reported this task. Report again only after a new message from the agent.'
        )
      }
      // Отметка ставится до доставки, чтобы два отчёта подряд не ушли оба.
      this.reportedChatIds.add(caller.chat.id)
      try {
        await this.deliver(parent, formatReport(caller.chat, summary))
      } catch (error) {
        this.reportedChatIds.delete(caller.chat.id)
        throw error
      }
      return { chatId: parent.id }
    },

    remove: async (caller, { chatIds }) => {
      const ids = Array.isArray(chatIds) ? [...new Set(chatIds.map(String))] : []
      if (ids.length === 0) {
        throw new CommandError('Specify the chat ids of the workers to remove.')
      }
      // Сначала проверяются все чаты: команда либо удаляет всех названных помощников, либо никого.
      const workers = ids.map((id) => {
        const worker = this.services.store.findChat(id)?.chat
        if (!worker) {
          throw new CommandError(`Chat ${id} not found.`)
        }
        if (worker.parentChatId !== caller.chat.id) {
          throw new CommandError(
            `Chat ${id} is not your worker. You can only remove your own workers.`
          )
        }
        return worker
      })
      for (const worker of workers) {
        this.services.store.removeChat(worker.id)
        await this.services.conversations.remove(worker.id)
        this.reportedChatIds.delete(worker.id)
      }
      this.services.onProjectsChanged()
      return { removed: workers.map(({ id }) => id) }
    },

    workers: (caller) =>
      this.workersOf(caller).map((chat) => ({
        chatId: chat.id,
        title: chat.title,
        agent: chat.agent,
        running: this.services.conversations.isRunning(chat.id),
        reported: this.reportedChatIds.has(chat.id),
        startedAt: chat.createdAt
      }))
  }

  private workersOf({ project, chat }: ChatLocation): Chat[] {
    return project.chats.filter((other) => other.parentChatId === chat.id)
  }

  /** Писать можно только своему агенту-родителю или своим помощникам. */
  private resolveRecipient(sender: Chat, to: string): Chat {
    const toParent = to === PARENT_ADDRESS
    const targetId = toParent ? sender.parentChatId : to
    if (!targetId) {
      throw new CommandError('This chat has no parent agent.')
    }
    const target = this.recipient(targetId, toParent ? 'The parent chat' : `Chat ${to}`)
    if (target.id !== sender.parentChatId && target.parentChatId !== sender.id) {
      throw new CommandError('You can only message your parent agent or your own workers.')
    }
    return target
  }

  /**
   * Чат, которому можно написать. Архивный или удалённый чат сообщений не получит: агент
   * узнаёт об этом из ответа команды, а не теряет сообщение молча.
   */
  private recipient(chatId: string, description: string): Chat {
    const chat = this.services.store.findChat(chatId)?.chat
    if (chat) {
      return chat
    }
    if (this.services.store.findArchivedChat(chatId)) {
      throw new CommandError(`${description} is archived, so it cannot receive messages.`)
    }
    throw new CommandError(`${description} was not found.`)
  }

  /**
   * Ставит текст в очередь агенту чата: он получит его, как только закончит текущую работу.
   * Команда отвечает, только когда сообщение принято, — иначе ошибкой.
   */
  private async deliver(chat: Chat, text: string): Promise<void> {
    try {
      await this.services.conversations.send(chat.id, text)
    } catch (error) {
      console.error('Failed to deliver an agent message', error)
      throw new CommandError(
        `Could not deliver the message to "${chat.title}": ${errorMessage(error)}`
      )
    }
  }
}

function parseRequest(line: string): OrchestrationRequest {
  try {
    const request = JSON.parse(line) as OrchestrationRequest
    if (typeof request.token === 'string' && typeof request.chatId === 'string') {
      return { ...request, params: request.params ?? {} }
    }
  } catch {
    // Ниже — общий ответ на любую нечитаемую строку.
  }
  throw new CommandError('Malformed request.')
}
