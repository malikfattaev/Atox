import { createHash, createPublicKey, verify } from 'node:crypto'
import { createWriteStream, promises as fs } from 'original-fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
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
/**
 * Тайм-аут запроса при ручной проверке: пользователь ждёт ответа, и без сети он должен
 * узнать об этом за секунды, а не через минуты.
 */
const INTERACTIVE_REQUEST_TIMEOUT_MS = 10_000
/** Скачивание обрывается, если данные перестали приходить на это время. */
const DOWNLOAD_STALL_TIMEOUT_MS = 60_000
/**
 * Паузы перед повторами запроса, который сорвался из-за сети или сбоя сервера: GitHub время
 * от времени отвечает 5xx на файлы релизов, и без повтора обновление ждало бы следующей проверки.
 */
const RETRY_DELAYS_MS = [2_000, 10_000, 30_000]
/**
 * Пауза перед новой попыткой скачать версию, которую скачать не удалось, удваивается
 * с каждым сбоем, но не больше предела. Без неё сломанный файл релиза (или нехватка места)
 * скачивался бы заново — по сотне мегабайт — каждые несколько минут и при каждом фокусе окна.
 */
const DOWNLOAD_BACKOFF_INITIAL_MS = 15 * 60 * 1000
const DOWNLOAD_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000
/**
 * Описание скачанной и подготовленной версии в её каталоге: по нему готовое обновление
 * подхватывается при следующем запуске, а не скачивается заново.
 */
const PREPARED_UPDATE_FILE_NAME = 'prepared.json'

/**
 * Идущая проверка. Ручная проверка без повторов; если её попросили посреди фоновой,
 * фоновая становится ручной: ждущий ответа запрос и пауза перед повтором обрываются.
 */
interface CheckRun {
  interactive: boolean
  /** Обрывает фоновое ожидание, когда проверка стала ручной. */
  readonly wake: AbortController
}

/** Версия, которую не удалось скачать: сколько раз подряд и когда пробовать снова. */
interface FailedDownload {
  version: string
  failures: number
  retryAt: number
}

interface ReadyUpdate {
  version: string
  /** То, что встанет на место приложения: бандл на macOS, файл AppImage на Linux. */
  path: string
}

interface PreparedUpdateRecord {
  /** Подписанное описание релиза, из которого скачана версия. */
  manifest: UpdateManifest
  /** Путь к подготовленной версии относительно её каталога. */
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
  private checking: { run: CheckRun; result: Promise<UpdateCheckResult> } | null = null
  /** Поиск обновления, готового с прошлого запуска; проверки начинаются после него. */
  private restoring: Promise<void> | null = null
  private failedDownload: FailedDownload | null = null
  private relaunchAfterInstall = false
  private installerStarted = false
  private lastCheckAt = 0

  constructor(private readonly options: AppUpdaterOptions) {}

  get state(): UpdateState {
    return this.currentState
  }

  start(): void {
    this.restoring = this.restorePreparedUpdate().catch((error) =>
      console.error('Failed to restore the prepared update', error)
    )
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
    return this.check(true)
  }

