import { useCallback, useEffect, useState } from 'react'
import type { Project } from '../../../shared/models'

const { atox } = window

export interface ProjectsState {
  projects: Project[]
  activeChatId: string | null
  /** Чаты, которые открывались в этой сессии: их терминалы держим смонтированными. */
  openedChatIds: string[]
  selectChat(chatId: string): void
  addProject(): Promise<void>
  removeProject(projectId: string): Promise<void>
  createChat(projectId: string): Promise<void>
  removeChat(chatId: string): Promise<void>
  renameChat(chatId: string, title: string): Promise<void>
}

export function useProjects(): ProjectsState {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [openedChatIds, setOpenedChatIds] = useState<string[]>([])

  useEffect(() => {
    void atox.projects.list().then(setProjects)
  }, [])

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

  const removeChat = useCallback(
    async (chatId: string) => applyProjects(await atox.chats.remove(chatId)),
    [applyProjects]
  )

  const renameChat = useCallback(
    async (chatId: string, title: string) => applyProjects(await atox.chats.rename(chatId, title)),
    [applyProjects]
  )

  return {
    projects,
    activeChatId,
    openedChatIds,
    selectChat,
    addProject,
    removeProject,
    createChat,
    removeChat,
    renameChat
  }
}
