import { FolderPlus, SquarePen } from 'lucide-react'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { ProfileBar } from './ProfileBar'
import { ProjectItem } from './ProjectItem'
import { SidebarButton } from './SidebarButton'

export function Sidebar() {
  const { projects, activeChatId, addProject, createChat } = useProjectsContext()

  // «Новый чат» открывается в проекте текущего чата, а если чат не выбран — в первом проекте.
  const currentProject =
    projects.find((project) => project.chats.some(({ id }) => id === activeChatId)) ?? projects[0]

  return (
    <aside className="sidebar">
      <div className="sidebar__titlebar" />

      <nav className="sidebar__nav">
        <SidebarButton
          icon={SquarePen}
          label="New chat"
          disabled={!currentProject}
          onClick={() => currentProject && void createChat(currentProject.id)}
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

      <ProfileBar />
    </aside>
  )
}
