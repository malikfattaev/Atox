import { randomUUID } from 'node:crypto'
import {
  query,
  type EffortLevel,
  type ModelInfo,
  type Options,
  type Query,
  type SDKMessage,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import {
  limitOutput,
  type AgentCatalog,
  type AgentModel,
  type UsageLimit,
  type TimelineItem,
  type ToolKind
} from '../../shared/conversation'
import { AsyncQueue } from './asyncQueue'
import { displayPath, errorMessage } from './display'
import type { AgentDriver, AgentLaunch, AgentSession, SessionEvents, SessionOptions } from './types'

type ToolItem = Extract<TimelineItem, { kind: 'tool' }>

type StreamedKind = 'assistant' | 'reasoning'

/** Уровни эффорта, которые принимает Claude Code. */
const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

/** Строка списка моделей, которая означает «модель по умолчанию», а не отдельную модель. */
const DEFAULT_MODEL_ALIAS = 'default'

/** Полные идентификаторы закреплённых версий: в меню они убраны в подменю. */
const PINNED_MODEL_PREFIX = 'claude-'

function launchOptions({ executable, env, cwd }: AgentLaunch): Options {
  return {
    cwd,
    env,
    pathToClaudeCodeExecutable: executable,
    // Те же настройки, CLAUDE.md, навыки и хуки, что у Claude Code в терминале.
    settingSources: ['user', 'project', 'local'],
    systemPrompt: { type: 'preset', preset: 'claude_code' }
  }
}

export const claudeDriver: AgentDriver = {
  agent: 'claude',

  async catalog(launch) {
    // Список моделей отдаёт сам Claude Code: сессия без сообщений к модели не обращается.
    const input = new AsyncQueue<SDKUserMessage>()
    const session = query({ prompt: input, options: launchOptions(launch) })
    try {
      return toCatalog(await session.supportedModels())
    } finally {
      input.end()
      session.close()
    }
  },

  start(options, events) {
    return new ClaudeSession(options, events)
  }
}

function toCatalog(models: ModelInfo[]): AgentCatalog {
  const alias = models.find(({ value }) => value === DEFAULT_MODEL_ALIAS)
  const listed = models.filter(({ value }) => value !== DEFAULT_MODEL_ALIAS)
  // «По умолчанию» — не модель, а ссылка на одну из них: показываем ту, на которую она указывает.
  const defaultModel =
    listed.find(
      (model) =>
        !model.value.startsWith(PINNED_MODEL_PREFIX) &&
        model.resolvedModel !== undefined &&
        model.resolvedModel === alias?.resolvedModel
    )?.value ??
    listed[0]?.value ??
    DEFAULT_MODEL_ALIAS
  return {
    agent: 'claude',
    defaultModel,
    models: listed.map((model): AgentModel => ({
      id: model.value,
      name: model.displayName,
      efforts: model.supportedEffortLevels ?? [],
      ...(model.value.startsWith(PINNED_MODEL_PREFIX) && { secondary: true })
    }))
  }
}

function isEffortLevel(value: string | undefined): value is EffortLevel {
  return EFFORT_LEVELS.some((level) => level === value)
}

class ClaudeSession implements AgentSession {
  private readonly input = new AsyncQueue<SDKUserMessage>()
  private readonly session: Query
  /** Вызовы инструментов по `tool_use_id`: их результат приходит отдельным сообщением. */
  private readonly tools = new Map<string, ToolItem>()
  /**
   * Блоки текста и рассуждений, которые уже появились в ленте, пока модель их печатала, —
   * по сообщениям модели, в порядке появления. Готовое сообщение Claude Code присылает по
   * одному блоку, и их номера не совпадают с номерами в потоке: блок находится по виду и порядку.
   */
  private readonly streamed = new Map<string, { id: string; kind: StreamedKind }[]>()
  /** Сообщение модели, части которого сейчас приходят потоком. */
  private streamingMessageId: string | null = null
  /** Пользователь остановил ответ: ошибка прерванного хода — не ошибка. */
  private interrupted = false

  constructor(
    private readonly options: SessionOptions,
    private readonly events: SessionEvents
  ) {
    const { sessionId, selection } = options
    this.session = query({
      prompt: this.input,
      options: {
        ...launchOptions(options),
        ...(sessionId && { resume: sessionId }),
        ...(selection?.model && { model: selection.model }),
        ...(isEffortLevel(selection?.effort) && { effort: selection.effort }),
        // Режим «полный доступ», как у агента в терминале с пропуском разрешений.
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true
      }
    })
    void this.consume()
  }

  send(text: string): void {
    this.interrupted = false
    this.input.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null
    })
  }

  interrupt(): void {
    this.interrupted = true
    this.session.interrupt().catch((error) => console.error('Failed to interrupt Claude', error))
  }

  close(): void {
    this.input.end()
    this.session.close()
  }

  private async consume(): Promise<void> {
    try {
      for await (const message of this.session) {
        this.handle(message)
      }
    } catch (error) {
      this.events.item({
        kind: 'error',
        id: randomUUID(),
        message: errorMessage(error)
      })
    } finally {
      this.events.closed()
    }
  }

  private handle(message: SDKMessage): void {
    // Работа субагентов видна по вызову инструмента Task, их внутренние шаги в ленту не идут.
    if ('parent_tool_use_id' in message && message.parent_tool_use_id) {
      return
    }
    switch (message.type) {
      case 'system':
        if (message.subtype === 'init') {
          this.events.sessionStarted(message.session_id)
          void this.reportUsage()
        }
        break
      case 'stream_event':
        this.handleStreamEvent(message.event)
        break
      case 'assistant':
        this.handleAssistantMessage(message.message.id, message.message.content)
        break
      case 'user':
        this.handleToolResults(message.message.content)
        break
      case 'result':
        if (message.subtype !== 'success' && !this.interrupted) {
          this.reportError(message.errors.join('\n') || 'Claude stopped with an error.')
        } else if (message.subtype === 'success' && message.is_error) {
          this.reportError(message.result || 'Claude stopped with an error.')
        }
        this.streamingMessageId = null
        this.streamed.clear()
        this.events.turnFinished()
        void this.reportUsage()
        break
    }
  }

  private handleStreamEvent(event: Extract<SDKMessage, { type: 'stream_event' }>['event']): void {
    switch (event.type) {
      case 'message_start':
        this.streamingMessageId = event.message.id
        break
      case 'content_block_delta': {
        if (!this.streamingMessageId) {
          return
        }
        const messageId = this.streamingMessageId
        const id = blockId(messageId, event.index)
        if (event.delta.type === 'text_delta') {
          this.stream(messageId, id, 'assistant', event.delta.text)
        } else if (event.delta.type === 'thinking_delta') {
          this.stream(messageId, id, 'reasoning', event.delta.thinking)
        }
        break
      }
    }
  }

  /** Часть текста, пока модель его печатает; первая часть создаёт элемент ленты. */
  private stream(messageId: string, id: string, kind: StreamedKind, delta: string): void {
    if (!delta) {
      return
    }
    const blocks = this.streamed.get(messageId) ?? []
    if (blocks.some((block) => block.id === id)) {
      this.events.delta(id, 'text', delta)
    } else {
      blocks.push({ id, kind })
      this.streamed.set(messageId, blocks)
      this.events.item({ kind, id, text: delta })
    }
  }

  /**
   * Элемент ленты для готового блока: тот, что уже появился в потоке, или новый, если
   * поток этот блок не показывал.
   */
  private takeStreamedId(messageId: string, kind: StreamedKind, fallback: string): string {
    const blocks = this.streamed.get(messageId)
    const index = blocks?.findIndex((block) => block.kind === kind) ?? -1
    if (!blocks || index < 0) {
      return fallback
    }
    const [block] = blocks.splice(index, 1)
    return block!.id
  }

  private handleAssistantMessage(
    messageId: string,
    content: Extract<SDKMessage, { type: 'assistant' }>['message']['content']
  ): void {
    for (const block of content) {
      // Без потока (например, у продолженной сессии) номер блока в сообщении неизвестен.
      const fallback = `${messageId}:${randomUUID()}`
      switch (block.type) {
        case 'text':
          if (block.text) {
            const id = this.takeStreamedId(messageId, 'assistant', fallback)
            this.events.item({ kind: 'assistant', id, text: block.text })
          }
          break
        case 'thinking':
          if (block.thinking) {
            const id = this.takeStreamedId(messageId, 'reasoning', fallback)
            this.events.item({ kind: 'reasoning', id, text: block.thinking })
          }
          break
        case 'tool_use':
        case 'server_tool_use':
        case 'mcp_tool_use': {
          const item: ToolItem = {
            kind: 'tool',
            id: block.id,
            name: block.name,
            ...describeTool(block.name, block.input, this.options.cwd),
            status: 'running'
          }
          this.tools.set(block.id, item)
          this.events.item(item)
          break
        }
      }
    }
  }

  private handleToolResults(
    content: Extract<SDKMessage, { type: 'user' }>['message']['content']
  ): void {
    if (typeof content === 'string') {
      return
    }
    for (const block of content) {
      if (block.type !== 'tool_result') {
        continue
      }
      const item = this.tools.get(block.tool_use_id)
      if (item) {
        this.tools.delete(block.tool_use_id)
        this.events.item({
          ...item,
          status: block.is_error ? 'failed' : 'done',
          output: limitOutput(toolResultText(block.content))
        })
      }
    }
  }

  /** Заполненность контекста и лимиты подписки — то же, что показывают `/context` и `/usage`. */
  private async reportUsage(): Promise<void> {
    const [context, account] = await Promise.all([
      this.session.getContextUsage().catch(() => null),
      // Лимиты подписки SDK пока отдаёт экспериментальным методом: без них индикатор покажет контекст.
      this.session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET().catch(() => null)
    ])
    if (!context && !account) {
      return
    }
    this.events.usage({
      ...(context && {
        context: { used: context.totalTokens, limit: context.maxTokens }
      }),
      limits: account?.rate_limits_available ? toUsageLimits(account.rate_limits) : []
    })
  }

  private reportError(message: string): void {
    this.events.item({ kind: 'error', id: randomUUID(), message })
  }
}

