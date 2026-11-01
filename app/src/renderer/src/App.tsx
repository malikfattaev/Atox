import { useCallback, useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'
import { ChatActivityProvider } from './hooks/ChatActivityContext'
import { ProjectsProvider, useProjectsContext } from './hooks/ProjectsContext'
import { SettingsProvider } from './hooks/SettingsContext'
import { useAppCommands } from './hooks/useAppCommands'

export function App() {
  return (
    <SettingsProvider>
      <ProjectsProvider>
        <ChatActivityProvider>
          <Layout />
        </ChatActivityProvider>
      </ProjectsProvider>
    </SettingsProvider>
  )
}

function Layout() {
  const projects = useProjectsContext()
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const toggleSidebar = useCallback(() => setSidebarVisible((visible) => !visible), [])
  const openSettings = useCallback(() => setSettingsOpen(true), [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])

  // Переход в чат (выбор, создание, переключение с клавиатуры) закрывает настройки.
  useEffect(closeSettings, [projects.activeChatId, closeSettings])

  useAppCommands({ projects, toggleSidebar, openSettings })

  return (
    <div className="app" data-sidebar={sidebarVisible ? 'visible' : 'hidden'}>
      {sidebarVisible && <Sidebar onOpenSettings={openSettings} />}
      <Workspace settingsOpen={settingsOpen} onCloseSettings={closeSettings} />
    </div>
  )
}
