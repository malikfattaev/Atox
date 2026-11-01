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

/** Открытые и недавно закрытые элементы с их общим числом в репозитории. */
export interface Listing<Item> {
  open: Item[]
  closed: Item[]
  openCount: number
  closedCount: number
}

export interface GitHubOverview {
  /** Адрес репозитория на GitHub. */
  url: string
  /** Владелец и имя, например `owner/repo`. */
  name: string
  pullRequests: Listing<PullRequest>
  issues: Listing<Issue>
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
