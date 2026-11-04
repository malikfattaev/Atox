import { useEffect, useState } from 'react'
import type { ConversationSummary } from '../../../shared/conversation'

/**
 * Как часто обновлять обзор, пока агенты работают: события приходят на каждое слово ответа,
 * а обзору хватает нескольких обновлений в секунду.
 */
const REFRESH_MS = 250

/** Сводки всех начатых разговоров; `null` — ещё не загружены. */
export function useConversationSummaries(): ConversationSummary[] | null {
  const [summaries, setSummaries] = useState<ConversationSummary[] | null>(null)

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null
    // Ответы могут прийти не по порядку: показывается только самый свежий запрос.
    let latestRequest = 0
    const load = () => {
      timer = null
      const request = ++latestRequest
      void window.atox.conversations.summaries().then((next) => {
        if (!disposed && request === latestRequest) {
          setSummaries(next)
        }
      })
    }
    load()
    const unsubscribe = window.atox.conversations.onAnyEvent(() => {
      timer ??= setTimeout(load, REFRESH_MS)
    })
    return () => {
      disposed = true
      unsubscribe()
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [])

  return summaries
}
