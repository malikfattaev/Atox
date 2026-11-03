import { spawn } from 'node:child_process'
import { userInfo } from 'node:os'
import { delimiter, dirname, sep } from 'node:path'

/** Стандартная оболочка системы — на случай, если система не сообщила оболочку пользователя. */
const DEFAULT_SHELL = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'

/** GUI-приложения на macOS запускаются без LANG, а без UTF-8-локали ломается вывод не-ASCII символов. */
const FALLBACK_LANG = 'en_US.UTF-8'

/**
 * Базовое окружение сеанса, с которым запускается оболочка входа, — как в Terminal.app.
 * Всё остальное (PATH из Homebrew и nvm, ключи, переменные инструментов) настраивает профиль
 * пользователя. Так агентам не протекают переменные процесса, из которого запущен сам Atox, —
 * на Linux это, например, LD_LIBRARY_PATH и APPDIR из образа AppImage.
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
  '__CF_USER_TEXT_ENCODING',
  // Сеанс Linux: без них агент не откроет окно, браузер или уведомление.
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XAUTHORITY',
  'XDG_RUNTIME_DIR',
  'XDG_SESSION_TYPE',
  'XDG_CURRENT_DESKTOP',
  'XDG_SESSION_DESKTOP',
  'DBUS_SESSION_BUS_ADDRESS',
  'HYPRLAND_INSTANCE_SIGNATURE'
] as const

/**
 * Переменные, которые оболочка выставляет сама себе: агенту, запущенному не из неё,
 * они не нужны и только путают (например, уровень вложенности оболочек).
 */
const SHELL_OWN_KEYS = new Set(['_', 'PWD', 'OLDPWD', 'SHLVL'])

/** Интерактивная оболочка читает .zshrc; если он завис, агенты не должны ждать вечно. */
const READ_TIMEOUT_MS = 10_000

/** Сколько ждать конца вывода после выхода оболочки. */
const OUTPUT_GRACE_MS = 500

/** Больше этого `env` не печатает: дальше — мусор из профиля, а не окружение. */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/** Метка вокруг вывода `env`: .zshrc может что-нибудь напечатать до или после. */
const OUTPUT_MARKER = '__ATOX_ENVIRONMENT__'

export function resolveShell(): string {
  return process.env['SHELL'] || userInfo().shell || DEFAULT_SHELL
}

/**
 * Окружение оболочки входа пользователя. Агенты запускаются с ним, как если бы их запустили
 * из терминала: nvm и установщики агентов дописывают PATH только в .zshrc, а там же
 * пользователи задают ключи и настройки агентов.
 */
export class ShellEnvironment {
  private environment: Promise<Record<string, string>> | null = null

  get(): Promise<Record<string, string>> {
    this.environment ??= this.read()
    return this.environment
  }

  private async read(): Promise<Record<string, string>> {
    const base = sessionEnvironment()
    try {
      const stdout = await runLoginShell(
        `printf '%s' ${OUTPUT_MARKER}; env -0; printf '%s' ${OUTPUT_MARKER}`,
        base
      )
      const parsed = parseEnvironment(stdout)
      if (parsed) {
        return { ...parsed, LANG: parsed['LANG'] ?? FALLBACK_LANG }
      }
      console.error('Could not parse the login shell environment')
    } catch (error) {
      console.error('Failed to read the login shell environment', error)
    }
    // Без профиля агенты найдутся хуже, но запустятся с тем, что есть у процесса.
    return base
  }
}

/**
 * Выполняет команду в интерактивной оболочке входа и возвращает её вывод.
 *
 * Интерактивные zsh и bash игнорируют SIGTERM, а фоновые процессы из профиля (ssh-agent,
 * gpg-agent) держат вывод открытым после выхода оболочки. Поэтому по таймауту вся группа
 * процессов получает SIGKILL, а после выхода оболочки ответ не ждёт закрытия вывода дольше
 * короткой паузы. Код выхода не важен: окружение проверяется по меткам вокруг вывода.
 */
function runLoginShell(command: string, env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveShell(), ['-l', '-i', '-c', command], {
      env,
      // Без stdin профиль, который что-то спрашивает, не зависнет в ожидании ответа.
      stdio: ['ignore', 'pipe', 'ignore'],
      // Своя группа процессов: её можно остановить целиком вместе с потомками.
      detached: true
    })
    let output = ''
    let settled = false
    const finish = (error: Error | null) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      child.stdout.removeAllListeners('data')
      if (error) {
        killGroup(child.pid)
        reject(error)
      } else {
        resolve(output)
      }
    }
    const timer = setTimeout(
      () => finish(new Error(`The login shell did not finish in ${READ_TIMEOUT_MS} ms`)),
      READ_TIMEOUT_MS
    )
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
      if (output.length > MAX_OUTPUT_BYTES) {
        finish(new Error('The login shell printed too much output'))
      }
    })
    child.on('error', finish)
    // Обычно вывод закрывается сразу за выходом оболочки. Если его держит фоновый процесс
    // из профиля, весь вывод оболочки к этому времени уже прочитан.
    child.stdout.on('close', () => finish(null))
    child.on('exit', () => setTimeout(() => finish(null), OUTPUT_GRACE_MS))
  })
}

function killGroup(pid: number | undefined): void {
  if (pid === undefined) {
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // Группа уже завершилась.
  }
}

/** Базовое окружение сеанса без профиля пользователя: с ним стартует оболочка входа. */
export function sessionEnvironment(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of SESSION_ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined) {
      env[key] = value
    }
  }
  env['PATH'] = inheritedPath()
  env['LANG'] ??= FALLBACK_LANG
  return env
}

/**
 * PATH процесса без каталогов образа AppImage: их дописывает его AppRun, и по имени `atox`
 * агент нашёл бы сам бинарник приложения вместо команды для агентов.
 */
function inheritedPath(): string {
  const entries = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean)
  if (!process.env['APPIMAGE']) {
    return entries.join(delimiter)
  }
  const appDir = dirname(process.execPath)
  return entries
    .filter((entry) => entry !== appDir && !entry.startsWith(appDir + sep))
    .join(delimiter)
}

function parseEnvironment(output: string): Record<string, string> | null {
  const start = output.indexOf(OUTPUT_MARKER)
  const end = output.lastIndexOf(OUTPUT_MARKER)
  if (start < 0 || end <= start) {
    return null
  }
  const env: Record<string, string> = {}
  for (const entry of output.slice(start + OUTPUT_MARKER.length, end).split('\0')) {
    const separator = entry.indexOf('=')
    if (separator > 0) {
      const key = entry.slice(0, separator)
      if (!SHELL_OWN_KEYS.has(key)) {
        env[key] = entry.slice(separator + 1)
      }
    }
  }
  return env
}
