import { useState } from 'react'
import { FolderPlus, SquarePen } from 'lucide-react'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { useAgentPicker } from '../hooks/useAgentPicker'
import { useGitBranches } from '../hooks/useGitBranches'
import { useSettings } from '../hooks/SettingsContext'
import { InlineRename } from './InlineRename'
import { ProfileBar } from './ProfileBar'
import { ProjectItem } from './ProjectItem'
import { SidebarButton } from './SidebarButton'
import { SidebarResizer } from './SidebarResizer'
import { SortableList } from './SortableList'
import { SpaceSwitcher } from './SpaceSwitcher'

interface SidebarProps {
  onOpenSettings(): void
}

export function Sidebar({ onOpenSettings }: SidebarProps) {
  const {
    spaces,
    activeSpaceId,
    spaceProjects,
    currentProjectId,
    renameSpace,
    addProject,
    moveProject
  } = useProjectsContext()
  const activeSpace = spaces.find(({ id }) => id === activeSpaceId)
  // Новое пространство сразу предлагают назвать — прямо в заголовке над его проектами.
  const [renamingSpaceId, setRenamingSpaceId] = useState<string | null>(null)
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

      <section className="sidebar__section">
        {activeSpace && renamingSpaceId === activeSpace.id ? (
          <div className="sidebar__heading sidebar__heading--editing">
            <InlineRename
              value={activeSpace.name}
              label="Space name"
              onSubmit={(name) => {
                setRenamingSpaceId(null)
                void renameSpace(activeSpace.id, name)
              }}
              onCancel={() => setRenamingSpaceId(null)}
            />
          </div>
        ) : (
          <h2
            className="sidebar__heading"
            title="Double-click to rename"
            onDoubleClick={() => activeSpace && setRenamingSpaceId(activeSpace.id)}
          >
            {activeSpace?.name}
          </h2>
        )}
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

      <SpaceSwitcher onRename={setRenamingSpaceId} />
      <ProfileBar onOpenSettings={onOpenSettings} />

      <SidebarResizer
        width={width}
        onDrag={setDraftWidth}
        onCommit={(next) => void window.atox.settings.update({ sidebarWidth: next })}
      />
    </aside>
  )
}
