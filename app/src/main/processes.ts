import { execFile } from 'node:child_process'

/** Сколько ждать ответа программы, прежде чем считать запуск неудавшимся. */
const DEFAULT_TIMEOUT_MS = 20_000
/** Ответ GitHub со страницами PR и issue — до нескольких сотен килобайт, diff — до мегабайт. */
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/** Окружение для фоновых запусков git. */
export const BACKGROUND_GIT_ENVIRONMENT: Readonly<Record<string, string>> = {
  // Без этого `git status` и подобные команды попутно обновляют индекс и берут `index.lock`,
  // и `git commit`, который агент запустил в этот момент, падает с «index.lock: File exists».
  // Обязательные блокировки — у `git restore` и `git rm` — переменная не отключает.
  GIT_OPTIONAL_LOCKS: '0',
  // Ошибки git распознаются по тексту, а git с переводами ответил бы на языке системы.
  LANGUAGE: 'en'
}

/** Как называть программу в сообщениях: `gh` пользователь знает как GitHub. */
const PROGRAM_NAMES: Readonly<Record<string, string>> = { gh: 'GitHub' }

/**
 * Ошибка запуска программы: код выхода и то, что она написала в stderr. Если программа
 * не ответила вовремя или ничего не написала, сообщение объясняет, что случилось.
 */
export class CommandError extends Error {
  constructor(
    readonly program: string,
    readonly code: string | number | undefined,
    readonly stderr: string,
    /** Программу остановили по таймауту — тогда кода выхода у неё нет. */
    readonly timedOut = false
  ) {
    // По таймауту в stderr может остаться обрывок вывода — он объяснил бы меньше.
    super((!timedOut && stderr.trim()) || failureDescription(program, code, timedOut))
  }
}

function failureDescription(
  program: string,
  code: string | number | undefined,
  timedOut: boolean
): string {
  const name = PROGRAM_NAMES[program] ?? program
  if (timedOut) {
    return `${name} didn’t respond in ${DEFAULT_TIMEOUT_MS / 1000} s`
  }
  if (code === 'ENOENT') {
    return `${program} not found`
  }
  return `${name} failed with code ${code}`
}

export interface CommandOptions {
  cwd: string
  env: Record<string, string>
  /** Что передать программе на вход. */
  input?: string
  /**
   * Коды выхода, которые не считаются ошибкой: `git diff --no-index` выходит с 1,
   * когда файлы различаются.
   */
  successCodes?: readonly number[]
}

/** Запускает программу без оболочки и возвращает её вывод. */
export function runCommand(
  program: string,
  args: readonly string[],
  { cwd, env, input, successCodes = [0] }: CommandOptions
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      program,
      args,
      { cwd, env, timeout: DEFAULT_TIMEOUT_MS, maxBuffer: DEFAULT_MAX_OUTPUT_BYTES },
      (error, stdout, stderr) => {
        // Остановленная сигналом программа — в том числе по таймауту — кода выхода не имеет,
        // и это ошибка, а не успех с недописанным выводом.
        const code = error ? error.code : 0
        if (typeof code === 'number' && successCodes.includes(code)) {
          resolve(String(stdout))
        } else {
          const timedOut = error?.killed === true && code === null
          reject(new CommandError(program, code ?? undefined, String(stderr), timedOut))
        }
      }
    )
    child.stdin?.end(input)
  })
}

/** Первая содержательная строка ошибки, без префиксов вроде `fatal:`. */
export function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const line = text.split('\n').find((candidate) => candidate.trim()) ?? text
  return line.replace(/^(gh|fatal|error):\s*/i, '').trim()
}

/** Запускает git в фоне: не мешая git, который в той же папке запустил агент. */
export function runGit(args: readonly string[], options: CommandOptions): Promise<string> {
  return runCommand('git', args, {
    ...options,
    env: { ...options.env, ...BACKGROUND_GIT_ENVIRONMENT }
  })
}
