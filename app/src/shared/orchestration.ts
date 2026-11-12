/**
 * Протокол, по которому агенты в терминалах Atox управляют приложением через команду `atox`:
 * запускают помощников в соседних чатах, переписываются с ними и получают отчёты.
 * Команда подключается к локальному сокету приложения и отправляет одну строку JSON.
 */

/** Переменные окружения, которые получает терминал каждого чата. */
export const OrchestrationEnv = {
  /** Путь к сокету приложения. */
  Socket: 'ATOX_SOCKET',
  /** Секрет запуска приложения: без него сокет не принимает команды. */
  Token: 'ATOX_TOKEN',
  /** Чат, из терминала которого вызвана команда. */
  ChatId: 'ATOX_CHAT_ID',
  /** Полный путь к команде `atox` — на случай, если профиль оболочки переписал PATH. */
  Cli: 'ATOX_CLI'
} as const

/** Адресат сообщения помощника — агент, который его запустил. */
export const PARENT_ADDRESS = 'parent'

export interface AgentInfo {
  id: string
  name: string
}

/** Модель агента, которую можно дать помощнику. */
export interface WorkerModelInfo {
  id: string
  name: string
  /** Уровни эффорта модели; пусто — выбора нет. */
  efforts: string[]
  /** Эффорт модели, если его не выбрали. */
  defaultEffort?: string
}

export interface WorkerInfo {
  chatId: string
  title: string
  agent: string
  /** Терминал помощника работает. */
  running: boolean
  /** Модель и эффорт помощника; нет — по умолчанию у агента. */
  model?: string
  effort?: string
  /** Помощник уже прислал отчёт. */
  reported: boolean
  /** Когда помощника запустили, мс с начала эпохи. */
  startedAt: number
}

/** Команды и их параметры/результаты. */
export interface OrchestrationMethods {
  agents: { params: Record<string, never>; result: AgentInfo[] }
  /** Модели агента и эффорты каждой — из них выбирают `model` и `effort` для `start`. */
  models: {
    params: { agent: string }
    result: { defaultModel: string; models: WorkerModelInfo[] }
  }
  start: {
    /** `model` и `effort` не заданы — те, с которыми пользователь начинает новые чаты. */
    params: { agent: string; task: string; title?: string; model?: string; effort?: string }
    result: { chatId: string; title: string; model?: string; effort?: string }
  }
  send: { params: { to: string; message: string }; result: { chatId: string } }
  report: { params: { summary: string }; result: { chatId: string } }
  workers: { params: Record<string, never>; result: WorkerInfo[] }
  /** Останавливает помощников и убирает их чаты из списка. */
  remove: { params: { chatIds: string[] }; result: { removed: string[] } }
}

export type OrchestrationMethod = keyof OrchestrationMethods

export interface OrchestrationRequest<Method extends OrchestrationMethod = OrchestrationMethod> {
  token: string
  chatId: string
  method: Method
  params: OrchestrationMethods[Method]['params']
}

export type OrchestrationResponse<Method extends OrchestrationMethod = OrchestrationMethod> =
  { ok: true; result: OrchestrationMethods[Method]['result'] } | { ok: false; error: string }
