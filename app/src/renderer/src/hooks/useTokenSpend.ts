import { useEffect, useState } from 'react'
import type { TokenSpendSummary } from '../../../shared/tokenSpend'

/** Сколько токенов потратили агенты; обновляется, как только main записывает новые траты. */
export function useTokenSpend(): TokenSpendSummary | null {
  const [summary, setSummary] = useState<TokenSpendSummary | null>(null)

  useEffect(() => {
    let subscribed = true
    const unsubscribe = window.atox.tokenSpend.subscribe(setSummary)
    void window.atox.tokenSpend.get().then((initial) => {
      // Подписка могла принести более свежие данные, пока шёл первый запрос.
      if (subscribed) {
        setSummary((current) => current ?? initial)
      }
    })
    return () => {
      subscribed = false
      unsubscribe()
    }
  }, [])

  return summary
}