type RateLimits = Awaited<
  ReturnType<Query['usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET']>
>['rate_limits']

interface RateLimitWindow {
  utilization: number | null
  resets_at: string | null
}

const SESSION_WINDOW_LABEL = 'Session (5 hours)'

/** Окна лимитов подписки Claude в том порядке и с теми названиями, что у `/usage`. */
const RATE_LIMIT_WINDOWS = [
  ['five_hour', SESSION_WINDOW_LABEL],
  ['seven_day', 'Week (all models)'],
  ['seven_day_opus', 'Week (Opus)'],
  ['seven_day_sonnet', 'Week (Sonnet)']
] as const

function toUsageLimits(limits: RateLimits): UsageLimit[] {
  if (!limits) {
    return []
  }
  const windows: [string, RateLimitWindow | null | undefined][] = [
    ...RATE_LIMIT_WINDOWS.map(([key, label]): [string, RateLimitWindow | null | undefined] => [
      label,
      limits[key]
    ]),
    ...(limits.model_scoped ?? []).map((window): [string, RateLimitWindow] => [
      `Week (${window.display_name})`,
      window
    ])
  ]
  return windows.flatMap(([label, window]): UsageLimit[] => {
    // Окно сессии показывается всегда: пользователю важно видеть, что Claude его не сообщил.
    if (!window || window.utilization === null) {
      return label === SESSION_WINDOW_LABEL ? [{ label, usedPercent: null }] : []
    }
    const resetsAt = window.resets_at ? Date.parse(window.resets_at) : NaN
    return [
      {
        label,
        usedPercent: window.utilization,
        ...(Number.isFinite(resetsAt) && { resetsAt })
      }
    ]
  })
}

