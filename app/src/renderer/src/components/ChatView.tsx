import { useEffect, useLayoutEffect, useRef } from 'react'
import { findAgent } from '../../../shared/agents'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { useConversation } from '../hooks/useConversation'
import { Composer } from './Composer'
import { Timeline } from './Timeline'

/** Докрутив вниз ближе этого, пользователь снова следует за новыми сообщениями. */
const STICK_TO_BOTTOM_PX = 48

/** Клавиши, которыми листают ленту вверх. */
const SCROLL_UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home'])

interface ChatViewProps {
  chatId: string
  visible: boolean
  focused: boolean
}

export function ChatView({ chatId, visible, focused }: ChatViewProps) {
  const { projects } = useProjectsContext()
  const conversation = useConversation(chatId, visible)
  const scrollRef = useRef<HTMLDivElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  // Пользователь внизу ленты: новые сообщения прокручивают её; отлистал вверх — не мешаем читать.
  const stickToBottom = useRef(true)
  const lastScrollTop = useRef(0)

  const project = projects.find(({ chats }) => chats.some(({ id }) => id === chatId))
  const chat = project?.chats.find(({ id }) => id === chatId)
  const rendered = Boolean(project && chat)

  const scrollToBottom = () => {
    const scroller = scrollRef.current
    if (scroller && stickToBottom.current) {
      scroller.scrollTop = scroller.scrollHeight
    }
  }

  useLayoutEffect(() => {
    if (visible) {
      scrollToBottom()
    }
  }, [conversation.items, conversation.running, visible])

  // Лента или окно поменяли размер (вырос ввод, раздвинули чаты): низ остаётся на месте.
  useEffect(() => {
    const scroller = scrollRef.current
    const column = columnRef.current
    if (!scroller || !column) {
      return
    }
    const observer = new ResizeObserver(scrollToBottom)
    observer.observe(scroller)
    observer.observe(column)
    return () => observer.disconnect()
  }, [rendered])

  // Лента отпускает низ, как только пользователь начал листать вверх, а не когда отлистал
  // далеко: иначе каждое новое слово агента возвращало бы его обратно.
  const releaseBottom = () => {
    stickToBottom.current = false
  }

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
        onWheel={(event) => {
          if (event.deltaY < 0) {
            releaseBottom()
          }
        }}
        onKeyDown={(event) => {
          if (SCROLL_UP_KEYS.has(event.key)) {
            releaseBottom()
          }
        }}
        onPointerDown={(event) => {
          // Нажатие на саму полосу прокрутки, а не на сообщение.
          if (event.target === event.currentTarget) {
            releaseBottom()
          }
        }}
        onScroll={(event) => {
          const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
          const movedDown = scrollTop > lastScrollTop.current
          lastScrollTop.current = scrollTop
          if (movedDown && scrollHeight - scrollTop - clientHeight <= STICK_TO_BOTTOM_PX) {
            stickToBottom.current = true
          }
        }}
      >
        <div ref={columnRef} className="chat-view__column">
          {started ? (
            <Timeline
              items={conversation.items}
              running={conversation.running}
              agent={chat.agent}
              turnTokens={conversation.turnTokens ?? 0}
              visible={visible}
            />
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
