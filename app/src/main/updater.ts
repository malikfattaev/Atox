import { execFile, spawn } from 'node:child_process'
import { createHash, createPublicKey, verify } from 'node:crypto'
// Файловые функции без поддержки asar: обычные fs в Electron считают app.asar папкой
// и не могут удалить бандл приложения целиком — от него остаётся оболочка с одним app.asar.
import { constants, createWriteStream, promises as fs } from 'original-fs'
import { dirname, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { app, net } from 'electron'
import {
  compareVersions,
  isSafeReleaseFileName,
  UPDATE_MANIFEST_NAME,
  updateSignaturePayload,
  type UpdateFile,
  type UpdateManifest
} from '../shared/update'
import { UPDATE_PUBLIC_KEY } from './updatePublicKey'

const execFileAsync = promisify(execFile)

/** Первая проверка — вскоре после запуска, чтобы не мешать открытию окна. */
const FIRST_CHECK_DELAY_MS = 10_000
const CHECK_INTERVAL_MS = 15 * 60 * 1000
/** При возвращении в окно проверяем снова, но не чаще этого интервала. */
const FOCUS_CHECK_INTERVAL_MS = 2 * 60 * 1000

/** Скачанные обновления лежат во временном каталоге системы. */
const UPDATES_DIR = 'updates'

/**
 * Заменяет приложение новой версией после выхода: ждёт завершения процесса, ещё раз проверяет
 * подпись новой версии, переименовывает старую, ставит новую и возвращает старую,
 * если что-то пошло не так. Повреждённая новая версия не ставится вовсе.
 * Аргументы: pid приложения, путь к его бандлу, путь к новому бандлу, 1 — запустить после замены.
 */
const INSTALL_SCRIPT = `
pid="$1"; target="$2"; update="$3"; relaunch="$4"; backup="$target.previous"
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
codesign --verify --deep --strict "$update" || exit 1
rm -rf "$backup"
mv "$target" "$backup" || exit 1
if mv "$update" "$target"; then rm -rf "$backup"; else mv "$backup" "$target"; fi
[ "$relaunch" = 1 ] && open "$target"
`

interface ReadyUpdate {
  version: string
  bundlePath: string
}

interface AppUpdaterOptions {
  /** Адрес, по которому лежат файлы последнего релиза. */
  feedUrl: string
  onReady(version: string): void
}

/**
 * Обновления из релизов GitHub без Squirrel.Mac: он принимает только сборки, подписанные
 * сертификатом Apple. Релиз подписан собственным ключом Ed25519 — архив проверяется по нему
 * и по хешу, а после выхода из приложения новая версия встаёт на место старой.
 */
export class AppUpdater {
  private readyUpdate: ReadyUpdate | null = null
  private checking = false
  private relaunchAfterInstall = false
  private installerStarted = false
  private lastCheckAt = 0

  constructor(private readonly options: AppUpdaterOptions) {}

  /** Версия, готовая к установке, или `null`. */
  get readyVersion(): string | null {
    return this.readyUpdate?.version ?? null
  }

  start(): void {
    setTimeout(() => this.runCheck(), FIRST_CHECK_DELAY_MS)
    setInterval(() => this.runCheck(), CHECK_INTERVAL_MS)
  }

  /** Проверка при возвращении в окно: свежий релиз виден сразу, а не через интервал. */
  checkOnFocus(): void {
    if (Date.now() - this.lastCheckAt >= FOCUS_CHECK_INTERVAL_MS) {
      this.runCheck()
    }
  }

  private runCheck(): void {
    this.lastCheckAt = Date.now()
    void this.check().catch((error) => console.error('Update check failed', error))
  }

  /** Выходит из приложения, ставит обновление и запускает новую версию. */
  installAndRelaunch(): void {
    if (this.readyUpdate) {
      this.relaunchAfterInstall = true
      app.quit()
    }
  }

  /** Выход отменили (например, в чатах что-то работает) — перезапуск больше не нужен. */
  cancelRelaunch(): void {
    this.relaunchAfterInstall = false
  }

  /**
   * Вызывается при выходе: готовое обновление ставится в любом случае, а перезапуск —
   * только если его попросили кнопкой обновления.
   */
  installOnQuit(): void {
    if (!this.readyUpdate || this.installerStarted) {
      return
    }
    this.installerStarted = true
    const args = [
      String(process.pid),
      currentBundlePath(),
      this.readyUpdate.bundlePath,
      this.relaunchAfterInstall ? '1' : '0'
    ]
    spawn('/bin/sh', ['-c', INSTALL_SCRIPT, 'atox-update', ...args], {
      detached: true,
      stdio: 'ignore'
    }).unref()
  }

  private async check(): Promise<void> {
    if (this.checking || !(await canReplaceBundle())) {
      return
    }
    this.checking = true
    try {
      const manifest = await this.fetchManifest()
      const isNewer = compareVersions(manifest.version, app.getVersion()) > 0
      const file = manifest.files[process.arch]
      if (!isNewer || !file || manifest.version === this.readyUpdate?.version) {
        return
      }
      const bundlePath = await this.download(manifest, file)
      this.readyUpdate = { version: manifest.version, bundlePath }
      this.options.onReady(manifest.version)
      // Прежние скачивания удаляются, только когда готовым стало новое: до этого на одно
      // из них могло указывать обновление, ожидающее установки.
      await removeOtherDownloads(updatesRoot(), manifest.version)
    } finally {
      this.checking = false
    }
  }

  private async fetchManifest(): Promise<UpdateManifest> {
    const response = await net.fetch(`${this.options.feedUrl}/${UPDATE_MANIFEST_NAME}`, {
      cache: 'no-store'
    })
    if (!response.ok) {
      throw new Error(`Update manifest request failed: ${response.status}`)
    }
    const manifest = parseManifest(await response.json())
    const signature = Buffer.from(manifest.signature, 'base64')
    const payload = Buffer.from(updateSignaturePayload(manifest))
    if (!verify(null, payload, createPublicKey(UPDATE_PUBLIC_KEY), signature)) {
      throw new Error('Update manifest signature is invalid')
    }
    return manifest
  }

  /** Скачивает архив, сверяет его с подписанным описанием и распаковывает; возвращает путь к бандлу. */
  private async download(manifest: UpdateManifest, file: UpdateFile): Promise<string> {
    if (!isSafeReleaseFileName(file.name)) {
      throw new Error(`Unexpected update file name: ${file.name}`)
    }
    const directory = join(updatesRoot(), manifest.version)
    await fs.rm(directory, { recursive: true, force: true })
    await fs.mkdir(directory, { recursive: true })

    const response = await net.fetch(`${this.options.feedUrl}/${file.name}`)
    if (!response.ok || !response.body) {
      throw new Error(`Update download failed: ${response.status}`)
    }
    const archivePath = join(directory, file.name)
    const hash = createHash('sha512')
    let size = 0
    const measure = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk)
        size += chunk.length
        callback(null, chunk)
      }
    })
    await pipeline(Readable.fromWeb(response.body), measure, createWriteStream(archivePath))
    if (size !== file.size || hash.digest('base64') !== file.sha512) {
      throw new Error('Downloaded update does not match the signed manifest')
    }

    const extractDir = join(directory, 'extracted')
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
  }
}

