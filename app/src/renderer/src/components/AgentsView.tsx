import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { ConversationStep, ConversationSummary } from '../../../shared/conversation'
import type { Chat, Project, Space } from '../../../shared/models'
import { useChatActivity } from '../hooks/ChatActivityContext'
import { useConversationSummaries } from '../hooks/useConversationSummaries'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { formatDuration, formatTokens, toolVerb } from '../lib/conversationText'
import { formatFullDate, formatRelativeTime } from '../lib/relativeTime'
import { ChatStatus } from './ChatStatus'

/** Как часто обновлять время работы агентов на экране. */
const CLOCK_TICK_MS = 1000

type GroupId = 'waiting' | 'working' | 'finished'

/** Разделы обзора сверху вниз: сначала то, что ждёт пользователя. */
const GROUPS: ReadonlyArray<{ id: GroupId; title: string }> = [
  { id: 'waiting', title: 'Needs you' },
  { id: 'working', title: 'Working' },
  { id: 'finished', title: 'Finished' }
]

/** Что агент ждёт, если он не назвал запрос сам. */
const REQUEST_LABELS = {
  approval: 'Waiting for approval',
  question: 'Waiting for your answer'
} as const

interface AgentEntry {
  summary: ConversationSummary
  chat: Chat
  project: Project
  /** Пространство проекта; нет — пространства ещё не загрузились. */
  space?: Space
  /** Чат, агент которого запустил этого помощника. */
  parent?: Chat
}

interface AgentsViewProps {
  onOpenChat(chatId: string): void
  onClose(): void
}

/** Обзор всех агентов: кто ждёт ответа, кто работает и кто уже закончил. */
export function AgentsView({ onOpenChat, onClose }: AgentsViewProps) {
  const { projects, spaces } = useProjectsContext()
  const summaries = useConversationSummaries()
  const now = useClock()

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const entries = (summaries ?? []).flatMap((summary): AgentEntry[] => {
    for (const project of projects) {
      const chat = project.chats.find(({ id }) => id === summary.chatId)
      if (chat) {
        const parent = project.chats.find(({ id }) => id === chat.parentChatId)
        const space = spaces.find(({ id }) => id === project.spaceId)
        return [{ summary, chat, project, ...(space && { space }), ...(parent && { parent }) }]
      }
    }
    // Чат уже удалён, а сводка пришла раньше обновления списка.
    return []
  })
  const groups = GROUPS.map((group) => ({
    ...group,
    entries: entries
      .filter((entry) => groupOf(entry.summary) === group.id)
      .sort((a, b) => latestActivity(b.summary) - latestActivity(a.summary))
  })).filter(({ entries: groupEntries }) => groupEntries.length > 0)

  return (
    <section className="agents" aria-labelledby="agents-title">
      <header className="agents__header">
        <h1 id="agents-title" className="agents__title">
          Agents
        </h1>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <X className="icon" />
        </button>
      </header>

      <div className="agents__body">
        {summaries && groups.length === 0 && (
          <div className="agents__empty">
            <p className="agents__empty-title">No agents yet</p>
            <p className="agents__empty-hint">Chats you start show up here while Atox is open</p>
          </div>
        )}
        {groups.map(({ id, title, entries: groupEntries }) => (
          <section key={id} className="agents__group" aria-label={title}>
            <h2 className="agents__group-title">
              {title}
              <span className="agents__group-count">{groupEntries.length}</span>
            </h2>
            <ul className="agents__list">
              {groupEntries.map((entry) => (
                <AgentRow key={entry.chat.id} entry={entry} now={now} onOpen={onOpenChat} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  )
}

interface AgentRowProps {
  entry: AgentEntry
  now: number
  onOpen(chatId: string): void
}

function AgentRow({
  entry: { summary, chat, project, space, parent },
  now,
  onOpen
}: AgentRowProps) {
  const status = useChatActivity(chat.id)
  const finishedAt = summary.running ? undefined : summary.finishedAt
  const activity = describe(summary)
  return (
    <li>
      <button type="button" className="agent-row" onClick={() => onOpen(chat.id)}>
        <ChatStatus status={status} />
        <span className="agent-row__title">{chat.title}</span>
        {finishedAt === undefined ? (
          <span className="agent-row__time" title="Working for">
            {formatDuration(now - summary.startedAt)}
          </span>
        ) : (
          <time className="agent-row__time" title={formatFullDate(finishedAt)}>
            {formatRelativeTime(finishedAt, now)}
          </time>
        )}
        <span className="agent-row__detail" data-waiting={Boolean(summary.waitingFor)}>
          <span className="agent-row__place">
            {[space?.name, project.name, parent?.title].filter(Boolean).join(' | ')}
          </span>
          {activity && <span className="agent-row__activity">{activity}</span>}
        </span>
        {summary.turnTokens !== undefined && (
          <span className="agent-row__tokens" title="Tokens written in this answer">
            {formatTokens(summary.turnTokens)} tokens
          </span>
        )}
      </button>
    </li>
  )
}

function groupOf(summary: ConversationSummary): GroupId {
  if (summary.waitingFor) {
    return 'waiting'
  }
  return summary.running ? 'working' : 'finished'
}

function latestActivity(summary: ConversationSummary): number {
  return summary.finishedAt ?? summary.startedAt
}

/** Чем занят агент или чем закончил, одной строкой. */
function describe(summary: ConversationSummary): string | undefined {
  if (summary.waitingFor) {
    return summary.step?.kind === 'request' && summary.step.title
      ? summary.step.title
      : REQUEST_LABELS[summary.waitingFor]
  }
  if (summary.running) {
    return summary.step ? describeStep(summary.step) : 'Starting'
  }
  return summary.reply
}

function describeStep(step: ConversationStep): string {
  switch (step.kind) {
    case 'tool':
      return `${toolVerb(step.tool, true)} ${step.title}`
    case 'thinking':
      return 'Thinking'
    case 'writing':
      return 'Writing'
    case 'compacting':
      return 'Compacting'
    case 'request':
      return step.title || REQUEST_LABELS[step.request]
  }
}

/** Текущее время, которое тикает, пока обзор открыт: время работы агентов идёт на глазах. */
function useClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => clearInterval(timer)
  }, [])
  return now
}
