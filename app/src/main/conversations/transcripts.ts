import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { isAgentId, type AgentId } from '../../shared/agents'
import type { TimelineItem } from '../../shared/conversation'
import { JsonFileWriter, readVersionedJson } from '../jsonFile'

const TRANSCRIPT_VERSION = 1

/** Что нужно, чтобы показать разговор чата после перезапуска Atox и продолжить его. */
export interface Transcript {
  items: TimelineItem[]
  /** Разговор на стороне агента (сессия Claude, тред Codex); `null` — ещё не начат. */
  sessionId: string | null
  /** Агент, с которым идёт разговор на его стороне. */
  sessionAgent: AgentId | null
  /** Агент последнего отправленного сообщения: по нему видно, что следующее уходит другому. */
  lastAgent: AgentId | null
}

interface TranscriptFile extends Transcript {
  version: typeof TRANSCRIPT_VERSION
}

/** Лента каждого чата — в своём файле: длинные разговоры не замедляют запись списка проектов. */
export class TranscriptStore {
  private readonly writers = new Map<string, JsonFileWriter>()

  private constructor(private readonly directory: string) {}

  static async open(directory: string): Promise<TranscriptStore> {
    await mkdir(directory, { recursive: true })
    return new TranscriptStore(directory)
  }

  /**
   * Разговор чата; без файла — пустой. Всё, что прервал выход из Atox, закрывается:
   * продолжить работу инструмента или ответить на запрос прежней сессии уже нельзя.
   */
  async load(chatId: string): Promise<Transcript> {
    // Чат могли закрыть и сразу открыть снова: читать файл нужно после его записи.
    await this.writers.get(chatId)?.flush()
    const data = await readVersionedJson<TranscriptFile>(this.path(chatId), TRANSCRIPT_VERSION)
    const items = Array.isArray(data?.items) ? data.items : []
    return {
      items: items.map(settle),
      sessionId: typeof data?.sessionId === 'string' ? data.sessionId : null,
      sessionAgent: isAgentId(data?.sessionAgent) ? data.sessionAgent : null,
      lastAgent: isAgentId(data?.lastAgent) ? data.lastAgent : null
    }
  }

  save(chatId: string, transcript: Transcript): void {
    const data: TranscriptFile = { version: TRANSCRIPT_VERSION, ...transcript }
    this.writer(chatId).write(data)
  }

  /** Дописывает файл чата и забывает о нём; файл остаётся. */
  async close(chatId: string): Promise<void> {
    await this.writers.get(chatId)?.flush()
    this.writers.delete(chatId)
  }

  async remove(chatId: string): Promise<void> {
    await this.close(chatId)
    await rm(this.path(chatId), { force: true })
  }

  async flush(): Promise<void> {
    await Promise.all([...this.writers.values()].map((writer) => writer.flush()))
  }

  private writer(chatId: string): JsonFileWriter {
    let writer = this.writers.get(chatId)
    if (!writer) {
      // Лента с выводом команд весит мегабайты и переписывается, пока агент пишет ответ.
      writer = new JsonFileWriter(this.path(chatId), { compact: true })
      this.writers.set(chatId, writer)
    }
    return writer
  }

  private path(chatId: string): string {
    return join(this.directory, `${chatId}.json`)
  }
}

/** Элемент ленты в том виде, в каком он остался, когда агент перестал работать. */
function settle(item: TimelineItem): TimelineItem {
  switch (item.kind) {
    case 'user':
      // Когда закончился прерванный ответ, неизвестно: берётся время самого сообщения.
      return item.finishedAt === undefined ? { ...item, finishedAt: item.createdAt } : item
    case 'tool':
    case 'image':
    case 'compaction':
      return item.status === 'running' ? { ...item, status: 'failed' } : item
    case 'approval':
    case 'question':
      return item.status === 'pending' ? { ...item, status: 'cancelled' } : item
    default:
      return item
  }
}
