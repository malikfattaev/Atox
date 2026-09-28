import { useEffect, useState, type KeyboardEvent } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import { AGENTS, TERMINAL_AGENT_ID, type AgentId } from '../../../shared/agents'
import { TERMINAL_FONT_SIZE } from '../../../shared/settings'
import { useSettings } from '../hooks/SettingsContext'

const { atox } = window

interface SettingsViewProps {
  onClose(): void
}

export function SettingsView({ onClose }: SettingsViewProps) {
  const settings = useSettings()

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const changeFontSize = (step: number) => {
    void atox.settings.update({ terminalFontSize: settings.terminalFontSize + step })
  }

  return (
    <section className="settings" aria-labelledby="settings-title">
      <header className="settings__header">
        <h1 id="settings-title" className="settings__title">
          Settings
        </h1>
        <button type="button" className="icon-button" aria-label="Close settings" onClick={onClose}>
          <X className="icon" />
        </button>
      </header>

      <div className="settings__group">
        <h2 className="settings__group-title">Agents</h2>
        {AGENTS.filter(({ id }) => id !== TERMINAL_AGENT_ID).map((agent) => (
          <AgentCommandRow
            key={agent.id}
            agentId={agent.id}
            name={agent.name}
            defaultCommand={agent.command}
            command={settings.agentCommands[agent.id] ?? ''}
          />
        ))}
      </div>

      <div className="settings__group">
        <h2 className="settings__group-title">Terminal</h2>
        <div className="settings__row">
          <span className="settings__label">
            Font size
            <span className="settings__hint">Also ⌘+, ⌘− and ⌘0</span>
          </span>
          <div className="stepper">
            <button
              type="button"
              className="icon-button"
              aria-label="Decrease font size"
              disabled={settings.terminalFontSize <= TERMINAL_FONT_SIZE.min}
              onClick={() => changeFontSize(-1)}
            >
              <Minus className="icon" />
            </button>
            <span className="stepper__value">{settings.terminalFontSize}</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Increase font size"
              disabled={settings.terminalFontSize >= TERMINAL_FONT_SIZE.max}
              onClick={() => changeFontSize(1)}
            >
              <Plus className="icon" />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

interface AgentCommandRowProps {
  agentId: AgentId
  name: string
  defaultCommand: string
  /** Своя команда из настроек; пустая строка — стандартная. */
  command: string
}

/** Команда запуска агента: пустое поле — стандартная, например `claude`. */
function AgentCommandRow({ agentId, name, defaultCommand, command }: AgentCommandRowProps) {
  const settings = useSettings()
  const [value, setValue] = useState(command)

  // Настройки могут поменяться и снаружи — поле следует за ними.
  useEffect(() => setValue(command), [command])

  const save = () => {
    const trimmed = value.trim()
    if (trimmed !== command) {
      void atox.settings.update({
        agentCommands: { ...settings.agentCommands, [agentId]: trimmed }
      })
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur()
    }
  }

  return (
    <label className="settings__row">
      <span className="settings__label">
        {name}
        <span className="settings__hint">Command that starts {name} in a new chat</span>
      </span>
      <input
        className="settings__input"
        value={value}
        placeholder={defaultCommand}
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
      />
    </label>
  )
}
