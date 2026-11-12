import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import {
  ChevronDown,
  CircleAlert,
  ExternalLink,
  FolderGit2,
  MessageSquare,
  Play,
  RefreshCw,
  Search,
  X
} from 'lucide-react'
import { BOARD_COLUMNS, type BoardColumn, type BoardIssue } from '../../../shared/board'
import { useChatActivity } from '../hooks/ChatActivityContext'
import { useSettings } from '../hooks/SettingsContext'
import { useBoard } from '../hooks/useBoard'
import { showMenu, type MenuItem } from '../lib/menu'
import { githubAvatarUrl } from '../lib/github'
import { formatRelativeTime } from '../lib/relativeTime'
import { BoardRepositoryPicker } from './BoardRepositoryPicker'
import { ChatStatus } from './ChatStatus'
import { GitHubMark } from './GitHubMark'

/** Сдвиг курсора, после которого нажатие на карточку — перетаскивание, а не клик. */
const DRAG_ACTIVATION_DISTANCE_PX = 6

/** Сколько аватаров исполнителей помещается на карточке. */
const MAX_ASSIGNEE_AVATARS = 3

/** Как часто обновлять «synced 2 min ago» в шапке. */
const CLOCK_TICK_MS = 30_000

const COLUMN_INFO: Record<BoardColumn, { title: string; hint: string }> = {
  backlog: { title: 'Backlog', hint: 'Open issues of your repositories.' },
  queue: { title: 'Queue', hint: 'Drop a task here and an agent picks it up.' },
  progress: { title: 'In progress', hint: 'Agents working on tasks show up here.' },
  review: { title: 'Review', hint: 'Finished tasks wait here for your review.' },
  done: { title: 'Done', hint: 'Move reviewed tasks here.' }
}

/** Пункт меню фильтра «все». */
const ALL = '*'

/** Кому назначена задача: кому угодно, одной из учётных записей пользователя или никому. */
type AssigneeFilter = 'anyone' | 'me' | 'unassigned'

const ASSIGNEE_LABELS: Record<AssigneeFilter, string> = {
  anyone: 'Anyone',
  me: 'Me',
  unassigned: 'Unassigned'
}

interface BoardViewProps {
  onOpenChat(chatId: string): void
  onClose(): void
}

