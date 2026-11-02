import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import type { ApprovalStatus, TimelineItem } from '../../../shared/conversation'

type ApprovalItem = Extract<TimelineItem, { kind: 'approval' }>

const STATUS_LABELS: Record<Exclude<ApprovalStatus, 'pending'>, string> = {
  allowed: 'Allowed',
  denied: 'Denied',
  cancelled: 'Cancelled'
}

interface ApprovalCardProps {
  chatId: string
  item: ApprovalItem
}

/** Вопрос агента, можно ли выполнить вызов: пока пользователь не ответит, агент ждёт. */
export function ApprovalCard({ chatId, item }: ApprovalCardProps) {
  // Ответ уходит агенту асинхронно: повторный клик до обновления карточки ничего не меняет.
  const [answered, setAnswered] = useState(false)
  const answer = (allow: boolean) => {
    setAnswered(true)
    void window.atox.conversations.answerRequest(chatId, item.id, {
      accepted: allow
    })
  }

  return (
    <div className="approval" data-status={item.status}>
      <div className="approval__header">
        <ShieldAlert className="icon" />
        <span className="approval__title">{item.title}</span>
      </div>
      {item.description && <p className="approval__description">{item.description}</p>}
      {item.fields.length > 0 && (
        <dl className="approval__fields">
          {item.fields.map((field) => (
            <div key={field.name} className="approval__field">
              <dt>{fieldLabel(field.name)}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="approval__footer">
        {item.status === 'pending' ? (
          <>
            <button
              type="button"
              className="approval__button"
              disabled={answered}
              onClick={() => answer(false)}
            >
              Deny
            </button>
            <button
              type="button"
              className="approval__button approval__button--allow"
              disabled={answered}
              onClick={() => answer(true)}
            >
              Allow once
            </button>
          </>
        ) : (
          <span className="approval__status">{STATUS_LABELS[item.status]}</span>
        )}
      </div>
    </div>
  )
}

/** Имя параметра для людей: `confirm_token` и `confirmToken` — «Confirm token». */
function fieldLabel(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name
}
