import { existsSync } from 'node:fs'
import { userInfo } from 'node:os'
import { basename } from 'node:path'
import { spawn, type IPty } from 'node-pty'
import type { TerminalSize } from '../shared/api'

/** Стандартная оболочка macOS — на случай, если система не сообщила оболочку пользователя. */
const DEFAULT_SHELL = '/bin/zsh'

/** GUI-приложения на macOS запускаются без LANG, а без UTF-8-локали ломается вывод не-ASCII символов. */
const FALLBACK_LANG = 'en_US.UTF-8'

/**
 * Как и Terminal.app, оболочка получает только базовое окружение сеанса macOS, а всё остальное
 * (PATH из Homebrew, алиасы, переменные инструментов) настраивает профиль пользователя при входе.
 * Так в терминал не протекают переменные процесса, из которого запущен сам Atox.
 */
const SESSION_ENV_KEYS = [
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'PATH',
  'TMPDIR',
  'LANG',
  'SSH_AUTH_SOCK',
  '__CF_USER_TEXT_ENCODING'
] as const

/**
 * Сколько последнего вывода держать в памяти: при повторном подключении интерфейса
 * (перезагрузка окна, пересоздание вида) терминал восстанавливается из этого буфера.
 */
const OUTPUT_BUFFER_LIMIT = 512 * 1024

/** Вставка текста в терминал, как из буфера обмена: программа получает его одним блоком. */
const BRACKETED_PASTE_START = '\x1b[200~'
const BRACKETED_PASTE_END = '\x1b[201~'

/**
 * Пауза между вставкой и Enter: если Enter придёт в той же записи, агенты (Claude Code, Codex)
 * могут оставить вставленный текст в поле ввода, не отправив его.
 */
const PASTE_SUBMIT_DELAY_MS = 500

/** Управляющие символы, кроме перевода строки и табуляции: в тексте они могли бы закрыть вставку. */
const CONTROL_CHARACTERS = /[\x00-\x08\x0b-\x1f\x7f]/g

interface Session {
  pty: IPty
  output: string
  /** Растёт с каждым новым выводом: по нему видно, изменился ли экран. */
  outputVersion: number
  /** Последний разобранный экран: пока вывод и размер те же, разбирать заново незачем. */
  screen?: { outputVersion: number; size: TerminalSize; lines: string[] }
  size: TerminalSize
  /** Когда пользователь последний раз что-то набрал в терминале. */
  lastInputAt: number
  /** Имя процесса оболочки: всё, что отличается от него, — запущенная в терминале программа. */
  shellName: string
}

export interface RunningProgram {
  chatId: string
  program: string
}

interface TerminalEvents {
  onData(chatId: string, data: string): void
  onExit(chatId: string): void
}

interface TerminalOptions {
  appName: string
  /** Дополнительные переменные окружения терминала чата. */
  environment?(chatId: string): Record<string, string>
}

/** Процессы оболочки для чатов: один псевдотерминал на чат. */
export class TerminalManager {
  private readonly sessions = new Map<string, Session>()

  constructor(
    private readonly options: TerminalOptions,
    private readonly events: TerminalEvents
  ) {}

