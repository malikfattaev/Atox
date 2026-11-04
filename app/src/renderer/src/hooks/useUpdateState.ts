import { useEffect, useState } from 'react'
import type { UpdateState } from '../../../shared/update'

/** Скачивается ли новая версия или она уже готова к установке; `null` — обновлений нет. */
export function useUpdateState(): UpdateState {
  const [state, setState] = useState<UpdateState>(null)

  useEffect(() => {
    const unsubscribe = window.atox.updates.subscribe(setState)
    void window.atox.updates.state().then(setState)
    return unsubscribe
  }, [])

  return state
}