/** Доска задач: issue выбранных репозиториев GitHub по колонкам, очередь задач для агентов. */
export function BoardView({ onOpenChat, onClose }: BoardViewProps) {
  const { state, refresh, move } = useBoard()
  const { boardMaxAgents } = useSettings()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [owner, setOwner] = useState<string>(ALL)
  const [repository, setRepository] = useState<string>(ALL)
  const [assignee, setAssignee] = useState<AssigneeFilter>('anyone')
  /** Логины учётных записей `gh` пользователя — «мои» задачи назначены на одну из них. */
  const [myLogins, setMyLogins] = useState<ReadonlySet<string>>(new Set())
  const [dragged, setDragged] = useState<BoardIssue | null>(null)
  const now = useClock()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } })
  )

  useEffect(() => {
    void window.atox.github
      .accounts()
      .then((accounts) => setMyLogins(new Set(accounts.map(({ login }) => login.toLowerCase()))))
  }, [])

  useEffect(() => {
    // Esc, который уже обработало поле или окно выбора репозиториев, страницу не закрывает.
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        onClose()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const issues = state?.issues ?? []
  const owners = useMemo(() => [...new Set(issues.map((issue) => issue.owner))].sort(), [issues])
  const repositories = useMemo(
    () =>
      [...new Set(state?.repositories.map(({ fullName }) => fullName) ?? [])]
        .filter((name) => owner === ALL || name.startsWith(`${owner}/`))
        .sort(),
    [state?.repositories, owner]
  )
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return issues.filter(
      (issue) =>
        (owner === ALL || issue.owner === owner) &&
        (repository === ALL || issue.repository === repository) &&
        matchesAssignee(issue, assignee, myLogins) &&
        (!needle ||
          issue.title.toLowerCase().includes(needle) ||
          `#${issue.number}`.includes(needle) ||
          issue.repository.toLowerCase().includes(needle))
    )
  }, [issues, owner, repository, assignee, myLogins, query])
  const working = issues.filter((issue) => issue.column === 'progress').length

  const chooseOwner = async (anchor: Element) => {
    const choice = await showMenu<string>(
      [
        { action: ALL, label: 'All organizations', checked: owner === ALL },
        { type: 'separator' },
        ...owners.map((name) => ({ action: name, label: name, checked: owner === name }))
      ],
      anchor
    )
    if (choice !== null) {
      setOwner(choice)
      setRepository(ALL)
    }
  }

  const chooseRepository = async (anchor: Element) => {
    const choice = await showMenu<string>(
      [
        { action: ALL, label: 'All repositories', checked: repository === ALL },
        { type: 'separator' },
        ...repositories.map((name) => ({ action: name, label: name, checked: repository === name }))
      ],
      anchor
    )
    if (choice !== null) {
      setRepository(choice)
    }
  }

  const chooseAssignee = async (anchor: Element) => {
    const choice = await showMenu<AssigneeFilter>(
      (Object.keys(ASSIGNEE_LABELS) as AssigneeFilter[]).map((id) => ({
        action: id,
        label: id === 'me' ? 'Assigned to me' : ASSIGNEE_LABELS[id],
        checked: assignee === id
      })),
      anchor
    )
    if (choice !== null) {
      setAssignee(choice)
    }
  }

  const handleDragStart = ({ active }: DragStartEvent) =>
    setDragged(issues.find(({ id }) => id === active.id) ?? null)

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setDragged(null)
    const issue = issues.find(({ id }) => id === active.id)
    const column = over?.id
    if (issue && typeof column === 'string' && column !== issue.column) {
      move(issue.id, column as BoardColumn)
    }
  }

  const hasRepositories = (state?.repositories.length ?? 0) > 0

  return (
    <section className="board" aria-labelledby="board-title">
      <header className="board__header">
        <div className="board__heading">
          <h1 id="board-title" className="board__title">
            Board
          </h1>
          <p className="board__subtitle" aria-live="polite">
            {describeSync(state, now)}
          </p>
        </div>
        <div className="board__actions">
          {hasRepositories && (
            <span className="board__agents" title="Change the limit in Settings → GitHub">
              {working} of {boardMaxAgents} agents working
            </span>
          )}
          {hasRepositories && (
            <button
              type="button"
              className="board__button"
              disabled={state?.syncing}
              onClick={refresh}
            >
              <RefreshCw className="board__button-icon" data-spinning={state?.syncing} />
              Refresh
            </button>
          )}
          <button type="button" className="board__button" onClick={() => setPickerOpen(true)}>
            <FolderGit2 className="board__button-icon" />
            Repositories
            {hasRepositories && <span className="board__count">{state?.repositories.length}</span>}
          </button>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X className="icon" />
          </button>
        </div>
      </header>

      {state && !hasRepositories ? (
        <div className="board__empty">
          <GitHubMark className="board__empty-icon" />
          <h2 className="board__empty-title">Pick repositories for your board</h2>
          <p className="board__empty-text">
            Their open issues become tasks. Move a task to Queue, and an agent starts working on it
            in its own git worktree, then opens a pull request.
          </p>
          <button
            type="button"
            className="settings__button settings__button--primary board__empty-button"
            onClick={() => setPickerOpen(true)}
          >
            Choose Repositories
          </button>
        </div>
      ) : (
        <>
          <div className="board__toolbar">
            <label className="board__search">
              <Search className="board__search-icon" />
              <input
                type="search"
                placeholder="Search tasks"
                value={query}
                spellCheck={false}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && query) {
                    event.preventDefault()
                    setQuery('')
                  }
                }}
              />
            </label>
            <FilterButton
              label="Organization"
              value={owner === ALL ? 'All' : owner}
              onClick={(event) => void chooseOwner(event.currentTarget)}
            />
            <FilterButton
              label="Repository"
              value={repository === ALL ? 'All' : repository.split('/')[1]!}
              onClick={(event) => void chooseRepository(event.currentTarget)}
            />
            <FilterButton
              label="Assignee"
              value={ASSIGNEE_LABELS[assignee]}
              onClick={(event) => void chooseAssignee(event.currentTarget)}
            />
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setDragged(null)}
          >
            <div className="board__columns">
              {BOARD_COLUMNS.map((column) => (
                <Column
                  key={column}
                  column={column}
                  issues={visible.filter((issue) => issue.column === column)}
                  loading={state === null || (state.syncedAt === null && state.syncing)}
                  onMove={move}
                  onOpenChat={onOpenChat}
                />
              ))}
            </div>
            <DragOverlay dropAnimation={null}>
              {dragged && <CardContent issue={dragged} overlay />}
            </DragOverlay>
          </DndContext>
        </>
      )}

      {pickerOpen && state && (
        <BoardRepositoryPicker
          selected={state.repositories}
          onClose={() => setPickerOpen(false)}
          onSave={(next) => {
            setPickerOpen(false)
            void window.atox.board.setRepositories(next)
          }}
        />
      )}
    </section>
  )
}

