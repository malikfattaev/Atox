import { useSyncExternalStore } from 'react'

/** Подписи вида «5m» меняются раз в минуту — обновлять их чаще, чем раз в полминуты, незачем. */
const TICK_MS = 30_000

// Один таймер на все подписанные компоненты; он работает, только пока есть подписчики.
let now = Date.now()
let timer: ReturnType<typeof setInterval> | undefined
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    now = Date.now()
    timer = setInterval(() => {
      now = Date.now()
      listeners.forEach((notify) => notify())
    }, TICK_MS)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      clearInterval(timer)
    }
  }
}

/** Текущее время, обновляемое раз в {@link TICK_MS} мс. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now)
}
