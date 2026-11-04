import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangesResult } from '../../../shared/changes'

/**
 * Как часто перечитывать изменения, пока агенты работают: они правят файлы посреди ответа,
 * а git status на каждое слово ответа был бы лишней нагрузкой.
 */
const LIVE_REFRESH_MS = 1500

export interface ProjectChanges {
  /** `null` — ещё не загружены. */
  result: ChangesResult | null
  refresh(): void
}

/** Незакоммиченные изменения проекта; обновляются, пока агенты работают и когда окно в фокусе. */
export function useProjectChanges(projectId: string): ProjectChanges {
  const [result, setResult] = useState<ChangesResult | null>(null)
  const latestRequestRef = useRef(0)

  const refresh = useCallback(() => {
    const request = ++latestRequestRef.current
    void window.atox.changes.list(projectId).then((next) => {
      // Ответы могут прийти не по порядку: показывается только самый свежий запрос.
      if (request === latestRequestRef.current) {
        setResult(next)
      }
    })
  }, [projectId])

  useEffect(() => {
    setResult(null)
    refresh()
    let timer: ReturnType<typeof setTimeout> | null = null
    const scheduleRefresh = () => {
      timer ??= setTimeout(() => {
        timer = null
        refresh()
      }, LIVE_REFRESH_MS)
    }
    const unsubscribe = window.atox.conversations.onAnyEvent(scheduleRefresh)
    // Файлы могли поменять в другом приложении, пока окно было не в фокусе.
    window.addEventListener('focus', refresh)
    return () => {
      latestRequestRef.current++
      unsubscribe()
      window.removeEventListener('focus', refresh)
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [refresh])

  return { result, refresh }
}
