export type ChatActivityStatus = 'idle' | 'working' | 'unread'

/** Тишина в выводе, после которой работа в чате считается законченной. */
const QUIET_PERIOD_MS = 1500

/** Вывод сразу после ввода — эхо набранного текста, а не работа программы. */
const ECHO_WINDOW_MS = 250

/** Уведомлять о завершении только долгой работы — быстрые команды не должны отвлекать. */
const NOTIFY_MIN_WORK_MS = 10_000

export interface ChatActivityEnvironment {
  /** Пользователь сейчас видит этот чат: он выбран и окно в фокусе. */
  isChatInView(chatId: string): boolean
  notify(chatId: string, message: string): void
}

interface ChatState {
  status: ChatActivityStatus
  workStartedAt: number
  lastOutputAt: number
  lastInputAt: number
  quietTimer?: ReturnType<typeof setTimeout>
}

/**
 * Следит за активностью терминалов по их выводу: работает ли программа, закончила ли она,
 * пока пользователь смотрел в другое место, и нужно ли его позвать.
 */
export class ChatActivityTracker {
  private readonly chats = new Map<string, ChatState>()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly environment: ChatActivityEnvironment) {}

  status(chatId: string): ChatActivityStatus {
    return this.chats.get(chatId)?.status ?? 'idle'
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  reportInput(chatId: string): void {
    this.state(chatId).lastInputAt = Date.now()
  }

  reportOutput(chatId: string): void {
    const state = this.state(chatId)
    const now = Date.now()
    if (now - state.lastInputAt < ECHO_WINDOW_MS) {
      return
    }

    state.lastOutputAt = now
    if (state.status !== 'working') {
      state.workStartedAt = now
      this.setStatus(state, 'working')
    }
    clearTimeout(state.quietTimer)
    state.quietTimer = setTimeout(() => this.finishWork(chatId, state), QUIET_PERIOD_MS)
  }

  /** Программа просит внимания: звонок терминала или уведомление через OSC 9. */
  reportAttention(chatId: string, message: string): void {
    if (this.environment.isChatInView(chatId)) {
      return
    }
    const state = this.state(chatId)
    clearTimeout(state.quietTimer)
    this.setStatus(state, 'unread')
    this.environment.notify(chatId, message)
  }

  markSeen(chatId: string): void {
    const state = this.chats.get(chatId)
    if (state?.status === 'unread') {
      this.setStatus(state, 'idle')
    }
  }

  forget(chatId: string): void {
    clearTimeout(this.chats.get(chatId)?.quietTimer)
    this.chats.delete(chatId)
  }

  private finishWork(chatId: string, state: ChatState): void {
    if (this.environment.isChatInView(chatId)) {
      this.setStatus(state, 'idle')
      return
    }
    this.setStatus(state, 'unread')
    if (state.lastOutputAt - state.workStartedAt >= NOTIFY_MIN_WORK_MS) {
      this.environment.notify(chatId, 'Finished working')
    }
  }

  private state(chatId: string): ChatState {
    let state = this.chats.get(chatId)
    if (!state) {
      state = { status: 'idle', workStartedAt: 0, lastOutputAt: 0, lastInputAt: 0 }
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
