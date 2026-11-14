import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { ConversationStep, ConversationSummary } from '../../../shared/conversation'
import { workerParentId } from '../../../shared/chats'
import type { Chat, Project, Space } from '../../../shared/models'
import { useChatActivity } from '../hooks/ChatActivityContext'
import { useConversationSummaries } from '../hooks/useConversationSummaries'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { formatDuration, formatTokens, toolVerb } from '../lib/conversationText'
import { formatFullDate, formatRelativeTime } from '../lib/relativeTime'
import { AgentIcon } from './AgentIcon'
import { ChatStatus } from './ChatStatus'

/** Как часто обновлять время работы агентов на экране. */
const CLOCK_TICK_MS = 1000

type GroupId = 'waiting' | 'working'

/**
 * Разделы обзора сверху вниз: сначала то, что ждёт пользователя. Закончившие агенты сюда не
 * попадают: история чатов хранится, и их список только рос бы.
 */
const GROUPS: ReadonlyArray<{ id: GroupId; title: string }> = [
  { id: 'waiting', title: 'Needs you' },
  { id: 'working', title: 'Working' }
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
    // Esc, который уже обработало поле (переименование, поиск), страницу не закрывает.
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
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
        const parent = project.chats.find(({ id }) => id === workerParentId(chat))
        const space = spaces.find(({ id }) => id === project.spaceId)
        return [
          {
            summary,
            chat,
            project,
            ...(space && { space }),
            ...(parent && { parent })
          }
        ]
      }
    }
    // Чат уже удалён, а сводка пришла раньше обновления списка.
    return []
  })
  const isActive = (entry: AgentEntry) => groupOf(entry.summary) !== undefined
  const entryIds = new Set(entries.map(({ chat }) => chat.id))
  /** Работающие помощники чата: они показываются под ним, а не отдельными строками. */
  const helpersOf = (chatId: string) =>
    entries
      .filter((entry) => workerParentId(entry.chat) === chatId && isActive(entry))
      .sort((a, b) => a.summary.startedAt - b.summary.startedAt)
  // Главный чат, который ждёт своих помощников, сам не работает, но в обзоре он главный.
  const rows = entries
    .filter((entry) => {
      const parentId = workerParentId(entry.chat)
      return (
        !(parentId && entryIds.has(parentId)) &&
        (isActive(entry) || helpersOf(entry.chat.id).length > 0)
      )
    })
    .map((entry) => ({ entry, helpers: helpersOf(entry.chat.id) }))
  const rowGroup = ({ entry, helpers }: (typeof rows)[number]): GroupId =>
    groupOf(entry.summary) === 'waiting' || helpers.some(({ summary }) => summary.waitingFor)
      ? 'waiting'
      : 'working'
  const groups = GROUPS.map((group) => ({
    ...group,
    rows: rows
      .filter((row) => rowGroup(row) === group.id)
      .sort(
        (a, b) =>
          Math.max(latestActivity(b.entry.summary), ...b.helpers.map((h) => latestActivity(h.summary))) -
          Math.max(latestActivity(a.entry.summary), ...a.helpers.map((h) => latestActivity(h.summary)))
      )
  })).filter(({ rows: groupRows }) => groupRows.length > 0)

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
            <p className="agents__empty-title">No agents working</p>
            <p className="agents__empty-hint">Agents show up here while they work or wait for you</p>
          </div>
        )}
        {groups.map(({ id, title, rows: groupRows }) => (
          <section key={id} className="agents__group" aria-label={title}>
            <h2 className="agents__group-title">
              {title}
              <span className="agents__group-count">{groupRows.length}</span>
            </h2>
            <ul className="agents__list">
              {groupRows.map(({ entry, helpers }) => (
                <AgentRow
                  key={entry.chat.id}
                  entry={entry}
                  helpers={helpers}
                  now={now}
                  onOpen={onOpenChat}
                />
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
  /** Работающие помощники этого чата — показываются под ним. */
  helpers?: AgentEntry[]
  now: number
  onOpen(chatId: string): void
}

function AgentRow({ entry, helpers = [], now, onOpen }: AgentRowProps) {
  return (
    <li className="agent-group" data-has-helpers={helpers.length > 0}>
      <AgentButton entry={entry} helpers={helpers} now={now} onOpen={onOpen} />
      {helpers.length > 0 && (
        <ul className="agent-group__helpers">
          {helpers.map((helper) => (
            <li key={helper.chat.id}>
              <AgentButton entry={helper} helpers={[]} now={now} onOpen={onOpen} nested />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function AgentButton({
  entry: { summary, chat, project, space, parent },
  helpers,
  now,
  onOpen,
  nested
}: Required<AgentRowProps> & { nested?: boolean }) {
  const status = useChatActivity(chat.id)
  // Чат, который ждёт помощников, показывается работающим, а не законченным.
  const finishedAt = summary.running || helpers.length > 0 ? undefined : summary.finishedAt
  const activity =
    describe(summary) ??
    (helpers.length > 0
      ? `Waiting for ${helpers.length === 1 ? '1 agent' : `${helpers.length} agents`}`
      : undefined)
  const place = nested
    ? [project.name]
    : [space?.name, project.name, ...(parent ? [parent.title] : [])]
  return (
    <button
      type="button"
      className="agent-row"
      data-nested={nested}
      onClick={() => onOpen(chat.id)}
    >
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
        <AgentIcon agent={chat.agent} className="agent-row__agent" />
        {!nested && <span className="agent-row__place">{place.filter(Boolean).join(' | ')}</span>}
        {activity && <span className="agent-row__activity">{activity}</span>}
      </span>
      {summary.turnTokens !== undefined && (
        <span className="agent-row__tokens" title="Tokens written in this answer">
          {formatTokens(summary.turnTokens)} tokens
        </span>
      )}
    </button>
  )
}

function groupOf(summary: ConversationSummary): GroupId | undefined {
  if (summary.waitingFor) {
    return 'waiting'
  }
  return summary.running ? 'working' : undefined
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
