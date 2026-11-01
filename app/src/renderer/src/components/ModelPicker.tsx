import { useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { AGENTS, findAgent, isAgentId } from '../../../shared/agents'
import type { ContextMenuItem } from '../../../shared/api'
import type { AgentCatalog, AgentModel } from '../../../shared/conversation'
import type { Chat } from '../../../shared/models'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { useAgentCatalog } from '../hooks/useAgentCatalog'
import { effortLabel } from '../lib/conversationText'
import { AgentIcon } from './AgentIcon'

const { atox } = window

/** Действия меню: `agent:claude`, `model:opus`, `effort:high`; пустой эффорт — по умолчанию. */
type PickerAction = `agent:${string}` | `model:${string}` | `effort:${string}`

interface ModelPickerProps {
  chat: Chat
  /** Разговор уже начат: агента сменить нельзя, только модель и эффорт. */
  started: boolean
}

/** Кнопка «Opus 5.5 High» в поле ввода: системное меню с агентом, моделью и эффортом. */
export function ModelPicker({ chat, started }: ModelPickerProps) {
  const { configureChat } = useProjectsContext()
  const catalog = useAgentCatalog(chat.agent)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const model = catalog && findModel(catalog, chat.model ?? catalog.defaultModel)
  const effort = chat.effort ?? model?.defaultEffort

  const openMenu = async () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    const agents = started ? [] : await atox.agents.available()
    const action = await atox.showContextMenu<PickerAction>(
      buildMenu({ chat, catalog, model, agents }),
      rect && { x: rect.left, y: rect.bottom }
    )
    if (!action) {
      return
    }
    const [kind, value = ''] = splitAction(action)
    if (kind === 'agent' && isAgentId(value)) {
      await configureChat(chat.id, { agent: value })
    } else if (kind === 'model' && catalog) {
      const next = findModel(catalog, value)
      // Эффорт, которого у новой модели нет, сбрасывается на её эффорт по умолчанию.
      const keepEffort = chat.effort !== undefined && next?.efforts.includes(chat.effort)
      await configureChat(chat.id, { model: value, ...(!keepEffort && { effort: null }) })
    } else if (kind === 'effort') {
      await configureChat(chat.id, { effort: value || null })
    }
  }

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

function findModel(catalog: AgentCatalog, id: string): AgentModel | undefined {
  return catalog.models.find((model) => model.id === id)
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

function buildMenu({ chat, catalog, model, agents }: MenuSource): ContextMenuItem<PickerAction>[] {
  const items: ContextMenuItem<PickerAction>[] = []
  const installed = AGENTS.filter(({ id }) => agents.includes(id))
  if (installed.length > 1) {
    items.push(
      ...installed.map(
        (agent): ContextMenuItem<PickerAction> => ({
          action: `agent:${agent.id}`,
          label: agent.name,
          symbol: agent.symbol,
          checked: agent.id === chat.agent
        })
      ),
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

  const modelItem = (option: AgentModel): ContextMenuItem<PickerAction> => ({
    action: `model:${option.id}`,
    label: option.name,
    checked: option.id === model?.id
  })
  const secondary = catalog.models.filter((option) => option.secondary)
  items.push(...catalog.models.filter((option) => !option.secondary).map(modelItem))
  if (secondary.length > 0) {
    items.push({ type: 'submenu', label: 'Other Models', items: secondary.map(modelItem) })
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
        symbol: 'gauge.with.dots.needle.67percent',
        items: [
          { action: 'effort:', label: defaultLabel, checked: chat.effort === undefined },
          { type: 'separator' },
          ...model.efforts.map(
            (level): ContextMenuItem<PickerAction> => ({
              action: `effort:${level}`,
              label: effortLabel(level),
              checked: level === chat.effort
            })
          )
        ]
      }
    )
  }
  return items
}
