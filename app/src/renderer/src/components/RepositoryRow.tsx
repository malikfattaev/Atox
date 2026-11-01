import type { MouseEvent, ReactNode } from 'react'
import { formatFullDate, formatRelativeTime } from '../lib/relativeTime'

export interface RepositoryRowAction {
  label: string
  title: string
  onClick(): void
}

interface RepositoryRowProps {
  icon: ReactNode
  /** Цвет значка по состоянию: открыт, смёржен, закрыт. */
  tone?: 'open' | 'merged' | 'closed' | 'muted'
  title: string
  /** То, что стоит сразу после заголовка, например метки issue. */
  badges?: ReactNode
  /** Части второй строки — между ними ставится разделитель. */
  meta: ReactNode[]
  /** Счётчики справа: комментарии, проверки, размер изменений. */
  aside?: ReactNode
  time: number
  /** Кнопка, которая появляется при наведении поверх правой части строки. */
  action?: RepositoryRowAction
  /** Клик по строке; без него строка ничего не открывает. */
  onOpen?(): void
  onContextMenu(event: MouseEvent): void
}

/** Строка списка коммитов, PR или issue: две строки текста, справа счётчики и время. */
export function RepositoryRow({
  icon,
  tone = 'muted',
  title,
  badges,
  meta,
  aside,
  time,
  action,
  onOpen,
  onContextMenu
}: RepositoryRowProps) {
  return (
    <li className="repo-row" data-has-action={Boolean(action)} onContextMenu={onContextMenu}>
      <button
        type="button"
        className="repo-row__main"
        data-openable={Boolean(onOpen)}
        onClick={onOpen}
      >
        <span className="repo-row__icon" data-tone={tone}>
          {icon}
        </span>
        <span className="repo-row__text">
          <span className="repo-row__title-line">
            <span className="repo-row__title">{title}</span>
            {badges}
          </span>
          <span className="repo-row__meta">
            {meta.filter(Boolean).map((part, index) => (
              <span key={index} className="repo-row__meta-part">
                {part}
              </span>
            ))}
          </span>
        </span>
        <span className="repo-row__aside">
          {aside}
          <time className="repo-row__time" title={formatFullDate(time)}>
            {formatRelativeTime(time)}
          </time>
        </span>
      </button>
      {action && (
        <button
          type="button"
          className="repo-row__action"
          title={action.title}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </li>
  )
}
