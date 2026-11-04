import { memo, useEffect, useMemo, useState, type ComponentType } from 'react'
import {
  Bot,
  Brain,
  CircleAlert,
  FoldVertical,
  FilePen,
  FileText,
  Globe,
  Image as ImageIcon,
  LoaderCircle,
  Search,
  SquareTerminal,
  Wrench,
  type LucideProps
} from 'lucide-react'
import type { TimelineItem, ToolKind } from '../../../shared/conversation'
import { findAgent } from '../../../shared/agents'
import {
  compactionText,
  formatDuration,
  formatTokens,
  toolVerb,
  workingLabel
} from '../lib/conversationText'
import { fileName, useImagePreview } from '../lib/attachments'
import { ImageViewer } from './ImageViewer'
import { imageContextMenu, type ShownImage } from '../lib/imageActions'
import { AgentIcon } from './AgentIcon'
import { ApprovalCard } from './ApprovalCard'
import { QuestionCard } from './QuestionCard'
import { Markdown } from './Markdown'
import { ContextCard, LimitsCard } from './UsageCards'

type UserItem = Extract<TimelineItem, { kind: 'user' }>
type ActivityItem = Extract<TimelineItem, { kind: 'tool' | 'reasoning' }>
type CompactionItem = Extract<TimelineItem, { kind: 'compaction' }>

type Block =
  | { type: 'user'; item: UserItem }
  | { type: 'assistant'; item: Extract<TimelineItem, { kind: 'assistant' }> }
  | { type: 'error'; item: Extract<TimelineItem, { kind: 'error' }> }
  | { type: 'approval'; item: Extract<TimelineItem, { kind: 'approval' }> }
  | { type: 'question'; item: Extract<TimelineItem, { kind: 'question' }> }
  | { type: 'limits'; item: Extract<TimelineItem, { kind: 'limits' }> }
  | { type: 'context'; item: Extract<TimelineItem, { kind: 'context' }> }
  | { type: 'compaction'; item: CompactionItem }
  | {
      type: 'agent-switch'
      item: Extract<TimelineItem, { kind: 'agent-switch' }>
    }
  /** Конец ответа на сообщение: пока агент работает — что он делает сейчас. */
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

/**
 * Сообщение моложе этого только что отправлено и появляется с анимацией; старые сообщения
 * при открытии чата появляются сразу.
 */
const FRESH_MESSAGE_MS = 2000

/** Как часто обновлять секундомер работающего агента. */
const CLOCK_INTERVAL_MS = 1000

interface TimelineProps {
  chatId: string
  items: readonly TimelineItem[]
  running: boolean
  /** Сколько токенов агент написал, отвечая на текущее сообщение. */
  turnTokens: number
  /** Чат на экране: секундомер скрытого чата не тикает. */
  visible: boolean
}

