import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import {
  query,
  type CanUseTool,
  type EffortLevel,
  type ElicitationRequest,
  type ElicitationResult,
  type ModelInfo,
  type Options,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import {
  limitOutput,
  type AgentCatalog,
  type ApprovalField,
  type InputField,
  type RequestAnswer,
  type AgentCommand,
  type AgentModel,
  type TimelineItem,
  type ToolKind
} from '../../shared/conversation'
import { AsyncQueue } from './asyncQueue'
import { displayPath, errorMessage } from './display'
import { elicitationContent, elicitationFields } from './elicitation'
import { UserRequests } from './userRequests'
import type { AgentDriver, AgentLaunch, AgentSession, SessionEvents, SessionOptions } from './types'

type ToolItem = Extract<TimelineItem, { kind: 'tool' }>

type ApprovalRequest = Parameters<CanUseTool>[2]

/** Что Claude узнаёт, когда пользователь отклонил вызов. */
const DENIED_MESSAGE =
  'The user declined this tool call. Do not retry it; ask the user how to proceed.'

/** Что Claude узнаёт, когда пользователь не стал отвечать на вопросы. */
const DISMISSED_MESSAGE = 'The user dismissed the questions without answering.'

/** Инструмент, которым Claude задаёт пользователю вопросы с вариантами ответа. */
const ASK_USER_QUESTION_TOOL = 'AskUserQuestion'

/** Инструмент, которым Claude просит одобрить план. */
const EXIT_PLAN_MODE_TOOL = 'ExitPlanMode'

/** Ответы на несколько вариантов Claude Code ждёт одной строкой через запятую. */
const MULTIPLE_ANSWERS_SEPARATOR = ', '

type StreamedKind = 'assistant' | 'reasoning'

/** Уровни эффорта, которые принимает Claude Code. */
const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

/** Строка списка моделей, которая означает «модель по умолчанию», а не отдельную модель. */
const DEFAULT_MODEL_ALIAS = 'default'

/**
 * Сколько символов текста в среднем приходится на токен: так оценивается ответ, пока модель
 * его пишет, — точное число Claude присылает только в конце каждого сообщения.
 */
const CHARS_PER_TOKEN = 4

/** Модель, которой Claude Code подписывает ответы своих встроенных команд, а не модели. */
const COMMAND_OUTPUT_MODEL = '<synthetic>'

/** Служебные команды Claude Code для его собственной инфраструктуры — не для людей. */
const INTERNAL_COMMAND_PREFIX = '__'

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

  catalog(launch) {
    return withIdleSession(launch, async (session) => toCatalog(await session.supportedModels()))
  },

  commands(launch) {
    return withIdleSession(launch, async (session) =>
      (await session.supportedCommands())
        .filter(({ name }) => !name.startsWith(INTERNAL_COMMAND_PREFIX))
        .map(({ name, description, argumentHint }): AgentCommand => ({
          name,
          description,
          ...(argumentHint && { argumentHint })
        }))
    )
  },

  start(options, events) {
    return new ClaudeSession(options, events)
  }
}

/**
 * Спрашивает что-то у Claude Code без разговора: сессия без сообщений к модели не обращается,
 * а списки моделей и команд отдаёт сразу.
 */
