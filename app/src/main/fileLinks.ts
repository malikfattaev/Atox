import type { Stats } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, isAbsolute, resolve } from 'node:path'
import { shell } from 'electron'

/**
 * Ссылку на строку агенты пишут прямо в пути: `src/app.ts:42` или `src/app.ts:42:7`.
 * Такой суффикс отрезается, только если файла с двоеточием в имени нет.
 */
const LINE_SUFFIX = /:\d+(?::\d+)?$/

/**
 * Файлы, которые при открытии запускаются, а не показываются: ссылку на них мог подставить
 * ответ агента, поэтому такой файл только выделяется в файловом менеджере.
 */
const LAUNCHABLE_EXTENSIONS = new Set([
  '.app',
  '.action',
  '.applescript',
  '.appimage',
  '.bat',
  '.cmd',
  '.command',
  '.desktop',
  '.dmg',
  '.exe',
  '.fileloc',
  '.inetloc',
  '.jar',
  '.mpkg',
  '.pkg',
  '.scpt',
  '.sh',
  '.terminal',
  '.tool',
  '.webloc',
  '.workflow'
])

/** Права на запуск у владельца, группы или остальных. */
const EXECUTABLE_MODE_BITS = 0o111

/**
 * Открывает файл или папку из ссылки в ответе агента программой по умолчанию. Относительный
 * путь считается от `baseDirectory` — папки проекта. Программу или скрипт не запускает,
 * а показывает в файловом менеджере.
 */
export async function openFileLink(target: string, baseDirectory?: string): Promise<void> {
  if (!isAbsolute(target) && !baseDirectory) {
    throw new Error(`Relative path without a base directory: ${target}`)
  }
  const requested = baseDirectory ? resolve(baseDirectory, target) : resolve(target)
  const found = await existingPath(requested)
  if (!found) {
    throw new Error(`No such file: ${requested}`)
  }
  if (isLaunchable(found.path, found.stats)) {
    shell.showItemInFolder(found.path)
    return
  }
  const error = await shell.openPath(found.path)
  if (error) {
    throw new Error(error)
  }
}

async function existingPath(path: string): Promise<{ path: string; stats: Stats } | null> {
  const candidates = LINE_SUFFIX.test(path) ? [path, path.replace(LINE_SUFFIX, '')] : [path]
  for (const candidate of candidates) {
    const stats = await stat(candidate).catch(() => null)
    if (stats) {
      return { path: candidate, stats }
    }
  }
  return null
}

function isLaunchable(path: string, stats: Stats): boolean {
  if (LAUNCHABLE_EXTENSIONS.has(extname(path).toLowerCase())) {
    return true
  }
  return stats.isFile() && (stats.mode & EXECUTABLE_MODE_BITS) !== 0
}
