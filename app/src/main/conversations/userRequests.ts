import { randomUUID } from 'node:crypto'
import type { RequestAnswer, TimelineItem } from '../../shared/conversation'
import type { SessionEvents } from './types'

type RequestItem = Extract<TimelineItem, { kind: 'approval' | 'question' }>

/** Запрос без `id` и состояния: их выставляет `UserRequests`. */
export type NewRequest =
  | Omit<Extract<RequestItem, { kind: 'approval' }>, 'id' | 'status'>
  | Omit<Extract<RequestItem, { kind: 'question' }>, 'id' | 'status' | 'answers'>

/**
 * Запросы агента к пользователю: разрешения, вопросы, формы MCP-серверов. Запрос
 * показывается в ленте и ждёт ответа; `null` — ответа не будет: агента остановили.
 */
export class UserRequests {
  private readonly pending = new Map<string, (answer: RequestAnswer | null) => void>()

  constructor(private readonly events: SessionEvents) {}

  ask(request: NewRequest, signal?: AbortSignal): Promise<RequestAnswer | null> {
    const item = {
      ...request,
      id: randomUUID(),
      status: 'pending'
    } as RequestItem
    this.events.item(item)
    return new Promise((resolve) => {
      const finish = (answer: RequestAnswer | null) => {
        if (!this.pending.delete(item.id)) {
          return
        }
        signal?.removeEventListener('abort', cancel)
        this.events.item(answeredItem(item, answer))
        resolve(answer)
      }
      const cancel = () => finish(null)
      this.pending.set(item.id, finish)
      if (signal?.aborted) {
        cancel()
      } else {
        signal?.addEventListener('abort', cancel, { once: true })
      }
    })
  }

  answer(itemId: string, answer: RequestAnswer): void {
    this.pending.get(itemId)?.(answer)
  }

  /** Агента остановили или он завершился: ждать ответов больше незачем. */
  cancelAll(): void {
    for (const finish of [...this.pending.values()]) {
      finish(null)
    }
  }
}

function answeredItem(item: RequestItem, answer: RequestAnswer | null): RequestItem {
  if (item.kind === 'approval') {
    return {
      ...item,
      status: !answer ? 'cancelled' : answer.accepted ? 'allowed' : 'denied'
    }
  }
  if (!answer) {
    return { ...item, status: 'cancelled' }
  }
  return answer.accepted
    ? {
        ...item,
        status: 'answered',
        ...(answer.values && { answers: answer.values })
      }
    : { ...item, status: 'declined' }
}
