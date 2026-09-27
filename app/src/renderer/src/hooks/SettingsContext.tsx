import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/settings'

const SettingsContext = createContext<Settings>(DEFAULT_SETTINGS)

/** Настройки из main-процесса; меняются и из меню, и из интерфейса — сюда приходят все изменения. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)

  useEffect(() => {
    void window.atox.settings.get().then(setSettings)
    return window.atox.settings.subscribe(setSettings)
  }, [])

  return <SettingsContext.Provider value={settings}>{children}</SettingsContext.Provider>
}

export function useSettings(): Settings {
  return useContext(SettingsContext)
}
