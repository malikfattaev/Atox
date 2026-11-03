import { useState } from 'react'
import { FolderPlus, GitPullRequest, SquarePen } from 'lucide-react'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { useGitBranches } from '../hooks/useGitBranches'
import { useSettings } from '../hooks/SettingsContext'
import { ProfileBar } from './ProfileBar'
import { ProjectItem } from './ProjectItem'
import { SIDEBAR_WIDTH } from '../../../shared/settings'
import { PanelResizer } from './PanelResizer'
import { SidebarButton } from './SidebarButton'
import { SortableList } from './SortableList'
import { SpacePicker } from './SpacePicker'

interface SidebarProps {
  /** Открыта страница репозитория — её кнопка подсвечена. */
  repositoryOpen: boolean
  onOpenSettings(): void
  onToggleRepository(): void
  onOpenRepository(projectId: string): void
}

export function Sidebar({
  repositoryOpen,
  onOpenSettings,
  onToggleRepository,
  onOpenRepository
}: SidebarProps) {
  const {
    spaces,
    activeSpaceId,
    spaceProjects,
    currentProjectId,
    addProject,
    moveProject,
    createChat
  } = useProjectsContext()
  const activeSpace = spaces.find(({ id }) => id === activeSpaceId)
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
          onClick={() => currentProjectId && void createChat(currentProjectId)}
        />
        <SidebarButton icon={FolderPlus} label="New project" onClick={() => void addProject()} />
        <SidebarButton
          icon={GitPullRequest}
          label="Repository"
          active={repositoryOpen}
          disabled={!currentProjectId}
          onClick={onToggleRepository}
        />
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
                onOpenRepository={onOpenRepository}
              />
            )}
          </SortableList>
        )}
      </section>

      <ProfileBar onOpenSettings={onOpenSettings} />

      <PanelResizer
        width={width}
        bounds={SIDEBAR_WIDTH}
        edge="right"
        label="Resize sidebar"
        onDrag={setDraftWidth}
        onCommit={(next) => void window.atox.settings.update({ sidebarWidth: next })}
      />
    </aside>
  )
}
