import { useProjectsContext } from '../hooks/ProjectsContext'
import { TerminalView } from './TerminalView'

export function Workspace() {
  const { activeChatId, openedChatIds, applyTerminalTitle } = useProjectsContext()

  return (
    <main className="workspace">
      {openedChatIds.map((chatId) => (
        <TerminalView
          key={chatId}
          chatId={chatId}
          active={chatId === activeChatId}
          onTitleChange={(title) => void applyTerminalTitle(chatId, title)}
        />
      ))}
      {!activeChatId && <p className="workspace__empty">Выберите чат или создайте новый</p>}
    </main>
  )
}
