import { randomUUID } from 'node:crypto'
import {
  limitOutput,
  type AgentCatalog,
  type ApprovalField,
  type ContextReport,
  type PlanLimit,
  type InputField,
  type ModelSelection,
  type RequestAnswer,
  type TimelineItem,
  type ToolStatus
} from '../../shared/conversation'
import { imageTypeOfData } from '../images'
import { savePastedImage } from '../pastedImages'
import { displayPath, errorMessage } from './display'
import { elicitationContent, elicitationFields } from './elicitation'
import {
  MCP_STARTUP_NOTIFICATION,
  readCodexMcpServers,
  readCodexPlugins,
  readCodexSkills,
  type McpStartupUpdate
} from './codexIntegrations'
import { JsonRpcProcess, type JsonRpcHandlers } from './jsonRpc'
import { withTimeout } from './timeout'
import type { AgentDriver, AgentLaunch, AgentSession, SessionEvents, SessionOptions } from './types'
import { UserRequests, type NewRequest } from './userRequests'

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

interface TokenUsageBreakdown {
  totalTokens: number
  inputTokens: number
  /** Часть входа, взятая из кэша. */
  cachedInputTokens: number
  outputTokens: number
}

interface TokenUsage {
  /** С начала треда. */
  total: TokenUsageBreakdown
  /** Последний запрос к модели; за ход их бывает много — по запросу на каждый вызов инструмента. */
  last: TokenUsageBreakdown
  modelContextWindow: number | null
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
  | {
      type: 'imageGeneration'
      id: string
      /** `in_progress`, `completed` или `failed`. */
      status: string
      /** Картинка в base64; пустая строка — её ещё нет. */
      result?: string
      /** Куда Codex сохранил картинку. */
      savedPath?: string
      failure?: { type: string } | null
    }

type GeneratedImage = Extract<CodexItem, { type: 'imageGeneration' }>
type ImageItem = Extract<TimelineItem, { kind: 'image' }>

/** Остальные виды элементов (план, сжатие контекста и т. п.) в ленту не попадают. */
type AnyCodexItem = CodexItem | { type: string; id: string }

interface ElicitationParams {
  serverName: string
  mode: string
  message: string
  url?: string
  requestedSchema?: unknown
  _meta?: { codex_approval_kind?: string } | null
}

interface UserInputQuestion {
  id: string
  header: string
  question: string
  isOther: boolean
  isSecret: boolean
  options: { label: string; description: string }[] | null
}

/**
 * Полный доступ без песочницы, как у агента в терминале. Подтверждения не отключены
 * совсем (`never`): тогда Codex сам отклоняет формы MCP-серверов, не спросив пользователя.
 * С `on-request` они приходят Atox, а команды при полном доступе подтверждения не требуют.
 */
const FULL_ACCESS = {
  approvalPolicy: 'on-request',
  sandbox: 'danger-full-access'
} as const

/**
 * Так Codex помечает свой вопрос «разрешить ли вызов инструмента MCP». При полном доступе
 * Atox разрешает такие вызовы сам — как Codex в режиме без подтверждений.
 */
const MCP_TOOL_CALL_APPROVAL = 'mcp_tool_call'

/**
 * Команды Codex приходят обёрнутыми в оболочку: `/bin/zsh -lc 'git status'`, а простые —
 * и без кавычек: `/bin/zsh -lc ls`.
 */
const SHELL_WRAPPER = /^\S*\b(?:ba|z)?sh\s+-l?c\s+(?:(['"])([\s\S]*)\1|([^'"\s][\s\S]*))$/

export function createCodexDriver(client: ClientInfo): AgentDriver {
  return {
    agent: 'codex',

    catalog(launch) {
      return withAppServer(launch, client, async (rpc) => {
        const { data } = await rpc.request<{ data: CodexModel[] }>('model/list', {})
        return toCatalog(data)
      })
    },

    // Codex выполняет команды «/…» только в своём терминальном интерфейсе, а не в app-server.
    commands: () => Promise.resolve([]),

    plugins(launch) {
      return withAppServer(launch, client, (rpc) => readCodexPlugins(rpc, launch.cwd))
    },

    skills(launch) {
      return withAppServer(launch, client, (rpc) => readCodexSkills(rpc, launch.cwd))
    },

    mcpServers(launch) {
      const startupErrors = new Map<string, string>()
      return withAppServer(
        launch,
        client,
        (rpc) => readCodexMcpServers(rpc, launch.cwd, startupErrors),
        (method, params) => {
          if (method === MCP_STARTUP_NOTIFICATION) {
            const { name, error } = params as McpStartupUpdate
            if (error) {
              startupErrors.set(name, error)
            }
          }
        }
      )
    },

    start(options, events) {
      return new CodexSession(options, events, client)
    },

    limits(launch) {
      return withAppServer(launch, client, readCodexLimits)
    },

    context: () => Promise.reject(new Error(UNSUPPORTED_COMMAND))
  }
}

const UNSUPPORTED_COMMAND = 'Codex does not report this.'

function startAppServer(
  { executable, cwd, env }: AgentLaunch,
  handlers: ConstructorParameters<typeof JsonRpcProcess>[3]
): JsonRpcProcess {
  return new JsonRpcProcess(executable, ['app-server'], { cwd, env }, handlers)
}

/**
 * Спрашивает что-то у отдельного `codex app-server` и сразу его останавливает — и тогда,
 * когда он завис и не ответил вовремя. `notification` — уведомления, которые Codex присылает,
 * пока отвечает.
 */
async function withAppServer<T>(
  launch: AgentLaunch,
  client: ClientInfo,
  read: (rpc: JsonRpcProcess) => Promise<T>,
  notification: JsonRpcHandlers['notification'] = () => undefined
): Promise<T> {
  const rpc = startAppServer(launch, {
    notification,
    request: () => Promise.reject(new Error('Not supported')),
    exit: () => undefined
  })
  const ask = async () => {
    await initialize(rpc, client)
    return read(rpc)
  }
  try {
    return await withTimeout(ask())
  } finally {
    rpc.kill()
  }
}

/** Окно лимита Codex: `usedPercent` — 0–100, `resetsAt` — в секундах. */
interface CodexRateLimitWindow {
  usedPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}

interface CodexRateLimits {
  primary: CodexRateLimitWindow | null
  secondary: CodexRateLimitWindow | null
}

const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR

/** Названия окон Codex по длительности — полное, как в его `/status`, и короткое. */
const CODEX_WINDOW_NAMES: ReadonlyMap<number, { label: string; shortLabel: string }> = new Map([
  [5 * MINUTES_PER_HOUR, { label: '5-hour limit', shortLabel: '5h' }],
  [7 * MINUTES_PER_DAY, { label: 'Weekly limit', shortLabel: 'Week' }],
  [30 * MINUTES_PER_DAY, { label: 'Monthly limit', shortLabel: 'Month' }]
])

/**
 * Лимиты подписки Codex: основное окно и, если есть, дополнительное. Пустой список —
 * Codex работает по ключу API, и лимитов подписки у него нет.
 */
async function readCodexLimits(rpc: JsonRpcProcess): Promise<PlanLimit[]> {
  const { rateLimits } = await rpc.request<{ rateLimits: CodexRateLimits | null }>(
    'account/rateLimits/read',
    {}
  )
  return [rateLimits?.primary, rateLimits?.secondary].flatMap((window): PlanLimit[] =>
    window
      ? [
          {
            ...codexWindowName(window.windowDurationMins),
            percent: window.usedPercent,
            ...(window.resetsAt !== null && { resetsAt: window.resetsAt * 1000 })
          }
        ]
      : []
  )
}

/** «5-hour limit», «Weekly limit»; окно непривычной длины — «12-hour limit», «3-day limit». */
function codexWindowName(minutes: number | null): { label: string; shortLabel: string } {
  if (minutes === null) {
    return { label: 'Usage limit', shortLabel: 'Limit' }
  }
  const known = CODEX_WINDOW_NAMES.get(minutes)
  if (known) {
    return known
  }
  const [count, unit, short] =
    minutes % MINUTES_PER_DAY === 0
      ? [minutes / MINUTES_PER_DAY, 'day', 'd']
      : [Math.round(minutes / MINUTES_PER_HOUR), 'hour', 'h']
  return { label: `${count}-${unit} limit`, shortLabel: `${count}${short}` }
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

/** Части сводки рассуждений разделяются в ленте пустой строкой — как в готовом элементе. */
const SUMMARY_PART_SEPARATOR = '\n\n'

/** Сколько раз пробовать остановить ход, который Codex ещё не успел запустить. */
const INTERRUPT_ATTEMPTS = 20
const INTERRUPT_RETRY_MS = 100

class CodexSession implements AgentSession {
  private readonly rpc: JsonRpcProcess
  /** Тред Codex, когда он открыт: сообщения ждут его. */
  private readonly thread: Promise<string>
  private turnId: string | null = null
  /** Ход остановили раньше, чем Codex сообщил его id: остановим, как только id придёт. */
  private interruptRequested = false
  /** Вопросы и разрешения, которых Codex ждёт от пользователя. */
  private readonly requests: UserRequests
  /** Ожидающие ответа запросы Codex по их id: Codex может отозвать запрос сам. */
  private readonly requestSignals = new Map<number | string, AbortController>()
  /** Модель и эффорт разговора — известны, когда тред открыт. */
  private selection: Partial<ModelSelection> = {}
  /**
   * Сколько токенов тред написал до текущего хода: счётчик хода — разница с итогом треда.
   * Codex сообщает лишь итог треда и последний запрос, а запросов за ход бывает много.
   */
  private turnTokenBase: { turnId: string; outputTokens: number } | null = null
  /** Сколько токенов треда уже учтено в тратах; `null` — тред ещё не сообщал о токенах. */
  private spentTotal: TokenUsageBreakdown | null = null
  /** Номер части сводки, которую сейчас пишет каждое рассуждение. */
  private readonly summaryParts = new Map<string, number>()

  constructor(
    private readonly options: SessionOptions,
    private readonly events: SessionEvents,
    client: ClientInfo
  ) {
    this.requests = new UserRequests(events)
    this.rpc = startAppServer(options, {
      notification: (method, params) => this.handleNotification(method, params),
      request: (method, params, id) => this.handleRequest(method, params, id),
      exit: (error) => {
        if (error) {
          this.reportError(errorMessage(error))
        }
        this.requests.cancelAll()
        events.closed()
      }
    })
    this.thread = this.openThread(client)
    // Ошибку открытия сообщит первое сообщение, которое будет его ждать. Процесс с неоткрытым
    // разговором бесполезен: он завершается, и следующее сообщение запустит Codex заново.
    this.thread.catch(() => this.rpc.kill())
  }

  send(text: string, images: readonly string[]): void {
    this.interruptRequested = false
    this.thread
      .then((threadId) =>
        this.rpc.request<{ turn: Turn }>('turn/start', {
          threadId,
          input: [
            ...(text ? [{ type: 'text', text, text_elements: [] }] : []),
            ...images.map((path) => ({ type: 'localImage', path }))
          ],
          ...(this.selection.model && { model: this.selection.model }),
          ...(this.selection.effort && { effort: this.selection.effort })
        })
      )
      .then(({ turn }) => {
        this.startTurn(turn.id)
      })
      .catch((error) => {
        // Если упал сам процесс, об этом уже сообщил его выход.
        if (this.rpc.alive) {
          this.reportError(errorMessage(error))
          this.events.turnFinished()
        }
      })
  }

  interrupt(): Promise<void> {
    const turnId = this.turnId
    if (!turnId) {
      this.interruptRequested = true
      return Promise.resolve()
    }
    return this.interruptTurn(turnId)
  }

  answer(itemId: string, answer: RequestAnswer): void {
    this.requests.answer(itemId, answer)
  }

  limits(): Promise<PlanLimit[]> {
    return withTimeout(readCodexLimits(this.rpc))
  }

  context(): Promise<ContextReport> {
    return Promise.reject(new Error(UNSUPPORTED_COMMAND))
  }

  close(): void {
    this.requests.cancelAll()
    this.rpc.kill()
  }

  /** Запрос Codex к пользователю: разрешение, вопросы или форма MCP-сервера. */
  private async handleRequest(method: string, params: unknown, id: number | string) {
    const controller = new AbortController()
    this.requestSignals.set(id, controller)
    try {
      return await this.answerRequest(method, params, controller.signal)
    } finally {
      this.requestSignals.delete(id)
    }
  }

  private async answerRequest(method: string, params: unknown, signal: AbortSignal) {
    const ask = (request: NewRequest) => this.requests.ask(request, signal)
    switch (method) {
      case 'item/commandExecution/requestApproval': {
        const answer = await ask({
          kind: 'approval',
          title: 'Allow Codex to run this command?',
          fields: fieldsOf(params, ['command', 'cwd', 'reason'])
        })
        return { decision: decision(answer) }
      }
      case 'item/fileChange/requestApproval': {
        const answer = await ask({
          kind: 'approval',
          title: 'Allow Codex to change files?',
          fields: fieldsOf(params, ['reason', 'grantRoot'])
        })
        return { decision: decision(answer) }
      }
      case 'item/permissions/requestApproval': {
        const { permissions } = params as {
          permissions: Record<string, unknown>
        }
        const answer = await ask({
          kind: 'approval',
          title: 'Allow Codex extra permissions?',
          fields: fieldsOf(params, ['reason', 'cwd', 'permissions'])
        })
        return {
          permissions: answer?.accepted ? permissions : {},
          scope: 'turn'
        }
      }
      case 'item/tool/requestUserInput': {
        const { questions } = params as { questions: UserInputQuestion[] }
        const answer = await ask({
          kind: 'question',
          title: 'Codex has a question',
          fields: questions.map(questionField)
        })
        if (!answer?.accepted) {
          return { answers: {} }
        }
        return {
          answers: Object.fromEntries(
            questions.map(({ id }) => {
              const value = answer.values?.[id]
              const answers = Array.isArray(value)
                ? value
                : value === undefined
                  ? []
                  : [String(value)]
              return [id, { answers }]
            })
          )
        }
      }
      case 'mcpServer/elicitation/request':
        return this.elicit(params as ElicitationParams, ask)
      default:
        throw new Error(`Atox does not handle ${method}`)
    }
  }

  /** Форма или ссылка от MCP-сервера. */
  private async elicit(
    params: ElicitationParams,
    ask: (request: NewRequest) => Promise<RequestAnswer | null>
  ) {
    if (params._meta?.codex_approval_kind === MCP_TOOL_CALL_APPROVAL) {
      return { action: 'accept', content: {}, _meta: null }
    }
    const url = params.mode === 'url' ? params.url : undefined
    const fields = url ? [] : elicitationFields(params.requestedSchema)
    const source = `From the ${params.serverName} MCP server`
    const answer = await ask(
      !url && fields.length === 0
        ? {
            kind: 'approval',
            title: params.message,
            description: source,
            fields: []
          }
        : {
            kind: 'question',
            title: params.message,
            description: source,
            ...(url && { url }),
            fields
          }
    )
    if (!answer) {
      return { action: 'cancel', content: null, _meta: null }
    }
    if (!answer.accepted) {
      return { action: 'decline', content: null, _meta: null }
    }
    return {
      action: 'accept',
      content: url ? null : elicitationContent(answer.values),
      _meta: null
    }
  }

  /**
   * Только что начатый ход Codex ещё не считает активным и отвечает «no active turn»:
   * остановку повторяют, пока ход не станет активным или не закончится сам.
   */
  private async interruptTurn(turnId: string): Promise<void> {
    const threadId = await this.thread
    for (let attempt = 1; ; attempt++) {
      try {
        await this.rpc.request('turn/interrupt', { threadId, turnId })
        return
      } catch (error) {
        if (this.turnId !== turnId || !this.rpc.alive) {
          return
        }
        if (attempt >= INTERRUPT_ATTEMPTS) {
          throw error
        }
        await new Promise((resolve) => setTimeout(resolve, INTERRUPT_RETRY_MS))
      }
    }
  }

  /** Codex сообщил id хода — из ответа на turn/start или уведомления, что придёт раньше. */
  private startTurn(turnId: string): void {
    if (this.turnId) {
      return
    }
    this.turnId = turnId
    if (this.interruptRequested) {
      this.interruptRequested = false
      // Остановку уже просили раньше, и ждать её некому: зависший ход закроет запасной путь
      // менеджера разговоров по таймауту.
      this.interrupt().catch((error) => console.error('Failed to interrupt Codex', error))
    }
  }

  private async openThread(client: ClientInfo): Promise<string> {
    await initialize(this.rpc, client)
    const { cwd, sessionId } = this.options
    this.selection = await this.resolveSelection()
    const params = {
      cwd,
      ...FULL_ACCESS,
      ...(this.selection.model && { model: this.selection.model })
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
    return response.thread.id
  }

  /**
   * Модель и эффорт, с которыми работать. Без них Codex взял бы свои из config.toml, а там
   * может стоять модель, недоступная аккаунту, или эффорт, которого нет у модели. Поэтому то,
   * что не выбрано в чате, берётся из списка моделей, который Codex отдаёт для этого аккаунта, —
   * того же, что показывает меню модели.
   */
  private async resolveSelection(): Promise<Partial<ModelSelection>> {
    const chosen = this.options.selection ?? {}
    if (chosen.model && chosen.effort) {
      return chosen
    }
    const catalog = await this.rpc
      .request<{ data: CodexModel[] }>('model/list', {})
      .then(({ data }) => toCatalog(data))
      .catch(() => null)
    const modelId = chosen.model ?? catalog?.defaultModel
    const effort =
      chosen.effort ?? catalog?.models.find(({ id }) => id === modelId)?.defaultEffort
    return { ...(modelId && { model: modelId }), ...(effort && { effort }) }
  }

  private handleNotification(method: string, params: unknown): void {
    if (method === 'serverRequest/resolved') {
      // Codex больше не ждёт ответа — например, ход остановили: карточка закрывается.
      const { requestId } = params as { requestId: number | string }
      this.requestSignals.get(requestId)?.abort()
      return
    }
    switch (method) {
      case 'turn/started':
        this.startTurn((params as { turn: Turn }).turn.id)
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
        const source = (params as { item: AnyCodexItem }).item
        const item = toTimelineItem(source, this.options.cwd)
        if (item) {
          this.events.item(item)
        }
        if (method === 'item/completed') {
          this.summaryParts.delete(source.id)
        }
        if (item?.kind === 'image' && item.status === 'done' && !item.path) {
          void this.saveGeneratedImage(item, source as GeneratedImage)
        }
        break
      }
      case 'item/agentMessage/delta': {
        const { itemId, delta } = params as { itemId: string; delta: string }
        this.events.delta(itemId, 'text', delta)
        break
      }
      case 'item/reasoning/summaryTextDelta': {
        const { itemId, delta, summaryIndex } = params as {
          itemId: string
          delta: string
          summaryIndex: number
        }
        // Новая часть сводки начинается с новой строки, а не продолжает прежнюю слитно.
        const previous = this.summaryParts.get(itemId)
        this.summaryParts.set(itemId, summaryIndex)
        const separator = previous !== undefined && previous !== summaryIndex
        this.events.delta(itemId, 'text', separator ? SUMMARY_PART_SEPARATOR + delta : delta)
        break
      }
      case 'thread/tokenUsage/updated': {
        const { turnId, tokenUsage } = params as { turnId: string; tokenUsage: TokenUsage }
        const { total, last } = tokenUsage
        if (this.turnTokenBase?.turnId !== turnId) {
          // Первое сообщение о ходе: до него тред написал итог без этого запроса.
          this.turnTokenBase = { turnId, outputTokens: total.outputTokens - last.outputTokens }
        }
        this.events.tokens(total.outputTokens - this.turnTokenBase.outputTokens)
        this.reportSpent(total, last)
        if (tokenUsage.modelContextWindow) {
          this.events.usage({
            context: {
              used: tokenUsage.last.totalTokens,
              limit: tokenUsage.modelContextWindow
            }
          })
        }
        break
      }
      case 'item/commandExecution/outputDelta': {
        const { itemId, delta } = params as { itemId: string; delta: string }
        this.events.delta(itemId, 'output', delta)
        break
      }
    }
  }

  /**
   * Тред считает токены с самого начала, а в тратах нужны только новые: берём разницу с прошлым
   * сообщением. Первое сообщение после возобновления треда не должно вернуть всю прежнюю историю,
   * поэтому из него берётся лишь последний запрос.
   */
  private reportSpent(total: TokenUsageBreakdown, last: TokenUsageBreakdown): void {
    const previous = this.spentTotal ?? {
      totalTokens: 0,
      inputTokens: total.inputTokens - last.inputTokens,
      cachedInputTokens: total.cachedInputTokens - last.cachedInputTokens,
      outputTokens: total.outputTokens - last.outputTokens
    }
    this.spentTotal = total
    const cached = Math.max(0, total.cachedInputTokens - previous.cachedInputTokens)
    this.events.spent({
      // Вход в Codex считается вместе с кэшем, а здесь они раздельно.
      input: Math.max(0, total.inputTokens - previous.inputTokens - cached),
      output: Math.max(0, total.outputTokens - previous.outputTokens),
      cached
    })
  }

  /**
   * Codex не сохранил картинку файлом (так бывает у старых версий) — Atox сохраняет её сам:
   * окно показывает картинки из файлов, а агенты получают их путями.
   */
  private async saveGeneratedImage(item: ImageItem, source: GeneratedImage): Promise<void> {
    try {
      const data = Buffer.from(source.result ?? '', 'base64')
      const type = imageTypeOfData(data)
      if (!type) {
        throw new Error('Codex returned an image in an unknown format.')
      }
      const path = await savePastedImage(data, type)
      this.events.item({ ...item, path })
    } catch (error) {
      this.events.item({ ...item, status: 'failed', error: errorMessage(error) })
    }
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
        text: item.summary.join(SUMMARY_PART_SEPARATOR)
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
    case 'imageGeneration':
      return imageItem(item)
    default:
      return null
  }
}

function imageItem(item: GeneratedImage): ImageItem {
  switch (item.status) {
    case 'completed':
      return {
        kind: 'image',
        id: item.id,
        status: 'done',
        ...(item.savedPath && { path: item.savedPath })
      }
    case 'failed':
      return {
        kind: 'image',
        id: item.id,
        status: 'failed',
        error:
          item.failure?.type === 'usageLimitExceeded'
            ? 'The image generation limit is reached.'
            : 'Codex could not generate the image.'
      }
    default:
      return { kind: 'image', id: item.id, status: 'running' }
  }
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
  return match?.[2] ?? match?.[3] ?? command
}

/** Ответ на разрешение команды или правки: `cancel` — ответа не будет, агента остановили. */
function decision(answer: RequestAnswer | null): 'accept' | 'decline' | 'cancel' {
  return !answer ? 'cancel' : answer.accepted ? 'accept' : 'decline'
}

/** Заполненные поля запроса Codex для карточки разрешения. */
function fieldsOf(params: unknown, keys: readonly string[]): ApprovalField[] {
  const record = (params ?? {}) as Record<string, unknown>
  return keys.flatMap((name) => {
    const value = record[name]
    if (value === null || value === undefined || value === '') {
      return []
    }
    return [
      {
        name,
        value: typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      }
    ]
  })
}

function questionField(question: UserInputQuestion): InputField {
  const options = question.options ?? []
  return {
    id: question.id,
    label: question.header || question.question,
    description: question.question,
    ...(options.length > 0
      ? {
          type: 'choice',
          options: options.map(({ label, description }) => ({
            value: label,
            label,
            ...(description && { description })
          })),
          allowOther: question.isOther
        }
      : { type: 'text' }),
    ...(question.isSecret && { secret: true }),
    required: true
  }
}
