import type { MouseEvent } from 'react'
import { X } from 'lucide-react'
import type { Chat } from '../../../shared/models'

const { atox } = window

interface ChatItemProps {
  chat: Chat
  active: boolean
  onSelect(): void
  onRemove(): void
}

export function ChatItem({ chat, active, onSelect, onRemove }: ChatItemProps) {
  const openContextMenu = async (event: MouseEvent) => {
    event.preventDefault()
    const action = await atox.showContextMenu([{ action: 'remove', label: 'Удалить чат' }])
    if (action === 'remove') {
      onRemove()
    }
  }

  return (
    <li className="row row--chat" data-active={active} onContextMenu={openContextMenu}>
      <button type="button" className="row__main" onClick={onSelect}>
        <span className="row__label">{chat.title}</span>
      </button>
      <button type="button" className="row__action" aria-label="Удалить чат" onClick={onRemove}>
        <X className="icon" />
      </button>
    </li>
  )
}
