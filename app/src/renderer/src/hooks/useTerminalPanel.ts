import { useCallback, useState } from 'react'

export interface TerminalPanelState {
  /** Проекты, у которых открыта панель терминала: у каждого проекта она своя. */
  openProjectIds: readonly string[]
  /**
   * Проекты, терминал которых хоть раз открывали и оболочка которых ещё работает. Их терминалы
   * остаются на странице и при закрытой панели: заново подключённый терминал восстанавливал бы
   * экран из сохранённого хвоста вывода, а полноэкранные программы (claude, vim, htop) из него
   * не восстановить.
   */
  attachedProjectIds: readonly string[]
  /** Растёт при каждом переключении панели: открытый терминал забирает фокус. */
  focusRequest: number
  /** Открывает или скрывает терминал проекта; скрытый терминал продолжает работать. */
  toggle(projectId: string): void
  /** Оболочка проекта завершилась: терминал убирается совсем. */
  close(projectId: string): void
}

export function useTerminalPanel(): TerminalPanelState {
  const [openProjectIds, setOpenProjectIds] = useState<readonly string[]>([])
  const [attachedProjectIds, setAttachedProjectIds] = useState<readonly string[]>([])
  const [focusRequest, setFocusRequest] = useState(0)

  const close = useCallback((projectId: string) => {
    setOpenProjectIds((ids) => ids.filter((id) => id !== projectId))
    setAttachedProjectIds((ids) => ids.filter((id) => id !== projectId))
  }, [])

  const toggle = useCallback((projectId: string) => {
    setOpenProjectIds((ids) =>
      ids.includes(projectId) ? ids.filter((id) => id !== projectId) : [...ids, projectId]
    )
    setAttachedProjectIds((ids) => (ids.includes(projectId) ? ids : [...ids, projectId]))
    // Скрытый терминал фокус не забирает, поэтому запрос безвреден и при скрытии.
    setFocusRequest((request) => request + 1)
  }, [])

  return { openProjectIds, attachedProjectIds, focusRequest, toggle, close }
}
