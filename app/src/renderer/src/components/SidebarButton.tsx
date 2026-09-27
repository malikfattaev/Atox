import type { LucideIcon } from 'lucide-react'

interface SidebarButtonProps {
  icon: LucideIcon
  label: string
  disabled?: boolean
  onClick(): void
}

export function SidebarButton({ icon: Icon, label, disabled, onClick }: SidebarButtonProps) {
  return (
    <button type="button" className="sidebar-button" disabled={disabled} onClick={onClick}>
      <Icon className="icon" />
      <span className="sidebar-button__label">{label}</span>
    </button>
  )
}
