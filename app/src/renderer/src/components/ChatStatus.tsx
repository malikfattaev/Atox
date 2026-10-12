import type { ChatActivityStatus } from '../lib/chatActivity'

const STATUS_LABELS: Record<ChatActivityStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  unread: 'Finished'
}

interface ChatStatusProps {
  status: ChatActivityStatus
}

/** Кружок состояния чата в колонке иконок: нейтральный, пульсирует во время работы, голубой — закончил. */
export function ChatStatus({ status }: ChatStatusProps) {
  return (
    <span className="chat-status" role="img" aria-label={STATUS_LABELS[status]}>
      <span className="chat-status__dot" data-status={status} />
    </span>
  )
}
