import { useEffect, useState, type MouseEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { AGENTS, findAgent, isAgentId, type AgentId } from '../../../shared/agents'
import type { TaskAgent } from '../../../shared/board'
import type { AgentModel } from '../../../shared/conversation'
import { useAgentCatalog } from '../hooks/useAgentCatalog'
import { effortLabel } from '../lib/conversationText'
import { showMenu, type MenuItem } from '../lib/menu'
import { findModel } from '../lib/modelSelection'
import { AgentIcon } from './AgentIcon'

/** Пункт «по умолчанию» в меню модели и эффорта. */
const DEFAULT = ''

interface TaskAgentPickerProps {
  value: TaskAgent
  onChange(value: TaskAgent): void
}

/**
 * Три кнопки — агент, модель, эффорт — для задачи с доски. Без выбранной модели или эффорта
 * агент берёт свои по умолчанию; это видно в подписи: «Default (Opus 5.5)».
 */
export function TaskAgentPicker({ value, onChange }: TaskAgentPickerProps) {
  const catalog = useAgentCatalog(value.agent)
  const [installed, setInstalled] = useState<AgentId[]>([])

  useEffect(() => {
    void window.atox.agents.available().then(setInstalled)
  }, [])

  const defaultModel = catalog ? findModel(catalog, catalog.defaultModel) : undefined
  const model: AgentModel | undefined = catalog
    ? findModel(catalog, value.model ?? catalog.defaultModel)
    : undefined
  const efforts = model?.efforts ?? []

  const chooseAgent = async (event: MouseEvent<HTMLButtonElement>) => {
    const agents = AGENTS.filter(({ id }) => installed.includes(id))
    const choice = await showMenu<string>(
      agents.map(({ id, name }) => ({
        action: id,
        label: name,
        icon: <AgentIcon agent={id} />,
        checked: id === value.agent
      })),
      event.currentTarget
    )
    // У другого агента свои модели: выбор модели и эффорта начинается заново.
    if (isAgentId(choice) && choice !== value.agent) {
      onChange({ agent: choice })
    }
  }

  const chooseModel = async (event: MouseEvent<HTMLButtonElement>) => {
    const items: MenuItem<string>[] = catalog
      ? [
          {
            action: DEFAULT,
            label: defaultModel ? `Default (${defaultModel.name})` : 'Default',
            checked: value.model === undefined
          },
          { type: 'separator' },
          ...catalog.models.map((option) => ({
            action: option.id,
            label: option.name,
            checked: option.id === value.model
          }))
        ]
      : [
          {
            action: DEFAULT,
            label: catalog === null ? 'Models are unavailable' : 'Loading models…',
            enabled: false
          }
        ]
    const choice = await showMenu(items, event.currentTarget)
    if (choice === null || !catalog) {
      return
    }
    const next = choice === DEFAULT ? undefined : choice
    const nextModel = findModel(catalog, next ?? catalog.defaultModel)
    // Эффорт, которого у новой модели нет, сбрасывается на её по умолчанию.
    const keepEffort = value.effort !== undefined && nextModel?.efforts.includes(value.effort)
    onChange({
      agent: value.agent,
      ...(next && { model: next }),
      ...(keepEffort && { effort: value.effort })
    })
  }

  const chooseEffort = async (event: MouseEvent<HTMLButtonElement>) => {
    const choice = await showMenu<string>(
      [
        {
          action: DEFAULT,
          label: model?.defaultEffort ? `Default (${effortLabel(model.defaultEffort)})` : 'Default',
          checked: value.effort === undefined
        },
        { type: 'separator' },
        ...efforts.map((level) => ({
          action: level,
          label: effortLabel(level),
          checked: level === value.effort
        }))
      ],
      event.currentTarget
    )
    if (choice !== null) {
      const { effort: _previous, ...rest } = value
      onChange(choice === DEFAULT ? rest : { ...rest, effort: choice })
    }
  }

  const modelLabel =
    value.model !== undefined
      ? (model?.name ?? value.model)
      : defaultModel
        ? `Default (${defaultModel.name})`
        : 'Default'
  const effortText =
    value.effort !== undefined
      ? effortLabel(value.effort)
      : model?.defaultEffort
        ? `Default (${effortLabel(model.defaultEffort)})`
        : 'Default'

  return (
    <div className="task-agent">
      <button type="button" className="task-agent__button" onClick={(e) => void chooseAgent(e)}>
        <AgentIcon agent={value.agent} className="task-agent__icon" />
        <span className="task-agent__value">{findAgent(value.agent)?.name ?? value.agent}</span>
        <ChevronDown className="task-agent__chevron" />
      </button>
      <button type="button" className="task-agent__button" onClick={(e) => void chooseModel(e)}>
        <span className="task-agent__label">Model</span>
        <span className="task-agent__value">{modelLabel}</span>
        <ChevronDown className="task-agent__chevron" />
      </button>
      {efforts.length > 0 && (
        <button type="button" className="task-agent__button" onClick={(e) => void chooseEffort(e)}>
          <span className="task-agent__label">Effort</span>
          <span className="task-agent__value">{effortText}</span>
          <ChevronDown className="task-agent__chevron" />
        </button>
      )}
    </div>
  )
}
