import { useState, type CSSProperties } from 'react'
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
        onCommit={(next) => window.atox.settings.update({ terminalWidth: next })}
      />
    </aside>
  )
}
