import { useEffect, useState, type KeyboardEvent } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import { TERMINAL_FONT_SIZE } from '../../../shared/settings'
import { useSettings } from '../hooks/SettingsContext'

const { atox } = window

interface SettingsViewProps {
  onClose(): void
}

export function SettingsView({ onClose }: SettingsViewProps) {
  const settings = useSettings()
  const [startupCommand, setStartupCommand] = useState(settings.startupCommand)

  // Настройки могут поменяться и снаружи (например, из меню) — поле следует за ними.
  useEffect(() => setStartupCommand(settings.startupCommand), [settings.startupCommand])

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const saveStartupCommand = () => {
    if (startupCommand.trim() !== settings.startupCommand) {
      void atox.settings.update({ startupCommand })
    }
  }

  const handleCommandKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur()
    }
  }

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
        <h2 className="settings__group-title">Chats</h2>
        <label className="settings__row">
          <span className="settings__label">
            Startup command
            <span className="settings__hint">
              Runs in every new chat terminal, for example claude or codex
            </span>
          </span>
          <input
            className="settings__input"
            value={startupCommand}
            placeholder="None"
            spellCheck={false}
            onChange={(event) => setStartupCommand(event.target.value)}
            onBlur={saveStartupCommand}
            onKeyDown={handleCommandKeyDown}
          />
        </label>
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
