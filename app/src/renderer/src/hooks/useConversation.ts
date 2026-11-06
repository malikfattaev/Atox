import { useEffect, useRef, useState } from 'react'
import {
  applyConversationEvent,
  EMPTY_CONVERSATION,
  type ConversationEvent,
  type ConversationSnapshot
} from '../../../shared/conversation'

const { atox } = window

export interface ConversationState extends ConversationSnapshot {
  /** Лента ещё загружается с диска. */
  loading: boolean
}

const LOADING_STATE: ConversationState = { ...EMPTY_CONVERSATION, loading: true }

/**
 * Лента чата: снимок из main-процесса плюс события, которые пришли после него.
 *
 * Агент присылает событие на каждый кусочек текста — это сотни в секунду. Лента применяет
 * их к своей копии сразу, а перерисовывается не чаще раза за кадр и только пока чат
 * на экране: скрытый чат догоняет ленту, когда его снова откроют.
 */
export function useConversation(chatId: string, visible: boolean): ConversationState {
  const [state, setState] = useState<ConversationState>(LOADING_STATE)
  const latestRef = useRef<ConversationState>(LOADING_STATE)
  const visibleRef = useRef(visible)
  const frameRef = useRef<number | null>(null)
  visibleRef.current = visible

  useEffect(() => {
    let cancelled = false
    // События, пришедшие до снимка, ждут его: те, что в снимок не вошли, применяются поверх.
    let pending: ConversationEvent[] | null = []
    latestRef.current = LOADING_STATE
    setState(LOADING_STATE)

    const flush = () => {
      frameRef.current = null
      setState(latestRef.current)
    }
    const scheduleFlush = () => {
      if (visibleRef.current && frameRef.current === null) {
        frameRef.current = requestAnimationFrame(flush)
      }
    }

    const unsubscribe = atox.conversations.onEvent(chatId, (event) => {
      if (pending) {
        pending.push(event)
        return
      }
      latestRef.current = { ...applyConversationEvent(latestRef.current, event), loading: false }
      scheduleFlush()
    })

    atox.conversations
      .snapshot(chatId)
      .then((snapshot) => {
        if (cancelled) {
          return
        }
        const events = pending ?? []
        pending = null
        // Снимок уже содержит события до своего номера: повторная дельта удвоила бы текст, а
        // старая версия элемента откатила бы его.
        const applied = snapshot.seq ?? 0
        const replayed = events
          .filter((event) => event.seq > applied)
          .reduce(applyConversationEvent, snapshot)
        latestRef.current = { ...replayed, loading: false }
        setState(latestRef.current)
      })
      .catch((error) => {
        console.error('Failed to load the conversation', error)
        pending = null
        if (!cancelled) {
          latestRef.current = { ...EMPTY_CONVERSATION, loading: false }
          setState(latestRef.current)
        }
      })

    return () => {
      cancelled = true
      unsubscribe()
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [chatId])

  // Чат снова на экране: показываем всё, что пришло, пока он был скрыт.
  useEffect(() => {
    if (visible) {
      setState(latestRef.current)
    }
  }, [visible])

  return state
}
