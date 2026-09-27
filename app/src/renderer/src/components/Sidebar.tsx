import { useState } from 'react'
import { FolderPlus, SquarePen } from 'lucide-react'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { useSettings } from '../hooks/SettingsContext'
import { ProfileBar } from './ProfileBar'
import { ProjectItem } from './ProjectItem'
import { SidebarButton } from './SidebarButton'
import { SidebarResizer } from './SidebarResizer'
import { SortableList } from './SortableList'

interface SidebarProps {
  onOpenSettings(): void
}

export function Sidebar({ onOpenSettings }: SidebarProps) {
  const { projects, currentProjectId, addProject, createChat, moveProject } = useProjectsContext()
  const { sidebarWidth } = useSettings()
  // Пока тянут край, ширина живёт здесь; в настройки попадает только итоговая.
  const [draftWidth, setDraftWidth] = useState<number | null>(null)
  const width = draftWidth ?? sidebarWidth

  return (
    <aside className="sidebar" style={{ width }}>
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
          <SortableList items={projects} onMove={(id, toIndex) => void moveProject(id, toIndex)}>
            {(project) => <ProjectItem key={project.id} project={project} />}
          </SortableList>
        )}
      </section>

      <ProfileBar onOpenSettings={onOpenSettings} />

      <SidebarResizer
        width={width}
        onDrag={setDraftWidth}
        onCommit={(next) => void window.atox.settings.update({ sidebarWidth: next })}
      />
    </aside>
  )
}