  /**
   * Запускает оболочку чата, если она ещё не запущена, и возвращает накопленный вывод.
   * `startupCommand` выполняется в новой оболочке — так запускается агент чата.
   */
  attach(chatId: string, cwd: string, size: TerminalSize, startupCommand: string): string {
    const existing = this.sessions.get(chatId)
    if (existing) {
      this.resizeSession(existing, size)
      return existing.output
    }

    if (!existsSync(cwd)) {
      throw new Error(`Project folder not found: ${cwd}`)
    }

    const shell = resolveShell()
    const pty = spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd,
      env: this.createEnvironment(chatId)
    })
    const session: Session = {
      pty,
      output: '',
      outputVersion: 0,
      size,
      lastInputAt: 0,
      shellName: basename(shell)
    }
    this.sessions.set(chatId, session)

    pty.onData((data) => {
      session.output = (session.output + data).slice(-OUTPUT_BUFFER_LIMIT)
      session.outputVersion++
      this.events.onData(chatId, data)
    })
    // Оболочка сама прочитает команду, как только будет готова: ввод буферизуется терминалом.
    if (startupCommand) {
      pty.write(`${startupCommand}\r`)
    }

    pty.onExit(() => {
      // Сессию могли уже заменить новой — удаляем только свою.
      if (this.sessions.get(chatId) === session) {
        this.sessions.delete(chatId)
      }
      this.events.onExit(chatId)
    })

    return ''
  }

  /** Ввод пользователя. */
  write(chatId: string, data: string): void {
    const session = this.sessions.get(chatId)
    if (session) {
      session.lastInputAt = Date.now()
      session.pty.write(data)
    }
  }

  /** Сколько миллисекунд пользователь ничего не набирал в терминале чата. */
  inputIdleTime(chatId: string): number {
    const session = this.sessions.get(chatId)
    return session ? Date.now() - session.lastInputAt : Infinity
  }

  /** Строки, которые сейчас видны в терминале чата; `null` — терминал не запущен. */
  async readScreen(chatId: string): Promise<string[] | null> {
    const session = this.sessions.get(chatId)
    if (!session) {
      return null
    }
    const { outputVersion, size, screen } = session
    if (screen?.outputVersion === outputVersion && screen.size === size) {
      return screen.lines
    }
    // Эмулятор нужен редко — он загружается при первом запросе, а не при запуске приложения.
    const { renderScreen } = await import('./terminalScreen')
    const lines = await renderScreen(session.output, size.cols, size.rows)
    session.screen = { outputVersion, size, lines }
    return lines
  }

  /**
   * Отправляет текст программе в терминале как вставку и нажимает Enter — так агент получает
   * сообщение целиком, даже многострочное. Возвращает `false`, если терминал не запущен.
   */
  paste(chatId: string, text: string): boolean {
    const session = this.sessions.get(chatId)
    if (!session) {
      return false
    }
    // Строки в терминал вставляются через CR, как это делает xterm при вставке.
    const content = text
      .replace(/\r\n?/g, '\n')
      .replace(CONTROL_CHARACTERS, '')
      .replace(/\n/g, '\r')
    session.pty.write(`${BRACKETED_PASTE_START}${content}${BRACKETED_PASTE_END}`)
    setTimeout(() => {
      // За паузу терминал могли закрыть или перезапустить.
      if (this.sessions.get(chatId) === session) {
        session.pty.write('\r')
      }
    }, PASTE_SUBMIT_DELAY_MS)
    return true
  }

  isRunning(chatId: string): boolean {
    return this.sessions.has(chatId)
  }

  resize(chatId: string, size: TerminalSize): void {
    const session = this.sessions.get(chatId)
    if (session) {
      this.resizeSession(session, size)
    }
  }

  private resizeSession(session: Session, size: TerminalSize): void {
    session.size = size
    session.pty.resize(size.cols, size.rows)
  }

  /** Программа, которая сейчас работает в терминале чата поверх оболочки; `null` — терминал свободен. */
  getRunningProgram(chatId: string): string | null {
    const session = this.sessions.get(chatId)
    if (!session) {
      return null
    }
    // Оболочку входа macOS показывает с дефисом в начале имени (-zsh).
    const program = session.pty.process.replace(/^-/, '')
    return program && program !== session.shellName ? program : null
  }

  listRunningPrograms(): RunningProgram[] {
    return [...this.sessions.keys()].flatMap((chatId) => {
      const program = this.getRunningProgram(chatId)
      return program ? [{ chatId, program }] : []
    })
  }

  kill(chatId: string): void {
    const session = this.sessions.get(chatId)
    if (session) {
      this.sessions.delete(chatId)
      session.pty.kill()
    }
  }

  killAll(): void {
    for (const chatId of [...this.sessions.keys()]) {
      this.kill(chatId)
    }
  }

  private createEnvironment(chatId: string): Record<string, string> {
    const env: Record<string, string> = {}
    for (const key of SESSION_ENV_KEYS) {
      const value = process.env[key]
      if (value !== undefined) {
        env[key] = value
      }
    }
    return {
      ...env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: this.options.appName,
      LANG: env['LANG'] ?? FALLBACK_LANG,
      ...this.options.environment?.(chatId)
    }
  }
}

export function resolveShell(): string {
  return process.env['SHELL'] || userInfo().shell || DEFAULT_SHELL
}
