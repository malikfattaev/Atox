import { TerminalView } from './TerminalView'

interface WorkspaceProps {
  activeChatId: string | null
  openedChatIds: string[]
  onChatTitleChange(chatId: string, title: string): void
}

export function Workspace({ activeChatId, openedChatIds, onChatTitleChange }: WorkspaceProps) {
  return (
    <main className="workspace">
      {openedChatIds.map((chatId) => (
        <TerminalView
          key={chatId}
          chatId={chatId}
          active={chatId === activeChatId}
          onTitleChange={(title) => onChatTitleChange(chatId, title)}
        />
      ))}
      {!activeChatId && <p className="workspace__empty">Выберите чат или создайте новый</p>}
    </main>
  )
}