export const Timeline = memo(function Timeline({
  chatId,
  items,
  running,
  turnTokens,
  visible
}: TimelineProps) {
  const blocks = useMemo(() => buildBlocks(items), [items])
  const lastTurn = blocks.findLast((block) => block.type === 'turn')
  return (
    <div className="timeline">
      {blocks.map((block) => {
        switch (block.type) {
          case 'user':
            return (
              <div
                key={block.item.id}
                className="user-message"
                data-fresh={Date.now() - block.item.createdAt < FRESH_MESSAGE_MS || undefined}
              >
                {(block.item.images || block.item.files) && (
                  <MessageAttachments
                    images={block.item.images ?? []}
                    files={block.item.files ?? []}
                  />
                )}
                {block.item.text && <div className="message message--user">{block.item.text}</div>}
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
          case 'approval':
            return <ApprovalCard key={block.item.id} chatId={chatId} item={block.item} />
          case 'question':
            return <QuestionCard key={block.item.id} chatId={chatId} item={block.item} />
          case 'limits':
            return <LimitsCard key={block.item.id} limits={block.item.limits} />
          case 'context':
            return <ContextCard key={block.item.id} context={block.item.context} />
          case 'compaction':
            return <CompactionNotice key={block.item.id} item={block.item} />
          case 'agent-switch':
            return (
              <div key={block.item.id} className="agent-switch">
                <AgentIcon agent={block.item.agent} className="agent-switch__icon" />
                Switched to {findAgent(block.item.agent)?.name ?? block.item.agent}
              </div>
            )
          case 'turn':
            // Законченный ответ — это только его текст: что агент делал, видно лишь пока он работает.
            return running && block === lastTurn && !block.user.finishedAt ? (
              <WorkingStatus
                key={block.key}
                user={block.user}
                items={block.items}
                tokens={turnTokens}
                visible={visible}
              />
            ) : null
        }
      })}
    </div>
  )
})

interface MessageAttachmentsProps {
  images: readonly string[]
  files: readonly string[]
}

/**
 * Вложения сообщения одним рядом над его текстом: картинки, затем файлы. Клик по картинке
 * открывает её на весь экран.
 */
function MessageAttachments({ images, files }: MessageAttachmentsProps) {
  const [viewed, setViewed] = useState<ShownImage | null>(null)
  return (
    <ul className="message__attachments">
      {images.map((path) => (
        <MessageImage key={path} path={path} onOpen={setViewed} />
      ))}
      {files.map((path) => (
        <li key={path} className="message__file" title={path}>
          <FileText className="icon" aria-hidden />
          <span className="message__file-name">{fileName(path)}</span>
        </li>
      ))}
      {viewed && <ImageViewer image={viewed} onClose={() => setViewed(null)} />}
    </ul>
  )
}

/** Картинка из сообщения: превью, пока файл читается или пропал, — значок. */
function MessageImage({ path, onOpen }: { path: string; onOpen(image: ShownImage): void }) {
  const preview = useImagePreview(path)
  return (
    <li className="message__image" title={path}>
      {preview ? (
        <button
          type="button"
          className="message__image-button"
          aria-label="Open image"
          onClick={() => onOpen({ src: preview, path })}
          onContextMenu={imageContextMenu({ src: preview, path })}
        >
          <img src={preview} alt="" />
        </button>
      ) : (
        <ImageIcon className="icon" />
      )}
    </li>
  )
}

/** Разбивает ленту на блоки; действия агента в неё не попадают — их показывает строка работы. */
function buildBlocks(items: readonly TimelineItem[]): Block[] {
  const blocks: Block[] = []
  let turn: UserItem | null = null
  let turnItems: TimelineItem[] = []

  const finishTurn = () => {
    if (turn) {
      blocks.push({
        type: 'turn',
        key: `${turn.id}:turn`,
        user: turn,
        items: turnItems
      })
    }
  }

  for (const item of items) {
    switch (item.kind) {
      case 'user':
        finishTurn()
        turn = item
        turnItems = []
        blocks.push({ type: 'user', item })
        continue
      case 'reasoning':
      case 'tool':
        break
      case 'assistant':
        if (item.text) {
          blocks.push({ type: 'assistant', item })
        }
        break
      case 'error':
        blocks.push({ type: 'error', item })
        break
      case 'approval':
        blocks.push({ type: 'approval', item })
        break
      case 'question':
        blocks.push({ type: 'question', item })
        break
      case 'limits':
        blocks.push({ type: 'limits', item })
        break
      case 'context':
        blocks.push({ type: 'context', item })
        break
      case 'compaction':
        blocks.push({ type: 'compaction', item })
        break
      case 'agent-switch':
        blocks.push({ type: 'agent-switch', item })
        break
    }
    turnItems.push(item)
  }
  finishTurn()
  return blocks
}

function ActivityList({ items }: { items: readonly ActivityItem[] }) {
  return (
    <ul className="activity__list">
      {items.map((item) => (
        <ActivityRow key={item.id} item={item} />
      ))}
    </ul>
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

/** Разделитель в ленте: агент сжимает разговор, всё выше осталось только в сводке. */
function CompactionNotice({ item }: { item: CompactionItem }) {
  return (
    <div className="compaction" data-status={item.status} role="status">
      <span className="compaction__line" />
      <span className="compaction__label">
        {item.status === 'running' ? (
          <LoaderCircle className="icon activity__spinner" />
        ) : item.status === 'failed' ? (
          <CircleAlert className="icon" />
        ) : (
          <FoldVertical className="icon" />
        )}
        <span>{compactionText(item)}</span>
      </span>
      <span className="compaction__line" />
    </div>
  )
}

interface WorkingStatusProps {
  user: UserItem
  /** Что агент уже сделал, отвечая на сообщение: по последнему видно, чем он занят. */
  items: readonly TimelineItem[]
  tokens: number
  visible: boolean
}

/**
 * Строка работающего агента: что он делает сейчас, сколько работает и сколько написал.
 * Клик раскрывает все действия этого ответа.
 */
function WorkingStatus({ user, items, tokens, visible }: WorkingStatusProps) {
  const now = useClock(visible)
  const [expanded, setExpanded] = useState(false)
  const activity = items.filter(
    (item): item is ActivityItem =>
      item.kind === 'tool' || (item.kind === 'reasoning' && item.text.trim() !== '')
  )
  const current = activity.findLast((item) => item.kind === 'tool' && item.status === 'running')
  const label =
    current?.kind === 'tool'
      ? `${toolVerb(current.tool, true)} ${current.title}`
      : `${workingLabel(items, user.id)}…`
  return (
    <div className="turn-status-group">
      <button
        type="button"
        className="turn-status"
        data-working
        aria-expanded={activity.length > 0 ? expanded : undefined}
        disabled={activity.length === 0}
        onClick={() => setExpanded((value) => !value)}
      >
        <AgentIcon agent={user.agent} className="turn-status__glyph" />
        <span className="turn-status__verb">{label}</span>
        <span className="turn-status__meta">
          ({formatDuration(now - user.createdAt)}
          {tokens > 0 && ` · ↓ ${formatTokens(tokens)} tokens`})
        </span>
      </button>
      {expanded && <ActivityList items={activity} />}
    </div>
  )
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
