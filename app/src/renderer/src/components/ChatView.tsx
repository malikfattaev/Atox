import { useLayoutEffect, useRef } from 'react'
import { findAgent } from '../../../shared/agents'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { useConversation } from '../hooks/useConversation'
import { Composer } from './Composer'
import { Timeline } from './Timeline'

/** Насколько можно отлистать от низа ленты, чтобы она всё ещё следовала за новыми сообщениями. */
const STICK_TO_BOTTOM_PX = 48

interface ChatViewProps {
  chatId: string
  visible: boolean
  focused: boolean
}

export function ChatView({ chatId, visible, focused }: ChatViewProps) {
  const { projects } = useProjectsContext()
  const conversation = useConversation(chatId)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Пользователь внизу ленты: новые сообщения прокручивают её; отлистал вверх — не мешаем читать.
  const stickToBottom = useRef(true)

  const project = projects.find(({ chats }) => chats.some(({ id }) => id === chatId))
  const chat = project?.chats.find(({ id }) => id === chatId)

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller && visible && stickToBottom.current) {
      scroller.scrollTop = scroller.scrollHeight
    }
  }, [conversation.items, conversation.running, visible])

  if (!project || !chat) {
    return null
  }

  const started = conversation.items.length > 0
  const agentName = findAgent(chat.agent)?.name ?? chat.agent

  return (
    <div className="chat-view" data-empty={!started && !conversation.loading}>
      <div
        ref={scrollRef}
        className="chat-view__scroll"
        onScroll={(event) => {
          const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
          stickToBottom.current = scrollHeight - scrollTop - clientHeight <= STICK_TO_BOTTOM_PX
        }}
      >
        <div className="chat-view__column">
          {started ? (
            <Timeline items={conversation.items} running={conversation.running} />
          ) : (
            !conversation.loading && (
              <h1 className="chat-view__greeting">
                What should {agentName} do in {project.name}?
              </h1>
            )
          )}
        </div>
      </div>
      <div className="chat-view__composer">
        <Composer
          chat={chat}
          running={conversation.running}
          started={started}
          focused={focused}
          usage={conversation.usage}
        />
      </div>
    </div>
  )
}