function FilterButton({
  label,
  value,
  onClick
}: {
  label: string
  value: string
  onClick(event: MouseEvent<HTMLButtonElement>): void
}) {
  return (
    <button type="button" className="board__filter" onClick={onClick}>
      <span className="board__filter-label">{label}</span>
      <span className="board__filter-value">{value}</span>
      <ChevronDown className="board__filter-chevron" />
    </button>
  )
}

interface ColumnProps {
  column: BoardColumn
  issues: BoardIssue[]
  loading: boolean
  onMove(issueId: string, column: BoardColumn): void
  onOpenChat(chatId: string): void
}

function Column({ column, issues, loading, onMove, onOpenChat }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column })
  const { title, hint } = COLUMN_INFO[column]
  return (
    <section
      ref={setNodeRef}
      className="board-column"
      data-column={column}
      data-over={isOver}
      aria-label={title}
    >
      <header className="board-column__header">
        <span className="board-column__dot" />
        <h2 className="board-column__title">{title}</h2>
        <span className="board-column__count">{issues.length}</span>
      </header>
      <ul className="board-column__cards">
        {issues.length === 0 && (
          <li className="board-column__hint">{loading ? 'Loading tasks…' : hint}</li>
        )}
        {issues.map((issue) => (
          <Card key={issue.id} issue={issue} onMove={onMove} onOpenChat={onOpenChat} />
        ))}
      </ul>
    </section>
  )
}

interface CardProps {
  issue: BoardIssue
  onMove(issueId: string, column: BoardColumn): void
  onOpenChat(chatId: string): void
}

function Card({ issue, onMove, onOpenChat }: CardProps) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: issue.id })

  const open = () => (issue.chatId ? onOpenChat(issue.chatId) : window.open(issue.url))

  const openMenu = async (event: MouseEvent) => {
    event.preventDefault()
    const items: MenuItem<string>[] = [
      ...(issue.chatId
        ? [{ action: 'chat', label: 'Open Chat', icon: <MessageSquare /> } as const]
        : []),
      { action: 'github', label: 'Open on GitHub', icon: <ExternalLink /> },
      { type: 'separator' },
      {
        type: 'submenu',
        label: 'Move to',
        items: BOARD_COLUMNS.map((column) => ({
          action: `move:${column}`,
          label: COLUMN_INFO[column].title,
          checked: issue.column === column
        }))
      }
    ]
    const action = await showMenu(items, event)
    if (action === 'chat' && issue.chatId) {
      onOpenChat(issue.chatId)
    } else if (action === 'github') {
      window.open(issue.url)
    } else if (action?.startsWith('move:')) {
      const column = action.slice('move:'.length) as BoardColumn
      if (column !== issue.column) {
        onMove(issue.id, column)
      }
    }
  }

  return (
    <li
      ref={setNodeRef}
      className="board-card"
      data-dragging={isDragging}
      {...attributes}
      {...listeners}
      onClick={open}
      onContextMenu={(event) => void openMenu(event)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          open()
        }
      }}
    >
      <CardContent issue={issue} onQueue={() => onMove(issue.id, 'queue')} />
    </li>
  )
}

