import { useRef, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import { DEFAULT_SPLIT_POSITION } from '../../../shared/split'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { useGitBranches } from '../hooks/useGitBranches'
import type { TerminalPanelState } from '../hooks/useTerminalPanel'
import { AgentsView } from './AgentsView'
import { ChangesPanel } from './ChangesPanel'
import { ChatView } from './ChatView'
import { RepositoryView, type RepositorySection } from './RepositoryView'
import { SettingsView } from './SettingsView'
import { SplitResizer } from './SplitResizer'
import { TerminalPanel } from './TerminalPanel'
import { WorkspaceTitle } from './WorkspaceTitle'
import { WorkspaceToolbar } from './WorkspaceToolbar'

/** Страница, открытая поверх чатов. */
export type WorkspacePage =
  | { kind: 'settings' }
  | { kind: 'agents' }
  | { kind: 'repository'; projectId: string }

interface WorkspaceProps {
  page: WorkspacePage | null
  repositorySection: RepositorySection
  onRepositorySectionChange(section: RepositorySection): void
  onClosePage(): void
  onOpenChat(chatId: string): void
  terminals: TerminalPanelState
  /** Панель изменений открыта вместо терминала. */
  changesOpen: boolean
  sidebarVisible: boolean
  onToggleSidebar(): void
  onToggleTerminal(): void
  onToggleChanges(): void
}

export function Workspace({
  page,
  repositorySection,
  onRepositorySectionChange,
  onClosePage,
  onOpenChat,
  terminals,
  changesOpen,
  sidebarVisible,
  onToggleSidebar,
  onToggleTerminal,
  onToggleChanges
}: WorkspaceProps) {
  const {
    projects,
    activeChatId,
    visibleChatIds,
    openedChatIds,
    currentProjectId,
    selectChat,
    closeChatPane,
    setSplitPosition
  } = useProjectsContext()
  const branches = useGitBranches()
  const chatsRef = useRef<HTMLDivElement>(null)
  // Пока тянут разделитель, положение живёт здесь; у проекта сохраняется только итоговое.
  const [draftPosition, setDraftPosition] = useState<number | null>(null)
  const currentProject = projects.find(({ id }) => id === currentProjectId)
  const splitPosition = draftPosition ?? currentProject?.split?.position ?? DEFAULT_SPLIT_POSITION
  // Проект страницы репозитория могли убрать из списка — тогда и страницы нет.
  const repositoryProject =
    page?.kind === 'repository' ? projects.find(({ id }) => id === page.projectId) : undefined
  const pageOpen =
    page?.kind === 'settings' || page?.kind === 'agents' || Boolean(repositoryProject)
  const isSplit = !pageOpen && visibleChatIds.length > 1
  // Терминалы убранных проектов main-процесс уже остановил.
  const terminalProjectIds = terminals.openProjectIds.filter((id) =>
    projects.some((project) => project.id === id)
  )
  const changesShown = changesOpen && Boolean(currentProjectId)
  const terminalOpen =
    !changesShown && Boolean(currentProjectId && terminalProjectIds.includes(currentProjectId))
  const chatTitles = new Map(
    projects.flatMap((project) => project.chats.map((chat) => [chat.id, chat.title] as const))
  )
  const activeChatProject = activeChatId
    ? projects.find((project) => project.chats.some((chat) => chat.id === activeChatId))
    : undefined

  return (
    <main className="workspace">
      <div className="workspace__main">
        <header className="workspace__header">
          {/* У страниц поверх чатов свои заголовки. */}
          {!pageOpen && activeChatId && activeChatProject && (
            <WorkspaceTitle
              chatTitle={chatTitles.get(activeChatId) ?? ''}
              projectName={activeChatProject.name}
            />
          )}
          <WorkspaceToolbar
            terminalOpen={terminalOpen}
            changesOpen={changesShown}
            projectAvailable={Boolean(currentProjectId)}
            sidebarVisible={sidebarVisible}
            onToggleTerminal={onToggleTerminal}
            onToggleChanges={onToggleChanges}
            onToggleSidebar={onToggleSidebar}
          />
        </header>
        <div
          ref={chatsRef}
          className="workspace__chats"
          data-split={isSplit}
          style={{ '--split-position': `${splitPosition * 100}%` } as CSSProperties}
        >
          {openedChatIds.map((chatId) => {
            const pane = visibleChatIds.indexOf(chatId)
            const visible = !pageOpen && pane >= 0
            const focused = visible && chatId === activeChatId
            return (
              // Открытые чаты остаются смонтированными: скрытый чат не теряет черновик и прокрутку.
              <section
                key={chatId}
                className="chat-pane"
                data-pane={pane}
                data-focused={focused}
                hidden={!visible}
                onFocus={() => selectChat(chatId)}
              >
                {isSplit && (
                  <header className="chat-pane__header">
                    <span className="chat-pane__title">{chatTitles.get(chatId)}</span>
                    <button
                      type="button"
                      className="chat-pane__close"
                      aria-label="Close"
                      title="Close"
                      onClick={() => closeChatPane(chatId)}
                    >
                      <X className="icon" />
                    </button>
                  </header>
                )}
                <ChatView chatId={chatId} visible={visible} focused={focused} />
              </section>
            )
          })}
          {isSplit && currentProjectId && (
            <SplitResizer
              position={splitPosition}
              containerRef={chatsRef}
              onDrag={setDraftPosition}
              onCommit={(position) => void setSplitPosition(currentProjectId, position)}
            />
          )}
          {!pageOpen && !activeChatId && (
            <p className="workspace__empty">Select a chat or create a new one</p>
          )}
        </div>
      </div>
      {!pageOpen && changesShown && currentProjectId && (
        <ChangesPanel projectId={currentProjectId} />
      )}
      <TerminalPanel
        projectIds={terminalProjectIds}
        shownProjectId={!pageOpen && terminalOpen ? currentProjectId : null}
        focusRequest={terminals.focusRequest}
        onClose={terminals.close}
      />
      {page?.kind === 'settings' && <SettingsView onClose={onClosePage} />}
      {page?.kind === 'agents' && <AgentsView onOpenChat={onOpenChat} onClose={onClosePage} />}
      {repositoryProject && (
        <RepositoryView
          // У каждого проекта свои фильтры и данные: при смене проекта страница начинается заново.
          key={repositoryProject.id}
          project={repositoryProject}
          branch={branches[repositoryProject.path] ?? null}
          section={repositorySection}
          onSectionChange={onRepositorySectionChange}
          onClose={onClosePage}
        />
      )}
    </main>
  )
}
