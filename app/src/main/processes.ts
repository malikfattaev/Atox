import { execFile } from 'node:child_process'

/** Сколько ждать ответа программы, прежде чем считать запуск неудавшимся. */
const DEFAULT_TIMEOUT_MS = 20_000
/** Ответ GitHub со страницами PR и issue — до нескольких сотен килобайт, diff — до мегабайт. */
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/** Ошибка запуска программы: код выхода и то, что она написала в stderr. */
export class CommandError extends Error {
  constructor(
    readonly code: string | number | undefined,
    readonly stderr: string
  ) {
    super(stderr.trim() || `Command failed with code ${code}`)
  }
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
        const code = error?.code ?? 0
        if (typeof code === 'number' && successCodes.includes(code)) {
          resolve(String(stdout))
        } else {
          reject(new CommandError(error?.code, String(stderr)))
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
