import { findAgent } from '../../shared/agents'
import type { Chat } from '../../shared/models'
import { PARENT_ADDRESS } from '../../shared/orchestration'

/** Так агент в тексте отличает сообщение от Atox от того, что набрал пользователь. */
const MESSAGE_PREFIX = '[Atox]'

function describeChat(chat: Chat): string {
  const agent = findAgent(chat.agent)?.name
  return agent ? `"${chat.title}" (${agent}, chat ${chat.id})` : `"${chat.title}" (chat ${chat.id})`
}

/**
 * Первое сообщение помощнику: задание и то, как вернуть результат. Правила стоят прямо у
 * примеров команд — агенты лучше следуют примерам, чем отдельному абзацу правил.
 */
export function formatWorkerTask(parent: Chat, task: string): string {
  return `You are a worker agent. The agent in Atox chat ${describeChat(parent)} started you to do the task below in this folder.

When you finish, or cannot finish, report back exactly once with a short summary (what you did, what you found, what is left):
  atox report "<summary>"

If you are blocked by a question only that agent can answer, ask it instead of the user; the answer arrives here as a new message:
  atox send ${PARENT_ADDRESS} "<question>"

If the atox command is not found, run "$ATOX_CLI" instead. If it fails because of a sandbox or permissions, run it again with elevated permissions: it only talks to the local Atox app.

Task:
${task.trim()}`
}

export function formatReport(worker: Chat, summary: string): string {
  return `${MESSAGE_PREFIX} Worker ${describeChat(worker)} finished and reported:
${summary.trim()}`
}

export function formatMessage(sender: Chat, message: string): string {
  const reply = sender.parentChatId
    ? `atox send ${sender.id} "<answer>"`
    : `atox send ${PARENT_ADDRESS} "<answer>"`
  return `${MESSAGE_PREFIX} Message from ${describeChat(sender)}:
${message.trim()}

Reply with: ${reply}`
}
