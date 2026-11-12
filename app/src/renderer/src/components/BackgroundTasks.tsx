import { useState } from 'react'
import { Bot, ChevronDown, Eye, LoaderCircle, Terminal, Workflow, type LucideIcon } from 'lucide-react'
import type { BackgroundTask, BackgroundTaskKind } from '../../../shared/conversation'

const KIND_ICONS: Record<BackgroundTaskKind, LucideIcon> = {
  shell: Terminal,
  agent: Bot,
  monitor: Eye,
  workflow: Workflow,
  other: LoaderCircle
}

const KIND_LABELS: Record<BackgroundTaskKind, string> = {
  shell: 'Command',
  agent: 'Agent',
  monitor: 'Watching',
  workflow: 'Workflow',
  other: 'Task'
}

/**
 * Над полем ввода — что агент оставил работать в фоне: команды, помощников, слежение за CI.
 * Его ход может уже закончиться, а работа идёт, и он вернётся, когда она завершится.
 */
export function BackgroundTasks({ tasks }: { tasks: readonly BackgroundTask[] }) {
  const [expanded, setExpanded] = useState(true)
  return (
    <section className="background-tasks" data-expanded={expanded} aria-label="Background tasks">
      <button
        type="button"
        className="background-tasks__header"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <LoaderCircle className="background-tasks__spinner" />
        <span className="background-tasks__title">
          {tasks.length === 1 ? '1 task' : `${tasks.length} tasks`} running in the background
        </span>
        <ChevronDown className="background-tasks__chevron" />
      </button>
      {expanded && (
        <ul className="background-tasks__list">
          {tasks.map(({ id, kind, description }) => {
            const Icon = KIND_ICONS[kind]
            return (
              <li key={id} className="background-tasks__item" title={description}>
                <Icon className="background-tasks__icon" />
                <span className="background-tasks__kind">{KIND_LABELS[kind]}</span>
                <span className="background-tasks__description">{description}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
