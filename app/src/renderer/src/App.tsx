import { useCallback, useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Workspace, type FindRequest } from './components/Workspace'
import { ProjectsProvider, useProjectsContext } from './hooks/ProjectsContext'
import { SettingsProvider } from './hooks/SettingsContext'
import { useAppCommands } from './hooks/useAppCommands'

export function App() {
  return (
    <SettingsProvider>
      <ProjectsProvider>
        <Layout />
      </ProjectsProvider>
    </SettingsProvider>
  )
}

function Layout() {
  const projects = useProjectsContext()
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [find, setFind] = useState<FindRequest | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const toggleSidebar = useCallback(() => setSidebarVisible((visible) => !visible), [])
  const openFind = useCallback((chatId: string) => {
    setFind((current) => ({ chatId, request: (current?.request ?? 0) + 1 }))
  }, [])
  const closeFind = useCallback(() => setFind(null), [])
  const openSettings = useCallback(() => setSettingsOpen(true), [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])

  // Переход в чат (выбор, создание, переключение с клавиатуры) закрывает настройки.
  useEffect(closeSettings, [projects.activeChatId, closeSettings])

  useAppCommands({ projects, toggleSidebar, openFind, openSettings })

  return (
    <div className="app" data-sidebar={sidebarVisible ? 'visible' : 'hidden'}>
      {sidebarVisible && <Sidebar onOpenSettings={openSettings} />}
      <Workspace
        find={find}
        onCloseFind={closeFind}
        settingsOpen={settingsOpen}
        onCloseSettings={closeSettings}
      />
    </div>
  )
}
