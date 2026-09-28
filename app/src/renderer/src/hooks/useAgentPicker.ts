import { useCallback } from 'react'
import { findAgent } from '../../../shared/agents'
import { useProjectsContext } from './ProjectsContext'
import { useSettings } from './SettingsContext'

const { atox } = window

/**
 * Новый чат с выбором агента: системное меню со списком установленных агентов,
 * галочка стоит на агенте по умолчанию — последнем выбранном.
 */
export function useAgentPicker(): (projectId: string) => Promise<void> {
  const { createChat } = useProjectsContext()
  const { defaultAgent } = useSettings()

  return useCallback(
    async (projectId: string) => {
      const available = await atox.agents.available()
      const agent = await atox.showContextMenu(
        available.flatMap((id) => {
          const option = findAgent(id)
          return option
            ? [{ action: id, label: option.name, symbol: option.symbol, checked: id === defaultAgent }]
            : []
        })
      )
      if (agent) {
        await createChat(projectId, agent)
      }
    },
    [createChat, defaultAgent]
  )
}
