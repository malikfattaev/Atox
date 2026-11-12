import type { AgentId } from '../../shared/agents'
import type { TokenCounts } from '../../shared/tokenSpend'
import type {
  AgentCatalog,
  AgentCommand,
  BackgroundTask,
  ContextReport,
  ConversationUsage,
  ModelSelection,
  PlanLimit,
  RequestAnswer,
  StreamedField,
  TimelineItem
} from '../../shared/conversation'
import type { McpServerInfo, PluginInfo, SkillInfo } from '../../shared/integrations'

/** Как запустить программу агента. */
export interface AgentLaunch {
  /** Путь к программе агента. */
  executable: string
  /** Окружение процесса агента. */
  env: Record<string, string>
  /** Папка, в которой работает агент. */
  cwd: string
}

export interface SessionOptions extends AgentLaunch {
  /** Разговор на стороне агента, который нужно продолжить; нет — начать новый. */
  sessionId?: string
  /** Модель и эффорт; нет — по умолчанию у агента. */
  selection?: Partial<ModelSelection>
  /** Открывает ссылку в браузере: например, вход в аккаунт по команде `/login`. */
  openLink(url: string): void
  /** Агент только что вошёл в аккаунт: лимиты подписки нужно перечитать. */
  onAccountChanged(): void
}

/** Что сессия сообщает о работе агента. */
export interface SessionEvents {
  /** Новый элемент ленты или его новая версия с тем же `id`. */
  item(item: TimelineItem): void
  /** Продолжение текста элемента, который агент ещё пишет. */
  delta(itemId: string, field: StreamedField, delta: string): void
  /** Агент закончил отвечать на сообщение — успешно, с ошибкой или по остановке. */
  turnFinished(): void
  /** Сколько токенов агент написал с начала ответа на текущее сообщение. */
  tokens(turnTokens: number): void
  /** Токены, которые агент только что потратил: учитываются в итогах по дням. */
  spent(counts: TokenCounts): void
  /** Агент сообщил, насколько заполнен контекст и сколько осталось лимитов подписки. */
  usage(usage: ConversationUsage): void
  /** Фоновые задачи агента изменились: здесь — все, что работают сейчас. */
  backgroundTasks(tasks: BackgroundTask[]): void
  /** Агент сообщил идентификатор разговора, по которому его можно продолжить. */
  sessionStarted(sessionId: string): void
  /** Процесс агента завершился: сессией больше пользоваться нельзя. */
  closed(): void
}

/** Разговор с запущенным агентом. Сообщения отправляются по одному: следующее — после `turnFinished`. */
export interface AgentSession {
  /** `images` — пути к картинкам, приложенным к сообщению. */
  send(text: string, images: readonly string[]): void
  /**
   * Просит агента остановить текущую работу; закончит он её событием `turnFinished`.
   * Отклоняется, если агент не принял просьбу: тогда остановить его может только `close`.
   */
  interrupt(): Promise<void>
  /** Ответ пользователя на запрос агента — элемент ленты `approval` или `question` с этим `id`. */
  answer(itemId: string, answer: RequestAnswer): void
  /** Лимиты подписки; пустой список — агент работает не по подписке. */
  limits(): Promise<PlanLimit[]>
  /** Из чего сейчас состоит контекст разговора. */
  context(): Promise<ContextReport>
  close(): void
}

/** Подключение к агенту через его служебный протокол. */
export interface AgentDriver {
  readonly agent: AgentId
  /** Модели, доступные агенту на этом компьютере. */
  catalog(launch: AgentLaunch): Promise<AgentCatalog>
  /** Команды, которые агент выполняет из сообщения вида `/команда`, — в папке проекта. */
  commands(launch: AgentLaunch): Promise<AgentCommand[]>
  /** Плагины, которые агент загружает в папке проекта. */
  plugins(launch: AgentLaunch): Promise<PluginInfo[]>
  /** Скиллы пользователя, проекта и плагинов — без встроенных в самого агента. */
  skills(launch: AgentLaunch): Promise<SkillInfo[]>
  /** Серверы MCP и их состояние после попытки подключиться. */
  mcpServers(launch: AgentLaunch): Promise<McpServerInfo[]>
  start(options: SessionOptions, events: SessionEvents): AgentSession
  /** Лимиты подписки, когда в чате ещё нет запущенной сессии. */
  limits(launch: AgentLaunch): Promise<PlanLimit[]>
  /** Контекст разговора `sessionId` (нет — нового), когда его сессия не запущена. */
  context(launch: AgentLaunch, sessionId?: string): Promise<ContextReport>
}
