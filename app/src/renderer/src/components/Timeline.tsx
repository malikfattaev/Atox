import { useEffect, useState, type ComponentType } from 'react'
import {
  Bot,
  Brain,
  ChevronRight,
  CircleAlert,
  FilePen,
  FileText,
  Globe,
  LoaderCircle,
  Search,
  SquareTerminal,
  Wrench,
  type LucideProps
} from 'lucide-react'
import type { TimelineItem, ToolKind } from '../../../shared/conversation'
import type { AgentId } from '../../../shared/agents'
import {
  formatDuration,
  formatTokens,
  summarizeActivity,
  toolVerb,
  workingLabel
} from '../lib/conversationText'
import { AgentIcon } from './AgentIcon'
import { Markdown } from './Markdown'

type UserItem = Extract<TimelineItem, { kind: 'user' }>
type ActivityItem = Extract<TimelineItem, { kind: 'tool' | 'reasoning' }>

type Block =
  | { type: 'user'; item: UserItem }
  | { type: 'assistant'; item: Extract<TimelineItem, { kind: 'assistant' }> }
  | { type: 'error'; item: Extract<TimelineItem, { kind: 'error' }> }
  | { type: 'activity'; key: string; items: ActivityItem[] }
  /** Конец ответа на сообщение: сколько агент работал или что он работает сейчас. */
  | { type: 'turn'; key: string; user: UserItem; items: TimelineItem[] }

const TOOL_ICONS: Record<ToolKind, ComponentType<LucideProps>> = {
  command: SquareTerminal,
  edit: FilePen,
  read: FileText,
  search: Search,
  web: Globe,
  agent: Bot,
  other: Wrench
}

/** Как часто обновлять секундомер работающего агента. */
const CLOCK_INTERVAL_MS = 1000

interface TimelineProps {
  items: readonly TimelineItem[]
  running: boolean
  agent: AgentId
  /** Сколько токенов агент написал, отвечая на текущее сообщение. */
  turnTokens: number
}

export function Timeline({ items, running, agent, turnTokens }: TimelineProps) {
  const blocks = buildBlocks(items)
  const lastTurn = blocks.findLast((block) => block.type === 'turn')
  return (
    <div className="timeline">
      {blocks.map((block) => {
        switch (block.type) {
          case 'user':
            return (
              <div key={block.item.id} className="message message--user">
                {block.item.text}
              </div>
            )
          case 'assistant':
            return (
              <Markdown
                key={block.item.id}
                text={block.item.text}
                preserveLineBreaks={block.item.commandOutput}
              />
            )
          case 'error':
            return (
              <div key={block.item.id} className="message message--error" role="alert">
                <CircleAlert className="icon" />
                <span>{block.item.message}</span>
              </div>
            )
          case 'activity':
            return (
              <ActivityGroup
                key={block.key}
                items={block.items}
                live={running && block === lastActivity(blocks)}
              />
            )
          case 'turn':
            return (
              <TurnStatus
                key={block.key}
                user={block.user}
                items={block.items}
                agent={agent}
                tokens={turnTokens}
                working={running && block === lastTurn && !block.user.finishedAt}
              />
            )
        }
      })}
    </div>
  )
}

/** Разбивает ленту на блоки: подряд идущие действия агента сворачиваются в одну группу. */
function buildBlocks(items: readonly TimelineItem[]): Block[] {
  const blocks: Block[] = []
  let activity: ActivityItem[] = []
  let turn: UserItem | null = null
  let turnItems: TimelineItem[] = []

  const flushActivity = () => {
    if (activity.length > 0) {
      blocks.push({ type: 'activity', key: activity[0]!.id, items: activity })
      activity = []
    }
  }
  const finishTurn = () => {
    flushActivity()
    if (turn) {
      blocks.push({ type: 'turn', key: `${turn.id}:turn`, user: turn, items: turnItems })
    }
  }

  for (const item of items) {
    if (item.kind !== 'user') {
      turnItems.push(item)
    }
    switch (item.kind) {
      case 'user':
        finishTurn()
        turn = item
        turnItems = []
        blocks.push({ type: 'user', item })
        continue
      case 'reasoning':
        // Codex создаёт рассуждение раньше, чем пишет в него текст.
        if (item.text.trim()) {
          activity.push(item)
        }
        break
      case 'tool':
        activity.push(item)
        break
      case 'assistant':
        flushActivity()
        if (item.text) {
          blocks.push({ type: 'assistant', item })
        }
        break
      case 'error':
        flushActivity()
        blocks.push({ type: 'error', item })
        break
    }
  }
  finishTurn()
  return blocks
}