/** Каталог, в который скачиваются обновления. */
function updatesRoot(): string {
  return join(app.getPath('temp'), app.getName(), UPDATES_DIR)
}

/** Прежние скачивания больше не нужны: хранится только последнее проверенное обновление. */
async function removeOtherDownloads(root: string, keepVersion: string): Promise<void> {
  const versions = await fs.readdir(root)
  await Promise.all(
    versions
      .filter((version) => version !== keepVersion)
      .map((version) => fs.rm(join(root, version), { recursive: true, force: true }))
  )
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
  if (!bundle.endsWith('.app')) {
    return false
  }
  try {
    await fs.access(dirname(bundle), constants.W_OK)
    await fs.access(bundle, constants.W_OK)
    return true
  } catch {
    return false
  }
}

function parseManifest(data: unknown): UpdateManifest {
  const manifest = data as Partial<UpdateManifest> | null
  if (
    typeof manifest?.version !== 'string' ||
    typeof manifest.signature !== 'string' ||
    typeof manifest.files !== 'object' ||
    manifest.files === null
  ) {
    throw new Error('Update manifest is malformed')
  }
  for (const file of Object.values(manifest.files)) {
    if (
      typeof file?.name !== 'string' ||
      typeof file.sha512 !== 'string' ||
      typeof file.size !== 'number'
    ) {
      throw new Error('Update manifest is malformed')
    }
  }
  return manifest as UpdateManifest
}