  private runCheck(): void {
    this.lastCheckAt = Date.now()
    void this.check(false).catch((error) => console.error('Update check failed', error))
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

  private check(interactive: boolean): Promise<UpdateCheckResult> {
    if (this.checking) {
      const { run } = this.checking
      if (interactive && !run.interactive) {
        run.interactive = true
        run.wake.abort()
      }
      return this.checking.result
    }
    const run: CheckRun = { interactive, wake: new AbortController() }
    const result = this.runCheckOnce(run).finally(() => {
      this.checking = null
    })
    this.checking = { run, result }
    return result
  }

  private async runCheckOnce(run: CheckRun): Promise<UpdateCheckResult> {
    const { installer } = this.options
    await this.restoring
    if (!(await installer.canInstall())) {
      return 'unsupported'
    }
    const manifest = await this.fetchManifest(run)
    const isNewer = compareVersions(manifest.version, app.getVersion()) > 0
    const file = manifest.files[process.arch]
    if (!isNewer || !file) {
      return 'current'
    }
    if (manifest.version === this.readyUpdate?.version) {
      return 'available'
    }
    // Ручная проверка пробует скачать сразу: её попросил пользователь.
    if (!run.interactive && this.isDownloadPostponed(manifest.version)) {
      return this.readyUpdate ? 'available' : 'current'
    }
    let path: string
    try {
      path = await this.download(manifest, file)
    } catch (error) {
      this.postponeDownload(manifest.version)
      // Скачивание сорвалось — показываем готовое ранее обновление, если оно есть.
      this.setState(this.readyUpdate && { phase: 'ready', version: this.readyUpdate.version })
      throw error
    }
    this.failedDownload = null
    this.readyUpdate = { version: manifest.version, path }
    this.setState({ phase: 'ready', version: manifest.version })
    // Прежние скачивания удаляются, только когда готовым стало новое: до этого на одно
    // из них могло указывать обновление, ожидающее установки.
    await removeOtherDownloads(installer.downloadsRoot(), manifest.version)
    return 'available'
  }

  /**
   * Подхватывает версию, скачанную и подготовленную в прошлый запуск, — кнопка обновления
   * появляется сразу, без нового скачивания. Всё, что поставить нельзя, удаляется.
   */
  private async restorePreparedUpdate(): Promise<void> {
    const { installer } = this.options
    if (!(await installer.canInstall())) {
      return
    }
    const root = installer.downloadsRoot()
    const versions = await fs.readdir(root).catch(() => [])
    for (const version of versions.sort((a, b) => compareVersions(b, a))) {
      const prepared = await this.loadPreparedUpdate(join(root, version)).catch(() => null)
      if (prepared) {
        this.readyUpdate = prepared
        this.setState({ phase: 'ready', version: prepared.version })
        await removeOtherDownloads(root, version)
        return
      }
    }
    await fs.rm(root, { recursive: true, force: true })
  }

  /** Подготовленная версия из каталога, если она новее запущенной и не повреждена. */
  private async loadPreparedUpdate(directory: string): Promise<ReadyUpdate | null> {
    const record = JSON.parse(
      await fs.readFile(join(directory, PREPARED_UPDATE_FILE_NAME), 'utf8')
    ) as Partial<PreparedUpdateRecord> | null
    const manifest = parseManifest(record?.manifest)
    verifyManifestSignature(manifest)
    const file = manifest.files[process.arch]
    const path = resolve(directory, String(record?.path))
    if (
      !file ||
      basename(directory) !== manifest.version ||
      compareVersions(manifest.version, app.getVersion()) <= 0 ||
      !path.startsWith(directory + sep)
    ) {
      return null
    }
    await this.options.installer.verify(path, file)
    return { version: manifest.version, path }
  }

  private async fetchManifest(run: CheckRun): Promise<UpdateManifest> {
    const manifestName = UPDATE_PLATFORMS[this.options.installer.platform].manifest
    const data = await withRetries(async () => {
      // Фоновый запрос обрывается, если проверка стала ручной: дальше она ждёт меньше.
      const signal = run.interactive
        ? AbortSignal.timeout(INTERACTIVE_REQUEST_TIMEOUT_MS)
        : AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), run.wake.signal])
      const response = await net.fetch(`${this.options.feedUrl}/${manifestName}`, {
        cache: 'no-store',
        signal
      })
      if (!response.ok) {
        throw new UpdateRequestError(
          `Update manifest request failed: ${response.status}`,
          isRetryableStatus(response.status)
        )
      }
      return (await response.json()) as unknown
    }, run)
    const manifest = parseManifest(data)
    verifyManifestSignature(manifest)
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
    // Скачивание повторяется и в ручной проверке: его ход и так виден в окне.
    const filePath = await withRetries(() => this.downloadFile(directory, manifest, file))
    const path = await installer.prepare(filePath)
    const record: PreparedUpdateRecord = { manifest, path: relative(directory, path) }
    await fs.writeFile(join(directory, PREPARED_UPDATE_FILE_NAME), JSON.stringify(record))
    return path
  }

  /** Скачивает файл релиза в чистый каталог версии и сверяет его с подписанным описанием. */
  private async downloadFile(
    directory: string,
    manifest: UpdateManifest,
    file: UpdateFile
  ): Promise<string> {
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
      throw new UpdateRequestError(
        `Update download failed: ${response.status}`,
        isRetryableStatus(response.status)
      )
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
      throw new UpdateRequestError('Downloaded update does not match the signed manifest', false)
    }
    return filePath
  }

  /** Эту версию недавно не удалось скачать, и пауза перед новой попыткой ещё не прошла. */
  private isDownloadPostponed(version: string): boolean {
    const failed = this.failedDownload
    return failed?.version === version && Date.now() < failed.retryAt
  }

  private postponeDownload(version: string): void {
    const failures = this.failedDownload?.version === version ? this.failedDownload.failures + 1 : 1
    const pause = Math.min(
      DOWNLOAD_BACKOFF_INITIAL_MS * 2 ** (failures - 1),
      DOWNLOAD_BACKOFF_MAX_MS
    )
    this.failedDownload = { version, failures, retryAt: Date.now() + pause }
    console.warn(`Update ${version} download postponed for ${pause / 60_000} min`)
  }

  private setState(state: UpdateState): void {
    this.currentState = state
    this.options.onStateChange(state)
  }
}

/** Сбой запроса с пометкой, поможет ли повтор. */
class UpdateRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message)
  }
}

/** Повторять стоит, когда сервер не справился или не дождался, а не когда файла нет. */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429
}

/**
 * Выполняет запрос и повторяет его после паузы при временном сбое. Временным считается всё,
 * кроме явного отказа сервера: обрыв сети, тайм-аут, недочитанный ответ. `run` — проверка,
 * которая ждёт запрос: если она ручная, запрос не повторяется — пользователь ждёт ответа
 * и сам решит, проверить ли снова.
 */
async function withRetries<T>(request: () => Promise<T>, run?: CheckRun): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const interactive = run?.interactive ?? false
    try {
      return await request()
    } catch (error) {
      // Проверка стала ручной, пока шёл запрос: следующая попытка — сразу и уже последняя.
      if (!interactive && run?.interactive) {
        continue
      }
      const pause = RETRY_DELAYS_MS[attempt]
      if (
        interactive ||
        pause === undefined ||
        (error instanceof UpdateRequestError && !error.retryable)
      ) {
        throw error
      }
      console.warn(`Update request failed, retrying in ${pause / 1000} s`, error)
      // Ручная просьба посреди паузы обрывает её — повтор начинается сразу.
      await delay(pause, undefined, run && { signal: run.wake.signal }).catch(() => undefined)
    }
  }
}

function verifyManifestSignature(manifest: UpdateManifest): void {
  const signature = Buffer.from(manifest.signature, 'base64')
  const payload = Buffer.from(updateSignaturePayload(manifest))
  if (!verify(null, payload, createPublicKey(UPDATE_PUBLIC_KEY), signature)) {
    throw new Error('Update manifest signature is invalid')
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
