import { useEffect, useState } from 'react'
import type { PlanLimitsState } from '../../../shared/planLimits'

/** Последние известные лимиты подписки агентов; обновляются, как только main узнаёт новые. */
export function usePlanLimits(): PlanLimitsState {
  const [state, setState] = useState<PlanLimitsState>({})

  useEffect(() => {
    let subscribed = true
    const unsubscribe = window.atox.planLimits.subscribe(setState)
    void window.atox.planLimits.get().then((initial) => {
      // Подписка могла принести более свежие лимиты, пока шёл первый запрос.
      if (subscribed) {
        setState((current) => (Object.keys(current).length > 0 ? current : initial))
      }
    })
    return () => {
      subscribed = false
      unsubscribe()
    }
  }, [])

  return state
}
