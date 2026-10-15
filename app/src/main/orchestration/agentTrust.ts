import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, rename, rmdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AgentId } from '../../shared/agents'

/**
 * Помощник запускается в папке, где пользователь уже работает с агентом, но сам агент может
 * ни разу не открывать её и спросить «доверяете ли вы этой папке?». Спросить некому — помощник
 * повиснет. Поэтому до запуска Atox записывает доверие так же, как это сделала бы кнопка
 * «Trust» в самом агенте. Если записать не удалось, агент просто спросит сам.
 */
export async function trustFolderForAgent(agent: AgentId, folder: string): Promise<void> {
  const path = await realpath(folder)
  if (agent === 'claude') {
    await trustClaudeFolder(path)
  } else if (agent === 'codex') {
    await trustCodexFolder(path)
  }
}

/** Глобальные настройки Claude Code: в них по папкам хранится принятое доверие. */
const CLAUDE_CONFIG = join(homedir(), '.claude.json')

/**
 * Claude Code сам меняет свой файл под блокировкой — каталогом `<файл>.lock`. Её берёт и Atox,
 * а занятую никогда не ломает: тогда агент спросит про доверие сам.
 */
const CLAUDE_LOCK = `${CLAUDE_CONFIG}.lock`

async function trustClaudeFolder(path: string): Promise<void> {
  if (!existsSync(CLAUDE_CONFIG)) {
    return
  }
  const isTrusted = (config: ClaudeConfig) =>
    config.projects?.[path]?.hasTrustDialogAccepted === true
  // Чаще всего доверие уже есть — тогда файл не трогаем и блокировку не берём.
  if (isTrusted(await readClaudeConfig())) {
    return
  }
  try {
    await mkdir(CLAUDE_LOCK)
  } catch {
    return
  }
  try {
    const config = await readClaudeConfig()
    if (!isTrusted(config)) {
      const projects = config.projects ?? {}
      projects[path] = { ...projects[path], hasTrustDialogAccepted: true }
      await replaceFile(CLAUDE_CONFIG, `${JSON.stringify({ ...config, projects }, null, 2)}\n`)
    }
  } finally {
    await rmdir(CLAUDE_LOCK).catch(() => undefined)
  }
}

interface ClaudeConfig {
  projects?: Record<string, { hasTrustDialogAccepted?: boolean }>
}

/** Читает настройки Claude; непрочитанный файл не перезаписывается — ошибка уходит выше. */
async function readClaudeConfig(): Promise<ClaudeConfig> {
  const config: unknown = JSON.parse(await readFile(CLAUDE_CONFIG, 'utf8'))
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new Error('Unexpected Claude Code config format')
  }
  return config as ClaudeConfig
}

const CODEX_CONFIG = join(homedir(), '.codex', 'config.toml')

/** Доверие Codex — таблица `[projects."<папка>"]` в его config.toml. */
async function trustCodexFolder(path: string): Promise<void> {
  if (!existsSync(dirname(CODEX_CONFIG))) {
    return
  }
  const content = await readFile(CODEX_CONFIG, 'utf8').catch(() => '')
  const header = `[projects.${tomlString(path)}]`
  // Уже записанное решение — в том числе «не доверять» — остаётся за пользователем.
  if (content.split('\n').some((line) => line.trim() === header)) {
    return
  }
  const separator =
    content === '' || content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n'
  await replaceFile(CODEX_CONFIG, `${content}${separator}${header}\ntrust_level = "trusted"\n`)
}

/** Строка TOML в двойных кавычках. */
function tomlString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/**
 * Заменяет файл целиком через временный рядом с ним: агент, читающий файл в этот момент,
 * видит либо старое содержимое, либо новое, но не половину. Права файла сохраняются.
 */
async function replaceFile(link: string, content: string): Promise<void> {
  // Файл может быть ссылкой (например, на настройки в dotfiles) — заменяется то, на что она ведёт.
  const path = await realpath(link).catch(() => link)
  const mode = await stat(path).then(
    ({ mode }) => mode & 0o777,
    () => 0o600
  )
  const temporary = `${path}.atox-${randomBytes(6).toString('hex')}`
  await writeFile(temporary, content, { mode, flag: 'wx' })
  await rename(temporary, path)
}
