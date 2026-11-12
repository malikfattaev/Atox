import { useCallback, useEffect, useState } from 'react'
import type { RepositorySection } from './components/RepositoryView'
import { MenuLayer } from './components/MenuLayer'
import { Sidebar } from './components/Sidebar'
import { Workspace, type WorkspacePage } from './components/Workspace'
import { ChatActivityProvider, useChatsCovered } from './hooks/ChatActivityContext'
import { ProjectsProvider, useProjectsContext } from './hooks/ProjectsContext'
import { SettingsProvider } from './hooks/SettingsContext'
import { useAppCommands } from './hooks/useAppCommands'
import { useTerminalPanel } from './hooks/useTerminalPanel'

export function App() {
  return (
    <SettingsProvider>
      <ProjectsProvider>
        <ChatActivityProvider>
          <Layout />
          <MenuLayer />
        </ChatActivityProvider>
      </ProjectsProvider>
    </SettingsProvider>
  )
}

function Layout() {
  const projects = useProjectsContext()
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [page, setPage] = useState<WorkspacePage | null>(null)
  // Раздел страницы репозитория не сбрасывается, когда её закрывают и открывают снова.
  const [repositorySection, setRepositorySection] = useState<RepositorySection>('commits')
  const terminals = useTerminalPanel()
  // Изменения показываются вместо терминала, у текущего проекта.
  const [changesOpen, setChangesOpen] = useState(false)
  const { currentProjectId } = projects

  const toggleSidebar = useCallback(() => setSidebarVisible((visible) => !visible), [])
  const openSettings = useCallback(() => setPage({ kind: 'settings' }), [])
  const toggleAgents = useCallback(
    () => setPage((current) => (current?.kind === 'agents' ? null : { kind: 'agents' })),
    []
  )
  const toggleBoard = useCallback(
    () => setPage((current) => (current?.kind === 'board' ? null : { kind: 'board' })),
    []
  )
  // Выбранный в обзоре чат мог уже быть активным — тогда страница сама не закроется.
  const openChat = useCallback(
    (chatId: string) => {
      projects.selectChat(chatId)
      setPage(null)
    },
    [projects.selectChat]
  )
  const closePage = useCallback(() => setPage(null), [])
  const openRepository = useCallback(
    (projectId: string) => setPage({ kind: 'repository', projectId }),
    []
  )
  // Кнопка и горячая клавиша открывают репозиторий текущего проекта, а повторно — закрывают.
  const toggleRepository = useCallback(() => {
    setPage((current) =>
      current?.kind === 'repository' || !currentProjectId
        ? null
        : { kind: 'repository', projectId: currentProjectId }
    )
  }, [currentProjectId])

  // Терминал открывается у текущего проекта; поверх страницы его не видно — страница закрывается.
  // Если на его месте были изменения, они уступают место уже открытому терминалу.
  const toggleTerminal = useCallback(() => {
    if (!currentProjectId) {
      return
    }
    setPage(null)
    if (changesOpen) {
      setChangesOpen(false)
      if (terminals.openProjectIds.includes(currentProjectId)) {
        return
      }
    }
    terminals.toggle(currentProjectId)
  }, [currentProjectId, changesOpen, terminals.openProjectIds, terminals.toggle])

  const toggleChanges = useCallback(() => {
    if (currentProjectId) {
      setPage(null)
      setChangesOpen((open) => !open)
    }
  }, [currentProjectId])

  // Переход в чат (выбор, создание, переключение с клавиатуры) закрывает страницу поверх чатов.
  useEffect(closePage, [projects.activeChatId, closePage])

  useAppCommands({
    projects,
    toggleSidebar,
    toggleTerminal,
    toggleChanges,
    openSettings,
    toggleRepository,
    toggleAgents
  })
  useChatsCovered(page !== null)

  return (
    <div className="app" data-sidebar={sidebarVisible ? 'visible' : 'hidden'}>
      {sidebarVisible && (
        <Sidebar
          repositoryOpen={page?.kind === 'repository'}
          agentsOpen={page?.kind === 'agents'}
          boardOpen={page?.kind === 'board'}
          onOpenSettings={openSettings}
          onToggleRepository={toggleRepository}
          onToggleAgents={toggleAgents}
          onToggleBoard={toggleBoard}
          onOpenRepository={openRepository}
        />
      )}
      <Workspace
        page={page}
        repositorySection={repositorySection}
        onRepositorySectionChange={setRepositorySection}
        onClosePage={closePage}
        onOpenChat={openChat}
        terminals={terminals}
        changesOpen={changesOpen}
        sidebarVisible={sidebarVisible}
        onToggleSidebar={toggleSidebar}
        onToggleTerminal={toggleTerminal}
        onToggleChanges={toggleChanges}
      />
    </div>
  )
}
