import type { Chat } from './models'
import { moveItem } from './list'

/**
 * Чаты проекта хранятся одним списком: за каждым чатом пользователя сразу идут помощники,
 * которых запустил его агент. Так порядок сохраняется без отдельной структуры.
 */
export function isWorkerChat(chat: Chat): boolean {
  return chat.parentChatId !== undefined
}

export function topLevelChats(chats: readonly Chat[]): Chat[] {
  return chats.filter((chat) => !isWorkerChat(chat))
}

export function workerChats(chats: readonly Chat[], parentChatId: string): Chat[] {
  return chats.filter((chat) => chat.parentChatId === parentChatId)
}

/** Список, где за каждым чатом верхнего уровня идут его помощники, в порядке `topLevel`. */
function withWorkers(chats: readonly Chat[], topLevel: readonly Chat[]): Chat[] {
  return topLevel.flatMap((chat) => [chat, ...workerChats(chats, chat.id)])
}

/** Добавляет помощника в конец группы его чата. */
export function insertWorkerChat(chats: readonly Chat[], worker: Chat): Chat[] {
  return withWorkers([...chats, worker], topLevelChats(chats))
}

/**
 * Переносит чат верхнего уровня на позицию `toIndex` среди таких же чатов; помощники
 * переезжают вместе с ним. `null` — переносить нечего.
 */
export function moveChatGroup(
  chats: readonly Chat[],
  chatId: string,
  toIndex: number
): Chat[] | null {
  const topLevel = topLevelChats(chats)
  const moved = moveItem(
    topLevel,
    topLevel.findIndex(({ id }) => id === chatId),
    toIndex
  )
  return moved && withWorkers(chats, moved)
}

/** Чаты без удалённого; его помощники становятся обычными чатами и остаются на месте. */
export function removeChatFromList(chats: readonly Chat[], chatId: string): Chat[] {
  return chats.flatMap((chat) => {
    if (chat.id === chatId) {
      return []
    }
    if (chat.parentChatId === chatId) {
      const { parentChatId: _parent, ...rest } = chat
      return [rest]
    }
    return [chat]
  })
}
