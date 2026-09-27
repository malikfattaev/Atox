import { useState, type MouseEvent } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { Chat } from '../../../shared/models'
import { useChatActivity } from '../hooks/ChatActivityContext'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { InlineRename } from './InlineRename'

const { atox } = window

interface ChatItemProps {
  chat: Chat
}

export function ChatItem({ chat }: ChatItemProps) {
  const { activeChatId, selectChat, renameChat, removeChat } = useProjectsContext()
  const [renaming, setRenaming] = useState(false)
  const activity = useChatActivity(chat.id)

  const openContextMenu = async (event: MouseEvent) => {
    event.preventDefault()
    const action = await atox.showContextMenu([
      { action: 'rename', label: 'Rename', symbol: 'pencil' },
      { type: 'separator' },
      { action: 'remove', label: 'Delete chat', symbol: 'trash' }
    ])
    if (action === 'rename') {
      setRenaming(true)
    } else if (action === 'remove') {
      void removeChat(chat.id)
    }
  }

  return (
    <li
      className="row row--chat"
      data-active={chat.id === activeChatId}
      onContextMenu={openContextMenu}
    >
      {renaming ? (
        <div className="row__main">
          <InlineRename
            value={chat.title}
            label="Chat name"
            onSubmit={(title) => {
              setRenaming(false)
              void renameChat(chat.id, title)
            }}
            onCancel={() => setRenaming(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          className="row__main"
          onClick={() => selectChat(chat.id)}
          onDoubleClick={() => setRenaming(true)}
        >
          <span className="row__label">{chat.title}</span>
          {activity === 'working' && (
            <LoaderCircle className="icon row__status row__status--working" aria-label="Working" />
          )}
          {activity === 'unread' && (
            <span className="row__status row__status--unread" aria-label="New activity" />
          )}
        </button>
      )}
    </li>
  )
}
