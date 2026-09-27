import { useEffect, useRef } from 'react'
import type { AppCommand } from '../../../shared/commands'
import type { ProjectsState } from './useProjects'

/** ⌘1…⌘9 выбирают чат по номеру в сайдбаре. */
const CHAT_NUMBER_KEYS = /^[1-9]$/

interface AppCommandHandlers {
  projects: ProjectsState
  toggleSidebar(): void
}

export function useAppCommands({ projects, toggleSidebar }: AppCommandHandlers): void {
  // Подписка живёт всё время работы окна и читает актуальное состояние через ref.
  const handlersRef = useRef({ projects, toggleSidebar })
  handlersRef.current = { projects, toggleSidebar }

  useEffect(() => {
    const selectRelative = (step: number) => {
      const { orderedChatIds, activeChatId, selectChat } = handlersRef.current.projects
      if (orderedChatIds.length === 0) {
        return
      }
      const current = activeChatId ? orderedChatIds.indexOf(activeChatId) : -1
      const next = (current + step + orderedChatIds.length) % orderedChatIds.length
      selectChat(orderedChatIds[next]!)
    }

    const execute = (command: AppCommand) => {
      const { currentProjectId, activeChatId, createChat, addProject, removeChat } =
        handlersRef.current.projects
      switch (command.type) {
        case 'new-chat':
          if (currentProjectId) {
            void createChat(currentProjectId)
          }
          break
        case 'open-project':
          void addProject()
          break
        case 'close-chat':
          if (activeChatId) {
            void removeChat(activeChatId)
          }
          break
        case 'toggle-sidebar':
          handlersRef.current.toggleSidebar()
          break
        case 'previous-chat':
          selectRelative(-1)
          break
        case 'next-chat':
          selectRelative(1)
          break
      }
    }

    // Перехват на этапе погружения: иначе нажатие съест сфокусированный терминал.
    const selectByNumber = (event: KeyboardEvent) => {
      if (!event.metaKey || event.shiftKey || event.altKey || !CHAT_NUMBER_KEYS.test(event.key)) {
        return
      }
      const chatId = handlersRef.current.projects.orderedChatIds[Number(event.key) - 1]
      if (chatId) {
        event.preventDefault()
        event.stopPropagation()
        handlersRef.current.projects.selectChat(chatId)
      }
    }

    const unsubscribe = window.atox.commands.subscribe(execute)
    window.addEventListener('keydown', selectByNumber, true)
    return () => {
      unsubscribe()
      window.removeEventListener('keydown', selectByNumber, true)
    }
  }, [])
}
