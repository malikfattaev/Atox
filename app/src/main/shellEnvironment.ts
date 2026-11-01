import { execFile } from 'node:child_process'
import { userInfo } from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

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
      const { stdout } = await execFileAsync(
        resolveShell(),
        ['-l', '-i', '-c', `printf '%s' ${OUTPUT_MARKER}; env -0; printf '%s' ${OUTPUT_MARKER}`],
        { env: base, timeout: READ_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }
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

function sessionEnvironment(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of SESSION_ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined) {
      env[key] = value
    }
  }
  env['LANG'] ??= FALLBACK_LANG
  return env
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
