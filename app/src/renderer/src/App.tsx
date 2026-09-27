import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'
import { ProjectsProvider } from './hooks/ProjectsContext'

export function App() {
  return (
    <ProjectsProvider>
      <div className="app">
        <Sidebar />
        <Workspace />
      </div>
    </ProjectsProvider>
  )
}
