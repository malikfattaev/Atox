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
  /** Ширина панели терминала в пикселях; меняется перетаскиванием её края. */
  terminalWidth: number
  /** Свои горячие клавиши вместо стандартных. */
  shortcuts: ShortcutOverrides
  /** Отправлять анонимную статистику: установки и активные дни, без данных о проектах и чатах. */
  shareUsageStats: boolean
  /**
   * Короткий звук, когда агент закончил работу или ждёт пользователя. Выключен, пока его не
   * включат: внезапный звук пугает.
   */
  playSounds: boolean
  /** Имя в профиле сайдбара, которое человек ввёл сам; пусто — имя берётся из git или macOS. */
  profileName: string
}

/** Длиннее имя в таблетке профиля не помещается. */
export const PROFILE_NAME_MAX_LENGTH = 40

/** Сайдбар по умолчанию самый узкий: его можно только расширить. */
export const SIDEBAR_WIDTH = {
  default: 280,
  min: 280,
  max: 480
} as const

/** Ширина панели терминала: в узком окне её дополнительно ужимает раскладка, оставляя место чату. */
export const TERMINAL_WIDTH = {
  default: 480,
  min: 320,
  max: 1200
} as const

/** Пределы ширины панели, которую тянут за край. */
export interface WidthBounds {
  default: number
  min: number
  max: number
}

export const DEFAULT_SETTINGS: Settings = {
  defaultAgent: DEFAULT_AGENT_ID,
  agentModels: {},
  sidebarWidth: SIDEBAR_WIDTH.default,
  terminalWidth: TERMINAL_WIDTH.default,
  shortcuts: {},
  shareUsageStats: true,
  playSounds: false,
  profileName: ''
}

/** Приводит ширину панели к целому числу пикселей в её пределах. */
export function clampWidth(width: number, bounds: WidthBounds): number {
  if (!Number.isFinite(width)) {
    return bounds.default
  }
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(width)))
}
