import { useProjectsContext } from '../hooks/ProjectsContext'
import { TerminalView } from './TerminalView'

interface WorkspaceProps {
  /** Открытый поиск: в каком чате и номер запроса (⌘F). */
  find: FindRequest | null
  onCloseFind(): void
}

export interface FindRequest {
  chatId: string
  request: number
}

export function Workspace({ find, onCloseFind }: WorkspaceProps) {
  const { activeChatId, openedChatIds, applyTerminalTitle } = useProjectsContext()

  return (
    <main className="workspace">
      {openedChatIds.map((chatId) => (
        <TerminalView
          key={chatId}
          chatId={chatId}
          active={chatId === activeChatId}
          findRequest={find?.chatId === chatId ? find.request : null}
          onCloseFind={onCloseFind}
          onTitleChange={(title) => void applyTerminalTitle(chatId, title)}
        />
      ))}
      {!activeChatId && <p className="workspace__empty">Select a chat or create a new one</p>}
    </main>
  )
}
