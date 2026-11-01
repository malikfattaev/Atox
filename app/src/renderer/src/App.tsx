import { useCallback, useEffect, useState } from 'react'
import type { RepositorySection } from './components/RepositoryView'
import { Sidebar } from './components/Sidebar'
import { Workspace, type WorkspacePage } from './components/Workspace'
import { ChatActivityProvider, useChatsCovered } from './hooks/ChatActivityContext'
import { ProjectsProvider, useProjectsContext } from './hooks/ProjectsContext'
import { SettingsProvider } from './hooks/SettingsContext'
import { useAppCommands } from './hooks/useAppCommands'

export function App() {
  return (
    <SettingsProvider>
      <ProjectsProvider>
        <ChatActivityProvider>
          <Layout />
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
  const { currentProjectId } = projects

  const toggleSidebar = useCallback(() => setSidebarVisible((visible) => !visible), [])
  const openSettings = useCallback(() => setPage({ kind: 'settings' }), [])
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

  // Переход в чат (выбор, создание, переключение с клавиатуры) закрывает страницу поверх чатов.
  useEffect(closePage, [projects.activeChatId, closePage])

  useAppCommands({ projects, toggleSidebar, openSettings, toggleRepository })
  useChatsCovered(page !== null)

  return (
    <div className="app" data-sidebar={sidebarVisible ? 'visible' : 'hidden'}>
      {sidebarVisible && (
        <Sidebar
          repositoryOpen={page?.kind === 'repository'}
          onOpenSettings={openSettings}
          onToggleRepository={toggleRepository}
          onOpenRepository={openRepository}
        />
      )}
      <Workspace
        page={page}
        repositorySection={repositorySection}
        onRepositorySectionChange={setRepositorySection}
        onClosePage={closePage}
      />
    </div>
  )
}
