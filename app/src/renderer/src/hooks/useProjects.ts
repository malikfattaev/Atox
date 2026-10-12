import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentId } from '../../../shared/agents'
import { moveItem } from '../../../shared/list'
import type { Project } from '../../../shared/models'
import type { ProjectColor } from '../../../shared/projectColors'

const { atox } = window

/** Сколько чатов можно открыть рядом в одном окне. */
const MAX_VISIBLE_CHATS = 2

interface ChatView {
  /** Чаты на экране слева направо: один или два рядом. */
  visibleChatIds: string[]
  /** Чат в фокусе — один из видимых. */
  activeChatId: string | null
}

const EMPTY_VIEW: ChatView = { visibleChatIds: [], activeChatId: null }

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
  /** Открывает чат рядом с тем, что в фокусе. */
  openChatBeside(chatId: string): void
  /** Убирает чат с экрана, когда чаты открыты рядом; сам чат остаётся в списке. */
  closeChatPane(chatId: string): void
  addProject(): Promise<void>
  removeProject(projectId: string): Promise<void>
  renameProject(projectId: string, name: string): Promise<void>
  setProjectColor(projectId: string, color: ProjectColor | null): Promise<void>
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
  const [{ visibleChatIds, activeChatId }, setView] = useState<ChatView>(EMPTY_VIEW)
  const [openedChatIds, setOpenedChatIds] = useState<string[]>([])

  useEffect(() => {
    void atox.projects.list().then(setProjects)
  }, [])

  const orderedChatIds = useMemo(
    () => projects.flatMap((project) => project.chats.map(({ id }) => id)),
    [projects]
  )

  const currentProjectId = useMemo(() => {
    const current = projects.find((project) => project.chats.some(({ id }) => id === activeChatId))
    return (current ?? projects[0])?.id ?? null
  }, [projects, activeChatId])

  const markOpened = useCallback((chatId: string) => {
    setOpenedChatIds((ids) => (ids.includes(chatId) ? ids : [...ids, chatId]))
  }, [])

  const selectChat = useCallback(
    (chatId: string) => {
      setView((view) => {
        if (view.activeChatId === chatId) {
          return view
        }
        if (view.visibleChatIds.includes(chatId)) {
          return { ...view, activeChatId: chatId }
        }
        const index = view.activeChatId ? view.visibleChatIds.indexOf(view.activeChatId) : -1
        const visible = index >= 0 ? view.visibleChatIds.with(index, chatId) : [chatId]
        return { visibleChatIds: visible, activeChatId: chatId }
      })
      markOpened(chatId)
    },
    [markOpened]
  )

  const openChatBeside = useCallback(
    (chatId: string) => {
      setView((view) => {
        if (view.visibleChatIds.includes(chatId)) {
          return { ...view, activeChatId: chatId }
        }
        // Чат в фокусе остаётся на месте, новый встаёт справа — вместо второго, если он был.
        const kept = view.visibleChatIds.filter((id) => id === view.activeChatId)
        const visible = [...kept, chatId].slice(-MAX_VISIBLE_CHATS)
        return { visibleChatIds: visible, activeChatId: chatId }
      })
      markOpened(chatId)
    },
    [markOpened]
  )

  const closeChatPane = useCallback((chatId: string) => {
    setView((view) => {
      const visible = view.visibleChatIds.filter((id) => id !== chatId)
      const active = view.activeChatId === chatId ? (visible[0] ?? null) : view.activeChatId
      return { visibleChatIds: visible, activeChatId: active }
    })
  }, [])

  /** Применяет свежий список проектов и забывает чаты, которых в нём больше нет. */
  const applyProjects = useCallback((next: Project[]) => {
    const existingChatIds = new Set(next.flatMap((project) => project.chats.map(({ id }) => id)))
    setProjects(next)
    setOpenedChatIds((ids) => ids.filter((id) => existingChatIds.has(id)))
    // Если удалили чат в фокусе, а рядом открыт второй, фокус переходит к нему.
    setView((view) => {
      const visible = view.visibleChatIds.filter((id) => existingChatIds.has(id))
      if (visible.length === view.visibleChatIds.length) {
        return view
      }
      const active =
        view.activeChatId && existingChatIds.has(view.activeChatId)
          ? view.activeChatId
          : (visible[0] ?? null)
      return { visibleChatIds: visible, activeChatId: active }
    })
  }, [])

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
