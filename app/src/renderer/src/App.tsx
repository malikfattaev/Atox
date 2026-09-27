import { useCallback, useState } from 'react'
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

  const toggleSidebar = useCallback(() => setSidebarVisible((visible) => !visible), [])
  const openFind = useCallback((chatId: string) => {
    setFind((current) => ({ chatId, request: (current?.request ?? 0) + 1 }))
  }, [])
  const closeFind = useCallback(() => setFind(null), [])

  useAppCommands({ projects, toggleSidebar, openFind })

  return (
    <div className="app" data-sidebar={sidebarVisible ? 'visible' : 'hidden'}>
      {sidebarVisible && <Sidebar />}
      <Workspace find={find} onCloseFind={closeFind} />
    </div>
  )
}
