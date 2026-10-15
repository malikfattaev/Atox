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

export interface WorkerInfo {
  chatId: string
  title: string
  agent: string
  /** Терминал помощника работает. */
  running: boolean
  /** Помощник уже прислал отчёт. */
  reported: boolean
}

/** Команды и их параметры/результаты. */
export interface OrchestrationMethods {
  agents: { params: Record<string, never>; result: AgentInfo[] }
  start: {
    params: { agent: string; task: string; title?: string }
    result: { chatId: string; title: string }
  }
  send: { params: { to: string; message: string }; result: { chatId: string } }
  report: { params: { summary: string }; result: { chatId: string } }
  workers: { params: Record<string, never>; result: WorkerInfo[] }
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
