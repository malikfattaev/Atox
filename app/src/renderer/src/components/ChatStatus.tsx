import type { ChatActivityStatus } from '../lib/chatActivity'
import { useBlink } from '../hooks/useBlink'

const STATUS_LABELS: Record<ChatActivityStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  unread: 'Finished'
}

interface ChatStatusProps {
  status: ChatActivityStatus
}

/** Кружок состояния чата в колонке иконок: нейтральный, мигает во время работы, голубой — закончил. */
export function ChatStatus({ status }: ChatStatusProps) {
  const visible = useBlink(status === 'working')

  return (
    <span className="chat-status" role="img" aria-label={STATUS_LABELS[status]}>
      <span className="chat-status__dot" data-status={status} data-dimmed={!visible} />
    </span>
  )
}
