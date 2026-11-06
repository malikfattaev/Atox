import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Commit,
  GitHubCounts,
  GitHubKind,
  GitHubOverview,
  ListState,
  Listing,
  Page,
  RepositoryError,
  RepositoryResult
} from '../../../shared/repository'

const { atox } = window

/** Как часто обновлять данные, когда окно снова получает фокус: GitHub не стоит дёргать чаще. */
const FOCUS_REFRESH_INTERVAL_MS = 30_000

export interface RepositoryData {
  /** `undefined` — ещё не загружено. */
  commits?: RepositoryResult<Listing<Commit>>
  github?: RepositoryResult<GitHubOverview>
}

/**
 * Ошибки последнего обновления источников, у которых остались показанные прежде данные:
 * неудачное обновление не стирает их, а показывается рядом.
 */
export type RefreshErrors = { [Key in keyof RepositoryData]?: RepositoryError }

/**
 * Как обновлять: `full` перезагружает всё долистанное, `latest` — только первые страницы,
 * сливая их с уже показанным. Авто-обновление — `latest`: с долистанными сотнями коммитов
 * и PR каждое возвращение в окно иначе стоило бы десятков запросов.
 */
type RefreshMode = 'full' | 'latest'

/** Список, который подгружается страницами. */
export type RepositoryList = 'commits' | { kind: GitHubKind; state: ListState }

export interface RepositoryState extends RepositoryData {
  /** Идёт загрузка — первая или обновление поверх уже показанных данных. */
  loading: boolean
  refreshErrors: RefreshErrors
  /** Перезагружает всё показанное — по кнопке. */
  refresh(): void
  /** Догружает следующую страницу списка; отклоняется, если загрузить не получилось. */
  loadMore(list: RepositoryList): Promise<void>
}

/**
 * Последние данные каждого проекта: страница открывается сразу с ними, а свежие
 * подгружаются в фоне. Живут до перезапуска окна.
 */
const cache = new Map<string, RepositoryData>()

/**
 * Коммиты, PR и issue проекта. Коммиты приходят из локального git почти мгновенно,
 * GitHub отвечает дольше — каждый источник показывается, как только готов.
 */
export function useRepository(projectId: string, branch: string | null): RepositoryState {
  const [data, setData] = useState<RepositoryData>(() => cache.get(projectId) ?? {})
  const [pending, setPending] = useState(0)
  const [refreshErrors, setRefreshErrors] = useState<RefreshErrors>({})
  // Номер последнего запроса каждого источника: ответ устаревшего запроса не затирает свежий.
  const requests = useRef({ commits: 0, github: 0 })
  const lastRefreshAt = useRef(0)

  const load = useCallback(
    <Key extends keyof RepositoryData>(
      key: Key,
      request: () => Promise<NonNullable<RepositoryData[Key]>>,
      /** Сливает свежий ответ с показанными данными; нет — ответ их заменяет. */
      merge?: (
        shown: NonNullable<RepositoryData[Key]>,
        fresh: NonNullable<RepositoryData[Key]>
      ) => NonNullable<RepositoryData[Key]>
    ) => {
      const id = ++requests.current[key]
      setPending((count) => count + 1)
      void request()
        // Сбой самого запроса (например, проект только что убрали) показываем как ошибку загрузки.
        .catch((error: unknown) => failure(error))
        .then((result) => {
          if (requests.current[key] !== id) {
            return
          }
          const shown = cache.get(projectId)?.[key]
          if (!result.ok && shown?.ok) {
            setRefreshErrors((errors) => ({ ...errors, [key]: result.error }))
            return
          }
          setRefreshErrors(({ [key]: _resolved, ...errors }) => errors)
          const next = {
            ...cache.get(projectId),
            [key]: merge && shown ? merge(shown, result) : result
          }
          cache.set(projectId, next)
          setData(next)
        })
        .finally(() => setPending((count) => count - 1))
    },
    [projectId]
  )

  /**
   * Полное обновление загружает столько же элементов, сколько уже показано, чтобы список
   * не укоротился; обновление первых страниц сохраняет долистанное за ними.
   */
  const refreshWith = useCallback(
    (mode: RefreshMode) => {
      lastRefreshAt.current = Date.now()
      const shown = cache.get(projectId)
      if (mode === 'full') {
        const commits = loadedCommits(shown)
        const github = loadedGitHub(shown)
        load('commits', () => atox.repository.commits(projectId, commits))
        load('github', () => atox.repository.github(projectId, github))
      } else {
        load('commits', () => atox.repository.commits(projectId), mergeCommits)
        load('github', () => atox.repository.github(projectId), mergeGitHub)
      }
    },
    [load, projectId]
  )

  const refresh = useCallback(() => refreshWith('full'), [refreshWith])

  const update = useCallback(
    <Key extends keyof RepositoryData>(
      key: Key,
      change: (value: NonNullable<RepositoryData[Key]>) => RepositoryData[Key]
    ) => {
      const current = cache.get(projectId) ?? {}
      const value = current[key]
      if (!value) {
        return
      }
      const next = { ...current, [key]: change(value) }
      cache.set(projectId, next)
      setData(next)
    },
    [projectId]
  )

  const loadMore = useCallback(
    async (list: RepositoryList) => {
      const current = cache.get(projectId)
      if (list === 'commits') {
        const cursor = current?.commits?.ok ? current.commits.data.next : null
        if (!cursor) {
          return
        }
        const page = unwrap(await atox.repository.moreCommits(projectId, cursor))
        // Пока страница грузилась, список могли обновить — тогда она к нему уже не подходит.
        update('commits', (commits) =>
          commits.ok && commits.data.next === cursor
            ? { ok: true, data: append(commits.data, page, (commit) => commit.hash) }
            : commits
        )
        return
      }
      const { kind, state } = list
      const cursor = current?.github?.ok ? current.github.data[kind][state].next : null
      if (!cursor) {
        return
      }
      const page = unwrap(await atox.repository.moreGitHub(projectId, kind, state, cursor))
      update('github', (github) =>
        github.ok && github.data[kind][state].next === cursor
          ? { ok: true, data: appendGitHub(github.data, kind, state, page) }
          : github
      )
    },
    [projectId, update]
  )

  // Страница открылась с данными из кеша — подтягиваем свежие поверх них.
  useEffect(() => refreshWith('latest'), [refreshWith])

  // Сменилась ветка — у неё другие коммиты; PR и issue от ветки не зависят.
  const previousBranch = useRef(branch)
  useEffect(() => {
    if (previousBranch.current !== branch) {
      previousBranch.current = branch
      load('commits', () => atox.repository.commits(projectId))
    }
  }, [branch, load, projectId])

  // Вернулись в окно — возможно, после пуша или мержа в браузере.
  useEffect(() => {
    const refreshOnFocus = () => {
      if (Date.now() - lastRefreshAt.current >= FOCUS_REFRESH_INTERVAL_MS) {
        refreshWith('latest')
      }
    }
    window.addEventListener('focus', refreshOnFocus)
    return () => window.removeEventListener('focus', refreshOnFocus)
  }, [refreshWith])

  return { ...data, loading: pending > 0, refreshErrors, refresh, loadMore }
}

