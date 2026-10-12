import { useSyncExternalStore } from 'react'

/**
 * Полупериод мигания. Мигание — смена состояния по таймеру, а не CSS-анимация: бесконечная
 * анимация заставляет окно перерисовываться 60 раз в секунду и заметно тратит батарею,
 * а смена по таймеру — это пара кадров в секунду.
 */
const BLINK_INTERVAL_MS = 600

// Один таймер на все мигающие элементы, поэтому они мигают в такт; работает, пока есть подписчики.
let visible = true
let timer: ReturnType<typeof setInterval> | undefined
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    visible = true
    timer = setInterval(() => {
      visible = !visible
      listeners.forEach((notify) => notify())
    }, BLINK_INTERVAL_MS)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      clearInterval(timer)
    }
  }
}

const subscribeNever = () => () => undefined

/** Фаза мигания: `true` — элемент виден. Пока `enabled` ложно, таймер не нужен и всегда `true`. */
export function useBlink(enabled: boolean): boolean {
  return useSyncExternalStore(enabled ? subscribe : subscribeNever, () => !enabled || visible)
}