function CardContent({
  issue,
  overlay,
  onQueue
}: {
  issue: BoardIssue
  overlay?: boolean
  onQueue?(): void
}) {
  return (
    <div className="board-card__body" data-overlay={overlay}>
      <div className="board-card__meta">
        <img className="board-card__avatar" src={issue.ownerAvatarUrl} alt="" />
        <span className="board-card__repository">{issue.repository.split('/')[1]}</span>
        <span className="board-card__number">#{issue.number}</span>
        {issue.state === 'closed' && <span className="board-card__closed">Closed</span>}
        {issue.assignees.length > 0 && (
          <span className="board-card__assignees" title={issue.assignees.join(', ')}>
            {issue.assignees.slice(0, MAX_ASSIGNEE_AVATARS).map((login) => (
              <img key={login} className="board-card__assignee" src={githubAvatarUrl(login)} alt="" />
            ))}
          </span>
        )}
      </div>
      <p className="board-card__title">{issue.title}</p>
      {issue.labels.length > 0 && (
        <div className="board-card__labels">
          {issue.labels.map(({ name, color }) => (
            <span key={name} className="board-card__label" style={{ '--label-color': color } as never}>
              {name}
            </span>
          ))}
        </div>
      )}
      {issue.error && (
        <p className="board-card__error">
          <CircleAlert className="board-card__error-icon" />
          {issue.error}
        </p>
      )}
      <CardFooter issue={issue} onQueue={onQueue} />
    </div>
  )
}

function CardFooter({ issue, onQueue }: { issue: BoardIssue; onQueue?(): void }) {
  if (issue.chatId && (issue.column === 'progress' || issue.column === 'review')) {
    return <AgentStatus chatId={issue.chatId} column={issue.column} />
  }
  if (issue.column === 'progress') {
    return (
      <div className="board-card__footer">
        <span className="board-card__status">Preparing the worktree…</span>
      </div>
    )
  }
  if (issue.column === 'backlog' && onQueue) {
    return (
      <div className="board-card__footer board-card__footer--hover">
        <button
          type="button"
          className="board-card__action"
          // Кнопка не начинает перетаскивание и не открывает задачу.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onQueue()
          }}
        >
          <Play className="board-card__action-icon" />
          Queue for an agent
        </button>
      </div>
    )
  }
  return null
}

function AgentStatus({ chatId, column }: { chatId: string; column: BoardColumn }) {
  const status = useChatActivity(chatId)
  const label =
    status === 'waiting'
      ? 'Agent needs you'
      : status === 'working'
        ? 'Agent working'
        : column === 'review'
          ? 'Ready for review'
          : 'Agent stopped'
  return (
    <div className="board-card__footer">
      <ChatStatus status={status} />
      <span className="board-card__status" data-waiting={status === 'waiting'}>
        {label}
      </span>
      <span className="board-card__open">
        <MessageSquare className="board-card__open-icon" />
        Chat
      </span>
    </div>
  )
}

function matchesAssignee(
  issue: BoardIssue,
  filter: AssigneeFilter,
  myLogins: ReadonlySet<string>
): boolean {
  switch (filter) {
    case 'anyone':
      return true
    case 'unassigned':
      return issue.assignees.length === 0
    case 'me':
      return issue.assignees.some((login) => myLogins.has(login.toLowerCase()))
  }
}

function describeSync(state: ReturnType<typeof useBoard>['state'], now: number): string {
  if (!state) {
    return ' '
  }
  if (state.syncing) {
    return 'Syncing with GitHub…'
  }
  if (state.error) {
    return `Couldn’t sync with GitHub: ${state.error}`
  }
  if (state.syncedAt === null) {
    return 'Tasks from your GitHub repositories'
  }
  const ago = formatRelativeTime(state.syncedAt, now)
  return ago === 'now' ? 'GitHub synced just now' : `GitHub synced ${ago} ago`
}

function useClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => clearInterval(timer)
  }, [])
  return now
}
