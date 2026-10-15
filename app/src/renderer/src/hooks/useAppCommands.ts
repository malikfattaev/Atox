import { useEffect, useRef } from 'react'
import type { AppCommand } from '../../../shared/commands'
import { SHORTCUT_RECORDER_ATTRIBUTE } from '../components/ShortcutRecorder'
import type { ProjectsState } from './useProjects'

/**
 * ⌘1…⌘9 выбирают чат по номеру в сайдбаре, ⌃1…⌃9 — пространство. Цифра берётся по положению
 * клавиши, поэтому сочетания одинаково работают на любой раскладке.
 */
const NUMBER_KEY_CODE = /^Digit([1-9])$/

interface AppCommandHandlers {
  projects: ProjectsState
  toggleSidebar(): void
  openFind(chatId: string): void
  openSettings(): void
}

export function useAppCommands(handlers: AppCommandHandlers): void {
  // Подписка живёт всё время работы окна и читает актуальное состояние через ref.
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

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
        case 'open-settings':
          handlersRef.current.openSettings()
          break
        case 'find':
          if (activeChatId) {
            handlersRef.current.openFind(activeChatId)
          }
          break
      }
    }

    // Перехват на этапе погружения: иначе нажатие съест сфокусированный терминал.
    const selectByNumber = (event: KeyboardEvent) => {
      const digit = NUMBER_KEY_CODE.exec(event.code)?.[1]
      // Нужен ровно один из ⌘ и ⌃, без других модификаторов.
      if (!digit || event.shiftKey || event.altKey || event.metaKey === event.ctrlKey) {
        return
      }
      // Сочетание, которое записывают в настройках, — не команда.
      if (
        event.target instanceof Element &&
        event.target.closest(`[${SHORTCUT_RECORDER_ATTRIBUTE}]`)
      ) {
        return
      }
      const { projects } = handlersRef.current
      const index = Number(digit) - 1
      const chatId = event.metaKey ? projects.orderedChatIds[index] : undefined
      const spaceId = event.ctrlKey ? projects.spaces[index]?.id : undefined
      if (chatId || spaceId) {
        event.preventDefault()
        event.stopPropagation()
      }
      if (chatId) {
        projects.selectChat(chatId)
      } else if (spaceId) {
        projects.selectSpace(spaceId)
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
