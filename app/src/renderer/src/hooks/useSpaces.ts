import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project, Space, SpacesState } from '../../../shared/models'
import type { ProjectColor } from '../../../shared/projectColors'

const { atox } = window

/** Пока пространства загружаются — один и тот же пустой список, чтобы не перерисовывать зря. */
const NO_SPACES: Space[] = []

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
  // Выбор, который ещё сохраняется. Ответы, пришедшие до его сохранения (прежнее переключение,
  // переименование), несут старое открытое пространство и не должны откатывать выбор.
  const pendingRef = useRef<{ spaceId: string; request: number } | null>(null)
  const requestRef = useRef(0)

  const apply = useCallback((next: SpacesState) => {
    const pending = pendingRef.current
    const keepsSelection =
      pending !== null &&
      pending.spaceId !== next.activeSpaceId &&
      next.spaces.some(({ id }) => id === pending.spaceId)
    const applied = keepsSelection ? { ...next, activeSpaceId: pending.spaceId } : next
    stateRef.current = applied
    setState(applied)
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
      const request = ++requestRef.current
      pendingRef.current = { spaceId, request }
      // Переключаем сразу, не дожидаясь сохранения.
      apply({ ...current, activeSpaceId: spaceId })
      void atox.spaces
        .setActive(spaceId)
        .finally(() => {
          // Ответ на последний выбор (и его ошибка) снимает защиту, ответы на прежние её соблюдают.
          if (pendingRef.current?.request === request) {
            pendingRef.current = null
          }
        })
        .then(apply)
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
    spaces: state?.spaces ?? NO_SPACES,
    activeSpaceId: state?.activeSpaceId ?? null,
    selectSpace,
    createSpace,
    renameSpace,
    setSpaceColor,
    removeSpace
  }
}
