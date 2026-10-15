import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentId } from '../../../shared/agents'
import { moveChatGroup } from '../../../shared/chats'
import { moveItemWithinGroup } from '../../../shared/list'
import type { Project, Space } from '../../../shared/models'
import type { ProjectColor } from '../../../shared/projectColors'
import {
  EMPTY_LAYOUT,
  hideChat,
  isSameSplit,
  layoutFromSplit,
  showChat,
  showChatBeside,
  splitChatIds,
  type ChatLayout
} from '../lib/chatLayout'
import { useSpaces } from './useSpaces'

const { atox } = window

/**
 * Что открыто в рабочей области. Раскладка своя у каждого проекта: при переходе в другой
 * проект его чаты, открытые рядом, возвращаются, а у прежнего сохраняются до возвращения.
 * Так же и с пространствами: в каждом на экране остаётся свой проект.
 */
interface WorkspaceView {
  /** Проект на экране в каждом пространстве (по id пространства). */
  shownProjectIds: Readonly<Record<string, string>>
  layouts: Readonly<Record<string, ChatLayout>>
}

const INITIAL_VIEW: WorkspaceView = { shownProjectIds: {}, layouts: {} }

export interface ProjectsState {
  /** Проекты всех пространств. */
  projects: Project[]
  spaces: Space[]
  /** `null` — пространства ещё загружаются. */
  activeSpaceId: string | null
  /** Проекты открытого пространства — их и показывает сайдбар. */
  spaceProjects: Project[]
  /** Чат в фокусе: к нему относятся поиск, закрытие и переключение с клавиатуры. */
  activeChatId: string | null
  /** Чаты на экране слева направо; два — когда чаты открыты рядом. */
  visibleChatIds: string[]
  /** Чаты, которые открывались в этой сессии: их терминалы держим смонтированными. */
  openedChatIds: string[]
  /** Чаты открытого пространства в порядке сайдбара — по ним работает переключение с клавиатуры. */
  orderedChatIds: string[]
  /** Проект текущего чата, а если чат не выбран — первый проект открытого пространства. */
  currentProjectId: string | null
  selectSpace(spaceId: string): void
  /** Создаёт пространство, открывает его и возвращает его id. */
  createSpace(): Promise<string>
  renameSpace(spaceId: string, name: string): Promise<void>
  setSpaceColor(spaceId: string, color: ProjectColor | null): Promise<void>
  /** Удаляет пространство; его проекты переходят в соседнее. */
  removeSpace(spaceId: string): Promise<void>
  moveProjectToSpace(projectId: string, spaceId: string): Promise<void>
  /** Открывает чат на месте того, что в фокусе; уже видимый чат просто получает фокус. */
  selectChat(chatId: string): void
  /** Открывает чат рядом с тем, что в фокусе; чат другого проекта открывается вместо него. */
  openChatBeside(chatId: string): void
  /** Убирает чат с экрана, когда чаты открыты рядом; сам чат остаётся в списке. */
  closeChatPane(chatId: string): void
  addProject(): Promise<void>
  removeProject(projectId: string): Promise<void>
  renameProject(projectId: string, name: string): Promise<void>
  setProjectColor(projectId: string, color: ProjectColor | null): Promise<void>
  /** Положение разделителя между чатами проекта, открытыми рядом. */
  setSplitPosition(projectId: string, position: number): Promise<void>
  moveProject(projectId: string, toIndex: number): Promise<void>
  revealProject(projectId: string): Promise<void>
  /** Без агента чат создаётся с агентом по умолчанию. */
  createChat(projectId: string, agent?: AgentId): Promise<void>
  removeChat(chatId: string): Promise<void>
  renameChat(chatId: string, title: string): Promise<void>
  moveChat(chatId: string, toIndex: number): Promise<void>
  applyTerminalTitle(chatId: string, title: string): Promise<void>
}

