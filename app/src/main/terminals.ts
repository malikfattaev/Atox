import { existsSync } from 'node:fs'
import { userInfo } from 'node:os'
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

interface Session {
  pty: IPty
  output: string
}

interface TerminalEvents {
  onData(chatId: string, data: string): void
  onExit(chatId: string): void
}

/** Процессы оболочки для чатов: один псевдотерминал на чат. */
export class TerminalManager {
  private readonly sessions = new Map<string, Session>()

  constructor(
    private readonly appName: string,
    private readonly events: TerminalEvents
  ) {}

  /** Запускает оболочку чата, если она ещё не запущена, и возвращает накопленный вывод. */
  attach(chatId: string, cwd: string, size: TerminalSize): string {
    const existing = this.sessions.get(chatId)
    if (existing) {
      existing.pty.resize(size.cols, size.rows)
      return existing.output
    }

    if (!existsSync(cwd)) {
      throw new Error(`Project folder not found: ${cwd}`)
    }

    const pty = spawn(resolveShell(), ['-l'], {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd,
      env: this.createEnvironment()
    })
    const session: Session = { pty, output: '' }
    this.sessions.set(chatId, session)

    pty.onData((data) => {
      session.output = (session.output + data).slice(-OUTPUT_BUFFER_LIMIT)
      this.events.onData(chatId, data)
    })
    pty.onExit(() => {
      // Сессию могли уже заменить новой — удаляем только свою.
      if (this.sessions.get(chatId) === session) {
        this.sessions.delete(chatId)
      }
      this.events.onExit(chatId)
    })

    return ''
  }

  write(chatId: string, data: string): void {
    this.sessions.get(chatId)?.pty.write(data)
  }

  resize(chatId: string, size: TerminalSize): void {
    this.sessions.get(chatId)?.pty.resize(size.cols, size.rows)
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

  private createEnvironment(): Record<string, string> {
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
      TERM_PROGRAM: this.appName,
      LANG: env['LANG'] ?? FALLBACK_LANG
    }
  }
}

function resolveShell(): string {
  return process.env['SHELL'] || userInfo().shell || DEFAULT_SHELL
}
