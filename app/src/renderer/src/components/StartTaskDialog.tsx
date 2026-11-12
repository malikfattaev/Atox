import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { BoardIssue, TaskStart } from '../../../shared/board'
import { useSettings } from '../hooks/SettingsContext'
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
  const messageRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messageRef.current?.focus()
  }, [])

  const start = () =>
    onStart({ agent, ...(message.trim() && { message: message.trim() }) })

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
