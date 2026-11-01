import { open, readFile, rename } from 'node:fs/promises'

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

/** Пишет JSON на диск сразу при каждом изменении, сохраняя порядок записей. */
export class JsonFileWriter {
  /** Цепочка записей: каждая начинается после предыдущей, поэтому порядок не нарушается. */
  private pendingWrites: Promise<void> = Promise.resolve()
  /** Временный файл свой у процесса: другой экземпляр не перепишет его посреди записи. */
  private readonly tempPath: string

  constructor(private readonly filePath: string) {
    this.tempPath = `${filePath}.${process.pid}.tmp`
  }

  /** Снимок данных берётся в момент вызова, запись — после уже начатых. */
  write(data: unknown): void {
    const contents = JSON.stringify(data, null, 2)
    this.pendingWrites = this.pendingWrites
      .then(() => this.writeAtomically(contents))
      .catch((error) => console.error(`Failed to write ${this.filePath}`, error))
  }

  /** Дожидается окончания всех начатых записей. */
  flush(): Promise<void> {
    return this.pendingWrites
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
