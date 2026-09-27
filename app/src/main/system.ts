import { execFile } from 'node:child_process'
import { userInfo } from 'node:os'
import { promisify } from 'node:util'
import type { UserProfile } from '../shared/models'

const execFileAsync = promisify(execFile)

/**
 * Источники имени в порядке приоритета: имя автора из git — то, под которым пользователь
 * работает с кодом, затем полное имя учётной записи macOS.
 */
const NAME_SOURCES: ReadonlyArray<readonly [command: string, args: string[]]> = [
  ['git', ['config', '--global', 'user.name']],
  ['id', ['-F']]
]

export async function getUserProfile(): Promise<UserProfile> {
  for (const [command, args] of NAME_SOURCES) {
    const name = await readCommandOutput(command, args)
    if (name) {
      return { name }
    }
  }
  return { name: userInfo().username }
}

/** Возвращает вывод команды или `null`, если команда недоступна либо ничего не вывела. */
async function readCommandOutput(command: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, args)
    return stdout.trim() || null
  } catch {
    return null
  }
}
