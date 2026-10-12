import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  formatShortcut,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  type ShortcutId
} from '../../../shared/shortcuts'
import { useSettings } from '../hooks/SettingsContext'
import { ShortcutRecorder } from './ShortcutRecorder'

const { atox } = window

/** Все горячие клавиши приложения по разделам; сочетания команд меню можно переназначить. */
export function ShortcutList() {
  const { shortcuts } = useSettings()
  // Записывать можно только одно сочетание за раз.
  const [recordingId, setRecordingId] = useState<ShortcutId | null>(null)

  const assign = (id: ShortcutId, accelerator: string | null) => {
    const { [id]: _previous, ...rest } = shortcuts
    void atox.settings.update({ shortcuts: accelerator ? { ...rest, [id]: accelerator } : rest })
  }

  return (
    <>
      {SHORTCUT_GROUPS.map(({ title, shortcuts: ids }) => (
        <section key={title} className="settings__subgroup" aria-label={title}>
          <h3 className="settings__subgroup-title">{title}</h3>
          <div className="settings__card">
            {ids.map((id) => {
              const shortcut = SHORTCUTS[id]
              const customizable = 'accelerator' in shortcut
              return (
                <div key={id} className="settings__row settings__row--compact">
                  <span>{shortcut.label}</span>
                  {customizable ? (
                    <div className="shortcut-editor">
                      {shortcuts[id] && recordingId !== id && (
                        <button
                          type="button"
                          className="shortcut-reset"
                          aria-label={`Reset ${shortcut.label} shortcut`}
                          title="Reset to default"
                          onClick={() => assign(id, null)}
                        >
                          <RotateCcw className="icon" />
                        </button>
                      )}
                      <ShortcutRecorder
                        id={id}
                        overrides={shortcuts}
                        recording={recordingId === id}
                        onRecordingChange={(recording) => setRecordingId(recording ? id : null)}
                        onRecord={(accelerator) => assign(id, accelerator)}
                      />
                    </div>
                  ) : (
                    <kbd className="shortcut-keys">{formatShortcut(id, shortcuts)}</kbd>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </>
  )
}
