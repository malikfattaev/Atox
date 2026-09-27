import { readFile, rename, writeFile } from 'node:fs/promises'

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

  constructor(private readonly filePath: string) {}

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

  /** Пишет во временный файл и переименовывает его, чтобы сбой не оставил файл наполовину записанным. */
  private async writeAtomically(contents: string): Promise<void> {
    const tempPath = `${this.filePath}.tmp`
    await writeFile(tempPath, contents, 'utf-8')
    await rename(tempPath, this.filePath)
  }
}
