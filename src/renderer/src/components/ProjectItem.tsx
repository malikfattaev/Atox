import { useState, type MouseEvent } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import type { Project } from '../../../shared/models'
import { ChatItem } from './ChatItem'

const { atox } = window

interface ProjectItemProps {
  project: Project
  activeChatId: string | null
  onRemove(): void
  onCreateChat(): void
  onSelectChat(chatId: string): void
  onRemoveChat(chatId: string): void
}

export function ProjectItem({
  project,
  activeChatId,
  onRemove,
  onCreateChat,
  onSelectChat,
  onRemoveChat
}: ProjectItemProps) {
  const [expanded, setExpanded] = useState(true)

  const createChat = () => {
    setExpanded(true)
    onCreateChat()
  }

  const openContextMenu = async (event: MouseEvent) => {
    event.preventDefault()
    const action = await atox.showContextMenu([
      { action: 'create-chat', label: 'Новый чат' },
      { action: 'remove', label: 'Убрать из списка' }
    ])
    if (action === 'create-chat') {
      createChat()
    } else if (action === 'remove') {
      onRemove()
    }
  }

  return (
    <li>
      <div className="row row--project" title={project.path} onContextMenu={openContextMenu}>
        <button
          type="button"
          className="row__main"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronRight className="icon row__chevron" data-expanded={expanded} />
          <span className="row__label">{project.name}</span>
        </button>
        <button type="button" className="row__action" aria-label="Новый чат" onClick={createChat}>
          <Plus className="icon" />
        </button>
      </div>

      {expanded && project.chats.length > 0 && (
        <ul className="chat-list">
          {project.chats.map((chat) => (
            <ChatItem
              key={chat.id}
              chat={chat}
              active={chat.id === activeChatId}
              onSelect={() => onSelectChat(chat.id)}
              onRemove={() => onRemoveChat(chat.id)}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
