import { FolderPlus, SquarePen } from 'lucide-react'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { ProfileBar } from './ProfileBar'
import { ProjectItem } from './ProjectItem'
import { SidebarButton } from './SidebarButton'

interface SidebarProps {
  onOpenSettings(): void
}

export function Sidebar({ onOpenSettings }: SidebarProps) {
  const { projects, currentProjectId, addProject, createChat } = useProjectsContext()

  return (
    <aside className="sidebar">
      <div className="sidebar__titlebar" />

      <nav className="sidebar__nav">
        <SidebarButton
          icon={SquarePen}
          label="New chat"
          disabled={!currentProjectId}
          onClick={() => currentProjectId && void createChat(currentProjectId)}
        />
        <SidebarButton icon={FolderPlus} label="New project" onClick={() => void addProject()} />
      </nav>

      <section className="sidebar__section">
        <h2 className="sidebar__heading">Projects</h2>
        {projects.length === 0 ? (
          <p className="sidebar__empty">No projects yet</p>
        ) : (
          <ul>
            {projects.map((project) => (
              <ProjectItem key={project.id} project={project} />
            ))}
          </ul>
        )}
      </section>

      <ProfileBar onOpenSettings={onOpenSettings} />
    </aside>
  )
}
