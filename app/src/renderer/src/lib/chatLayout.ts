import type { ProjectSplit } from '../../../shared/models'

/** Сколько чатов можно открыть рядом в одном окне. */
const MAX_VISIBLE_CHATS = 2

/** Что показано в рабочей области, когда открыт проект. */
export interface ChatLayout {
  /** Чаты на экране слева направо: один или два рядом. */
  visibleChatIds: string[]
  /** Чат в фокусе — один из видимых. */
  activeChatId: string | null
}

export const EMPTY_LAYOUT: ChatLayout = { visibleChatIds: [], activeChatId: null }

/** Раскладка проекта при первом открытии: сохранённые рядом чаты, фокус на левом. */
export function layoutFromSplit(split: ProjectSplit | undefined): ChatLayout {
  return split
    ? { visibleChatIds: [...split.chatIds], activeChatId: split.chatIds[0] }
    : EMPTY_LAYOUT
}

/** Показывает чат на месте того, что в фокусе; уже видимый чат просто получает фокус. */
export function showChat(layout: ChatLayout, chatId: string): ChatLayout {
  if (layout.activeChatId === chatId) {
    return layout
  }
  if (layout.visibleChatIds.includes(chatId)) {
    return { ...layout, activeChatId: chatId }
  }
  const index = layout.activeChatId ? layout.visibleChatIds.indexOf(layout.activeChatId) : -1
  const visible = index >= 0 ? layout.visibleChatIds.with(index, chatId) : [chatId]
  return { visibleChatIds: visible, activeChatId: chatId }
}

/** Открывает чат рядом: чат в фокусе остаётся на месте, новый встаёт справа вместо второго. */
export function showChatBeside(layout: ChatLayout, chatId: string): ChatLayout {
  if (layout.visibleChatIds.includes(chatId)) {
    return { ...layout, activeChatId: chatId }
  }
  const kept = layout.visibleChatIds.filter((id) => id === layout.activeChatId)
  return { visibleChatIds: [...kept, chatId].slice(-MAX_VISIBLE_CHATS), activeChatId: chatId }
}

/** Убирает чат с экрана; если он был в фокусе, фокус переходит к оставшемуся. */
export function hideChat(layout: ChatLayout, chatId: string): ChatLayout {
  if (!layout.visibleChatIds.includes(chatId)) {
    return layout
  }
  const visible = layout.visibleChatIds.filter((id) => id !== chatId)
  const active = layout.activeChatId === chatId ? (visible[0] ?? null) : layout.activeChatId
  return { visibleChatIds: visible, activeChatId: active }
}

/** Чаты, открытые рядом, — то, что сохраняется у проекта; `null` — на экране один чат. */
export function splitChatIds(layout: ChatLayout): [string, string] | null {
  const [left, right] = layout.visibleChatIds
  return left && right ? [left, right] : null
}

export function isSameSplit(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined
): boolean {
  return (a ?? null) === (b ?? null) || (!!a && !!b && a[0] === b[0] && a[1] === b[1])
}
