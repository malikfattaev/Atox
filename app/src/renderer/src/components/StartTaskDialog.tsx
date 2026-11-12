import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { ChevronDown, Folder, X } from 'lucide-react'
import type { BoardIssue, TaskStart } from '../../../shared/board'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { useSettings } from '../hooks/SettingsContext'
import { showMenu } from '../lib/menu'
import { formatAccelerator } from '../../../shared/shortcuts'
import { TaskAgentPicker } from './TaskAgentPicker'

/** Запуск из поля сообщения — как отправка в чате с модификатором. */
const START_ACCELERATOR = 'CommandOrControl+Enter'

interface StartTaskDialogProps {
  issue: BoardIssue
  /** Issue открыл не пользователь: агент получит текст чужого человека. */
  foreignAuthor: boolean
  /** Сколько агентов доски уже работает и сколько можно. */
  working: number
  limit: number
  onStart(start: TaskStart): void
  onClose(): void
}

/**
 * Окно перед запуском задачи: с каким агентом, моделью и эффортом её делать и что сказать
 * агенту от себя. По умолчанию — агент доски из настроек.
 */
export function StartTaskDialog({
  issue,
  foreignAuthor,
  working,
  limit,
  onStart,
  onClose
}: StartTaskDialogProps) {
  const { boardAgent } = useSettings()
  const [agent, setAgent] = useState(boardAgent)
  const [message, setMessage] = useState('')
  // Проект, под которым появится чат; нет — проект репозитория задачи.
  const [projectId, setProjectId] = useState<string | undefined>()
  const [defaultProjectId, setDefaultProjectId] = useState<string | null | undefined>()
  const { projects } = useProjectsContext()
  const messageRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messageRef.current?.focus()
    void window.atox.board.defaultProject(issue.repository).then(setDefaultProjectId)
  }, [issue.repository])

  const start = () =>
    onStart({
      agent,
      ...(message.trim() && { message: message.trim() }),
      ...(projectId && { projectId })
    })

  const repositoryName = issue.repository.split('/')[1]
  const defaultProject = projects.find(({ id }) => id === defaultProjectId)
  const chosenProject = projects.find(({ id }) => id === projectId)
  const defaultLabel = defaultProject
    ? `Default (${defaultProject.name})`
    : defaultProjectId === null
      ? `Default (new project ${repositoryName})`
      : 'Default'

  const chooseProject = async (event: MouseEvent<HTMLButtonElement>) => {
    const choice = await showMenu<string>(
      [
        { action: '', label: defaultLabel, checked: !chosenProject },
        { type: 'separator' },
        ...projects.map(({ id, name }) => ({
          action: id,
          label: name,
          icon: <Folder />,
          checked: id === chosenProject?.id
        }))
      ],
      event.currentTarget
    )
    if (choice !== null) {
      setProjectId(choice || undefined)
    }
  }

  useEffect(() => {
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        // Esc закрывает окно, а не доску под ним.
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const note =
    working >= limit
      ? `All ${limit} agents are busy, so the task waits in Queue for a free one.`
      : 'The agent starts right away.'

  return (
    <div className="modal" role="presentation" onMouseDown={onClose}>
      <div
        className="modal__dialog start-task"
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-task-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          <div className="start-task__heading">
            <h2 id="start-task-title" className="modal__title">
              Start an agent
            </h2>
            <p className="start-task__issue">
              <img className="start-task__avatar" src={issue.ownerAvatarUrl} alt="" />
              <span className="start-task__repository">{issue.repository.split('/')[1]}</span>
              <span className="start-task__number">#{issue.number}</span>
              <span className="start-task__title">{issue.title}</span>
            </p>
            {foreignAuthor && (
              <p className="start-task__author">
                Opened by {issue.author}. The agent reads the issue as its task, so check it
                first.
              </p>
            )}
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X className="icon" />
          </button>
        </header>

        <div className="start-task__body">
          <section className="start-task__section">
            <h3 className="start-task__label">Agent</h3>
            <TaskAgentPicker value={agent} onChange={setAgent} />
          </section>

          <section className="start-task__section">
            <h3 className="start-task__label">Project in the sidebar</h3>
            <div className="task-agent">
              <button
                type="button"
                className="task-agent__button"
                onClick={(event) => void chooseProject(event)}
              >
                <Folder className="task-agent__icon" />
                <span className="task-agent__value">
                  {chosenProject ? chosenProject.name : defaultLabel}
                </span>
                <ChevronDown className="task-agent__chevron" />
              </button>
            </div>
            {chosenProject && chosenProject.id !== defaultProjectId && (
              <p className="start-task__hint">
                The chat is listed under {chosenProject.name}. The agent still works in its own git
                worktree of {repositoryName}, so the changes don’t touch that folder.
              </p>
            )}
          </section>

          <section className="start-task__section">
            <label className="start-task__label" htmlFor="start-task-message">
              Message to the agent <span className="start-task__optional">optional</span>
            </label>
            <textarea
              id="start-task-message"
              ref={messageRef}
              className="start-task__message"
              rows={4}
              placeholder="Anything the issue doesn’t say: where to look, what to avoid, how to test…"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  start()
                }
              }}
            />
          </section>
        </div>

        <footer className="modal__footer">
          <span className="modal__note">{note}</span>
          <button type="button" className="settings__button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="settings__button settings__button--primary"
            title={formatAccelerator(START_ACCELERATOR)}
            onClick={start}
          >
            Start Agent
          </button>
        </footer>
      </div>
    </div>
  )
}
