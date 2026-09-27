import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'
import { useProjects } from './hooks/useProjects'

export function App() {
  const state = useProjects()

  return (
    <div className="app">
      <Sidebar
        projects={state.projects}
        activeChatId={state.activeChatId}
        onAddProject={state.addProject}
        onRemoveProject={state.removeProject}
        onCreateChat={state.createChat}
        onSelectChat={state.selectChat}
        onRemoveChat={state.removeChat}
      />
      <Workspace
        activeChatId={state.activeChatId}
        openedChatIds={state.openedChatIds}
        onChatTitleChange={state.renameChat}
      />
    </div>
  )
}
