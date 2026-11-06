import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/settings'

const SettingsContext = createContext<Settings>(DEFAULT_SETTINGS)

/**
 * Настройки из main-процесса; меняются и из меню, и из интерфейса — сюда приходят все изменения.
 * Читаются синхронно ещё до первой отрисовки, а подписка живёт с загрузки модуля: так первый кадр
 * уже с сохранённой раскладкой и ни одно изменение не теряется между чтением и подпиской.
 */
let currentSettings = window.atox.settings.get()
const settingsListeners = new Set<() => void>()
window.atox.settings.subscribe((next) => {
  currentSettings = next
  settingsListeners.forEach((listener) => listener())
})

function subscribeToSettings(listener: () => void): () => void {
  settingsListeners.add(listener)
  return () => settingsListeners.delete(listener)
}

const getSettings = () => currentSettings

export function SettingsProvider({ children }: { children: ReactNode }) {
  const settings = useSyncExternalStore(subscribeToSettings, getSettings)
  return <SettingsContext.Provider value={settings}>{children}</SettingsContext.Provider>
}

export function useSettings(): Settings {
  return useContext(SettingsContext)
}
