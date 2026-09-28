import { formatShortcut, SHORTCUT_GROUPS } from '../../../shared/shortcuts'

/** Все горячие клавиши приложения по разделам. */
export function ShortcutList() {
  return (
    <>
      {SHORTCUT_GROUPS.map(({ title, shortcuts }) => (
        <section key={title} className="settings__subgroup" aria-label={title}>
          <h3 className="settings__subgroup-title">{title}</h3>
          <div className="settings__card">
            {shortcuts.map((shortcut) => (
              <div key={shortcut.label} className="settings__row settings__row--compact">
                <span>{shortcut.label}</span>
                <kbd className="shortcut-keys">{formatShortcut(shortcut)}</kbd>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}
