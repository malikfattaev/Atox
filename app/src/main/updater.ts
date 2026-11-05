import { createHash, createPublicKey, verify } from 'node:crypto'
import { createWriteStream, promises as fs } from 'original-fs'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app, net } from 'electron'
import {
  compareVersions,
  isSafeReleaseFileName,
  UPDATE_PLATFORMS,
  updateSignaturePayload,
  type UpdateCheckResult,
  type UpdateFile,
  type UpdateManifest,
  type UpdateState
} from '../shared/update'
import { isInstallableFile, type UpdateInstaller } from './updateInstallers'
import { UPDATE_PUBLIC_KEY } from './updatePublicKey'

/** Первая проверка — вскоре после запуска, чтобы не мешать открытию окна. */
const FIRST_CHECK_DELAY_MS = 10_000
const CHECK_INTERVAL_MS = 5 * 60 * 1000
/** При возвращении в окно проверяем снова, но не чаще этого интервала. */
const FOCUS_CHECK_INTERVAL_MS = 30 * 1000
/** Прогресс скачивания сообщается шагами по проценту, а не на каждый пришедший кусок. */
const PROGRESS_STEP = 0.01
/**
 * Сколько ждать ответа сервера. Без предела запрос, начатый перед сном компьютера или сменой
 * сети, мог висеть вечно, а вместе с ним — и все следующие проверки.
 */
const REQUEST_TIMEOUT_MS = 30_000
/** Скачивание обрывается, если данные перестали приходить на это время. */
const DOWNLOAD_STALL_TIMEOUT_MS = 60_000

interface ReadyUpdate {
  version: string
  /** То, что встанет на место приложения: бандл на macOS, файл AppImage на Linux. */
  path: string
}

interface AppUpdaterOptions {
  /** Адрес, по которому лежат файлы последнего релиза. */
  feedUrl: string
  installer: UpdateInstaller
  onStateChange(state: UpdateState): void
}

/**
 * Обновления из релизов GitHub без Squirrel.Mac: он принимает только сборки, подписанные
 * сертификатом Apple. Релиз подписан собственным ключом Ed25519 — файл проверяется по нему
 * и по хешу, а после выхода из приложения новая версия встаёт на место старой.
 */
export class AppUpdater {
  private readyUpdate: ReadyUpdate | null = null
  private currentState: UpdateState = null
  /** Идущая проверка: повторные просьбы дожидаются её, а не запускают вторую. */
  private checking: Promise<UpdateCheckResult> | null = null
  private relaunchAfterInstall = false
  private installerStarted = false
  private lastCheckAt = 0

  constructor(private readonly options: AppUpdaterOptions) {}

  get state(): UpdateState {
    return this.currentState
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

  /** Проверка по просьбе пользователя — из меню или настроек; ошибки достаются вызывающему. */
  checkNow(): Promise<UpdateCheckResult> {
    this.lastCheckAt = Date.now()
    return this.check()
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
    try {
      this.options.installer.install(this.readyUpdate.path, this.relaunchAfterInstall)
    } catch (error) {
      console.error('Failed to install the update', error)
    }
  }

  private check(): Promise<UpdateCheckResult> {
    this.checking ??= this.runCheckOnce().finally(() => {
      this.checking = null
    })
    return this.checking
  }

  private async runCheckOnce(): Promise<UpdateCheckResult> {
    const { installer } = this.options
    if (!(await installer.canInstall())) {
      return 'unsupported'
    }
    const manifest = await this.fetchManifest()
    const isNewer = compareVersions(manifest.version, app.getVersion()) > 0
    const file = manifest.files[process.arch]
    if (!isNewer || !file) {
      return 'current'
    }
    if (manifest.version === this.readyUpdate?.version) {
      return 'available'
    }
    let path: string
    try {
      path = await this.download(manifest, file)
    } catch (error) {
      // Скачивание сорвалось — показываем готовое ранее обновление, если оно есть.
      this.setState(this.readyUpdate && { phase: 'ready', version: this.readyUpdate.version })
      throw error
    }
    this.readyUpdate = { version: manifest.version, path }
    this.setState({ phase: 'ready', version: manifest.version })
    // Прежние скачивания удаляются, только когда готовым стало новое: до этого на одно
    // из них могло указывать обновление, ожидающее установки.
    await removeOtherDownloads(installer.downloadsRoot(), manifest.version)
    return 'available'
  }

  private async fetchManifest(): Promise<UpdateManifest> {
    const manifestName = UPDATE_PLATFORMS[this.options.installer.platform].manifest
    const response = await net.fetch(`${this.options.feedUrl}/${manifestName}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
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

  /**
   * Скачивает файл релиза, сверяет его с подписанным описанием и готовит к установке;
   * возвращает путь к тому, что встанет на место приложения.
   */
  private async download(manifest: UpdateManifest, file: UpdateFile): Promise<string> {
    const { installer } = this.options
    if (!isSafeReleaseFileName(file.name) || !isInstallableFile(installer.platform, file.name)) {
      throw new Error(`Unexpected update file name: ${file.name}`)
    }
    const directory = join(installer.downloadsRoot(), manifest.version)
    await fs.rm(directory, { recursive: true, force: true })
    await fs.mkdir(directory, { recursive: true })

    const stall = new StallTimer(DOWNLOAD_STALL_TIMEOUT_MS)
    const response = await net
      .fetch(`${this.options.feedUrl}/${file.name}`, { signal: stall.signal })
      .catch((error: unknown) => {
        stall.stop()
        throw error
      })
    if (!response.ok || !response.body) {
      stall.stop()
      throw new Error(`Update download failed: ${response.status}`)
    }
    const filePath = join(directory, file.name)
    const hash = createHash('sha512')
    let size = 0
    let reported = 0
    this.setState({ phase: 'downloading', version: manifest.version, progress: 0 })
    const measure = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        stall.reset()
        hash.update(chunk)
        size += chunk.length
        const progress = Math.min(1, size / file.size)
        if (progress - reported >= PROGRESS_STEP) {
          reported = progress
          this.setState({ phase: 'downloading', version: manifest.version, progress })
        }
        callback(null, chunk)
      }
    })
    try {
      await pipeline(Readable.fromWeb(response.body), measure, createWriteStream(filePath))
    } finally {
      stall.stop()
    }
    if (size !== file.size || hash.digest('base64') !== file.sha512) {
      throw new Error('Downloaded update does not match the signed manifest')
    }

    return installer.prepare(filePath)
  }

  private setState(state: UpdateState): void {
    this.currentState = state
    this.options.onStateChange(state)
  }
}

/** Отменяет запрос, если между событиями прошло больше заданного времени. */
class StallTimer {
  private readonly controller = new AbortController()
  private timer: NodeJS.Timeout

  constructor(private readonly timeoutMs: number) {
    this.timer = this.schedule()
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  reset(): void {
    clearTimeout(this.timer)
    this.timer = this.schedule()
  }

  stop(): void {
    clearTimeout(this.timer)
  }

  private schedule(): NodeJS.Timeout {
    return setTimeout(
      () => this.controller.abort(new Error('Update download stalled')),
      this.timeoutMs
    )
  }
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
