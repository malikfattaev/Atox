/**
 * Доска задач: issue выбранных репозиториев GitHub по колонкам. Задача в очереди сама уходит
 * агенту — в отдельный worktree репозитория, — а когда агент закончит, переходит на проверку.
 */

import { isAgentId, type AgentId } from './agents'

/** Агент, модель и эффорт, с которыми задача уходит в работу; без модели и эффорта — его по умолчанию. */
export interface TaskAgent {
  agent: AgentId
  model?: string
  effort?: string
}

/** Как запустить задачу: агент и сообщение ему от пользователя вместе с заданием. */
export interface TaskStart {
  agent: TaskAgent
  /** Что пользователь хочет добавить к задаче; пусто — ничего. */
  message?: string
  /** Проект, под которым появится чат агента; нет — проект репозитория задачи. */
  projectId?: string
}

/** Агент из сохранённых данных или окна; `null` — значение не похоже на агента. */
export function parseTaskAgent(value: unknown): TaskAgent | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const { agent, model, effort } = value as Record<string, unknown>
  if (!isAgentId(agent)) {
    return null
  }
  return {
    agent,
    ...(typeof model === 'string' && model && { model }),
    ...(typeof effort === 'string' && effort && { effort })
  }
}

/** Колонки слева направо. */
export const BOARD_COLUMNS = ['backlog', 'queue', 'progress', 'review', 'done'] as const
export type BoardColumn = (typeof BOARD_COLUMNS)[number]

export function isBoardColumn(value: unknown): value is BoardColumn {
  return BOARD_COLUMNS.some((column) => column === value)
}

/**
 * Сколько задача видна в Done: день — чтобы было видно, что закрыто сегодня. Потом она уходит
 * с доски насовсем, и Done не превращается в свалку.
 */
export const DONE_VISIBLE_MS = 24 * 60 * 60_000

/** Сколько агентов доски работают одновременно: каждый тратит лимит подписки. */
export const BOARD_AGENTS = { min: 1, max: 8, default: 2 } as const

/** Репозиторий на доске и учётная запись `gh`, под которой читаются его задачи. */
export interface BoardRepository {
  /** `owner/name`. */
  fullName: string
  account: string
}

/** Репозиторий, который можно добавить на доску. */
export interface AvailableRepository extends BoardRepository {
  owner: string
  ownerAvatarUrl: string
  isPrivate: boolean
  openIssues: number
  /** Когда в репозиторий последний раз пушили, мс с начала эпохи. */
  pushedAt: number
}

export interface BoardLabel {
  name: string
  /** `#RRGGBB`. */
  color: string
}

export interface BoardIssue {
  /** Глобальный id issue на GitHub. */
  id: string
  repository: string
  owner: string
  ownerAvatarUrl: string
  number: number
  title: string
  url: string
  state: 'open' | 'closed'
  labels: BoardLabel[]
  author: string | null
  /** Логины тех, на кого назначена задача. */
  assignees: string[]
  updatedAt: number
  column: BoardColumn
  /** Чат агента, который работает или работал над задачей. */
  chatId?: string
  /** Задача не ушла агенту: почему. */
  error?: string
}

export interface BoardState {
  repositories: BoardRepository[]
  issues: BoardIssue[]
  /** Когда задачи последний раз прочитаны с GitHub; `null` — ещё ни разу. */
  syncedAt: number | null
  syncing: boolean
  /** Последняя синхронизация не удалась. */
  error: string | null
}
