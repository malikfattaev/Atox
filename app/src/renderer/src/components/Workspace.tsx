import { useRef, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import { DEFAULT_SPLIT_POSITION } from '../../../shared/split'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { ChatView } from './ChatView'
import { SettingsView } from './SettingsView'
import { SplitResizer } from './SplitResizer'

interface WorkspaceProps {
  settingsOpen: boolean
  onCloseSettings(): void
}

export function Workspace({ settingsOpen, onCloseSettings }: WorkspaceProps) {
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
  const workspaceRef = useRef<HTMLElement>(null)
  // Пока тянут разделитель, положение живёт здесь; у проекта сохраняется только итоговое.
  const [draftPosition, setDraftPosition] = useState<number | null>(null)
  const currentProject = projects.find(({ id }) => id === currentProjectId)
  const splitPosition = draftPosition ?? currentProject?.split?.position ?? DEFAULT_SPLIT_POSITION
  const isSplit = !settingsOpen && visibleChatIds.length > 1
  const chatTitles = new Map(
    projects.flatMap((project) => project.chats.map((chat) => [chat.id, chat.title] as const))
  )

  return (
    <main
      ref={workspaceRef}
      className="workspace"
      data-split={isSplit}
      style={{ '--split-position': `${splitPosition * 100}%` } as CSSProperties}
    >
      {openedChatIds.map((chatId) => {
        const pane = visibleChatIds.indexOf(chatId)
        const visible = !settingsOpen && pane >= 0
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
          containerRef={workspaceRef}
          onDrag={setDraftPosition}
          onCommit={(position) => void setSplitPosition(currentProjectId, position)}
        />
      )}
      {settingsOpen && <SettingsView onClose={onCloseSettings} />}
      {!settingsOpen && !activeChatId && (
        <p className="workspace__empty">Select a chat or create a new one</p>
      )}
    </main>
  )
}
