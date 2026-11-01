import { randomUUID } from 'node:crypto'
import {
  limitOutput,
  type AgentCatalog,
  type ConversationUsage,
  type TimelineItem,
  type ToolStatus,
  type UsageLimit
} from '../../shared/conversation'
import { displayPath, errorMessage } from './display'
import { JsonRpcProcess } from './jsonRpc'
import type { AgentDriver, AgentLaunch, AgentSession, SessionEvents, SessionOptions } from './types'

/*
 * Протокол `codex app-server`: JSON-RPC по строкам stdin/stdout. Здесь описана только та его
 * часть, которой пользуется Atox; полные типы печатает `codex app-server generate-ts`.
 */

interface ClientInfo {
  name: string
  title: string
  version: string
}

interface CodexModel {
  id: string
  displayName: string
  hidden: boolean
  isDefault: boolean
  supportedReasoningEfforts: { reasoningEffort: string }[]
  defaultReasoningEffort: string
}

interface ThreadResponse {
  thread: { id: string }
}

interface Turn {
  id: string
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress'
  error: { message: string } | null
}

type ItemStatus = 'inProgress' | 'completed' | 'failed' | 'declined'

interface TokenUsage {
  last: { totalTokens: number }
  modelContextWindow: number | null
}

interface RateLimitWindow {
  usedPercent: number
  windowDurationMins: number | null
  /** Секунды Unix. */
  resetsAt: number | null
}

interface RateLimitSnapshot {
  primary: RateLimitWindow | null
  secondary: RateLimitWindow | null
}

type CodexItem =
  | { type: 'agentMessage'; id: string; text: string }
  | { type: 'reasoning'; id: string; summary: string[]; content: string[] }
  | {
      type: 'commandExecution'
      id: string
      command: string
      status: ItemStatus
      aggregatedOutput: string | null
      exitCode: number | null
    }
  | {
      type: 'fileChange'
      id: string
      changes: { path: string }[]
      status: ItemStatus
    }
  | {
      type: 'mcpToolCall'
      id: string
      server: string
      tool: string
      status: ItemStatus
    }
  | { type: 'webSearch'; id: string; query?: string }

/** Остальные виды элементов (план, сжатие контекста и т. п.) в ленту не попадают. */
type AnyCodexItem = CodexItem | { type: string; id: string }

/**
 * Режим «полный доступ», как у агента в терминале без подтверждений: Codex не спрашивает
 * разрешений и не ограничен песочницей.
 */
const FULL_ACCESS = {
  approvalPolicy: 'never',
  sandbox: 'danger-full-access'
} as const

