import { useId, useMemo, useState, type MouseEvent } from 'react'
import {
  ChevronDown,
  CodeXml,
  GitBranch,
  Sparkle,
  SquareTerminal,
  type LucideIcon
} from 'lucide-react'
import { findAgent, type AgentId } from '../../../shared/agents'
import type { Chat } from '../../../shared/models'
import { useChatActivity } from '../hooks/ChatActivityContext'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { ChatStatus } from './ChatStatus'
import { InlineRename } from './InlineRename'
import { useSortableItem } from './SortableList'

const { atox } = window

interface ChatItemProps {
  chat: Chat
  /** Помощники, которых запустил агент этого чата; показываются под ним. */
  workers: Chat[]
  projectId: string
  /** Ветка git, в которой работает чат; `null` — папка проекта не репозиторий. */
  branch: string | null
}

/** Значки агентов в строках помощников — те же, что у пунктов меню нового чата. */
const AGENT_ICONS: Record<AgentId, LucideIcon> = {
  claude: Sparkle,
  codex: CodeXml,
  terminal: SquareTerminal
}

/**
 * Чат в списке проекта. Если его агент запустил помощников, чат становится карточкой:
 * под ним сворачиваемая строка «N agents» и компактные строки помощников.
 * Перетаскивается вся карточка целиком.
 */
export function ChatItem({ chat, workers, projectId, branch }: ChatItemProps) {
  const [renaming, setRenaming] = useState(false)
  const [workersExpanded, setWorkersExpanded] = useState(true)
  const workersId = useId()
  const { itemProps, handleProps } = useSortableItem(chat.id, renaming)
  const hasWorkers = workers.length > 0
  const workerChatIds = useMemo(() => workers.map(({ id }) => id), [workers])

  return (
    <li className="chat-group" data-has-workers={hasWorkers} {...itemProps}>
      <ChatRow
        chat={chat}
        projectId={projectId}
        branch={branch}
        workerChatIds={workerChatIds}
        renaming={renaming}
        onRenamingChange={setRenaming}
        dragHandleProps={handleProps}
      />
      {hasWorkers && (
        <>
          <button
            type="button"
            className="chat-workers__toggle"
            aria-expanded={workersExpanded}
            aria-controls={workersId}
            onClick={() => setWorkersExpanded((value) => !value)}
          >
            {workers.length === 1 ? '1 agent' : `${workers.length} agents`}
            <ChevronDown className="icon" aria-hidden />
          </button>
          {/* Свёрнутые помощники остаются в DOM, чтобы список плавно раскрывался. */}
          <div
            id={workersId}
            className="chat-workers"
            data-expanded={workersExpanded}
            inert={!workersExpanded}
          >
            <ul>
              {workers.map((worker) => (
                <WorkerItem key={worker.id} chat={worker} projectId={projectId} />
              ))}
            </ul>
          </div>
        </>
      )}
    </li>
  )
}

function WorkerItem({ chat, projectId }: { chat: Chat; projectId: string }) {
  const [renaming, setRenaming] = useState(false)
  return (
    <li>
      <ChatRow
        chat={chat}
        projectId={projectId}
        compact
        renaming={renaming}
        onRenamingChange={setRenaming}
      />
    </li>
  )
}

interface ChatRowProps {
  chat: Chat
  projectId: string
  branch?: string | null
  /** Помощники чата: пока работает любой из них, индикатор чата показывает работу. */
  workerChatIds?: readonly string[]
  /** Строка помощника: в одну строку, со значком агента вместо индикатора и ветки. */
  compact?: boolean
  renaming: boolean
  onRenamingChange(renaming: boolean): void
  /** Обработчики перетаскивания: строку чата верхнего уровня можно тянуть. */
  dragHandleProps?: ReturnType<typeof useSortableItem>['handleProps']
}

function ChatRow({
  chat,
  projectId,
  branch = null,
  workerChatIds,
  compact = false,
  renaming,
  onRenamingChange,
  dragHandleProps
}: ChatRowProps) {
  const {
    activeChatId,
    visibleChatIds,
    currentProjectId,
    selectChat,
    openChatBeside,
    renameChat,
    removeChat
  } = useProjectsContext()
  const visible = visibleChatIds.includes(chat.id)
  // Рядом открываются чаты того проекта, что сейчас на экране: раскладка у каждого проекта своя.
  const canOpenBeside = Boolean(activeChatId) && projectId === currentProjectId && !visible

  const openContextMenu = async (event: MouseEvent) => {
    event.preventDefault()
    const action = await atox.showContextMenu([
      ...(canOpenBeside
        ? [
            {
              action: 'open-beside' as const,
              label: 'Open to the Side',
              symbol: 'rectangle.split.2x1'
            },
            { type: 'separator' as const }
          ]
        : []),
      { action: 'rename', label: 'Rename', symbol: 'pencil' },
      { type: 'separator' },
      { action: 'remove', label: 'Delete chat', symbol: 'trash' }
    ])
    if (action === 'open-beside') {
      openChatBeside(chat.id)
    } else if (action === 'rename') {
      onRenamingChange(true)
    } else if (action === 'remove') {
      void removeChat(chat.id)
    }
  }

  const title = renaming ? (
    <InlineRename
      value={chat.title}
      label="Chat name"
      onSubmit={(value) => {
        onRenamingChange(false)
        void renameChat(chat.id, value)
      }}
      onCancel={() => onRenamingChange(false)}
    />
  ) : (
    <span className="row__label">{chat.title}</span>
  )

  const AgentIcon = AGENT_ICONS[chat.agent ?? 'terminal']
  const content = (
    <>
      <span className="chat-title">
        {compact ? (
          <span className="worker-agent">
            <AgentIcon className="agent-icon" aria-hidden />
          </span>
        ) : (
          <ChatActivityStatus chatId={chat.id} workerChatIds={workerChatIds} />
        )}
        {title}
      </span>
      {branch && (
        <span className="chat-branch" title={branch}>
          <GitBranch className="chat-branch__icon" aria-hidden />
          <span className="row__label">{branch}</span>
        </span>
      )}
    </>
  )

  return (
    <div
      className={compact ? 'row row--chat row--worker' : 'row row--chat'}
      data-active={chat.id === activeChatId}
      data-visible={visible}
      title={compact ? findAgent(chat.agent)?.name : undefined}
      onContextMenu={openContextMenu}
      {...dragHandleProps}
    >
      {renaming ? (
        <div className="row__main chat-row">{content}</div>
      ) : (
        <button
          type="button"
          className="row__main chat-row"
          // ⌘-клик открывает чат рядом с текущим, как в редакторах кода.
          onClick={(event) => (event.metaKey ? openChatBeside(chat.id) : selectChat(chat.id))}
          onDoubleClick={() => onRenamingChange(true)}
        >
          {content}
        </button>
      )}
    </div>
  )
}

/** Индикатор чата верхнего уровня: подписка на состояние только там, где индикатор виден. */
function ChatActivityStatus({
  chatId,
  workerChatIds
}: {
  chatId: string
  workerChatIds?: readonly string[]
}) {
  return <ChatStatus status={useChatActivity(chatId, workerChatIds)} />
}
