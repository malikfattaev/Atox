import { execFile, spawn } from 'node:child_process'
// Файловые функции без поддержки asar: обычные fs в Electron считают app.asar папкой
// и не могут удалить бандл приложения целиком — от него остаётся оболочка с одним app.asar.
import { constants, promises as fs, renameSync, rmSync } from 'original-fs'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import { UPDATE_PLATFORMS, type UpdatePlatform } from '../shared/update'

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
    await execFileAsync('codesign', ['--verify', '--deep', '--strict', bundlePath])
    // Архив проверен по подписи релиза; снимаем карантин, чтобы новая версия открылась без вопросов.
    await execFileAsync('xattr', ['-dr', 'com.apple.quarantine', bundlePath]).catch(() => undefined)
    await fs.rm(archivePath)
    return bundlePath
  },

  install(bundlePath, relaunch) {
    const args = [String(process.pid), currentBundlePath(), bundlePath, relaunch ? '1' : '0']
    spawn('/bin/sh', ['-c', MAC_INSTALL_SCRIPT, 'atox-update', ...args], {
      detached: true,
      stdio: 'ignore'
    }).unref()
  }
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

    install(updatePath, relaunch) {
      renameSync(updatePath, appImagePath)
      rmSync(downloadsRoot, { recursive: true, force: true })
      if (relaunch) {
        app.relaunch({ execPath: appImagePath, args: [] })
      }
    }
  }
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
