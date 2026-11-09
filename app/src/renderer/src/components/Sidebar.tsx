import { useState } from 'react'
import { Bot, FolderPlus, GitPullRequest, SquarePen } from 'lucide-react'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { useGitBranches } from '../hooks/useGitBranches'
import { useSettings } from '../hooks/SettingsContext'
import { NO_CHAT_IDS } from '../lib/chatLayout'
import { PlanLimits } from './PlanLimits'
import { ProfileBar } from './ProfileBar'
import { ProjectItem } from './ProjectItem'
import type { Project } from '../../../shared/models'
import { SIDEBAR_WIDTH } from '../../../shared/settings'
import { PanelResizer } from './PanelResizer'
import { SidebarButton } from './SidebarButton'
import { SortableList } from './SortableList'
import { SpacePicker } from './SpacePicker'

/** Показаны ли лимиты подписки над профилем: по умолчанию скрыты, выбор помнится. */
const LIMITS_SHOWN_KEY = 'atox.limitsShown'

function containsChat(project: Project, chatId: string | null): boolean {
  return chatId !== null && project.chats.some(({ id }) => id === chatId)
}

interface SidebarProps {
  /** Открыта страница репозитория — её кнопка подсвечена. */
  repositoryOpen: boolean
  /** Открыт обзор агентов. */
  agentsOpen: boolean
  onOpenSettings(): void
  onToggleRepository(): void
  onToggleAgents(): void
  onOpenRepository(projectId: string): void
}

export function Sidebar({
  repositoryOpen,
  agentsOpen,
  onOpenSettings,
  onToggleRepository,
  onToggleAgents,
  onOpenRepository
}: SidebarProps) {
  const {
    loading,
    spaces,
    spaceProjects,
    activeChatId,
    visibleChatIds,
    currentProjectId,
    addProject,
    moveProject,
    createChat
  } = useProjectsContext()
  const { sidebarWidth } = useSettings()
  const branches = useGitBranches()
  // Пока тянут край, ширина живёт здесь; в настройки попадает только итоговая.
  const [draftWidth, setDraftWidth] = useState<number | null>(null)
  const [limitsShown, setLimitsShown] = useState(() => localStorage.getItem(LIMITS_SHOWN_KEY) === '1')
  const toggleLimits = () => {
    const next = !limitsShown
    localStorage.setItem(LIMITS_SHOWN_KEY, next ? '1' : '0')
    setLimitsShown(next)
  }
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
        <SidebarButton icon={Bot} label="Agents" active={agentsOpen} onClick={onToggleAgents} />
      </nav>

      <div className="sidebar__spaces">
        <SpacePicker />
      </div>

      <section className="sidebar__section">
        {/* Пока проекты загружаются, пустое состояние не показываем — оно бы мигнуло. */}
        {!loading && spaceProjects.length === 0 ? (
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
                spaces={spaces}
                // Выбор чата передаётся только его проекту: остальные карточки не перерисовываются.
                activeChatId={containsChat(project, activeChatId) ? activeChatId : null}
                visibleChatIds={
                  visibleChatIds.some((id) => containsChat(project, id))
                    ? visibleChatIds
                    : NO_CHAT_IDS
                }
              />
            )}
          </SortableList>
        )}
      </section>

      <div className="plan-limits-collapse" data-shown={limitsShown} inert={!limitsShown}>
        <div className="plan-limits-collapse__inner">
          <PlanLimits />
        </div>
      </div>
      <ProfileBar onOpenSettings={onOpenSettings} limitsShown={limitsShown} onToggleLimits={toggleLimits} />

      <PanelResizer
        width={width}
        bounds={SIDEBAR_WIDTH}
        edge="right"
        label="Resize sidebar"
        onDrag={setDraftWidth}
        onCommit={(next) => window.atox.settings.update({ sidebarWidth: next })}
      />
    </aside>
  )
}
