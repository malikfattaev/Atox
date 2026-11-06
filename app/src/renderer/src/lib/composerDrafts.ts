import { useCallback, useSyncExternalStore } from 'react'
import type { Attachment } from './attachments'

/** Файл, который ещё готовится (картинка из буфера сохраняется на диск): без него не отправить. */
export interface PendingAttachment {
  id: number
  name: string
}

/** Всё, что набрано в поле ввода чата и ещё не отправлено. */
export interface ComposerDraft {
  text: string
  attachments: readonly Attachment[]
  pending: readonly PendingAttachment[]
  /** Что не получилось в последний раз (отправка, вложение): видно над полем, пока не закроют. */
  error: string | null
}

const EMPTY_DRAFT: ComposerDraft = { text: '', attachments: [], pending: [], error: null }

/**
 * Черновики живут вне компонентов: чат, который давно не открывали, выгружается, а набранный
 * текст и вложения остаются. Вложение, которое догрузилось уже после выгрузки, тоже не теряется.
 */
const drafts = new Map<string, ComposerDraft>()
const listeners = new Map<string, Set<() => void>>()

let nextPendingId = 0

export function newPendingId(): number {
  return ++nextPendingId
}

function isEmpty(draft: ComposerDraft): boolean {
  return (
    !draft.text &&
    draft.attachments.length === 0 &&
    draft.pending.length === 0 &&
    draft.error === null
  )
}

function getDraft(chatId: string): ComposerDraft {
  return drafts.get(chatId) ?? EMPTY_DRAFT
}

/** Меняет черновик чата; пустой черновик не хранится. */
export function updateDraft(
  chatId: string,
  change: (draft: ComposerDraft) => Partial<ComposerDraft>
): void {
  const current = getDraft(chatId)
  const next = { ...current, ...change(current) }
  if (isEmpty(next)) {
    drafts.delete(chatId)
  } else {
    drafts.set(chatId, next)
  }
  listeners.get(chatId)?.forEach((listener) => listener())
}

function subscribe(chatId: string, listener: () => void): () => void {
  let chatListeners = listeners.get(chatId)
  if (!chatListeners) {
    chatListeners = new Set()
    listeners.set(chatId, chatListeners)
  }
  chatListeners.add(listener)
  return () => {
    chatListeners.delete(listener)
    if (chatListeners.size === 0) {
      listeners.delete(chatId)
    }
  }
}

export function useComposerDraft(chatId: string): ComposerDraft {
  const subscribeToChat = useCallback(
    (listener: () => void) => subscribe(chatId, listener),
    [chatId]
  )
  return useSyncExternalStore(subscribeToChat, () => getDraft(chatId))
}
