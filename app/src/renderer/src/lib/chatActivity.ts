export type ChatActivityStatus = 'idle' | 'working' | 'unread'

/** Тишина в выводе, после которой работа в чате считается законченной. */
const QUIET_PERIOD_MS = 1500

/** Вывод сразу после ввода — эхо набранного текста, а не работа программы. */
const ECHO_WINDOW_MS = 250

/**
 * Дольше запуск или перерисовка не длятся: если вывод всё ещё идёт, программа уже работает —
 * например, агенту пришло сообщение сразу после открытия чата.
 */
const SETTLE_LIMIT_MS = 5000

/**
 * Служебные последовательности терминала: команды курсора и экрана, заголовки, запросы
 * возможностей. Вывод только из них — перерисовка, а не работа программы.
 */
const TERMINAL_CONTROLS =
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[P_^X][\s\S]*?(?:\x1b\\|$)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[ -/]*[0-~]|[\x00-\x1f\x7f]/g

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
  /**
   * Программа запускается или перерисовывает экран под новый размер: её вывод — не работа,
   * пока он не затихнет или пользователь что-нибудь не наберёт.
   */
  settling: boolean
  settleDeadline: number
  settleTimer?: ReturnType<typeof setTimeout>
  quietTimer?: ReturnType<typeof setTimeout>
}

/**
 * Следит за активностью терминалов по их выводу: работает ли программа, закончила ли она,
 * пока пользователь смотрел в другое место, и нужно ли его позвать.
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
    return () => this.listeners.delete(listener)
  }

  reportInput(chatId: string): void {
    const state = this.state(chatId)
    state.lastInputAt = Date.now()
    // Пользователь что-то отправил — дальше вывод снова может быть работой.
    state.settling = false
    clearTimeout(state.settleTimer)
  }

  /**
   * Терминал чата подключили или изменили его размер: программа сейчас запустится или
   * перерисует экран. Так бывает, когда чат просто открывают, — это не работа.
   */
  reportRedraw(chatId: string): void {
    const state = this.state(chatId)
    if (state.status !== 'working') {
      state.settling = true
      state.settleDeadline = Date.now() + SETTLE_LIMIT_MS
      this.restartSettleTimer(state)
    }
  }

  reportOutput(chatId: string, data: string): void {
    const state = this.state(chatId)
    const now = Date.now()
    if (now - state.lastInputAt < ECHO_WINDOW_MS || !hasVisibleText(data)) {
      return
    }
    if (state.settling && now < state.settleDeadline) {
      this.restartSettleTimer(state)
      return
    }
    state.settling = false

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
    if (this.backgroundChatIds.has(chatId) || this.environment.isChatInView(chatId)) {
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
    clearTimeout(this.chats.get(chatId)?.settleTimer)
    this.chats.delete(chatId)
  }

  private finishWork(chatId: string, state: ChatState): void {
    if (this.backgroundChatIds.has(chatId) || this.environment.isChatInView(chatId)) {
      this.setStatus(state, 'idle')
      return
    }
    this.setStatus(state, 'unread')
    if (state.lastOutputAt - state.workStartedAt >= NOTIFY_MIN_WORK_MS) {
      this.environment.notify(chatId, 'Finished working')
    }
  }

  private restartSettleTimer(state: ChatState): void {
    clearTimeout(state.settleTimer)
    state.settleTimer = setTimeout(() => (state.settling = false), QUIET_PERIOD_MS)
  }

  private state(chatId: string): ChatState {
    let state = this.chats.get(chatId)
    if (!state) {
      state = {
        status: 'idle',
        workStartedAt: 0,
        lastOutputAt: 0,
        lastInputAt: 0,
        settling: false,
        settleDeadline: 0
      }
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

function hasVisibleText(data: string): boolean {
  return data.replace(TERMINAL_CONTROLS, '').trim().length > 0
}
