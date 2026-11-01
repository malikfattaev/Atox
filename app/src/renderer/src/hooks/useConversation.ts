import { useEffect, useState } from 'react'
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

/** Лента чата: снимок из main-процесса плюс события, которые пришли после него. */
export function useConversation(chatId: string): ConversationState {
  const [state, setState] = useState<ConversationState>({ ...EMPTY_CONVERSATION, loading: true })

  useEffect(() => {
    let cancelled = false
    // События, пришедшие до снимка, применяются поверх него: так ничего не теряется.
    let pending: ConversationEvent[] | null = []
    setState({ ...EMPTY_CONVERSATION, loading: true })

    const unsubscribe = atox.conversations.onEvent(chatId, (event) => {
      if (pending) {
        pending.push(event)
      } else {
        setState((current) => ({ ...applyConversationEvent(current, event), loading: false }))
      }
    })

    atox.conversations
      .snapshot(chatId)
      .then((snapshot) => {
        if (cancelled) {
          return
        }
        const events = pending ?? []
        pending = null
        // Снимок мог уже включать часть событий: повторное применение элемента его не дублирует,
        // а дельту текста — да, поэтому дельты до снимка отбрасываются.
        const replayed = events
          .filter((event) => event.type !== 'delta')
          .reduce(applyConversationEvent, snapshot)
        setState({ ...replayed, loading: false })
      })
      .catch((error) => {
        console.error('Failed to load the conversation', error)
        pending = null
        if (!cancelled) {
          setState({ ...EMPTY_CONVERSATION, loading: false })
        }
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [chatId])

  return state
}
