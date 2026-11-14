import type { MouseEvent } from 'react'
import { ChevronDown } from 'lucide-react'

interface FilterButtonProps {
  label: string
  value: string
  onClick(event: MouseEvent<HTMLButtonElement>): void
}

/** Кнопка фильтра: название и выбранное значение; по клику открывается меню выбора. */
export function FilterButton({ label, value, onClick }: FilterButtonProps) {
  return (
    <button type="button" className="board__filter" onClick={onClick}>
      <span className="board__filter-label">{label}</span>
      <span className="board__filter-value">{value}</span>
      <ChevronDown className="board__filter-chevron" />
    </button>
  )
}
