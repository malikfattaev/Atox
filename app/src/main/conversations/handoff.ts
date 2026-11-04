import { findAgent, type AgentId } from '../../shared/agents'
import type { TimelineItem } from '../../shared/conversation'

/**
 * Сколько переписки передавать агенту, который продолжает чат за другим: хватает, чтобы
 * понять, о чём шла речь, и не съедает его контекст. Обрезается начало — конец важнее.
 */
const HANDOFF_LIMIT_CHARS = 60_000

/** Длинный ответ или команда в пересказе сокращаются: целиком их можно перечитать в файлах. */
const ENTRY_LIMIT_CHARS = 4_000

/**
 * Сообщение агенту, который подхватывает чат после другого: у него нет памяти о прежнем
 * разговоре, поэтому он получает переписку целиком, а за ней — новое сообщение пользователя.
 */
export function handoffMessage(
  previousAgent: AgentId,
  history: readonly TimelineItem[],
  message: string
): string {
  const previousName = findAgent(previousAgent)?.name ?? previousAgent
  const transcript = limitFromStart(history.flatMap(describe).join('\n\n'))
  return [
    `[Atox] The user switched this chat from ${previousName} to you. You have no memory of ` +
      'the conversation so far, so here it is (oldest first; earlier parts may be cut). ' +
      'Continue from where it left off; files in the project may already contain changes made ' +
      `by ${previousName}.`,
    `<conversation>\n${transcript}\n</conversation>`,
    `The user's new message:\n${message}`
  ].join('\n\n')
}

/** Ответы подписаны «Assistant»: чат мог переходить между агентами не один раз. */
function describe(item: TimelineItem): string[] {
  switch (item.kind) {
    case 'user': {
      const attachments = [...(item.images ?? []), ...(item.files ?? [])]
      const attached = attachments.length > 0 ? `\n(attached: ${attachments.join(', ')})` : ''
      return [`User: ${shorten(item.text)}${attached}`]
    }
    case 'assistant':
      return item.text.trim() ? [`Assistant: ${shorten(item.text)}`] : []
    case 'tool':
      return [`(assistant used ${item.name}: ${shorten(item.title)})`]
    case 'error':
      return [`(error: ${shorten(item.message)})`]
    case 'image':
      return item.path ? [`(assistant generated an image: ${item.path})`] : []
    default:
      return []
  }
}

function shorten(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > ENTRY_LIMIT_CHARS ? `${trimmed.slice(0, ENTRY_LIMIT_CHARS)}…` : trimmed
}

function limitFromStart(text: string): string {
  return text.length > HANDOFF_LIMIT_CHARS ? `…${text.slice(-HANDOFF_LIMIT_CHARS)}` : text
}
