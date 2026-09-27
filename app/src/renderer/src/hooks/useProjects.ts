import { useCallback, useEffect, useMemo, useState } from 'react'
import { moveItem } from '../../../shared/list'
import type { Project } from '../../../shared/models'

const { atox } = window

export interface ProjectsState {
  projects: Project[]
  activeChatId: string | null
  /** Чаты, которые открывались в этой сессии: их терминалы держим смонтированными. */
  openedChatIds: string[]
  /** Все чаты в порядке сайдбара — по нему работает переключение с клавиатуры. */
  orderedChatIds: string[]
  /** Проект текущего чата, а если чат не выбран — первый проект. */
  currentProjectId: string | null
  selectChat(chatId: string): void
  addProject(): Promise<void>
  removeProject(projectId: string): Promise<void>
  renameProject(projectId: string, name: string): Promise<void>
  moveProject(projectId: string, toIndex: number): Promise<void>
  revealProject(projectId: string): Promise<void>
  createChat(projectId: string): Promise<void>
  removeChat(chatId: string): Promise<void>
  renameChat(chatId: string, title: string): Promise<void>
  moveChat(chatId: string, toIndex: number): Promise<void>
  recordChatActivity(chatId: string, at: number): Promise<void>
  applyTerminalTitle(chatId: string, title: string): Promise<void>
}

export function useProjects(): ProjectsState {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
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

  const selectChat = useCallback((chatId: string) => {
    setActiveChatId(chatId)
    setOpenedChatIds((ids) => (ids.includes(chatId) ? ids : [...ids, chatId]))
  }, [])

  /** Применяет свежий список проектов и забывает чаты, которых в нём больше нет. */
  const applyProjects = useCallback((next: Project[]) => {
    const existingChatIds = new Set(next.flatMap((project) => project.chats.map(({ id }) => id)))
    setProjects(next)
    setOpenedChatIds((ids) => ids.filter((id) => existingChatIds.has(id)))
    setActiveChatId((id) => (id && existingChatIds.has(id) ? id : null))
  }, [])

  const createChat = useCallback(
    async (projectId: string) => {
      const { projects: next, chatId } = await atox.chats.create(projectId)
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
    openedChatIds,
    orderedChatIds,
    currentProjectId,
    selectChat,
    addProject,
    removeProject,
    renameProject,
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
