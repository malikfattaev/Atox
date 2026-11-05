import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
// Файловые функции без поддержки asar: обычные fs в Electron считают app.asar папкой
// и не могут удалить бандл приложения целиком — от него остаётся оболочка с одним app.asar.
import { constants, createReadStream, promises as fs, renameSync, rmSync } from 'original-fs'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { app } from 'electron'
import { UPDATE_PLATFORMS, type UpdateFile, type UpdatePlatform } from '../shared/update'

const execFileAsync = promisify(execFile)

/** Права исполняемого файла: скачанный AppImage должен запускаться. */
const EXECUTABLE = 0o755

/** Как ставится новая версия на этой платформе. */
export interface UpdateInstaller {
  platform: UpdatePlatform
  /** Можно ли заменить запущенное приложение: оно лежит там, где у пользователя есть право записи. */
  canInstall(): Promise<boolean>
  /** Каталог, в который скачиваются версии. */
  downloadsRoot(): string
  /** Скачанный и проверенный файл релиза → путь к тому, что встанет на место приложения. */
  prepare(filePath: string): Promise<string>
  /**
   * Проверяет, что подготовленная в прошлый запуск версия цела: временные файлы могла
   * частично удалить система. Бросает ошибку, если ставить её нельзя.
   */
  verify(updatePath: string, file: UpdateFile): Promise<void>
  /** Вызывается при выходе: ставит подготовленную версию и при `relaunch` запускает её. */
  install(updatePath: string, relaunch: boolean): void
}

/** Установщик для текущей платформы; `null` — приложение так установлено, что само не обновится. */
export function createUpdateInstaller(): UpdateInstaller | null {
  if (process.platform === 'darwin') {
    return macInstaller
  }
  // Пакет pacman обновляет менеджер пакетов; приложение обновляет себя, только если оно AppImage.
  const appImage = process.env['APPIMAGE']
  return process.platform === 'linux' && appImage ? createAppImageInstaller(appImage) : null
}

/**
 * Заменяет приложение новой версией после выхода: ждёт завершения процесса, ещё раз проверяет
 * подпись новой версии, переименовывает старую, ставит новую и возвращает старую,
 * если что-то пошло не так. Повреждённая новая версия не ставится вовсе.
 * Аргументы: pid приложения, путь к его бандлу, путь к новому бандлу, 1 — запустить после замены.
 */
const MAC_INSTALL_SCRIPT = `
pid="$1"; target="$2"; update="$3"; relaunch="$4"; backup="$target.previous"
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
codesign --verify --deep --strict "$update" || exit 1
rm -rf "$backup"
mv "$target" "$backup" || exit 1
if mv "$update" "$target"; then rm -rf "$backup"; else mv "$backup" "$target"; fi
[ "$relaunch" = 1 ] && open "$target"
`

/**
 * macOS: архив с бандлом приложения распаковывается во временный каталог, а после выхода
 * скрипт ставит бандл на место старого — запущенный бандл заменять нельзя.
 */
const macInstaller: UpdateInstaller = {
  platform: 'mac',

  canInstall: canReplaceBundle,

  downloadsRoot: () => join(app.getPath('temp'), app.getName(), 'updates'),

  async prepare(archivePath) {
    const extractDir = join(dirname(archivePath), 'extracted')
    await execFileAsync('ditto', ['-x', '-k', archivePath, extractDir])
    const bundleName = (await fs.readdir(extractDir)).find((name) => name.endsWith('.app'))
    if (!bundleName) {
      throw new Error('Update archive does not contain an app bundle')
    }
    const bundlePath = join(extractDir, bundleName)
    await verifyBundleSignature(bundlePath)
    // Архив проверен по подписи релиза; снимаем карантин, чтобы новая версия открылась без вопросов.
    await execFileAsync('xattr', ['-dr', 'com.apple.quarantine', bundlePath]).catch(() => undefined)
    await fs.rm(archivePath)
    return bundlePath
  },

  // Архива уже нет, поэтому целость распакованного бандла проверяется по его подписи.
  verify: (bundlePath) => verifyBundleSignature(bundlePath),

  install(bundlePath, relaunch) {
    const args = [String(process.pid), currentBundlePath(), bundlePath, relaunch ? '1' : '0']
    spawn('/bin/sh', ['-c', MAC_INSTALL_SCRIPT, 'atox-update', ...args], {
      detached: true,
      stdio: 'ignore'
    }).unref()
  }
}

async function verifyBundleSignature(bundlePath: string): Promise<void> {
  await execFileAsync('codesign', ['--verify', '--deep', '--strict', bundlePath])
}

/** Бандл запущенного приложения: `…/Atox.app/Contents/MacOS/Atox`. */
function currentBundlePath(): string {
  return resolve(process.execPath, '../../..')
}

/**
 * Обновлять можно только приложение, которое лежит в папке с правом записи: не на смонтированном
 * образе диска и не в изолированной копии, куда macOS переносит запущенное прямо из загрузок.
 */
async function canReplaceBundle(): Promise<boolean> {
  const bundle = currentBundlePath()
  return bundle.endsWith('.app') && (await isWritable(dirname(bundle))) && isWritable(bundle)
}

/**
 * Linux: AppImage — один файл. Новая версия скачивается в скрытый каталог рядом с ним, на тот же
 * диск, и при выходе встаёт на его место переименованием: запущенная версия работает из своего
 * смонтированного образа до конца, а следующий запуск — уже новая.
 */
function createAppImageInstaller(appImagePath: string): UpdateInstaller {
  const downloadsRoot = join(dirname(appImagePath), `.${app.getName()}-updates`)
  return {
    platform: 'linux',

    canInstall: async () => (await isWritable(dirname(appImagePath))) && isWritable(appImagePath),

    downloadsRoot: () => downloadsRoot,

    async prepare(filePath) {
      await fs.chmod(filePath, EXECUTABLE)
      return filePath
    },

    async verify(filePath, file) {
      const { size } = await fs.stat(filePath)
      if (size !== file.size || (await sha512(filePath)) !== file.sha512) {
        throw new Error('Downloaded update was modified')
      }
    },

    install(updatePath, relaunch) {
      renameSync(updatePath, appImagePath)
      rmSync(downloadsRoot, { recursive: true, force: true })
      if (relaunch) {
        app.relaunch({ execPath: appImagePath, args: [] })
      }
    }
  }
}

/** SHA-512 файла в base64 — в том же виде, что и в описании релиза. */
async function sha512(path: string): Promise<string> {
  const hash = createHash('sha512')
  await pipeline(createReadStream(path), hash)
  return hash.digest('base64')
}

async function isWritable(path: string): Promise<boolean> {
  try {
    await fs.access(path, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** Файл релиза, которым обновляется платформа, — по расширению из описания платформ. */
export function isInstallableFile(platform: UpdatePlatform, name: string): boolean {
  return name.endsWith(`.${UPDATE_PLATFORMS[platform].extension}`)
}
