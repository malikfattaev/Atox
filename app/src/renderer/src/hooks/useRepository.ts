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

/** Список, который подгружается страницами. */
export type RepositoryList = 'commits' | { kind: GitHubKind; state: ListState }

export interface RepositoryState extends RepositoryData {
  /** Идёт загрузка — первая или обновление поверх уже показанных данных. */
  loading: boolean
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
  // Номер последнего запроса каждого источника: ответ устаревшего запроса не затирает свежий.
  const requests = useRef({ commits: 0, github: 0 })
  const lastRefreshAt = useRef(0)

  const load = useCallback(
    <Key extends keyof RepositoryData>(
      key: Key,
      request: () => Promise<NonNullable<RepositoryData[Key]>>
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
          const next = { ...cache.get(projectId), [key]: result }
          cache.set(projectId, next)
          setData(next)
        })
        .finally(() => setPending((count) => count - 1))
    },
    [projectId]
  )

  /** Обновление загружает столько же элементов, сколько уже показано, чтобы список не укоротился. */
  const loadCommits = useCallback(
    (keepLoaded: boolean) => {
      const loaded = keepLoaded ? loadedCommits(cache.get(projectId)) : 0
      load('commits', () => atox.repository.commits(projectId, loaded))
    },
    [load, projectId]
  )

  const refresh = useCallback(() => {
    lastRefreshAt.current = Date.now()
    loadCommits(true)
    const loaded = loadedGitHub(cache.get(projectId))
    load('github', () => atox.repository.github(projectId, loaded))
  }, [load, loadCommits, projectId])

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

  useEffect(refresh, [refresh])

  // Сменилась ветка — у неё другие коммиты; PR и issue от ветки не зависят.
  const previousBranch = useRef(branch)
  useEffect(() => {
    if (previousBranch.current !== branch) {
      previousBranch.current = branch
      loadCommits(false)
    }
  }, [branch, loadCommits])

  // Вернулись в окно — возможно, после пуша или мержа в браузере.
  useEffect(() => {
    const refreshOnFocus = () => {
      if (Date.now() - lastRefreshAt.current >= FOCUS_REFRESH_INTERVAL_MS) {
        refresh()
      }
    }
    window.addEventListener('focus', refreshOnFocus)
    return () => window.removeEventListener('focus', refreshOnFocus)
  }, [refresh])

  return { ...data, loading: pending > 0, refresh, loadMore }
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
