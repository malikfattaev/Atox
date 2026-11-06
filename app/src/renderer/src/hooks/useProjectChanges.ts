import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangesResult } from '../../../shared/changes'
import { ipcErrorMessage } from '../lib/ipcError'
import { useProjectsContext } from './ProjectsContext'

/**
 * Как часто перечитывать изменения, пока агенты работают: они правят файлы посреди ответа,
 * а git status на каждое слово ответа был бы лишней нагрузкой.
 */
const LIVE_REFRESH_MS = 1500

/**
 * Сколько вывод терминала проекта должен молчать, чтобы обновить изменения: команда (git,
 * сборка) закончила писать. Программа, которая пишет без остановки (сервер разработки, htop),
 * так не заставляет перечитывать git каждые полторы секунды.
 */
const TERMINAL_QUIET_MS = 1000

/** Разделитель идентификаторов чатов в ключе подписок; в самих идентификаторах его нет. */
const CHAT_IDS_SEPARATOR = '\n'

export interface ProjectChanges {
  /** `null` — ещё не загружены. */
  result: ChangesResult | null
  refresh(): void
}

/**
 * Незакоммиченные изменения проекта. Обновляются, пока работают агенты чатов этого проекта
 * или что-то происходит в его терминале, и когда окно получает фокус.
 */
export function useProjectChanges(projectId: string): ProjectChanges {
  const [result, setResult] = useState<ChangesResult | null>(null)
  const { projects } = useProjectsContext()
  // Строка, а не массив: подписки пересоздаются, только когда меняется состав чатов.
  const chatIdsKey =
    projects
      .find((project) => project.id === projectId)
      ?.chats.map((chat) => chat.id)
      .join(CHAT_IDS_SEPARATOR) ?? ''
  const refreshRef = useRef<() => void>(() => undefined)
  const scheduleRefreshRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    setResult(null)
    let disposed = false
    // Каждый проход — несколько запусков git. Новый не начинается, пока идёт прежний:
    // вместо этого запоминается, что после него нужен ещё один, — он увидит свежие изменения.
    let running = false
    let pending = false
    const refresh = () => {
      if (running) {
        pending = true
        return
      }
      running = true
      window.atox.changes
        .list(projectId)
        .catch((error: unknown): ChangesResult => {
          return { ok: false, error: { kind: 'failed', message: ipcErrorMessage(error) } }
        })
        .then((next) => {
          running = false
          if (disposed) {
            return
          }
          setResult(next)
          if (pending) {
            pending = false
            refresh()
          }
        })
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const scheduleRefresh = () => {
      timer ??= setTimeout(() => {
        timer = undefined
        refresh()
      }, LIVE_REFRESH_MS)
    }

    let terminalQuietTimer: ReturnType<typeof setTimeout> | undefined
    const refreshWhenTerminalQuiet = () => {
      clearTimeout(terminalQuietTimer)
      terminalQuietTimer = setTimeout(refresh, TERMINAL_QUIET_MS)
    }

    refreshRef.current = refresh
    scheduleRefreshRef.current = scheduleRefresh
    refresh()
    // Git и правки в терминале проекта меняют файлы так же, как агенты.
    const unsubscribeTerminal = window.atox.terminals.onData(projectId, refreshWhenTerminalQuiet)
    // Файлы могли поменять в другом приложении, пока окно было не в фокусе.
    window.addEventListener('focus', refresh)
    return () => {
      disposed = true
      refreshRef.current = () => undefined
      scheduleRefreshRef.current = () => undefined
      unsubscribeTerminal()
      window.removeEventListener('focus', refresh)
      clearTimeout(timer)
      clearTimeout(terminalQuietTimer)
    }
  }, [projectId])

  // События чатов других проектов к изменениям в этой папке отношения не имеют.
  useEffect(() => {
    if (!chatIdsKey) {
      return
    }
    const unsubscribes = chatIdsKey
      .split(CHAT_IDS_SEPARATOR)
      .map((chatId) =>
        window.atox.conversations.onEvent(chatId, () => scheduleRefreshRef.current())
      )
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
  }, [chatIdsKey])

  const refresh = useCallback(() => refreshRef.current(), [])
  return { result, refresh }
}
