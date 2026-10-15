import type { TerminalManager } from '../terminals'

/** Как часто проверять, можно ли отдать сообщение агенту. */
const CHECK_INTERVAL_MS = 1000

/** Пользователь набирал текст недавно — вставка смешалась бы с его черновиком. */
const TYPING_IDLE_MS = 3000

/** Сообщение, которое так и не удалось отдать, перестаёт ждать — агент, видимо, занят надолго. */
const MAX_WAIT_MS = 30 * 60 * 1000

/**
 * Подписи диалогов, в которых агент ждёт решения: подтверждение команды, выбор варианта.
 * Вставленный в такой момент текст с Enter выбрал бы вариант за пользователя.
 */
const DIALOG_HINT = /esc to cancel|enter to confirm|\((?:y\/n|yes\/no)\)|\[(?:y\/n|yes\/no)\]/i

/** Сколько нижних строк экрана смотреть: диалоги агентов рисуются внизу, над строкой ввода. */
const DIALOG_SEARCH_LINES = 15

interface PendingMessage {
  chatId: string
  text: string
  queuedAt: number
}

/**
 * Очередь сообщений агентам в терминалах. Сообщение вставляется, только когда агента можно
 * безопасно прервать: пользователь не печатает в этом чате и на экране нет диалога
 * с вариантами. Пока агент работает, вставка безопасна — агенты ставят её в очередь сами.
 */
export class MessageDelivery {
  private readonly queue: PendingMessage[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private checking = false

  constructor(private readonly terminals: TerminalManager) {}

  enqueue(chatId: string, text: string): void {
    this.queue.push({ chatId, text, queuedAt: Date.now() })
    this.timer ??= setInterval(() => void this.check(), CHECK_INTERVAL_MS)
    void this.check()
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.queue.length = 0
  }

  private async check(): Promise<void> {
    if (this.checking) {
      return
    }
    this.checking = true
    try {
      // В каждый чат за проверку уходит не больше одного сообщения: агент примет его по очереди.
      const served = new Set<string>()
      for (const message of [...this.queue]) {
        if (served.has(message.chatId)) {
          continue
        }
        served.add(message.chatId)
        const state = await this.readiness(message)
        if (state !== 'wait') {
          this.queue.splice(this.queue.indexOf(message), 1)
        }
        if (state === 'ready') {
          this.terminals.paste(message.chatId, message.text)
        } else if (state === 'drop') {
          console.warn('Dropped an undelivered agent message for chat', message.chatId)
        }
      }
    } finally {
      this.checking = false
      if (this.queue.length === 0 && this.timer) {
        clearInterval(this.timer)
        this.timer = null
      }
    }
  }

  private async readiness(message: PendingMessage): Promise<'ready' | 'wait' | 'drop'> {
    const { chatId } = message
    // Агент вышел или чат удалили — отдавать некому.
    if (this.terminals.getRunningProgram(chatId) === null) {
      return 'drop'
    }
    if (Date.now() - message.queuedAt > MAX_WAIT_MS) {
      return 'drop'
    }
    if (this.terminals.inputIdleTime(chatId) < TYPING_IDLE_MS) {
      return 'wait'
    }
    const screen = await this.terminals.readScreen(chatId)
    const bottom = (screen ?? []).filter((line) => line.trim()).slice(-DIALOG_SEARCH_LINES)
    return bottom.some((line) => DIALOG_HINT.test(line)) ? 'wait' : 'ready'
  }
}
