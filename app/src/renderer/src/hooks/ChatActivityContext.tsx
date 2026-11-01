import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import { isWorkerChat } from '../../../shared/chats'
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
          projectsRef.current.visibleChatIds.includes(chatId) && document.hasFocus(),
        notify: (chatId, message) => showChatNotification(projectsRef.current, chatId, message)
      })
  )

  // Работа агентов во всех чатах, в том числе тех, что сейчас не на экране.
  useEffect(
    () =>
      window.atox.conversations.onRunningChange((chatId, running) =>
        tracker.reportRunning(chatId, running)
      ),
    [tracker]
  )

  // Чаты на экране в окне, которое в фокусе, считаются просмотренными.
  const { visibleChatIds } = projects
  useEffect(() => {
    if (visibleChatIds.length === 0) {
      return
    }
    const markSeen = () => visibleChatIds.forEach((chatId) => tracker.markSeen(chatId))
    markSeen()
    window.addEventListener('focus', markSeen)
    return () => window.removeEventListener('focus', markSeen)
  }, [visibleChatIds, tracker])

  // Помощники работают в фоне: о результате сообщает их агент, а не уведомление.
  const { projects: projectList } = projects
  useEffect(() => {
    tracker.setBackgroundChats(
      projectList.flatMap(({ chats }) => chats.filter(isWorkerChat).map(({ id }) => id))
    )
  }, [projectList, tracker])

  // Удалённые чаты больше не отслеживаются. Чаты других пространств остаются: их состояние
  // должно дождаться возвращения в пространство.
  const trackedChatIdsRef = useRef<string[]>([])
  useEffect(() => {
    const chatIds = projectList.flatMap(({ chats }) => chats.map(({ id }) => id))
    const existing = new Set(chatIds)
    trackedChatIdsRef.current.filter((id) => !existing.has(id)).forEach((id) => tracker.forget(id))
    trackedChatIdsRef.current = chatIds
  }, [projectList, tracker])

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

/**
 * Состояние чата для индикатора. `workerChatIds` — его помощники: пока работает хоть один,
 * индикатор чата показывает работу. У самих помощников индикатора нет.
 */
export function useChatActivity(
  chatId: string,
  workerChatIds: readonly string[] = []
): ChatActivityStatus {
  const tracker = useChatActivityTracker()
  return useSyncExternalStore(
    (listener) => tracker.subscribe(listener),
    () =>
      workerChatIds.some((id) => tracker.status(id) === 'working')
        ? 'working'
        : tracker.status(chatId)
  )
}
