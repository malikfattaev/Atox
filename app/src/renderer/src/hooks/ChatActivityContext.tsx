import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import { ChatActivityTracker, type ChatActivityStatus } from '../lib/chatActivity'
import { useProjectsContext } from './ProjectsContext'
import type { ProjectsState } from './useProjects'

const ChatActivityContext = createContext<ChatActivityTracker | null>(null)

export function ChatActivityProvider({ children }: { children: ReactNode }) {
  const projects = useProjectsContext()
  // Трекер живёт всё время работы окна и читает актуальные проекты через ref.
  const projectsRef = useRef(projects)
  projectsRef.current = projects

  const [tracker] = useState(
    () =>
      new ChatActivityTracker({
        isChatInView: (chatId) =>
          projectsRef.current.activeChatId === chatId && document.hasFocus(),
        notify: (chatId, message) => showChatNotification(projectsRef.current, chatId, message),
        recordActivity: (chatId, at) => void projectsRef.current.recordChatActivity(chatId, at)
      })
  )

  // Открытый чат в окне, которое в фокусе, считается просмотренным.
  const { activeChatId, orderedChatIds } = projects
  useEffect(() => {
    if (!activeChatId) {
      return
    }
    const markSeen = () => tracker.markSeen(activeChatId)
    markSeen()
    window.addEventListener('focus', markSeen)
    return () => window.removeEventListener('focus', markSeen)
  }, [activeChatId, tracker])

  // Удалённые чаты больше не отслеживаются.
  const trackedChatIdsRef = useRef<string[]>([])
  useEffect(() => {
    const existing = new Set(orderedChatIds)
    trackedChatIdsRef.current.filter((id) => !existing.has(id)).forEach((id) => tracker.forget(id))
    trackedChatIdsRef.current = orderedChatIds
  }, [orderedChatIds, tracker])

  return <ChatActivityContext.Provider value={tracker}>{children}</ChatActivityContext.Provider>
}

/** Системное уведомление о чате; клик по нему открывает окно на этом чате. */
function showChatNotification(projects: ProjectsState, chatId: string, message: string): void {
  const project = projects.projects.find(({ chats }) => chats.some(({ id }) => id === chatId))
  const chat = project?.chats.find(({ id }) => id === chatId)
  if (!project || !chat) {
    return
  }
  const notification = new Notification(chat.title, { body: `${project.name} · ${message}` })
  notification.onclick = () => {
    window.atox.system.focusWindow()
    projects.selectChat(chatId)
  }
}

export function useChatActivityTracker(): ChatActivityTracker {
  const tracker = useContext(ChatActivityContext)
  if (!tracker) {
    throw new Error('useChatActivityTracker must be used within ChatActivityProvider')
  }
  return tracker
}

export function useChatActivity(chatId: string): ChatActivityStatus {
  const tracker = useChatActivityTracker()
  return useSyncExternalStore(
    (listener) => tracker.subscribe(listener),
    () => tracker.status(chatId)
  )
}
