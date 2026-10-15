import { randomBytes } from 'node:crypto'
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { join } from 'node:path'
import { findAgent, isAgentId, TERMINAL_AGENT_ID } from '../../shared/agents'
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
import type { SettingsStore } from '../settings'
import type { ChatLocation, ProjectStore } from '../store'
import { quoteShell } from '../shellQuote'
import type { TerminalManager } from '../terminals'
import { trustFolderForAgent } from './agentTrust'
import { MessageDelivery } from './delivery'
import { agentLaunchCommand } from './launch'
import { formatMessage, formatReport, formatWorkerTask } from './prompts'

/** Размер терминала помощника до того, как его откроют в окне и подгонят под панель. */
const WORKER_TERMINAL_SIZE = { cols: 120, rows: 32 }

/**
 * Сколько помощников одного агента могут работать одновременно. Каждый тратит лимит
 * подписки — агент не должен случайно запустить их десятки.
 */
const MAX_ACTIVE_WORKERS = 4

/** Запрос — одна строка JSON; больше этого — не команда, а ошибка или мусор. */
const MAX_REQUEST_BYTES = 1024 * 1024

/** Права на сокет и файлы заданий: только для текущего пользователя. */
const OWNER_ONLY = 0o600

interface OrchestrationServices {
  store: ProjectStore
  settings: SettingsStore
  terminals: TerminalManager
  agents: AgentDetector
  /** Путь к сокету, через который команда `atox` обращается к приложению. */
  socketPath: string
  /** Каталог временных файлов с заданиями помощникам. */
  tasksDirectory: string
  /** Путь к команде `atox`, которую получают терминалы. */
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
 * Принимает команды `atox` из терминалов чатов: агент может запустить помощника в соседнем
 * чате, переписываться с ним и получить его отчёт. Помощники одного уровня: свои помощники
 * им запускать нельзя, чтобы агенты не плодили друг друга бесконечно.
 */
export class OrchestrationServer {
  private readonly token = randomBytes(32).toString('hex')
  /** Помощники, которые отчитались и с тех пор не получали новых сообщений от агента. */
  private readonly reportedChatIds = new Set<string>()
  private readonly delivery: MessageDelivery
  private server: Server | null = null

  constructor(private readonly services: OrchestrationServices) {
    this.delivery = new MessageDelivery(services.terminals)
  }

  async start(): Promise<void> {
    // Задания, которые не успел прочитать агент прошлого запуска, больше не нужны.
    await rm(this.services.tasksDirectory, { recursive: true, force: true })
    await mkdir(this.services.tasksDirectory, { recursive: true })
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
    this.delivery.dispose()
    this.server?.close()
    this.server = null
  }

  /** Переменные, по которым команда `atox` в терминале чата находит приложение и себя. */
  environment(chatId: string): Record<string, string> {
    return {
      [OrchestrationEnv.Socket]: this.services.socketPath,
      [OrchestrationEnv.Token]: this.token,
      [OrchestrationEnv.ChatId]: chatId,
      [OrchestrationEnv.Cli]: this.services.cliPath
    }
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
      if (request.token !== this.token) {
        throw new CommandError('Not authorized: run atox from a terminal inside Atox.')
      }
      const caller = this.services.store.findChat(request.chatId)
      if (!caller) {
        throw new CommandError('This terminal does not belong to an Atox chat.')
      }
      const handler = this.handlers[request.method] as (
        caller: ChatLocation,
        params: unknown
      ) => unknown
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
      return installed
        .filter((id) => id !== TERMINAL_AGENT_ID)
        .map((id) => ({ id, name: findAgent(id)?.name ?? id }))
    },

