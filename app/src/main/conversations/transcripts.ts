import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { TimelineItem } from '../../shared/conversation'
import { JsonFileWriter, readVersionedJson } from '../jsonFile'

const TRANSCRIPT_VERSION = 1

interface TranscriptFile {
  version: typeof TRANSCRIPT_VERSION
  items: TimelineItem[]
}

/** Лента каждого чата — в своём файле: длинные разговоры не замедляют запись списка проектов. */
export class TranscriptStore {
  private readonly writers = new Map<string, JsonFileWriter>()
  private ready: Promise<void> | null = null

  constructor(private readonly directory: string) {}

  async load(chatId: string): Promise<TimelineItem[]> {
    const data = await readVersionedJson<TranscriptFile>(this.path(chatId), TRANSCRIPT_VERSION)
    const items = Array.isArray(data?.items) ? data.items : []
    // Инструменты, которые работали при закрытии Atox, уже не закончатся.
    return items.map((item) =>
      item.kind === 'tool' && item.status === 'running' ? { ...item, status: 'failed' } : item
    )
  }

  save(chatId: string, items: readonly TimelineItem[]): void {
    const data: TranscriptFile = { version: TRANSCRIPT_VERSION, items: [...items] }
    void this.ensureDirectory().then(() => this.writer(chatId).write(data))
  }

  async remove(chatId: string): Promise<void> {
    await this.writers.get(chatId)?.flush()
    this.writers.delete(chatId)
    await rm(this.path(chatId), { force: true })
  }

  async flush(): Promise<void> {
    await this.ready
    await Promise.all([...this.writers.values()].map((writer) => writer.flush()))
  }

  private writer(chatId: string): JsonFileWriter {
    let writer = this.writers.get(chatId)
    if (!writer) {
      writer = new JsonFileWriter(this.path(chatId))
      this.writers.set(chatId, writer)
    }
    return writer
  }

  private ensureDirectory(): Promise<void> {
    this.ready ??= mkdir(this.directory, { recursive: true }).then(() => undefined)
    return this.ready
  }

  private path(chatId: string): string {
    return join(this.directory, `${chatId}.json`)
  }
}
