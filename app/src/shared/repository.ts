/** Коммит текущей ветки проекта. */
export interface Commit {
  hash: string
  shortHash: string
  /** Первая строка сообщения. */
  subject: string
  author: string
  /** Время коммита в миллисекундах. */
  committedAt: number
  /** Теги, которые указывают на коммит. */
  tags: string[]
  /** Коммит есть только локально: его ещё не отправили ни в один удалённый репозиторий. */
  unpushed: boolean
}

export type PullRequestState = 'open' | 'draft' | 'merged' | 'closed'

/** Итог проверок CI у последнего коммита; `null` — проверок нет. */
export type CheckStatus = 'success' | 'failure' | 'pending' | null

/** Решение ревьюеров; `null` — ревью не требуется. */
export type ReviewDecision = 'approved' | 'changes-requested' | 'review-required' | null

export interface PullRequest {
  number: number
  title: string
  url: string
  state: PullRequestState
  author: string
  /** Ветка, из которой предлагаются изменения. */
  branch: string
  updatedAt: number
  comments: number
  additions: number
  deletions: number
  checks: CheckStatus
  review: ReviewDecision
}

export type IssueState = 'open' | 'completed' | 'not-planned'

export interface IssueLabel {
  name: string
  /** Цвет метки в GitHub — `#RRGGBB`. */
  color: string
}

export interface Issue {
  number: number
  title: string
  url: string
  state: IssueState
  author: string
  updatedAt: number
  comments: number
  labels: IssueLabel[]
}

/** Часть длинного списка: элементы подгружаются страницами, пока не кончатся. */
export interface Page<Item> {
  items: Item[]
  /** Курсор следующей страницы; `null` — загружено всё. */
  next: string | null
}

/** Начало списка вместе с числом всех его элементов, а не только загруженных. */
export interface Listing<Item> extends Page<Item> {
  total: number
}

/** Элементы списков GitHub. */
export interface GitHubItems {
  pullRequests: PullRequest
  issues: Issue
}

export type GitHubKind = keyof GitHubItems

/** Открытые и закрытые элементы — отдельные списки со своими счётчиками. */
export type ListState = 'open' | 'closed'

/** Сколько элементов каждого списка GitHub уже загружено: обновление загружает не меньше. */
export type GitHubCounts = Record<GitHubKind, Record<ListState, number>>

export interface GitHubOverview {
  /** Адрес репозитория на GitHub. */
  url: string
  /** Владелец и имя, например `owner/repo`. */
  name: string
  pullRequests: Record<ListState, Listing<PullRequest>>
  issues: Record<ListState, Listing<Issue>>
}

/** Почему данные репозитория не получилось загрузить. */
export type RepositoryError =
  | { kind: 'not-git' }
  | { kind: 'not-github' }
  | { kind: 'gh-missing' }
  | { kind: 'gh-signed-out' }
  | { kind: 'failed'; message: string }

export type RepositoryResult<Data> =
  { ok: true; data: Data } | { ok: false; error: RepositoryError }
