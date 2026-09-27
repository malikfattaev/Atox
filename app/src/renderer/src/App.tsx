import { useCallback, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'
import { ProjectsProvider, useProjectsContext } from './hooks/ProjectsContext'
import { useAppCommands } from './hooks/useAppCommands'

export function App() {
  return (
    <ProjectsProvider>
      <Layout />
    </ProjectsProvider>
  )
}

function Layout() {
  const projects = useProjectsContext()
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const toggleSidebar = useCallback(() => setSidebarVisible((visible) => !visible), [])

  useAppCommands({ projects, toggleSidebar })

  return (
    <div className="app" data-sidebar={sidebarVisible ? 'visible' : 'hidden'}>
      {sidebarVisible && <Sidebar />}
      <Workspace />
    </div>
  )
}
