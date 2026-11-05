import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useSettings } from '../hooks/SettingsContext'
import { ShortcutList } from './ShortcutList'

const { atox } = window

interface SettingsViewProps {
  onClose(): void
}

export function SettingsView({ onClose }: SettingsViewProps) {
  const { shareUsageStats } = useSettings()

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

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
        <section className="settings__subgroup" aria-label="Privacy">
          <h3 className="settings__subgroup-title">Privacy</h3>
          <div className="settings__card">
            <label className="settings__row">
              <span className="settings__label">
                <span>Share anonymous usage stats</span>
                <span className="settings__description">
                  Only app version and OS, once a day. No projects, chats or personal data.
                </span>
              </span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={shareUsageStats}
                onChange={(event) =>
                  void atox.settings.update({ shareUsageStats: event.target.checked })
                }
              />
            </label>
          </div>
        </section>
      </div>

      <div className="settings__group">
        <ShortcutList />
      </div>
    </section>
  )
}