    start: async (caller, { agent, task, title }) => {
      if (caller.chat.parentChatId) {
        throw new CommandError('A worker cannot start workers of its own.')
      }
      if (!task?.trim()) {
        throw new CommandError('The task is empty.')
      }
      const active = this.workersOf(caller).filter(
        (chat) =>
          this.services.terminals.getRunningProgram(chat.id) !== null &&
          !this.reportedChatIds.has(chat.id)
      )
      if (active.length >= MAX_ACTIVE_WORKERS) {
        throw new CommandError(
          `You already have ${active.length} workers in progress. Wait for their reports before starting more.`
        )
      }
      const installed = (await this.services.agents.list()).filter((id) => id !== TERMINAL_AGENT_ID)
      if (!isAgentId(agent) || !installed.includes(agent)) {
        const available = installed.join(', ') || 'none'
        throw new CommandError(`Agent "${agent}" is not installed. Available agents: ${available}.`)
      }
      // Доверие к папке — до создания чата: помощник не должен остановиться на этом вопросе.
      await trustFolderForAgent(agent, caller.project.path).catch((error) =>
        console.error('Failed to trust the folder for a worker', error)
      )
      const { project, chat } = this.services.store.createWorkerChat(caller.chat.id, agent, title)
      const taskFile = join(this.services.tasksDirectory, `${chat.id}.md`)
      await writeFile(taskFile, formatWorkerTask(caller.chat, task), { mode: OWNER_ONLY })
      const launch = agentLaunchCommand(agent, this.services.settings.get().agentCommands, {
        worker: true
      })
      // Задание передаётся агенту аргументом: так оно приходит первым сообщением, без ожидания,
      // пока агент запустится. Файл удаляется сразу после чтения.
      const command = `${launch} "$(cat ${quoteShell(taskFile)}; rm -f ${quoteShell(taskFile)})"`
      this.services.terminals.attach(chat.id, project.path, WORKER_TERMINAL_SIZE, command)
      this.services.onProjectsChanged()
      return { chatId: chat.id, title: chat.title }
    },

    send: (caller, { to, message }) => {
      if (!message?.trim()) {
        throw new CommandError('The message is empty.')
      }
      const target = this.resolveRecipient(caller.chat, to)
      this.deliver(target, formatMessage(caller.chat, message))
      // Новое сообщение от агента — новая работа: помощник снова может отчитаться.
      if (target.parentChatId === caller.chat.id) {
        this.reportedChatIds.delete(target.id)
      }
      return { chatId: target.id }
    },

    report: (caller, { summary }) => {
      const parent =
        caller.chat.parentChatId && this.services.store.findChat(caller.chat.parentChatId)
      if (!parent) {
        throw new CommandError('Only a worker started with "atox start" can report.')
      }
      if (!summary?.trim()) {
        throw new CommandError('The report is empty.')
      }
      if (this.reportedChatIds.has(caller.chat.id)) {
        throw new CommandError(
          'You already reported this task. Report again only after a new message from the agent.'
        )
      }
      this.deliver(parent.chat, formatReport(caller.chat, summary))
      this.reportedChatIds.add(caller.chat.id)
      return { chatId: parent.chat.id }
    },

    workers: (caller) =>
      this.workersOf(caller).map((chat) => ({
        chatId: chat.id,
        title: chat.title,
        agent: chat.agent ?? TERMINAL_AGENT_ID,
        running: this.services.terminals.isRunning(chat.id),
        reported: this.reportedChatIds.has(chat.id)
      }))
  }

  private workersOf({ project, chat }: ChatLocation): Chat[] {
    return project.chats.filter((other) => other.parentChatId === chat.id)
  }

  /** Писать можно только своему агенту-родителю или своим помощникам. */
  private resolveRecipient(sender: Chat, to: string): Chat {
    const targetId = to === PARENT_ADDRESS ? sender.parentChatId : to
    const target = targetId && this.services.store.findChat(targetId)?.chat
    if (!target) {
      throw new CommandError(
        to === PARENT_ADDRESS ? 'This chat has no parent agent.' : `Chat ${to} not found.`
      )
    }
    if (target.id !== sender.parentChatId && target.parentChatId !== sender.id) {
      throw new CommandError('You can only message your parent agent or your own workers.')
    }
    return target
  }

  /**
   * Ставит текст в очередь агенту чата: он придёт, как только агент сможет его принять.
   * В пустую оболочку не пишет — там текст выполнился бы как команда.
   */
  private deliver(chat: Chat, text: string): void {
    if (this.services.terminals.getRunningProgram(chat.id) === null) {
      throw new CommandError(`No agent is running in "${chat.title}", so the message was not sent.`)
    }
    this.delivery.enqueue(chat.id, text)
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
