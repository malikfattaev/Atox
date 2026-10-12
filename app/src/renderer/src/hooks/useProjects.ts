import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentId } from '../../../shared/agents'
import { moveItem } from '../../../shared/list'
import type { Project } from '../../../shared/models'
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

const { atox } = window

/**
 * Что открыто в рабочей области. Раскладка своя у каждого проекта: при переходе в другой
 * проект его чаты, открытые рядом, возвращаются, а у прежнего сохраняются до возвращения.
 */
interface WorkspaceView {
  /** Проект, чаты которого на экране; `null` — чат ещё не выбран. */
  projectId: string | null
  layouts: Readonly<Record<string, ChatLayout>>
}

const INITIAL_VIEW: WorkspaceView = { projectId: null, layouts: {} }

export interface ProjectsState {
  projects: Project[]
  /** Чат в фокусе: к нему относятся поиск, закрытие и переключение с клавиатуры. */
  activeChatId: string | null
  /** Чаты на экране слева направо; два — когда чаты открыты рядом. */
  visibleChatIds: string[]
  /** Чаты, которые открывались в этой сессии: их терминалы держим смонтированными. */
  openedChatIds: string[]
  /** Все чаты в порядке сайдбара — по нему работает переключение с клавиатуры. */
  orderedChatIds: string[]
  /** Проект текущего чата, а если чат не выбран — первый проект. */
  currentProjectId: string | null
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
  recordChatActivity(chatId: string, at: number): Promise<void>
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

  const layout = (view.projectId && view.layouts[view.projectId]) || EMPTY_LAYOUT
  const { visibleChatIds, activeChatId } = layout

  const orderedChatIds = useMemo(
    () => projects.flatMap((project) => project.chats.map(({ id }) => id)),
    [projects]
  )

  const currentProjectId = view.projectId ?? projects[0]?.id ?? null

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
      const projectId = next.some(({ id }) => id === current.projectId) ? current.projectId : null
      commitView({ projectId, layouts })
    },
    [commitView]
  )

  useEffect(() => {
    void atox.projects.list().then(applyProjects)
  }, [applyProjects])

  /**
   * Меняет раскладку проекта и показывает его. Чаты, открытые рядом, сохраняются у проекта,
   * поэтому после перезапуска они снова откроются вместе.
   */
  const changeLayout = useCallback(
    (projectId: string, change: (layout: ChatLayout) => ChatLayout) => {
      const current = viewRef.current
      const project = projectsRef.current.find(({ id }) => id === projectId)
      const before = current.layouts[projectId] ?? layoutFromSplit(project?.split)
      const after = change(before)
      if (after === before && projectId === current.projectId) {
        return
      }
      commitView({ projectId, layouts: { ...current.layouts, [projectId]: after } })
      setOpenedChatIds((ids) => [...new Set([...ids, ...after.visibleChatIds])])

      const split = splitChatIds(after)
      if (project && !isSameSplit(project.split?.chatIds, split)) {
        void atox.projects.setSplit(projectId, split).then(applyProjects)
      }
    },
    [commitView, applyProjects]
  )

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
        const sameProject = projectId === viewRef.current.projectId
        changeLayout(projectId, (layout) =>
          sameProject ? showChatBeside(layout, chatId) : showChat(layout, chatId)
        )
      }
    },
    [changeLayout]
  )

  const closeChatPane = useCallback(
    (chatId: string) => {
      const { projectId } = viewRef.current
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
    const result = await atox.projects.add()
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
        return moveItem(current, fromIndex, toIndex) ?? current
      })
      applyProjects(await atox.projects.move(projectId, toIndex))
    },
    [applyProjects]
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
          const fromIndex = project.chats.findIndex(({ id }) => id === chatId)
          const chats = moveItem(project.chats, fromIndex, toIndex)
          return chats ? { ...project, chats } : project
        })
      )
      applyProjects(await atox.chats.move(chatId, toIndex))
    },
    [applyProjects]
  )

  const recordChatActivity = useCallback(
    async (chatId: string, at: number) =>
      applyProjects(await atox.chats.recordActivity(chatId, at)),
    [applyProjects]
  )

  const applyTerminalTitle = useCallback(
    async (chatId: string, title: string) =>
      applyProjects(await atox.chats.applyTerminalTitle(chatId, title)),
    [applyProjects]
  )

  return {
    projects,
    activeChatId,
    visibleChatIds,
    openedChatIds,
    orderedChatIds,
    currentProjectId,
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
    recordChatActivity,
    applyTerminalTitle
  }
}

function findChatProjectId(projects: readonly Project[], chatId: string): string | undefined {
  return projects.find(({ chats }) => chats.some(({ id }) => id === chatId))?.id
}
