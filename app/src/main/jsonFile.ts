import { open, readFile, rename } from 'node:fs/promises'
import { inform } from './dialogs'

/**
 * Читает JSON-файл данных указанной версии; `undefined` — файла ещё нет.
 * Повреждённый или несовместимый файл не удаляется, а откладывается в сторону,
 * чтобы данные можно было восстановить вручную.
 */
export async function readVersionedJson<T extends { version: number }>(
  filePath: string,
  version: T['version']
): Promise<T | undefined> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }

  try {
    const data = JSON.parse(raw) as T
    if (data.version !== version) {
      throw new Error(`Unsupported file version: ${String(data.version)}`)
    }
    return data
  } catch (error) {
    const backupPath = `${filePath}.corrupt-${Date.now()}`
    await rename(filePath, backupPath)
    console.error(`${filePath} is corrupted, a copy was saved to ${backupPath}`, error)
    return undefined
  }
}

/** Файлы, запись которых сейчас не удаётся: о сбое сообщаем один раз, а не на каждое изменение. */
const failingFiles = new Set<string>()
/** Сообщение о сбое на экране: при общей беде (диск полон) файлы не выводят по окну каждый. */
let failureShown = false

/**
 * Сбой записи нельзя оставлять только в логе: пользователь продолжил бы работать, думая,
 * что всё сохраняется. Сообщаем об этом окном, пока файл не запишется снова.
 */
function reportWriteFailure(filePath: string, error: unknown): void {
  console.error(`Failed to write ${filePath}`, error)
  if (failingFiles.has(filePath)) {
    return
  }
  failingFiles.add(filePath)
  if (failureShown) {
    return
  }
  failureShown = true
  void inform(null, {
    type: 'error',
    message: 'Atox can’t save your changes',
    detail: `Writing ${filePath} failed: ${error instanceof Error ? error.message : String(error)}`
  }).finally(() => {
    failureShown = false
  })
}

/**
 * Пишет JSON на диск сразу при изменении. Одновременно идёт одна запись; изменения, пришедшие
 * за время записи, схлопываются в последний снимок — промежуточные состояния на диск не нужны.
 */
export class JsonFileWriter {
  /** Текущая запись вместе со всеми, что встанут за ней; `null` — файл записан. */
  private draining: Promise<void> | null = null
  /** Последний снимок, который ещё не начали писать. */
  private pendingContents: string | null = null
  /** Временный файл свой у процесса: другой экземпляр не перепишет его посреди записи. */
  private readonly tempPath: string

  /**
   * `compact` — без отступов: для больших файлов, которые часто переписываются целиком
   * и которые человек не читает.
   */
  constructor(
    private readonly filePath: string,
    private readonly options: { compact?: boolean } = {}
  ) {
    this.tempPath = `${filePath}.${process.pid}.tmp`
  }

  /** Снимок данных берётся в момент вызова и заменяет ещё не начатую запись. */
  write(data: unknown): void {
    this.pendingContents = this.options.compact
      ? JSON.stringify(data)
      : JSON.stringify(data, null, 2)
    this.draining ??= this.drain()
  }

  /** Дожидается записи последнего снимка — в том числе пришедшего уже после вызова. */
  flush(): Promise<void> {
    return this.draining ?? Promise.resolve()
  }

  private async drain(): Promise<void> {
    while (this.pendingContents !== null) {
      const contents = this.pendingContents
      this.pendingContents = null
      try {
        await this.writeAtomically(contents)
        failingFiles.delete(this.filePath)
      } catch (error) {
        reportWriteFailure(this.filePath, error)
      }
    }
    this.draining = null
  }

  /**
   * Пишет во временный файл и переименовывает его, чтобы сбой не оставил файл наполовину
   * записанным. Перед переименованием данные сбрасываются на диск: иначе после отключения
   * питания на месте файла мог бы оказаться пустой.
   */
  private async writeAtomically(contents: string): Promise<void> {
    const file = await open(this.tempPath, 'w')
    try {
      await file.writeFile(contents, 'utf-8')
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(this.tempPath, this.filePath)
  }
}