async function withIdleSession<T>(
  launch: AgentLaunch,
  read: (session: Query) => Promise<T>
): Promise<T> {
  const input = new AsyncQueue<SDKUserMessage>()
  const session = query({ prompt: input, options: launchOptions(launch) })
  try {
    return await read(session)
  } finally {
    input.end()
    session.close()
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
  /** Разрешения, вопросы и формы, на которые пользователь ещё не ответил. */
  private readonly requests: UserRequests
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
  /** Токены ответа на текущее сообщение: законченные сообщения модели и то, что пишется сейчас. */
  private readonly turnTokens = { finished: 0, message: 0, estimate: 0, reported: 0 }

  constructor(
    private readonly options: SessionOptions,
    private readonly events: SessionEvents
  ) {
    const { sessionId, selection } = options
    this.requests = new UserRequests(events)
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
        includePartialMessages: true,
        // Даже в режиме полного доступа инструмент может требовать подтверждения: например,
        // запись в боевую базу через MCP. Без этого обработчика Claude Code отклоняет такой
        // вызов сам, не спросив пользователя.
        canUseTool: (toolName, input, request) => this.canUseTool(toolName, input, request),
        // Без этого обработчика Claude Code отклоняет формы и ссылки MCP-серверов сам.
        onElicitation: (request, { signal }) => this.elicit(request, signal)
      }
    })
    void this.consume()
  }

  send(text: string, images: readonly string[]): void {
    this.interrupted = false
    Object.assign(this.turnTokens, { finished: 0, message: 0, estimate: 0, reported: 0 })
    if (images.length === 0) {
      this.input.push({
        type: 'user',
        message: { role: 'user', content: text },
        parent_tool_use_id: null
      })
      return
    }
    void userContent(text, images)
      .then((content) =>
        this.input.push({
          type: 'user',
          message: { role: 'user', content },
          parent_tool_use_id: null
        })
      )
      .catch((error) => {
        this.reportError(`Could not attach the image. ${errorMessage(error)}`)
        this.events.turnFinished()
      })
  }

  interrupt(): void {
    this.interrupted = true
    this.requests.cancelAll()
    this.session.interrupt().catch((error) => console.error('Failed to interrupt Claude', error))
  }

  answer(itemId: string, answer: RequestAnswer): void {
    this.requests.answer(itemId, answer)
  }

  close(): void {
    this.requests.cancelAll()
    this.input.end()
    this.session.close()
  }

  /** Вызов, о котором Claude Code спрашивает пользователя: вопросы, план или разрешение. */
  private async canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    { signal, title, displayName, description }: ApprovalRequest
  ): Promise<PermissionResult> {
    if (toolName === ASK_USER_QUESTION_TOOL) {
      return this.askQuestions(input, signal)
    }
    const answer = await this.requests.ask(
      {
        kind: 'approval',
        title:
          title ??
          (toolName === EXIT_PLAN_MODE_TOOL
            ? 'Approve the plan and let Claude start working?'
            : `Allow Claude to use ${displayName ?? toolLabel(toolName)}?`),
        ...(description && { description }),
        fields: approvalFields(input)
      },
      signal
    )
    return answer?.accepted
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: DENIED_MESSAGE }
  }

  /** Вопросы `AskUserQuestion`: ответы уходят Claude в поле `answers`, по тексту вопроса. */
  private async askQuestions(
    input: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<PermissionResult> {
    const fields = questionFields(input)
    const answer = await this.requests.ask(
      { kind: 'question', title: 'Claude has a question', fields },
      signal
    )
    if (!answer?.accepted) {
      return { behavior: 'deny', message: DISMISSED_MESSAGE }
    }
    const answers = Object.fromEntries(
      fields.flatMap(({ id }) => {
        const value = answer.values?.[id]
        const text = Array.isArray(value) ? value.join(MULTIPLE_ANSWERS_SEPARATOR) : value
        return text === undefined || text === '' ? [] : [[id, String(text)]]
      })
    )
    return { behavior: 'allow', updatedInput: { ...input, answers } }
  }

  /** Форма или ссылка от MCP-сервера. */
  private async elicit(
    request: ElicitationRequest,
    signal: AbortSignal
  ): Promise<ElicitationResult> {
    const fields = request.mode === 'url' ? [] : elicitationFields(request.requestedSchema)
    const source = `From the ${request.serverName} MCP server`
    // Сервер просит только подтверждения — это разрешение, а не форма.
    const answer = await this.requests.ask(
      request.mode !== 'url' && fields.length === 0
        ? {
            kind: 'approval',
            title: request.title ?? request.message,
            description: request.description ?? (request.title ? request.message : source),
            fields: []
          }
        : {
            kind: 'question',
            title: request.message,
            description: source,
            ...(request.mode === 'url' && request.url && { url: request.url }),
            fields
          },
      signal
    )
    if (!answer) {
      return { action: 'cancel' }
    }
    if (!answer.accepted) {
      return { action: 'decline' }
    }
    return request.mode === 'url'
      ? { action: 'accept' }
      : { action: 'accept', content: elicitationContent(answer.values) }
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
      this.requests.cancelAll()
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
        } else if (message.subtype === 'local_command_output') {
          this.events.item({
            kind: 'assistant',
            id: message.uuid,
            text: message.content,
            commandOutput: true
          })
        }
        break
      case 'stream_event':
        this.handleStreamEvent(message.event)
        break
      case 'assistant':
        this.handleAssistantMessage(
          message.message.id,
          message.message.content,
          message.message.model === COMMAND_OUTPUT_MODEL
        )
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
        this.turnTokens.message = 0
        this.turnTokens.estimate = 0
        break
      case 'message_delta':
        this.turnTokens.message = event.usage.output_tokens
        this.reportTokens()
        break
      case 'message_stop': {
        const { message, estimate } = this.turnTokens
        this.turnTokens.finished += Math.max(message, estimate)
        this.turnTokens.message = 0
        this.turnTokens.estimate = 0
        break
      }
      case 'content_block_delta': {
        if (!this.streamingMessageId) {
          return
        }
        const messageId = this.streamingMessageId
        const id = blockId(messageId, event.index)
        this.estimateTokens(event.delta)
        if (event.delta.type === 'text_delta') {
          this.stream(messageId, id, 'assistant', event.delta.text)
        } else if (event.delta.type === 'thinking_delta') {
          this.stream(messageId, id, 'reasoning', event.delta.thinking)
        }
        break
      }
    }
  }

  private estimateTokens(
    delta: Extract<
      Extract<SDKMessage, { type: 'stream_event' }>['event'],
      { type: 'content_block_delta' }
    >['delta']
  ): void {
    const text =
      delta.type === 'text_delta'
        ? delta.text
        : delta.type === 'thinking_delta'
          ? delta.thinking
          : delta.type === 'input_json_delta'
            ? delta.partial_json
            : ''
    if (text) {
      this.turnTokens.estimate += text.length / CHARS_PER_TOKEN
      this.reportTokens()
    }
  }

  private reportTokens(): void {
    const { finished, message, estimate, reported } = this.turnTokens
    const total = Math.round(finished + Math.max(message, estimate))
    // Окно получает новое число, только когда оно изменилось, а не на каждый кусочек текста.
    if (total !== reported) {
      this.turnTokens.reported = total
      this.events.tokens(total)
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
    content: Extract<SDKMessage, { type: 'assistant' }>['message']['content'],
    commandOutput: boolean
  ): void {
    for (const block of content) {
      // Без потока (например, у продолженной сессии) номер блока в сообщении неизвестен.
      const fallback = `${messageId}:${randomUUID()}`
      switch (block.type) {
        case 'text':
          if (block.text) {
            const id = this.takeStreamedId(messageId, 'assistant', fallback)
            this.events.item({
              kind: 'assistant',
              id,
              text: block.text,
              ...(commandOutput && { commandOutput })
            })
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

  /** Заполненность контекста — то же, что показывает `/context`. */
  private async reportUsage(): Promise<void> {
    const context = await this.session.getContextUsage().catch(() => null)
    if (context) {
      this.events.usage({ context: { used: context.totalTokens, limit: context.maxTokens } })
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

/** Инструменты MCP называются `mcp__сервер__инструмент`. */
function parseMcpTool(name: string): { server: string; tool: string } | null {
  const [prefix, server, ...tool] = name.split('__')
  return prefix === 'mcp' && server && tool.length > 0 ? { server, tool: tool.join('__') } : null
}

/** Вызов MCP в ленте — «сервер · инструмент». */
function describeMcpTool(name: string): string {
  const mcp = parseMcpTool(name)
  return mcp ? `${mcp.server} · ${mcp.tool}` : name
}

/** Инструмент в вопросе о разрешении: «sql write (granite-prod)». */
function toolLabel(name: string): string {
  const mcp = parseMcpTool(name)
  return mcp ? `${mcp.tool.replaceAll('_', ' ')} (${mcp.server})` : name
}

/** Вопросы `AskUserQuestion` как поля карточки; ответ Claude ждёт по тексту вопроса. */
function questionFields(input: Record<string, unknown>): InputField[] {
  const questions = Array.isArray(input['questions']) ? input['questions'] : []
  return questions.flatMap((question: unknown): InputField[] => {
    const text = stringField(question, 'question')
    if (!text) {
      return []
    }
    const record = question as Record<string, unknown>
    const options = Array.isArray(record['options']) ? record['options'] : []
    return [
      {
        id: text,
        label: stringField(question, 'header') ?? text,
        description: text,
        type: 'choice',
        options: options.flatMap((option: unknown) => {
          const label = stringField(option, 'label')
          const description = stringField(option, 'description')
          return label ? [{ value: label, label, ...(description && { description }) }] : []
        }),
        multiple: record['multiSelect'] === true,
        allowOther: true,
        required: true
      }
    ]
  })
}

/** Параметры вызова для карточки разрешения: строки как есть, остальное — JSON. */
function approvalFields(input: Record<string, unknown>): ApprovalField[] {
  return Object.entries(input).flatMap(([name, value]) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    return text === undefined ? [] : [{ name, value: text }]
  })
}

/** Форматы картинок, которые Claude принимает прямо в сообщении. */
const IMAGE_MEDIA_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
} as const

/** Больше этого картинку в сообщение не вложить: после base64 она превысит лимит API в 5 МБ. */
const MAX_INLINE_IMAGE_BYTES = Math.floor((5 * 1024 * 1024 * 3) / 4)

type UserContent = Exclude<Extract<SDKUserMessage['message'], { role: 'user' }>['content'], string>

/**
 * Текст и картинки сообщения. Картинку, которую нельзя вложить (большая или в другом
 * формате), Claude получает путём к файлу и откроет её сам.
 */
async function userContent(text: string, images: readonly string[]): Promise<UserContent> {
  const blocks: UserContent = []
  const notAttached: string[] = []
  for (const path of images) {
    const mediaType =
      IMAGE_MEDIA_TYPES[extname(path).toLowerCase() as keyof typeof IMAGE_MEDIA_TYPES]
    const data = mediaType ? await readFile(path) : null
    if (mediaType && data && data.length <= MAX_INLINE_IMAGE_BYTES) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: data.toString('base64') }
      })
    } else {
      notAttached.push(path)
    }
  }
  const fullText = [text, ...notAttached.map((path) => `[Image: ${path}]`)]
    .filter(Boolean)
    .join('\n')
  if (fullText) {
    blocks.push({ type: 'text', text: fullText })
  }
  return blocks
}
