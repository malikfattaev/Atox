import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Commit,
  GitHubOverview,
  RepositoryError,
  RepositoryResult
} from '../../../shared/repository'

const { atox } = window

/** Как часто обновлять данные, когда окно снова получает фокус: GitHub не стоит дёргать чаще. */
const FOCUS_REFRESH_INTERVAL_MS = 30_000

export interface RepositoryData {
  /** `undefined` — ещё не загружено. */
  commits?: RepositoryResult<Commit[]>
  github?: RepositoryResult<GitHubOverview>
}

export interface RepositoryState extends RepositoryData {
  /** Идёт загрузка — первая или обновление поверх уже показанных данных. */
  loading: boolean
  refresh(): void
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

  const loadCommits = useCallback(
    () => load('commits', () => atox.repository.commits(projectId)),
    [load, projectId]
  )

  const refresh = useCallback(() => {
    lastRefreshAt.current = Date.now()
    loadCommits()
    load('github', () => atox.repository.github(projectId))
  }, [load, loadCommits, projectId])

  useEffect(refresh, [refresh])

  // Сменилась ветка — у неё другие коммиты; PR и issue от ветки не зависят.
  const previousBranch = useRef(branch)
  useEffect(() => {
    if (previousBranch.current !== branch) {
      previousBranch.current = branch
      loadCommits()
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

  return { ...data, loading: pending > 0, refresh }
}

function failure(error: unknown): { ok: false; error: RepositoryError } {
  return {
    ok: false,
    error: { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
  }
}