function blockId(messageId: string, index: number): string {
  return `${messageId}:${index}`
}

type ToolResultContent = Extract<
  Exclude<Extract<SDKMessage, { type: 'user' }>['message']['content'], string>[number],
  { type: 'tool_result' }
>['content']

function toolResultText(content: ToolResultContent): string {
  if (typeof content === 'string') {
    return content
  }
  return (content ?? []).flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
}

function stringField(input: unknown, key: string): string | undefined {
  if (typeof input === 'object' && input !== null) {
    const value = (input as Record<string, unknown>)[key]
    return typeof value === 'string' && value ? value : undefined
  }
  return undefined
}

/** Что показать в ленте о вызове инструмента Claude Code. */
function describeTool(
  name: string,
  input: unknown,
  cwd: string
): { tool: ToolKind; title: string } {
  const path = (key: string) => {
    const value = stringField(input, key)
    return value ? displayPath(value, cwd) : name
  }
  switch (name) {
    case 'Bash':
      return { tool: 'command', title: stringField(input, 'command') ?? name }
    case 'Read':
      return { tool: 'read', title: path('file_path') }
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return { tool: 'edit', title: path('file_path') }
    case 'NotebookEdit':
      return { tool: 'edit', title: path('notebook_path') }
    case 'Grep':
    case 'Glob':
      return { tool: 'search', title: stringField(input, 'pattern') ?? name }
    case 'WebFetch':
      return { tool: 'web', title: stringField(input, 'url') ?? name }
    case 'WebSearch':
      return { tool: 'web', title: stringField(input, 'query') ?? name }
    case 'Task':
    case 'Agent':
      return {
        tool: 'agent',
        title: stringField(input, 'description') ?? name
      }
    default:
      return { tool: 'other', title: describeMcpTool(name) }
  }
}

/** Инструменты MCP называются `mcp__сервер__инструмент` — показываем «сервер · инструмент». */
function describeMcpTool(name: string): string {
  const [prefix, server, ...tool] = name.split('__')
  return prefix === 'mcp' && server && tool.length > 0 ? `${server} · ${tool.join('__')}` : name
}
