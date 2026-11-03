import { useState, type CSSProperties } from 'react'
import { SquareTerminal, X } from 'lucide-react'
import { TERMINAL_WIDTH } from '../../../shared/settings'
import { useSettings } from '../hooks/SettingsContext'
import { PanelResizer } from './PanelResizer'
import { TerminalView } from './TerminalView'

interface TerminalPanelProps {
  /** Проекты с открытым терминалом: их оболочки остаются подключёнными. */
  projectIds: readonly string[]
  /** Терминал какого проекта показать; `null` — панель скрыта. */
  shownProjectId: string | null
  focusRequest: number
  onClose(projectId: string): void
}

/** Панель терминала справа от чатов: оболочка в папке текущего проекта. */
export function TerminalPanel({
  projectIds,
  shownProjectId,
  focusRequest,
  onClose
}: TerminalPanelProps) {
  const { terminalWidth } = useSettings()
  // Пока тянут край, ширина живёт здесь; в настройки попадает только итоговая.
  const [draftWidth, setDraftWidth] = useState<number | null>(null)
  const width = draftWidth ?? terminalWidth

  if (projectIds.length === 0) {
    return null
  }

  return (
    <aside
      className="terminal-panel"
      hidden={shownProjectId === null}
      style={{ '--terminal-width': `${width}px` } as CSSProperties}
    >
      <header className="terminal-panel__header">
        <SquareTerminal className="icon terminal-panel__icon" />
        <span className="terminal-panel__title">Terminal</span>
        {shownProjectId && (
          <button
            type="button"
            className="chat-pane__close"
            aria-label="Hide terminal"
            title="Hide terminal"
            onClick={() => onClose(shownProjectId)}
          >
            <X className="icon" />
          </button>
        )}
      </header>
      {projectIds.map((projectId) => (
        <TerminalView
          key={projectId}
          projectId={projectId}
          visible={projectId === shownProjectId}
          focusRequest={focusRequest}
          onExit={onClose}
        />
      ))}
      <PanelResizer
        width={width}
        bounds={TERMINAL_WIDTH}
        edge="left"
        label="Resize terminal"
        onDrag={setDraftWidth}
        onCommit={(next) => void window.atox.settings.update({ terminalWidth: next })}
      />
    </aside>
  )
}