export function useProjects(): ProjectsState {
  const [projects, setProjects] = useState<Project[]>([])
  const [view, setView] = useState<WorkspaceView>(INITIAL_VIEW)
  const [openedChatIds, setOpenedChatIds] = useState<string[]>([])
  // Действия читают и меняют состояние сразу, не дожидаясь отрисовки: например, новый чат
  // открывается в том же вызове, в котором пришёл обновлённый список проектов.
  const projectsRef = useRef(projects)
  const viewRef = useRef(view)
  const {
    spaces,
    activeSpaceId,
    selectSpace,
    createSpace,
    renameSpace,
    setSpaceColor,
    removeSpace: removeSpaceReturningProjects
  } = useSpaces()
  const activeSpaceIdRef = useRef(activeSpaceId)
  activeSpaceIdRef.current = activeSpaceId

  const spaceProjects = useMemo(
    () => projects.filter((project) => project.spaceId === activeSpaceId),
    [projects, activeSpaceId]
  )
  const shownProjectId = findShownProjectId(view, projects, activeSpaceId)
  const layout = (shownProjectId && view.layouts[shownProjectId]) || EMPTY_LAYOUT
  const { visibleChatIds, activeChatId } = layout

  const orderedChatIds = useMemo(
    () => spaceProjects.flatMap((project) => project.chats.map(({ id }) => id)),
    [spaceProjects]
  )

  const currentProjectId = shownProjectId ?? spaceProjects[0]?.id ?? null

  const commitView = useCallback((next: WorkspaceView) => {
    viewRef.current = next
    setView(next)
  }, [])

  /** Применяет свежий список проектов и забывает чаты, которых в нём больше нет. */
  const applyProjects = useCallback(
    (next: Project[]) => {
      projectsRef.current = next
      setProjects(next)
      const existingChatIds = new Set(next.flatMap((project) => project.chats.map(({ id }) => id)))
      setOpenedChatIds((ids) => ids.filter((id) => existingChatIds.has(id)))

      // Удалённый чат пропадает с экрана; если рядом открыт второй, фокус переходит к нему.
      const current = viewRef.current
      const layouts = Object.fromEntries(
        next.flatMap((project) => {
          const layout = current.layouts[project.id]
          if (!layout) {
            return []
          }
          const removed = layout.visibleChatIds.filter((id) => !existingChatIds.has(id))
          return [[project.id, removed.reduce(hideChat, layout)]]
        })
      )
      // Проект на экране остаётся, только пока он существует и лежит в том же пространстве.
      const shownProjectIds = Object.fromEntries(
        Object.entries(current.shownProjectIds).filter(([spaceId, projectId]) =>
          next.some((project) => project.id === projectId && project.spaceId === spaceId)
        )
      )
      commitView({ shownProjectIds, layouts })
    },
    [commitView]
  )

  useEffect(() => {
    void atox.projects.list().then(applyProjects)
    return atox.chats.onChanged(applyProjects)
  }, [applyProjects])

  /**
   * Меняет раскладку проекта и показывает его, открыв его пространство. Чаты, открытые рядом,
   * сохраняются у проекта, поэтому после перезапуска они снова откроются вместе.
   */
  const changeLayout = useCallback(
    (projectId: string, change: (layout: ChatLayout) => ChatLayout) => {
      const current = viewRef.current
      const project = projectsRef.current.find(({ id }) => id === projectId)
      if (!project) {
        return
      }
      const before = current.layouts[projectId] ?? layoutFromSplit(project.split)
      const after = change(before)
      const alreadyShown =
        project.spaceId === activeSpaceIdRef.current &&
        current.shownProjectIds[project.spaceId] === projectId
      if (after === before && alreadyShown) {
        return
      }
      commitView({
        shownProjectIds: { ...current.shownProjectIds, [project.spaceId]: projectId },
        layouts: { ...current.layouts, [projectId]: after }
      })
      setOpenedChatIds((ids) => [...new Set([...ids, ...after.visibleChatIds])])
      // Чат из другого пространства (например, по клику на уведомление) открывает и его.
      selectSpace(project.spaceId)

      const split = splitChatIds(after)
      if (!isSameSplit(project.split?.chatIds, split)) {
        void atox.projects.setSplit(projectId, split).then(applyProjects)
      }
    },
    [commitView, applyProjects, selectSpace]
  )

  /** Проект на экране в открытом пространстве — для действий, которые читают состояние сразу. */
  const currentShownProjectId = () =>
    findShownProjectId(viewRef.current, projectsRef.current, activeSpaceIdRef.current)

  const selectChat = useCallback(
    (chatId: string) => {
      const projectId = findChatProjectId(projectsRef.current, chatId)
      if (projectId) {
        changeLayout(projectId, (layout) => showChat(layout, chatId))
      }
    },
    [changeLayout]
  )

  // Рядом открываются только чаты одного проекта: раскладка принадлежит проекту.
  const openChatBeside = useCallback(
    (chatId: string) => {
      const projectId = findChatProjectId(projectsRef.current, chatId)
      if (projectId) {
        const sameProject = projectId === currentShownProjectId()
        changeLayout(projectId, (layout) =>
          sameProject ? showChatBeside(layout, chatId) : showChat(layout, chatId)
        )
      }
    },
    [changeLayout]
  )

  const closeChatPane = useCallback(
    (chatId: string) => {
      const projectId = currentShownProjectId()
      if (projectId) {
        changeLayout(projectId, (layout) => hideChat(layout, chatId))
      }
    },
    [changeLayout]
  )

  const createChat = useCallback(
    async (projectId: string, agent?: AgentId) => {
      const { projects: next, chatId } = await atox.chats.create(projectId, agent)
      applyProjects(next)
      selectChat(chatId)
    },
    [applyProjects, selectChat]
  )

  const addProject = useCallback(async () => {
    const spaceId = activeSpaceIdRef.current
    if (!spaceId) {
      return
    }
    const result = await atox.projects.add(spaceId)
    if (!result) {
      return
    }
    applyProjects(result.projects)

    // Новый проект сразу открывается в чате — меньше кликов до работающего терминала.
    const project = result.projects.find(({ id }) => id === result.projectId)
    const [latestChat] = project?.chats ?? []
    if (latestChat) {
      selectChat(latestChat.id)
    } else {
      await createChat(result.projectId)
    }
  }, [applyProjects, createChat, selectChat])

  const removeProject = useCallback(
    async (projectId: string) => applyProjects(await atox.projects.remove(projectId)),
    [applyProjects]
  )

  const renameProject = useCallback(
    async (projectId: string, name: string) =>
      applyProjects(await atox.projects.rename(projectId, name)),
    [applyProjects]
  )

  const setProjectColor = useCallback(
    async (projectId: string, color: ProjectColor | null) =>
      applyProjects(await atox.projects.setColor(projectId, color)),
    [applyProjects]
  )

  const setSplitPosition = useCallback(
    async (projectId: string, position: number) =>
      applyProjects(await atox.projects.setSplitPosition(projectId, position)),
    [applyProjects]
  )

  // Перенос применяется сразу, не дожидаясь main-процесса: иначе брошенный элемент
  // на мгновение вернулся бы на старое место.
  const moveProject = useCallback(
    async (projectId: string, toIndex: number) => {
      setProjects((current) => {
        const fromIndex = current.findIndex(({ id }) => id === projectId)
        const moved = moveItemWithinGroup(
          current,
          fromIndex,
          toIndex,
          (a, b) => a.spaceId === b.spaceId
        )
        return moved ?? current
      })
      applyProjects(await atox.projects.move(projectId, toIndex))
    },
    [applyProjects]
  )

  const moveProjectToSpace = useCallback(
    async (projectId: string, spaceId: string) =>
      applyProjects(await atox.projects.moveToSpace(projectId, spaceId)),
    [applyProjects]
  )

  // Проекты удалённого пространства переезжают в соседнее — список проектов тоже обновляется.
  const removeSpace = useCallback(
    async (spaceId: string) => {
      const next = await removeSpaceReturningProjects(spaceId)
      if (next) {
        applyProjects(next)
      }
    },
    [removeSpaceReturningProjects, applyProjects]
  )

  const revealProject = useCallback((projectId: string) => atox.projects.reveal(projectId), [])

  const removeChat = useCallback(
    async (chatId: string) => applyProjects(await atox.chats.remove(chatId)),
    [applyProjects]
  )

  const renameChat = useCallback(
    async (chatId: string, title: string) => applyProjects(await atox.chats.rename(chatId, title)),
    [applyProjects]
  )

  const moveChat = useCallback(
    async (chatId: string, toIndex: number) => {
      setProjects((current) =>
        current.map((project) => {
          const chats = moveChatGroup(project.chats, chatId, toIndex)
          return chats ? { ...project, chats } : project
        })
      )
      applyProjects(await atox.chats.move(chatId, toIndex))
    },
    [applyProjects]
  )

  const applyTerminalTitle = useCallback(
    async (chatId: string, title: string) =>
      applyProjects(await atox.chats.applyTerminalTitle(chatId, title)),
    [applyProjects]
  )

  return {
    projects,
    spaces,
    activeSpaceId,
    spaceProjects,
    activeChatId,
    visibleChatIds,
    openedChatIds,
    orderedChatIds,
    currentProjectId,
    selectSpace,
    createSpace,
    renameSpace,
    setSpaceColor,
    removeSpace,
    moveProjectToSpace,
    selectChat,
    openChatBeside,
    closeChatPane,
    addProject,
    removeProject,
    renameProject,
    setProjectColor,
    setSplitPosition,
    moveProject,
    revealProject,
    createChat,
    removeChat,
    renameChat,
    moveChat,
    applyTerminalTitle
  }
}

function findChatProjectId(projects: readonly Project[], chatId: string): string | undefined {
  return projects.find(({ chats }) => chats.some(({ id }) => id === chatId))?.id
}

/** Проект на экране в пространстве, если он всё ещё существует и лежит в нём. */
function findShownProjectId(
  view: WorkspaceView,
  projects: readonly Project[],
  spaceId: string | null
): string | null {
  const projectId = spaceId ? view.shownProjectIds[spaceId] : undefined
  return projects.some((project) => project.id === projectId && project.spaceId === spaceId)
    ? projectId!
    : null
}
