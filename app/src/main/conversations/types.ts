import type { AgentId } from '../../shared/agents'
import type {
  AgentCatalog,
  AgentCommand,
  ConversationUsage,
  ModelSelection,
  StreamedField,
  TimelineItem
} from '../../shared/conversation'

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
  /** Агент сообщил, насколько заполнен контекст и сколько осталось лимитов подписки. */
  usage(usage: ConversationUsage): void
  /** Агент сообщил идентификатор разговора, по которому его можно продолжить. */
  sessionStarted(sessionId: string): void
  /** Процесс агента завершился: сессией больше пользоваться нельзя. */
  closed(): void
}

/** Разговор с запущенным агентом. Сообщения отправляются по одному: следующее — после `turnFinished`. */
export interface AgentSession {
  send(text: string): void
  /** Просит агента остановить текущую работу; закончит он её событием `turnFinished`. */
  interrupt(): void
  close(): void
}

/** Подключение к агенту через его служебный протокол. */
export interface AgentDriver {
  readonly agent: AgentId
  /** Модели, доступные агенту на этом компьютере. */
  catalog(launch: AgentLaunch): Promise<AgentCatalog>
  /** Команды, которые агент выполняет из сообщения вида `/команда`, — в папке проекта. */
  commands(launch: AgentLaunch): Promise<AgentCommand[]>
  start(options: SessionOptions, events: SessionEvents): AgentSession
}
