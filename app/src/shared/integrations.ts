/*
 * Чем пользуется агент помимо модели: плагины, скиллы и серверы MCP. Формат общий для всех
 * агентов — каждый драйвер переводит в него ответ своего агента, а окно показывает списки
 * одинаково, сколько бы агентов ни подключили.
 */

export const INTEGRATION_KINDS = ['plugins', 'skills', 'mcp'] as const

export type IntegrationKind = (typeof INTEGRATION_KINDS)[number]

export function isIntegrationKind(value: unknown): value is IntegrationKind {
  return INTEGRATION_KINDS.some((kind) => kind === value)
}

/** Откуда элемент у агента; по этому в списке ставится пометка. */
export type IntegrationOrigin =
  /** Настройки пользователя — обычный случай, без пометки. */
  | { type: 'user' }
  /** Настройки текущего проекта. */
  | { type: 'project' }
  /** Пришёл вместе с плагином. */
  | { type: 'plugin'; plugin: string }
  /** Подключён в аккаунте у сервиса агента, например на claude.ai. */
  | { type: 'account'; service: string }
  /** Задан администратором организации. */
  | { type: 'managed' }

export interface PluginInfo {
  /** Уникален в списке агента. */
  id: string
  name: string
  description?: string
  version?: string
  /** Откуда плагин установлен, например каталог плагинов. */
  marketplace?: string
  enabled: boolean
}

export interface SkillInfo {
  id: string
  name: string
  description: string
  origin: IntegrationOrigin
  enabled: boolean
}

/**
 * Состояние сервера MCP. `connecting` остаётся, если сервер не успел подключиться, пока агент
 * отвечал.
 */
export type McpServerState = 'connected' | 'needs-auth' | 'failed' | 'connecting' | 'disabled'

export interface McpServerInfo {
  id: string
  name: string
  state: McpServerState
  /** Почему сервер не подключился, словами агента. */
  error?: string
  /** Сколько инструментов дал подключённый сервер. */
  tools?: number
  origin: IntegrationOrigin
}

export interface IntegrationItems {
  plugins: PluginInfo[]
  skills: SkillInfo[]
  mcp: McpServerInfo[]
}

/** Ответ агента на вопрос «что у тебя подключено»; без ошибки страница не остаётся. */
export type IntegrationList<Kind extends IntegrationKind> =
  | { status: 'ok'; items: IntegrationItems[Kind] }
  | { status: 'not-installed' }
  | { status: 'failed'; message: string }
