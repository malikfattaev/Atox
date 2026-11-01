import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

interface JsonRpcMessage {
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code?: number; message?: string }
}

interface PendingRequest {
  resolve(result: unknown): void
  reject(error: Error): void
}

export interface JsonRpcHandlers {
  notification(method: string, params: unknown): void
  /** Запрос от сервера к клиенту, например подтверждение действия; ответ — его результат. */
  request(method: string, params: unknown): Promise<unknown>
  exit(error: Error | null): void
}

/** Код ошибки JSON-RPC «метод не найден» — ответ на запрос, который клиент не знает. */
export const METHOD_NOT_FOUND = -32601

/** Сколько последнего stderr держать: им объясняется, почему процесс упал. */
const STDERR_TAIL_LIMIT = 4096

/**
 * Процесс, с которым идёт обмен сообщениями JSON-RPC по строкам stdin/stdout,
 * как у `codex app-server`.
 */
export class JsonRpcProcess {
  private readonly process: ChildProcessWithoutNullStreams
  private readonly pending = new Map<number, PendingRequest>()
  private nextId = 1
  private stderrTail = ''
  private exited = false
  /** Процесс остановил сам Atox: его завершение по сигналу — не ошибка. */
  private killed = false

  constructor(
    command: string,
    args: readonly string[],
    options: { cwd: string; env: Record<string, string> },
    private readonly handlers: JsonRpcHandlers
  ) {
    this.process = spawn(command, args, { cwd: options.cwd, env: options.env })
    createInterface({ input: this.process.stdout }).on('line', (line) => this.receive(line))
    this.process.stderr.setEncoding('utf8')
    this.process.stderr.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_LIMIT)
    })
    // Процесс, упавший сразу после запуска, закрывает stdin посреди записи. Об ошибке
    // сообщит его выход, а необработанная ошибка потока уронила бы всё приложение.
    this.process.stdin.on('error', () => undefined)
    this.process.on('error', (error) => this.finish(error))
    this.process.on('exit', (code, signal) => {
      const failed = !this.killed && (code !== 0 || signal !== null)
      this.finish(failed ? new Error(this.describeExit(code, signal)) : null)
    })
  }

  request<Result>(method: string, params: unknown): Promise<Result> {
    if (this.exited) {
      return Promise.reject(new Error('The agent process has exited'))
    }
    const id = this.nextId++
    return new Promise<Result>((resolve, reject) => {
      this.pending.set(id, { resolve: (result) => resolve(result as Result), reject })
      this.write({ id, method, params })
    })
  }

  /** Процесс ещё работает: его ошибки ещё не сообщены через `exit`. */
  get alive(): boolean {
    return !this.exited
  }

  notify(method: string, params?: unknown): void {
    this.write({ method, ...(params !== undefined && { params }) })
  }

  kill(): void {
    if (!this.exited) {
      this.killed = true
      this.process.kill()
    }
  }

  private write(message: JsonRpcMessage): void {
    if (!this.exited) {
      this.process.stdin.write(`${JSON.stringify(message)}\n`)
    }
  }

  private receive(line: string): void {
    let message: JsonRpcMessage
    try {
      message = JSON.parse(line) as JsonRpcMessage
    } catch {
      return
    }
    if (message.method === undefined) {
      this.settle(message)
    } else if (message.id === undefined) {
      this.handlers.notification(message.method, message.params)
    } else {
      void this.answer(message.id, message.method, message.params)
    }
  }

  private settle({ id, result, error }: JsonRpcMessage): void {
    const request = typeof id === 'number' ? this.pending.get(id) : undefined
    if (!request) {
      return
    }
    this.pending.delete(id as number)
    if (error) {
      request.reject(new Error(error.message ?? 'The agent rejected the request'))
    } else {
      request.resolve(result)
    }
  }

  private async answer(id: number | string, method: string, params: unknown): Promise<void> {
    try {
      this.write({ id, result: await this.handlers.request(method, params) })
    } catch (error) {
      this.write({
        id,
        error: {
          code: METHOD_NOT_FOUND,
          message: error instanceof Error ? error.message : String(error)
        }
      })
    }
  }

  private finish(error: Error | null): void {
    if (this.exited) {
      return
    }
    this.exited = true
    const reason = error ?? new Error('The agent process has exited')
    for (const request of this.pending.values()) {
      request.reject(reason)
    }
    this.pending.clear()
    this.handlers.exit(error)
  }

  private describeExit(code: number | null, signal: NodeJS.Signals | null): string {
    const details = this.stderrTail.trim().split('\n').slice(-3).join('\n')
    const reason = signal ? `was stopped by ${signal}` : `exited with code ${code ?? 'unknown'}`
    return `The agent ${reason}${details ? `: ${details}` : ''}`
  }
}
