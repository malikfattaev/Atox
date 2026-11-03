import { useCallback, useState } from 'react'

export interface TerminalPanelState {
  /** Проекты, у которых открыта панель терминала: у каждого проекта она своя. */
  openProjectIds: readonly string[]
  /** Растёт при каждом переключении панели: открытый терминал забирает фокус. */
  focusRequest: number
  /** Открывает или скрывает терминал проекта; скрытый терминал продолжает работать. */
  toggle(projectId: string): void
  close(projectId: string): void
}

export function useTerminalPanel(): TerminalPanelState {
  const [openProjectIds, setOpenProjectIds] = useState<readonly string[]>([])
  const [focusRequest, setFocusRequest] = useState(0)

  const close = useCallback((projectId: string) => {
    setOpenProjectIds((ids) => ids.filter((id) => id !== projectId))
  }, [])

  const toggle = useCallback((projectId: string) => {
    setOpenProjectIds((ids) =>
      ids.includes(projectId) ? ids.filter((id) => id !== projectId) : [...ids, projectId]
    )
    // Скрытый терминал фокус не забирает, поэтому запрос безвреден и при скрытии.
    setFocusRequest((request) => request + 1)
  }, [])

  return { openProjectIds, focusRequest, toggle, close }
}
