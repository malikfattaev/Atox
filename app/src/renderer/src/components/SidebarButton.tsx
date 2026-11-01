import type { LucideIcon } from 'lucide-react'

interface SidebarButtonProps {
  icon: LucideIcon
  label: string
  /** Кнопка открытой сейчас страницы. */
  active?: boolean
  disabled?: boolean
  onClick(): void
}

export function SidebarButton({
  icon: Icon,
  label,
  active = false,
  disabled,
  onClick
}: SidebarButtonProps) {
  return (
    <button
      type="button"
      className="sidebar-button"
      data-active={active}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="icon" />
      <span className="sidebar-button__label">{label}</span>
    </button>
  )
}
