import { useEffect, useRef } from 'react'
import { ChevronDown, Gauge } from 'lucide-react'
import { AGENTS, findAgent, isAgentId } from '../../../shared/agents'
import type { AgentCatalog, AgentModel } from '../../../shared/conversation'
import type { Chat } from '../../../shared/models'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { useAgentCatalog } from '../hooks/useAgentCatalog'
import { effortLabel } from '../lib/conversationText'
import { showMenu, type MenuItem } from '../lib/menu'
import { currentModel, modelConfiguration } from '../lib/modelSelection'
import { AgentIcon } from './AgentIcon'

const { atox } = window

/** Действия меню: `agent:claude`, `model:opus`, `effort:high`; пустой эффорт — по умолчанию. */
type PickerAction = `agent:${string}` | `model:${string}` | `effort:${string}`

interface ModelPickerProps {
  chat: Chat
  /** Растёт, когда меню просят открыть без клика — командой `/model` или `/effort`. */
  openRequest: number
}

/** Кнопка «Opus 5.5 High» в поле ввода: меню с агентом, моделью и эффортом. */
export function ModelPicker({ chat, openRequest }: ModelPickerProps) {
  const { configureChat } = useProjectsContext()
  const catalog = useAgentCatalog(chat.agent)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const model = catalog && currentModel(chat, catalog)
  const effort = chat.effort ?? model?.defaultEffort

  const openMenu = async () => {
    const button = buttonRef.current
    if (!button) {
      return
    }
    // Агента можно сменить в любой момент: новый продолжит разговор с того же места.
    const agents = await atox.agents.available()
    const action = await showMenu(buildMenu({ chat, catalog, model, agents }), button)
    if (!action) {
      return
    }
    const [kind, value = ''] = splitAction(action)
    if (kind === 'agent' && isAgentId(value)) {
      await configureChat(chat.id, { agent: value })
    } else if (kind === 'model' && catalog) {
      await configureChat(chat.id, modelConfiguration(chat, catalog, value))
    } else if (kind === 'effort') {
      await configureChat(chat.id, { effort: value || null })
    }
  }

  // Последняя версия openMenu: эффект ниже срабатывает только на новый запрос открыть меню.
  const openMenuRef = useRef(openMenu)
  openMenuRef.current = openMenu
  useEffect(() => {
    if (openRequest > 0) {
      void openMenuRef.current()
    }
  }, [openRequest])

  const agentName = findAgent(chat.agent)?.name ?? chat.agent
  const label =
    catalog === undefined
      ? agentName
      : `${model?.name ?? chat.model ?? agentName}${effort ? ` ${effortLabel(effort)}` : ''}`

  return (
    <button
      ref={buttonRef}
      type="button"
      className="model-picker"
      title="Choose the model"
      onClick={() => void openMenu()}
    >
      <AgentIcon agent={chat.agent} className="agent-icon" />
      <span className="model-picker__label">{label}</span>
      <ChevronDown className="icon model-picker__chevron" />
    </button>
  )
}

function splitAction(action: PickerAction): [string, string] {
  const separator = action.indexOf(':')
  return [action.slice(0, separator), action.slice(separator + 1)]
}

interface MenuSource {
  chat: Chat
  catalog: AgentCatalog | null | undefined
  model: AgentModel | null | undefined
  /** Установленные агенты; пустой список — выбор агента не показывается. */
  agents: string[]
}

function buildMenu({ chat, catalog, model, agents }: MenuSource): MenuItem<PickerAction>[] {
  const items: MenuItem<PickerAction>[] = []
  const installed = AGENTS.filter(({ id }) => agents.includes(id))
  if (installed.length > 1) {
    items.push(
      ...installed.map((agent): MenuItem<PickerAction> => ({
        action: `agent:${agent.id}`,
        label: agent.name,
        icon: <AgentIcon agent={agent.id} />,
        checked: agent.id === chat.agent
      })),
      { type: 'separator' }
    )
  }

  if (!catalog) {
    items.push({
      action: 'model:',
      label: catalog === null ? 'Models are unavailable' : 'Loading models…',
      enabled: false
    })
    return items
  }

  const modelItem = (option: AgentModel): MenuItem<PickerAction> => ({
    action: `model:${option.id}`,
    label: option.name,
    checked: option.id === model?.id
  })
  const secondary = catalog.models.filter((option) => option.secondary)
  items.push(...catalog.models.filter((option) => !option.secondary).map(modelItem))
  if (secondary.length > 0) {
    items.push({
      type: 'submenu',
      label: 'Other Models',
      items: secondary.map(modelItem)
    })
  }

  if (model && model.efforts.length > 0) {
    const defaultLabel = model.defaultEffort
      ? `Default (${effortLabel(model.defaultEffort)})`
      : 'Default'
    items.push(
      { type: 'separator' },
      {
        type: 'submenu',
        label: 'Effort',
        icon: <Gauge />,
        items: [
          {
            action: 'effort:',
            label: defaultLabel,
            checked: chat.effort === undefined
          },
          { type: 'separator' },
          ...model.efforts.map((level): MenuItem<PickerAction> => ({
            action: `effort:${level}`,
            label: effortLabel(level),
            checked: level === chat.effort
          }))
        ]
      }
    )
  }
  return items
}
