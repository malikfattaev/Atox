import { useCallback, useEffect, useState } from 'react'
import type { BoardColumn, BoardState } from '../../../shared/board'

/**
 * Сколько доска может не обновляться: открытая позже этого, она перечитывает задачи с GitHub
 * сама. Чаще не нужно — каждое чтение это запросы по всем репозиториям доски.
 */
const BOARD_STALE_MS = 2 * 60_000

export interface BoardHandle {
  state: BoardState | null
  refresh(): void
  /** Переносит задачу сразу на экране, не дожидаясь ответа main. */
  move(issueId: string, column: BoardColumn): void
}

export function useBoard(): BoardHandle {
  const [state, setState] = useState<BoardState | null>(null)

  useEffect(() => {
    let subscribed = true
    const unsubscribe = window.atox.board.subscribe(setState)
    void window.atox.board.get().then((initial) => {
      if (!subscribed) {
        return
      }
      setState((current) => current ?? initial)
      const stale = initial.syncedAt === null || Date.now() - initial.syncedAt > BOARD_STALE_MS
      if (initial.repositories.length > 0 && stale) {
        void window.atox.board.refresh()
      }
    })
    return () => {
      subscribed = false
      unsubscribe()
    }
  }, [])

  const refresh = useCallback(() => void window.atox.board.refresh(), [])

  const move = useCallback((issueId: string, column: BoardColumn) => {
    setState(
      (current) =>
        current && {
          ...current,
          issues: current.issues.map((issue) =>
            issue.id === issueId ? { ...issue, column } : issue
          )
        }
    )
    void window.atox.board.move(issueId, column).then(setState)
  }, [])

  return { state, refresh, move }
}
