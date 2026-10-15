import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project, Space, SpacesState } from '../../../shared/models'
import type { ProjectColor } from '../../../shared/projectColors'

const { atox } = window

export interface SpacesApi {
  spaces: Space[]
  /** `null` — пространства ещё загружаются. */
  activeSpaceId: string | null
  selectSpace(spaceId: string): void
  /** Создаёт пространство, открывает его и возвращает его id. */
  createSpace(): Promise<string>
  renameSpace(spaceId: string, name: string): Promise<void>
  setSpaceColor(spaceId: string, color: ProjectColor | null): Promise<void>
  /** Удаляет пространство; возвращает проекты после переезда или `null`, если удаление отменили. */
  removeSpace(spaceId: string): Promise<Project[] | null>
}

/** Пространства и то, какое открыто; выбор сохраняется, чтобы после перезапуска открылось оно же. */
export function useSpaces(): SpacesApi {
  const [state, setState] = useState<SpacesState | null>(null)
  // Переключение срабатывает часто (каждый выбор чата) — текущее значение нужно без перерисовки.
  const stateRef = useRef(state)

  const apply = useCallback((next: SpacesState) => {
    stateRef.current = next
    setState(next)
  }, [])

  useEffect(() => {
    void atox.spaces.list().then(apply)
  }, [apply])

  const selectSpace = useCallback(
    (spaceId: string) => {
      const current = stateRef.current
      if (!current || current.activeSpaceId === spaceId) {
        return
      }
      // Переключаем сразу, не дожидаясь сохранения.
      apply({ ...current, activeSpaceId: spaceId })
      void atox.spaces.setActive(spaceId).then(apply)
    },
    [apply]
  )

  const createSpace = useCallback(async () => {
    const next = await atox.spaces.create()
    apply(next)
    return next.activeSpaceId
  }, [apply])

  const renameSpace = useCallback(
    async (spaceId: string, name: string) => apply(await atox.spaces.rename(spaceId, name)),
    [apply]
  )

  const setSpaceColor = useCallback(
    async (spaceId: string, color: ProjectColor | null) =>
      apply(await atox.spaces.setColor(spaceId, color)),
    [apply]
  )

  const removeSpace = useCallback(
    async (spaceId: string) => {
      const result = await atox.spaces.remove(spaceId)
      if (!result) {
        return null
      }
      apply(result.spaces)
      return result.projects
    },
    [apply]
  )

  return {
    spaces: state?.spaces ?? [],
    activeSpaceId: state?.activeSpaceId ?? null,
    selectSpace,
    createSpace,
    renameSpace,
    setSpaceColor,
    removeSpace
  }
}
