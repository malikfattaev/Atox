import { useEffect, useRef } from 'react'
import type { AppCommand } from '../../../shared/commands'
import { IS_MAC } from '../../../shared/platform'
import { SHORTCUT_RECORDER_ATTRIBUTE } from '../components/ShortcutRecorder'
import type { ProjectsState } from './useProjects'

/**
 * ⌘1…⌘9 (на Linux — Alt+1…Alt+9) выбирают чат по номеру в сайдбаре, ⌃1…⌃9 — пространство.
 * Цифра берётся по положению клавиши, поэтому сочетания одинаково работают на любой раскладке.
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
      const chatModifier = IS_MAC ? event.metaKey : event.altKey
      const otherModifier = IS_MAC ? event.altKey : event.metaKey
      // Нужен ровно один из модификаторов чата и пространства, без других.
      if (!digit || event.shiftKey || otherModifier || chatModifier === event.ctrlKey) {
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
      const chatId = chatModifier ? projects.orderedChatIds[index] : undefined
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