function lastActivity(blocks: readonly Block[]): Block | undefined {
  const last = blocks.findLast((block) => block.type !== 'turn')
  return last?.type === 'activity' ? last : undefined
}

interface ActivityGroupProps {
  items: readonly ActivityItem[]
  /** Агент работает именно в этой группе: показываем, что он делает сейчас. */
  live: boolean
}

function ActivityGroup({ items, live }: ActivityGroupProps) {
  const [expanded, setExpanded] = useState(false)
  const current = live ? items.findLast((item) => item.kind === 'tool') : undefined
  const summary =
    current?.kind === 'tool' && current.status === 'running'
      ? `${toolVerb(current.tool, true)} ${current.title}`
      : summarizeActivity(items)

  return (
    <div className="activity" data-expanded={expanded}>
      <button
        type="button"
        className="activity__summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {live ? (
          <LoaderCircle className="icon activity__spinner" />
        ) : (
          <ChevronRight className="icon activity__chevron" />
        )}
        <span className="activity__summary-text">{summary}</span>
      </button>
      {expanded && (
        <ul className="activity__list">
          {items.map((item) => (
            <ActivityRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const [open, setOpen] = useState(false)
  const details = item.kind === 'reasoning' ? item.text : item.output
  const Icon = item.kind === 'reasoning' ? Brain : TOOL_ICONS[item.tool]
  const status = item.kind === 'tool' ? item.status : 'done'

  return (
    <li className="activity-row" data-status={status}>
      <button
        type="button"
        className="activity-row__header"
        disabled={!details}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {status === 'running' ? (
          <LoaderCircle className="icon activity__spinner" />
        ) : (
          <Icon className="icon" />
        )}
        {item.kind === 'reasoning' ? (
          <span className="activity-row__verb">Thought</span>
        ) : (
          <>
            <span className="activity-row__verb">{toolVerb(item.tool, status === 'running')}</span>
            <span
              className="activity-row__title"
              data-code={item.tool === 'command' || undefined}
              title={item.title}
            >
              {item.title}
            </span>
          </>
        )}
        {status === 'failed' && <CircleAlert className="icon activity-row__failed" />}
      </button>
      {open && details && (
        <pre className="activity-row__details" data-prose={item.kind === 'reasoning' || undefined}>
          {details}
        </pre>
      )}
    </li>
  )
}

interface TurnStatusProps {
  user: UserItem
  /** Что агент уже сделал, отвечая на сообщение: по последнему видно, чем он занят. */
  items: readonly TimelineItem[]
  agent: AgentId
  tokens: number
  working: boolean
}

function TurnStatus({ user, items, agent, tokens, working }: TurnStatusProps) {
  const now = useClock(working)
  if (working) {
    const elapsed = formatDuration(now - user.createdAt)
    return (
      <div className="turn-status" data-working>
        <AgentIcon agent={agent} className="turn-status__glyph" />
        <span className="turn-status__verb">{workingLabel(items, user.id)}…</span>
        <span className="turn-status__meta">
          ({elapsed}
          {tokens > 0 && ` · ↓ ${formatTokens(tokens)} tokens`})
        </span>
      </div>
    )
  }
  return user.finishedAt ? (
    <div className="turn-status">Worked for {formatDuration(user.finishedAt - user.createdAt)}</div>
  ) : null
}

/** Текущее время, которое обновляется каждую секунду, пока `active`. */
function useClock(active: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) {
      return
    }
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [active])
  return now
}
