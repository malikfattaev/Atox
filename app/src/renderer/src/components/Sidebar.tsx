import { useState } from 'react'
import { FolderPlus, SquarePen } from 'lucide-react'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { useAgentPicker } from '../hooks/useAgentPicker'
import { useGitBranches } from '../hooks/useGitBranches'
import { useSettings } from '../hooks/SettingsContext'
import { ProfileBar } from './ProfileBar'
import { ProjectItem } from './ProjectItem'
import { SidebarButton } from './SidebarButton'
import { SidebarResizer } from './SidebarResizer'
import { SortableList } from './SortableList'
import { SpacePicker } from './SpacePicker'

interface SidebarProps {
  onOpenSettings(): void
}

export function Sidebar({ onOpenSettings }: SidebarProps) {
  const { spaces, activeSpaceId, spaceProjects, currentProjectId, addProject, moveProject } =
    useProjectsContext()
  const activeSpace = spaces.find(({ id }) => id === activeSpaceId)
  const pickAgentAndCreateChat = useAgentPicker()
  const { sidebarWidth } = useSettings()
  const branches = useGitBranches()
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
          onClick={() => currentProjectId && void pickAgentAndCreateChat(currentProjectId)}
        />
        <SidebarButton icon={FolderPlus} label="New project" onClick={() => void addProject()} />
      </nav>

      <div className="sidebar__spaces">
        <SpacePicker />
      </div>

      <section className="sidebar__section">
        {/* Пока пространства загружаются, пустое состояние не показываем — оно бы мигнуло. */}
        {activeSpace && spaceProjects.length === 0 ? (
          <p className="sidebar__empty">No projects yet</p>
        ) : (
          <SortableList
            items={spaceProjects}
            onMove={(id, toIndex) => void moveProject(id, toIndex)}
          >
            {(project) => (
              <ProjectItem
                key={project.id}
                project={project}
                branch={branches[project.path] ?? null}
              />
            )}
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
