export type ChatActivityStatus = 'idle' | 'working' | 'unread'

/** Уведомлять о завершении только долгой работы — быстрые ответы не должны отвлекать. */
const NOTIFY_MIN_WORK_MS = 10_000

export interface ChatActivityEnvironment {
  /** Пользователь сейчас видит этот чат: он выбран и окно в фокусе. */
  isChatInView(chatId: string): boolean
  notify(chatId: string, message: string): void
}

interface ChatState {
  status: ChatActivityStatus
  workStartedAt: number
}

/**
 * Состояние чатов для индикаторов в сайдбаре: работает ли агент, закончил ли он, пока
 * пользователь смотрел в другое место, и нужно ли его позвать.
 */
export class ChatActivityTracker {
  private readonly chats = new Map<string, ChatState>()
  private readonly listeners = new Set<() => void>()
  /**
   * Чаты помощников: у них не бывает «закончил, не прочитано» и уведомлений — об их работе
   * сообщает их агент, когда получит отчёт.
   */
  private backgroundChatIds = new Set<string>()

  constructor(private readonly environment: ChatActivityEnvironment) {}

  status(chatId: string): ChatActivityStatus {
    return this.chats.get(chatId)?.status ?? 'idle'
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
    if (running) {
      if (state.status !== 'working') {
        state.workStartedAt = Date.now()
      }
      this.setStatus(state, 'working')
      return
    }
    if (state.status !== 'working') {
      return
    }
    if (this.backgroundChatIds.has(chatId) || this.environment.isChatInView(chatId)) {
      this.setStatus(state, 'idle')
      return
    }
    this.setStatus(state, 'unread')
    if (Date.now() - state.workStartedAt >= NOTIFY_MIN_WORK_MS) {
      this.environment.notify(chatId, 'Finished working')
    }
  }

  markSeen(chatId: string): void {
    const state = this.chats.get(chatId)
    if (state?.status === 'unread') {
      this.setStatus(state, 'idle')
    }
  }

  forget(chatId: string): void {
    this.chats.delete(chatId)
  }

  private state(chatId: string): ChatState {
    let state = this.chats.get(chatId)
    if (!state) {
      state = { status: 'idle', workStartedAt: 0 }
      this.chats.set(chatId, state)
    }
    return state
  }

  private setStatus(state: ChatState, status: ChatActivityStatus): void {
    if (state.status !== status) {
      state.status = status
      this.listeners.forEach((listener) => listener())
    }
  }
}
