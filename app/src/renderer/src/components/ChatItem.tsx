import { useState, type MouseEvent } from 'react'
import { GitBranch } from 'lucide-react'
import type { Chat } from '../../../shared/models'
import { useChatActivity } from '../hooks/ChatActivityContext'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { ChatStatus } from './ChatStatus'
import { ChatTime } from './ChatTime'
import { InlineRename } from './InlineRename'
import { useSortableItem } from './SortableList'

const { atox } = window

interface ChatItemProps {
  chat: Chat
  projectId: string
  /** Ветка git, в которой работает чат; `null` — папка проекта не репозиторий. */
  branch: string | null
}

export function ChatItem({ chat, projectId, branch }: ChatItemProps) {
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
  const [renaming, setRenaming] = useState(false)
  const activity = useChatActivity(chat.id)
  const { itemProps, handleProps } = useSortableItem(chat.id, renaming)

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
      setRenaming(true)
    } else if (action === 'remove') {
      void removeChat(chat.id)
    }
  }

  const title = renaming ? (
    <InlineRename
      value={chat.title}
      label="Chat name"
      onSubmit={(value) => {
        setRenaming(false)
        void renameChat(chat.id, value)
      }}
      onCancel={() => setRenaming(false)}
    />
  ) : (
    <span className="row__label">{chat.title}</span>
  )

  const content = (
    <>
      <span className="chat-title">
        <ChatStatus status={activity} />
        {title}
      </span>
      {/* Пока программа работает, время не показываем: о работе говорит пульсирующий кружок. */}
      {!renaming && activity !== 'working' && <ChatTime at={chat.lastActiveAt ?? chat.createdAt} />}
      {branch && (
        <span className="chat-branch" title={branch}>
          <GitBranch className="chat-branch__icon" aria-hidden />
          <span className="row__label">{branch}</span>
        </span>
      )}
    </>
  )

  return (
    <li
      className="row row--chat"
      data-active={chat.id === activeChatId}
      data-visible={visible}
      onContextMenu={openContextMenu}
      {...itemProps}
      {...handleProps}
    >
      {renaming ? (
        <div className="row__main chat-row">{content}</div>
      ) : (
        <button
          type="button"
          className="row__main chat-row"
          // ⌘-клик открывает чат рядом с текущим, как в редакторах кода.
          onClick={(event) => (event.metaKey ? openChatBeside(chat.id) : selectChat(chat.id))}
          onDoubleClick={() => setRenaming(true)}
        >
          {content}
        </button>
      )}
    </li>
  )
}
