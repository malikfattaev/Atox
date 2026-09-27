import { FolderPlus } from 'lucide-react'
import type { Project } from '../../../shared/models'
import { ProjectItem } from './ProjectItem'

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
  return (
    <aside className="sidebar">
      <div className="sidebar__titlebar" />

      <nav className="sidebar__actions">
        <button type="button" className="sidebar__action" onClick={onAddProject}>
          <FolderPlus className="icon" />
          Новый проект
        </button>
      </nav>

      <section className="sidebar__section">
        <h2 className="sidebar__heading">Проекты</h2>
        {projects.length === 0 ? (
          <p className="sidebar__empty">Пока нет проектов</p>
        ) : (
          <ul className="project-list">
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
    </aside>
  )
}