function loadedCommits(data: RepositoryData | undefined): number {
  return data?.commits?.ok ? data.commits.data.items.length : 0
}

function loadedGitHub(data: RepositoryData | undefined): GitHubCounts | undefined {
  if (!data?.github?.ok) {
    return undefined
  }
  const { pullRequests, issues } = data.github.data
  return {
    pullRequests: { open: pullRequests.open.items.length, closed: pullRequests.closed.items.length },
    issues: { open: issues.open.items.length, closed: issues.closed.items.length }
  }
}

function mergeCommits(
  shown: RepositoryResult<Listing<Commit>>,
  fresh: RepositoryResult<Listing<Commit>>
): RepositoryResult<Listing<Commit>> {
  if (!shown.ok || !fresh.ok) {
    return fresh
  }
  // Прежний хвост продолжает свежую страницу, только если на ней есть показанная вершина:
  // иначе ветку сменили или историю переписали, и хвост относится к другой истории.
  const shownHead = shown.data.items[0]?.hash
  if (!fresh.data.items.some((commit) => commit.hash === shownHead)) {
    return fresh
  }
  return { ok: true, data: mergeLatest(shown.data, fresh.data, (commit) => commit.hash) }
}

function mergeGitHub(
  shown: RepositoryResult<GitHubOverview>,
  fresh: RepositoryResult<GitHubOverview>
): RepositoryResult<GitHubOverview> {
  if (!shown.ok || !fresh.ok) {
    return fresh
  }
  const number = (item: { number: number }) => String(item.number)
  const merge = <Item extends { number: number }>(
    lists: (overview: GitHubOverview) => Record<ListState, Listing<Item>>
  ): Record<ListState, Listing<Item>> => ({
    open: mergeLatest(lists(shown.data).open, lists(fresh.data).open, number),
    closed: mergeLatest(lists(shown.data).closed, lists(fresh.data).closed, number)
  })
  return {
    ok: true,
    data: {
      ...fresh.data,
      pullRequests: merge((overview) => overview.pullRequests),
      issues: merge((overview) => overview.issues)
    }
  }
}

/**
 * Сливает свежую первую страницу с показанным списком. Если последний элемент страницы
 * есть среди показанных, за ним продолжается прежний список — вместе с его курсором.
 * Если нет (историю переписали или новых элементов больше страницы), склеить нечем,
 * и список начинается со свежей страницы заново.
 */
function mergeLatest<Item>(
  shown: Listing<Item>,
  fresh: Listing<Item>,
  key: (item: Item) => string
): Listing<Item> {
  const last = fresh.items.at(-1)
  // Свежая страница — уже весь список.
  if (!fresh.next || !last) {
    return fresh
  }
  const boundary = shown.items.findIndex((item) => key(item) === key(last))
  if (boundary < 0) {
    return fresh
  }
  // Элемент из хвоста мог подняться наверх — например, PR обновили, — повторять его незачем.
  const freshKeys = new Set(fresh.items.map(key))
  const rest = shown.items.slice(boundary + 1).filter((item) => !freshKeys.has(key(item)))
  return { ...fresh, items: [...fresh.items, ...rest], next: shown.next }
}

/** Добавляет страницу в конец списка. Элемент мог сдвинуться между страницами — без повторов. */
function append<Item>(listing: Listing<Item>, page: Page<Item>, key: (item: Item) => string) {
  const known = new Set(listing.items.map(key))
  return {
    ...listing,
    items: [...listing.items, ...page.items.filter((item) => !known.has(key(item)))],
    next: page.next
  }
}

function appendGitHub(
  overview: GitHubOverview,
  kind: GitHubKind,
  state: ListState,
  page: Page<{ number: number }>
): GitHubOverview {
  // Страница пришла из того же списка, так что типы элементов совпадают.
  const lists = overview[kind] as Record<ListState, Listing<{ number: number }>>
  const listing = append(lists[state], page, (item) => String(item.number))
  return { ...overview, [kind]: { ...lists, [state]: listing } }
}

function unwrap<Data>(result: RepositoryResult<Data>): Data {
  if (!result.ok) {
    throw new Error(result.error.kind === 'failed' ? result.error.message : result.error.kind)
  }
  return result.data
}

function failure(error: unknown): { ok: false; error: RepositoryError } {
  return {
    ok: false,
    error: { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
  }
}
