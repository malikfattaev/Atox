import { DEFAULT_AGENT_ID, type AgentId } from './agents'
import type { ModelSelection } from './conversation'
import type { ShortcutOverrides } from './shortcuts'

export interface Settings {
  /** Агент нового чата по ⌘N; меняется на последний выбранный. */
  defaultAgent: AgentId
  /** Последние выбранные модель и эффорт каждого агента: с ними начинается новый чат. */
  agentModels: Partial<Record<AgentId, Partial<ModelSelection>>>
  /** Ширина сайдбара в пикселях; меняется перетаскиванием его края. */
  sidebarWidth: number
  /** Свои горячие клавиши вместо стандартных. */
  shortcuts: ShortcutOverrides
}

/** Сайдбар по умолчанию самый узкий: его можно только расширить. */
export const SIDEBAR_WIDTH = {
  default: 280,
  min: 280,
  max: 480
} as const

export const DEFAULT_SETTINGS: Settings = {
  defaultAgent: DEFAULT_AGENT_ID,
  agentModels: {},
  sidebarWidth: SIDEBAR_WIDTH.default,
  shortcuts: {}
}

/** Приводит ширину сайдбара к целому числу пикселей в допустимых пределах. */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return SIDEBAR_WIDTH.default
  }
  return Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, Math.round(width)))
}
