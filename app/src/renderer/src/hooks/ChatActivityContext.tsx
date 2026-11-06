import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import { isWorkerChat } from '../../../shared/chats'
import { ChatActivityTracker, type ChatActivityStatus } from '../lib/chatActivity'
import { playChime } from '../lib/chime'
import { useProjectsContext } from './ProjectsContext'
import { useSettings } from './SettingsContext'
import type { ProjectsState } from './useProjects'

const ChatActivityContext = createContext<ChatActivityTracker | null>(null)
/** Сообщает, что чаты закрыты другим экраном (настройками): тогда их не видно. */
const ChatsCoveredContext = createContext<((covered: boolean) => void) | null>(null)

export function ChatActivityProvider({ children }: { children: ReactNode }) {
  const projects = useProjectsContext()
  // Трекер живёт всё время работы окна и читает актуальные проекты через ref.
  const projectsRef = useRef(projects)
  projectsRef.current = projects
  const [chatsCovered, setChatsCovered] = useState(false)
  const chatsCoveredRef = useRef(chatsCovered)
  chatsCoveredRef.current = chatsCovered
  const { notificationSounds } = useSettings()
  const notificationSoundsRef = useRef(notificationSounds)
  notificationSoundsRef.current = notificationSounds

  const [tracker] = useState(
    () =>
      new ChatActivityTracker({
        isChatInView: (chatId) =>
          !chatsCoveredRef.current &&
          projectsRef.current.visibleChatIds.includes(chatId) &&
          document.hasFocus(),
        notify: (chatId, message, tone) => {
          showChatNotification(projectsRef.current, chatId, message)
          if (notificationSoundsRef.current) {
            playChime(tone)
          }
        }
      })
  )

  // Работа агентов во всех чатах, в том числе тех, что сейчас не на экране.
  useEffect(() => {
    const stopRunning = window.atox.conversations.onRunningChange((chatId, running) =>
      tracker.reportRunning(chatId, running)
    )
    const stopWaiting = window.atox.conversations.onWaitingChange((chatId, waitingFor) =>
      tracker.reportWaiting(chatId, waitingFor)
    )
    return () => {
      stopRunning()
      stopWaiting()
    }
  }, [tracker])

  // Число на иконке в доке — сколько чатов ждут пользователя, как непрочитанные в почте.
  useEffect(() => {
    let shown: number | null = null
    const sync = () => {
      const count = tracker.attentionCount()
      if (count !== shown) {
        shown = count
        window.atox.system.setBadgeCount(count)
      }
    }
    sync()
    return tracker.subscribe(sync)
  }, [tracker])

  // Чаты на экране в окне, которое в фокусе, считаются просмотренными.
  const { visibleChatIds } = projects
  useEffect(() => {
    if (visibleChatIds.length === 0 || chatsCovered) {
      return
    }
    const markSeen = () => visibleChatIds.forEach((chatId) => tracker.markSeen(chatId))
    markSeen()
    window.addEventListener('focus', markSeen)
    return () => window.removeEventListener('focus', markSeen)
  }, [visibleChatIds, chatsCovered, tracker])

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

  return (
    <ChatActivityContext.Provider value={tracker}>
      <ChatsCoveredContext.Provider value={setChatsCovered}>
        {children}
      </ChatsCoveredContext.Provider>
    </ChatActivityContext.Provider>
  )
}

/** Чаты закрыты другим экраном: работа, законченная за ним, остаётся непрочитанной. */
export function useChatsCovered(covered: boolean): void {
  const setChatsCovered = useContext(ChatsCoveredContext)
  if (!setChatsCovered) {
    throw new Error('useChatsCovered must be used within ChatActivityProvider')
  }
  useEffect(() => setChatsCovered(covered), [covered, setChatsCovered])
}

/** Системное уведомление о чате; клик по нему открывает окно на этом чате. */
function showChatNotification(projects: ProjectsState, chatId: string, message: string): void {
  const project = projects.projects.find(({ chats }) => chats.some(({ id }) => id === chatId))
  const chat = project?.chats.find(({ id }) => id === chatId)
  if (!project || !chat) {
    return
  }
  // Вместо системного звука играет свой звук Atox: его включают и выключают в настройках.
  const notification = new Notification(chat.title, {
    body: `${project.name} · ${message}`,
    silent: true
  })
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

/** Что важнее показать у чата, если у него и его помощников разные состояния. */
const GROUP_STATUS_PRIORITY: readonly ChatActivityStatus[] = ['waiting', 'working']

/**
 * Состояние чата для индикатора. `workerChatIds` — его помощники: пока хоть один ждёт ответа
 * или работает, индикатор чата показывает это. У самих помощников индикатора нет.
 */
export function useChatActivity(
  chatId: string,
  workerChatIds: readonly string[] = []
): ChatActivityStatus {
  const tracker = useChatActivityTracker()
  const subscribe = useCallback((listener: () => void) => tracker.subscribe(listener), [tracker])
  return useSyncExternalStore(subscribe, () => {
    const statuses = [chatId, ...workerChatIds].map((id) => tracker.status(id))
    return (
      GROUP_STATUS_PRIORITY.find((status) => statuses.includes(status)) ?? tracker.status(chatId)
    )
  })
}
