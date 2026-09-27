import { FolderPlus, SquarePen } from 'lucide-react'
import type { Project } from '../../../shared/models'
import { ProfileBar } from './ProfileBar'
import { ProjectItem } from './ProjectItem'
import { SidebarButton } from './SidebarButton'

interface SidebarProps {
  projects: Project[]
  activeChatId: string | null
  onAddProject(): void
  onRemoveProject(projectId: string): void
  onCreateChat(projectId: string): void
  onSelectChat(chatId: string): void
  onRemoveChat(chatId: string): void
}

export function Sidebar({
  projects,
  activeChatId,
  onAddProject,
  onRemoveProject,
  onCreateChat,
  onSelectChat,
  onRemoveChat
}: SidebarProps) {
  // «Новый чат» открывается в проекте текущего чата, а если чат не выбран — в первом проекте.
  const currentProject =
    projects.find((project) => project.chats.some(({ id }) => id === activeChatId)) ?? projects[0]

  return (
    <aside className="sidebar">
      <div className="sidebar__titlebar" />

      <nav className="sidebar__nav">
        <SidebarButton
          icon={SquarePen}
          label="Новый чат"
          disabled={!currentProject}
          onClick={() => currentProject && onCreateChat(currentProject.id)}
        />
        <SidebarButton icon={FolderPlus} label="Новый проект" onClick={onAddProject} />
      </nav>

      <section className="sidebar__section">
        <h2 className="sidebar__heading">Проекты</h2>
        {projects.length === 0 ? (
          <p className="sidebar__empty">Пока нет проектов</p>
        ) : (
          <ul>
            {projects.map((project) => (
              <ProjectItem
                key={project.id}
                project={project}
                activeChatId={activeChatId}
                onRemove={() => onRemoveProject(project.id)}
                onCreateChat={() => onCreateChat(project.id)}
                onSelectChat={onSelectChat}
                onRemoveChat={onRemoveChat}
              />
            ))}
          </ul>
        )}
      </section>

      <ProfileBar />
    </aside>
  )
}
