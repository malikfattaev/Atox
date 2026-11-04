import type { UserRequestKind } from '../../../shared/conversation'

/** `waiting` — агент ждёт ответа пользователя, `unread` — закончил, пока на чат не смотрели. */
export type ChatActivityStatus = 'idle' | 'working' | 'waiting' | 'unread'

/** Уведомлять о завершении только долгой работы — быстрые ответы не должны отвлекать. */
const NOTIFY_MIN_WORK_MS = 10_000

/** Текст уведомления о том, чего ждёт агент. */
const REQUEST_MESSAGES: Record<UserRequestKind, string> = {
  approval: 'Needs your approval',
  question: 'Has a question for you'
}

export interface ChatActivityEnvironment {
  /** Пользователь сейчас видит этот чат: он выбран и окно в фокусе. */
  isChatInView(chatId: string): boolean
  notify(chatId: string, message: string): void
}

interface ChatState {
  running: boolean
  waitingFor: UserRequestKind | null
  /** Агент закончил, пока пользователь смотрел в другое место. */
  unread: boolean
  workStartedAt: number
}

/**
 * Состояние чатов для индикаторов в сайдбаре и числа на иконке приложения: работает ли агент,
 * ждёт ли он ответа, закончил ли он, пока пользователь смотрел в другое место, и нужно ли
 * его позвать.
 */
export class ChatActivityTracker {
  private readonly chats = new Map<string, ChatState>()
  private readonly listeners = new Set<() => void>()
  /**
   * Чаты помощников: у них не бывает «закончил, не прочитано» и уведомлений о завершении —
   * об их работе сообщает их агент, когда получит отчёт. Ответа пользователя они ждут как все.
   */
  private backgroundChatIds = new Set<string>()

  constructor(private readonly environment: ChatActivityEnvironment) {}

  status(chatId: string): ChatActivityStatus {
    const state = this.chats.get(chatId)
    if (!state) {
      return 'idle'
    }
    if (state.waitingFor) {
      return 'waiting'
    }
    if (state.running) {
      return 'working'
    }
    return state.unread ? 'unread' : 'idle'
  }

  /** Сколько чатов ждут пользователя: ответа на запрос или просмотра законченной работы. */
  attentionCount(): number {
    let count = 0
    for (const state of this.chats.values()) {
      if (state.waitingFor || state.unread) {
        count++
      }
    }
    return count
  }

  setBackgroundChats(chatIds: Iterable<string>): void {
    this.backgroundChatIds = new Set(chatIds)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Агент чата начал или закончил работу. */
  reportRunning(chatId: string, running: boolean): void {
    const state = this.state(chatId)
    if (state.running === running) {
      return
    }
    state.running = running
    if (running) {
      state.workStartedAt = Date.now()
      state.unread = false
    } else if (!this.backgroundChatIds.has(chatId) && !this.environment.isChatInView(chatId)) {
      state.unread = true
      if (Date.now() - state.workStartedAt >= NOTIFY_MIN_WORK_MS) {
        this.environment.notify(chatId, 'Finished working')
      }
    }
    this.changed()
  }

  /** Агент чата начал (`waitingFor`) или перестал (`null`) ждать ответа пользователя. */
  reportWaiting(chatId: string, waitingFor: UserRequestKind | null): void {
    const state = this.state(chatId)
    if (state.waitingFor === waitingFor) {
      return
    }
    const started = waitingFor !== null && state.waitingFor === null
    state.waitingFor = waitingFor
    if (started && !this.environment.isChatInView(chatId)) {
      this.environment.notify(chatId, REQUEST_MESSAGES[waitingFor])
    }
    this.changed()
  }

  markSeen(chatId: string): void {
    const state = this.chats.get(chatId)
    if (state?.unread) {
      state.unread = false
      this.changed()
    }
  }

  forget(chatId: string): void {
    if (this.chats.delete(chatId)) {
      this.changed()
    }
  }

  private state(chatId: string): ChatState {
    let state = this.chats.get(chatId)
    if (!state) {
      state = { running: false, waitingFor: null, unread: false, workStartedAt: 0 }
      this.chats.set(chatId, state)
    }
    return state
  }

  private changed(): void {
    this.listeners.forEach((listener) => listener())
  }
}
