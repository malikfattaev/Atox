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
  type TimelineItem,
  type ToolKind
} from '../../shared/conversation'
import { AsyncQueue } from './asyncQueue'
import { displayPath, errorMessage } from './display'
import type {
  AgentDriver,
  AgentLaunch,
  AgentSession,
  SessionEvents,
  SessionOptions
} from './types'

type ToolItem = Extract<TimelineItem, { kind: 'tool' }>

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
    models: listed.map(
      (model): AgentModel => ({
        id: model.value,
        name: model.displayName,
        efforts: model.supportedEffortLevels ?? [],
        ...(model.value.startsWith(PINNED_MODEL_PREFIX) && { secondary: true })
      })
    )
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
  /** Элементы, которые уже появились в ленте, пока агент печатал ответ. */
  private readonly streamed = new Set<string>()
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
    this.session
      .interrupt()
      .catch((error) => console.error('Failed to interrupt Claude', error))
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
      this.events.item({ kind: 'error', id: randomUUID(), message: errorMessage(error) })
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
        this.events.turnFinished()
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
        const id = blockId(this.streamingMessageId, event.index)
        if (event.delta.type === 'text_delta') {
          this.stream(id, 'assistant', event.delta.text)
        } else if (event.delta.type === 'thinking_delta') {
          this.stream(id, 'reasoning', event.delta.thinking)
        }
        break
      }
    }
  }

  /** Часть текста, пока модель его печатает; первая часть создаёт элемент ленты. */
  private stream(id: string, kind: 'assistant' | 'reasoning', delta: string): void {
    if (!delta) {
      return
    }
    if (this.streamed.has(id)) {
      this.events.delta(id, 'text', delta)
    } else {
      this.streamed.add(id)
      this.events.item({ kind, id, text: delta })
    }
  }

  private handleAssistantMessage(
    messageId: string,
    content: Extract<SDKMessage, { type: 'assistant' }>['message']['content']
  ): void {
    content.forEach((block, index) => {
      const id = blockId(messageId, index)
      switch (block.type) {
        case 'text':
          if (block.text) {
            this.events.item({ kind: 'assistant', id, text: block.text })
          }
          break
        case 'thinking':
          if (block.thinking) {
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
      this.streamed.delete(id)
    })
  }

  private handleToolResults(content: Extract<SDKMessage, { type: 'user' }>['message']['content']): void {
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

  private reportError(message: string): void {
    this.events.item({ kind: 'error', id: randomUUID(), message })
  }
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
  return (content ?? [])
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n')
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
      return { tool: 'agent', title: stringField(input, 'description') ?? name }
    default:
      return { tool: 'other', title: describeMcpTool(name) }
  }
}

/** Инструменты MCP называются `mcp__сервер__инструмент` — показываем «сервер · инструмент». */
function describeMcpTool(name: string): string {
  const [prefix, server, ...tool] = name.split('__')
  return prefix === 'mcp' && server && tool.length > 0 ? `${server} · ${tool.join('__')}` : name
}
