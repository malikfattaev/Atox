import { existsSync } from 'node:fs'
import { spawn, type IPty } from 'node-pty'
import type { TerminalSize } from '../shared/api'
import { resolveShell, sessionEnvironment } from './shellEnvironment'

/**
 * Сколько последнего вывода держать в памяти: панель терминала, открытая заново (или окно после
 * перезагрузки), восстанавливает экран из этого буфера.
 */
const OUTPUT_BUFFER_LIMIT = 512 * 1024

/**
 * Сколько чанков, уже вытесненных из буфера, копить перед тем, как убрать их из массива:
 * убирать по одному — сдвигать весь массив на каждый чанк вывода. Массив переписывается,
 * только когда вытесненных не меньше половины, — так на чанк приходится постоянная работа.
 */
const COMPACT_THRESHOLD = 1024

/**
 * Последний вывод оболочки, не больше лимита. Чанки хранятся как пришли и склеиваются,
 * только когда вывод понадобился: склеивать и обрезать строку в полмегабайта на каждый
 * чанк — заметная нагрузка, когда программа в терминале выводит много.
 */
class OutputBuffer {
  private chunks: string[] = []
  /** Первый чанк, ещё входящий в буфер; перед ним — вытесненные. */
  private head = 0
  private length = 0

  constructor(private readonly limit: number) {}

  append(data: string): void {
    this.chunks.push(data)
    this.length += data.length
    // Вытесняем старые чанки, пока без них в буфере остаётся не меньше лимита.
    let first = this.chunks[this.head]
    while (first !== undefined && this.length - first.length >= this.limit) {
      this.length -= first.length
      first = this.chunks[++this.head]
    }
    if (this.head >= COMPACT_THRESHOLD && this.head * 2 >= this.chunks.length) {
      this.chunks = this.chunks.slice(this.head)
      this.head = 0
    }
  }

  toString(): string {
    const output = this.chunks.slice(this.head).join('')
    return output.length > this.limit ? output.slice(output.length - this.limit) : output
  }
}

interface Session {
  pty: IPty
  output: OutputBuffer
}

interface TerminalEvents {
  onData(terminalId: string, data: string): void
  onExit(terminalId: string): void
}

/**
 * Оболочки в панели терминала: по одной на проект, в его папке. Оболочка живёт, пока её
 * не закроют командой `exit`, не уберут проект или не выйдут из приложения, — скрытая панель
 * её не останавливает.
 */
export class TerminalManager {
  private readonly sessions = new Map<string, Session>()

  constructor(
    private readonly appName: string,
    private readonly events: TerminalEvents
  ) {}

  /** Запускает оболочку, если она ещё не запущена, и возвращает накопленный вывод. */
  attach(terminalId: string, cwd: string, size: TerminalSize): string {
    const existing = this.sessions.get(terminalId)
    if (existing) {
      existing.pty.resize(size.cols, size.rows)
      return existing.output.toString()
    }
    if (!existsSync(cwd)) {
      throw new Error(`Project folder not found: ${cwd}`)
    }

    // Оболочка входа сама настроит PATH, алиасы и переменные инструментов из профиля пользователя.
    const pty = spawn(resolveShell(), ['-l'], {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd,
      env: {
        ...sessionEnvironment(),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        TERM_PROGRAM: this.appName
      }
    })
    const session: Session = { pty, output: new OutputBuffer(OUTPUT_BUFFER_LIMIT) }
    this.sessions.set(terminalId, session)

    pty.onData((data) => {
      session.output.append(data)
      this.events.onData(terminalId, data)
    })
    pty.onExit(() => {
      // Оболочку могли уже остановить и запустить заново — удаляем только свою.
      if (this.sessions.get(terminalId) === session) {
        this.sessions.delete(terminalId)
        this.events.onExit(terminalId)
      }
    })
    return ''
  }

  write(terminalId: string, data: string): void {
    this.sessions.get(terminalId)?.pty.write(data)
  }

  resize(terminalId: string, size: TerminalSize): void {
    this.sessions.get(terminalId)?.pty.resize(size.cols, size.rows)
  }

  kill(terminalId: string): void {
    const session = this.sessions.get(terminalId)
    if (session) {
      this.sessions.delete(terminalId)
      session.pty.kill()
    }
  }

  killAll(): void {
    for (const terminalId of [...this.sessions.keys()]) {
      this.kill(terminalId)
    }
  }
}
