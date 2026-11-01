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
import { formatDuration, summarizeActivity, toolVerb } from '../lib/conversationText'
import { Markdown } from './Markdown'

type UserItem = Extract<TimelineItem, { kind: 'user' }>
type ActivityItem = Extract<TimelineItem, { kind: 'tool' | 'reasoning' }>

type Block =
  | { type: 'user'; item: UserItem }
  | { type: 'assistant'; item: Extract<TimelineItem, { kind: 'assistant' }> }
  | { type: 'error'; item: Extract<TimelineItem, { kind: 'error' }> }
  | { type: 'activity'; key: string; items: ActivityItem[] }
  /** Конец ответа на сообщение: сколько агент работал или что он работает сейчас. */
  | { type: 'turn'; key: string; user: UserItem }

const TOOL_ICONS: Record<ToolKind, ComponentType<LucideProps>> = {
  command: SquareTerminal,
  edit: FilePen,
  read: FileText,
  search: Search,
  web: Globe,
  agent: Bot,
  other: Wrench
}

/** Как часто обновлять «Working… 12s». */
const CLOCK_INTERVAL_MS = 1000

interface TimelineProps {
  items: readonly TimelineItem[]
  running: boolean
}

export function Timeline({ items, running }: TimelineProps) {
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

  const flushActivity = () => {
    if (activity.length > 0) {
      blocks.push({ type: 'activity', key: activity[0]!.id, items: activity })
      activity = []
    }
  }
  const finishTurn = () => {
    flushActivity()
    if (turn) {
      blocks.push({ type: 'turn', key: `${turn.id}:turn`, user: turn })
    }
  }

  for (const item of items) {
    switch (item.kind) {
      case 'user':
        finishTurn()
        turn = item
        blocks.push({ type: 'user', item })
        break
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
  working: boolean
}

function TurnStatus({ user, working }: TurnStatusProps) {
  const now = useClock(working)
  if (working) {
    return (
      <div className="turn-status" data-working>
        <LoaderCircle className="icon activity__spinner" />
        Working… {formatDuration(now - user.createdAt)}
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