/** Команды Codex приходят обёрнутыми в оболочку: `/bin/zsh -lc 'git status'`. */
const SHELL_WRAPPER = /^\S*\b(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/

const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY

export function createCodexDriver(client: ClientInfo): AgentDriver {
  return {
    agent: 'codex',

    async catalog(launch) {
      const rpc = startAppServer(launch, {
        notification: () => undefined,
        request: () => Promise.reject(new Error('Not supported')),
        exit: () => undefined
      })
      try {
        await initialize(rpc, client)
        const { data } = await rpc.request<{ data: CodexModel[] }>('model/list', {})
        return toCatalog(data)
      } finally {
        rpc.kill()
      }
    },

    // Codex выполняет команды «/…» только в своём терминальном интерфейсе, а не в app-server.
    commands: () => Promise.resolve([]),

    start(options, events) {
      return new CodexSession(options, events, client)
    }
  }
}

function startAppServer(
  { executable, cwd, env }: AgentLaunch,
  handlers: ConstructorParameters<typeof JsonRpcProcess>[3]
): JsonRpcProcess {
  return new JsonRpcProcess(executable, ['app-server'], { cwd, env }, handlers)
}

async function initialize(rpc: JsonRpcProcess, clientInfo: ClientInfo): Promise<void> {
  await rpc.request('initialize', { clientInfo })
  rpc.notify('initialized')
}

function toCatalog(models: CodexModel[]): AgentCatalog {
  const visible = models.filter(({ hidden }) => !hidden)
  return {
    agent: 'codex',
    defaultModel: (visible.find(({ isDefault }) => isDefault) ?? visible[0])?.id ?? '',
    models: visible.map((model) => ({
      id: model.id,
      name: model.displayName,
      efforts: model.supportedReasoningEfforts.map(({ reasoningEffort }) => reasoningEffort),
      defaultEffort: model.defaultReasoningEffort
    }))
  }
}

class CodexSession implements AgentSession {
  private readonly rpc: JsonRpcProcess
  /** Тред Codex, когда он открыт: сообщения ждут его. */
  private readonly thread: Promise<string>
  private turnId: string | null = null
  /** Последние известные контекст и лимиты: Codex присылает их разными событиями. */
  private usage: ConversationUsage = { limits: [] }

  constructor(
    private readonly options: SessionOptions,
    private readonly events: SessionEvents,
    client: ClientInfo
  ) {
    this.rpc = startAppServer(options, {
      notification: (method, params) => this.handleNotification(method, params),
      // Codex работает без подтверждений, другие запросы Atox не поддерживает.
      request: (method) => Promise.reject(new Error(`Atox does not handle ${method}`)),
      exit: (error) => {
        if (error) {
          this.reportError(errorMessage(error))
        }
        events.closed()
      }
    })
    this.thread = this.openThread(client)
    // Ошибку открытия сообщит первое сообщение, которое будет его ждать.
    this.thread.catch(() => undefined)
  }

  send(text: string): void {
    const { selection } = this.options
    this.thread
      .then((threadId) =>
        this.rpc.request<{ turn: Turn }>('turn/start', {
          threadId,
          input: [{ type: 'text', text, text_elements: [] }],
          ...(selection?.model && { model: selection.model }),
          ...(selection?.effort && { effort: selection.effort })
        })
      )
      .then(({ turn }) => {
        this.turnId ??= turn.id
      })
      .catch((error) => {
        // Если упал сам процесс, об этом уже сообщил его выход.
        if (this.rpc.alive) {
          this.reportError(errorMessage(error))
          this.events.turnFinished()
        }
      })
  }

  interrupt(): void {
    const turnId = this.turnId
    if (!turnId) {
      return
    }
    void this.thread
      .then((threadId) => this.rpc.request('turn/interrupt', { threadId, turnId }))
      .catch((error) => console.error('Failed to interrupt Codex', error))
  }

  close(): void {
    this.rpc.kill()
  }

  private async openThread(client: ClientInfo): Promise<string> {
    await initialize(this.rpc, client)
    const { cwd, sessionId, selection } = this.options
    const params = {
      cwd,
      ...FULL_ACCESS,
      ...(selection?.model && { model: selection.model })
    }
    let response: ThreadResponse | null = null
    if (sessionId) {
      response = await this.rpc
        .request<ThreadResponse>('thread/resume', {
          threadId: sessionId,
          ...params
        })
        .catch((error) => {
          this.reportError(
            `Could not continue the previous Codex conversation, so a new one was started. ${errorMessage(error)}`
          )
          return null
        })
    }
    response ??= await this.rpc.request<ThreadResponse>('thread/start', params)
    this.events.sessionStarted(response.thread.id)
    void this.rpc
      .request<{ rateLimits: RateLimitSnapshot }>('account/rateLimits/read', {})
      .then(({ rateLimits }) => this.updateLimits(rateLimits))
      .catch(() => undefined)
    return response.thread.id
  }

  private handleNotification(method: string, params: unknown): void {
    switch (method) {
      case 'turn/started':
        this.turnId = (params as { turn: Turn }).turn.id
        break
      case 'turn/completed': {
        const { turn } = params as { turn: Turn }
        if (turn.status === 'failed') {
          this.reportError(turn.error?.message ?? 'Codex stopped with an error.')
        }
        this.turnId = null
        this.events.turnFinished()
        break
      }
      case 'item/started':
      case 'item/completed': {
        const item = toTimelineItem((params as { item: AnyCodexItem }).item, this.options.cwd)
        if (item) {
          this.events.item(item)
        }
        break
      }
      case 'item/agentMessage/delta':
      case 'item/reasoning/summaryTextDelta': {
        const { itemId, delta } = params as { itemId: string; delta: string }
        this.events.delta(itemId, 'text', delta)
        break
      }
      case 'thread/tokenUsage/updated': {
        const { tokenUsage } = params as { tokenUsage: TokenUsage }
        if (tokenUsage.modelContextWindow) {
          this.updateUsage({
            context: {
              used: tokenUsage.last.totalTokens,
              limit: tokenUsage.modelContextWindow
            }
          })
        }
        break
      }
      case 'account/rateLimits/updated':
        this.updateLimits((params as { rateLimits: RateLimitSnapshot }).rateLimits)
        break
      case 'item/commandExecution/outputDelta': {
        const { itemId, delta } = params as { itemId: string; delta: string }
        this.events.delta(itemId, 'output', delta)
        break
      }
    }
  }

  /** Обновление лимитов бывает частичным: окно, о котором Codex не сообщил, остаётся прежним. */
  private updateLimits({ primary, secondary }: RateLimitSnapshot): void {
    const limits = [primary, secondary].flatMap((window) => (window ? [toUsageLimit(window)] : []))
    if (limits.length > 0) {
      const labels = new Set(limits.map(({ label }) => label))
      this.updateUsage({
        limits: [...this.usage.limits.filter(({ label }) => !labels.has(label)), ...limits]
      })
    }
  }

  private updateUsage(patch: Partial<ConversationUsage>): void {
    this.usage = { ...this.usage, ...patch }
    this.events.usage(this.usage)
  }

  private reportError(message: string): void {
    this.events.item({ kind: 'error', id: randomUUID(), message })
  }
}

function toTimelineItem(source: AnyCodexItem, cwd: string): TimelineItem | null {
  const item = source as CodexItem
  switch (item.type) {
    case 'agentMessage':
      return { kind: 'assistant', id: item.id, text: item.text }
    case 'reasoning':
      return {
        kind: 'reasoning',
        id: item.id,
        text: item.summary.join('\n\n')
      }
    case 'commandExecution':
      return {
        kind: 'tool',
        id: item.id,
        tool: 'command',
        name: item.type,
        title: unwrapShellCommand(item.command),
        status: toolStatus(item.status, item.exitCode),
        ...(item.aggregatedOutput && {
          output: limitOutput(item.aggregatedOutput)
        })
      }
    case 'fileChange':
      return {
        kind: 'tool',
        id: item.id,
        tool: 'edit',
        name: item.type,
        title: item.changes.map(({ path }) => displayPath(path, cwd)).join(', '),
        status: toolStatus(item.status, null)
      }
    case 'mcpToolCall':
      return {
        kind: 'tool',
        id: item.id,
        tool: 'other',
        name: item.type,
        title: `${item.server} · ${item.tool}`,
        status: toolStatus(item.status, null)
      }
    case 'webSearch':
      return {
        kind: 'tool',
        id: item.id,
        tool: 'web',
        name: item.type,
        title: item.query || 'Web search',
        status: 'done'
      }
    default:
      return null
  }
}

function toUsageLimit({ usedPercent, windowDurationMins, resetsAt }: RateLimitWindow): UsageLimit {
  return {
    label: windowLabel(windowDurationMins),
    usedPercent,
    ...(resetsAt !== null && { resetsAt: resetsAt * 1000 })
  }
}

/** «Session (5 hours)», «Week», «3 days» — по длительности окна лимита. */
function windowLabel(minutes: number | null): string {
  if (minutes === null) {
    return 'Limit'
  }
  if (minutes === MINUTES_PER_WEEK) {
    return 'Week'
  }
  if (minutes < MINUTES_PER_DAY) {
    const hours = Math.round(minutes / MINUTES_PER_HOUR)
    return `Session (${hours} ${hours === 1 ? 'hour' : 'hours'})`
  }
  const days = Math.round(minutes / MINUTES_PER_DAY)
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

function toolStatus(status: ItemStatus, exitCode: number | null): ToolStatus {
  switch (status) {
    case 'inProgress':
      return 'running'
    case 'completed':
      return exitCode !== null && exitCode !== 0 ? 'failed' : 'done'
    default:
      return 'failed'
  }
}

function unwrapShellCommand(command: string): string {
  const match = SHELL_WRAPPER.exec(command.trim())
  return match?.[2] ?? command
}
