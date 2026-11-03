import { PanelLeft, SquareTerminal, type LucideIcon } from 'lucide-react'
import { formatShortcut, type ShortcutId } from '../../../shared/shortcuts'
import { useSettings } from '../hooks/SettingsContext'

interface WorkspaceToolbarProps {
  terminalOpen: boolean
  /** Без выбранного проекта терминалу негде открыться. */
  terminalAvailable: boolean
  sidebarVisible: boolean
  onToggleTerminal(): void
  onToggleSidebar(): void
}

/** Кнопки в правом верхнем углу рабочей области, как в Claude. */
export function WorkspaceToolbar({
  terminalOpen,
  terminalAvailable,
  sidebarVisible,
  onToggleTerminal,
  onToggleSidebar
}: WorkspaceToolbarProps) {
  return (
    <div className="workspace-toolbar">
      <ToolbarButton
        icon={SquareTerminal}
        shortcut="toggleTerminal"
        label={terminalOpen ? 'Hide terminal' : 'Open terminal'}
        active={terminalOpen}
        disabled={!terminalAvailable}
        onClick={onToggleTerminal}
      />
      <ToolbarButton
        icon={PanelLeft}
        shortcut="toggleSidebar"
        label={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
        onClick={onToggleSidebar}
      />
    </div>
  )
}

interface ToolbarButtonProps {
  icon: LucideIcon
  shortcut: ShortcutId
  label: string
  /** Кнопка открытой сейчас панели. */
  active?: boolean
  disabled?: boolean
  onClick(): void
}

function ToolbarButton({
  icon: Icon,
  shortcut,
  label,
  active = false,
  disabled,
  onClick
}: ToolbarButtonProps) {
  const { shortcuts } = useSettings()
  const keys = formatShortcut(shortcut, shortcuts)
  return (
    <button
      type="button"
      className="workspace-toolbar__button"
      data-active={active}
      aria-label={label}
      aria-pressed={active}
      title={keys ? `${label} (${keys})` : label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="icon" />
    </button>
  )
}
