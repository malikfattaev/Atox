import { memo, useEffect, useLayoutEffect, useRef } from 'react'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { useConversation } from '../hooks/useConversation'
import { Composer } from './Composer'
import { Timeline } from './Timeline'

/** Докрутив вниз ближе этого, пользователь снова следует за новыми сообщениями. */
const STICK_TO_BOTTOM_PX = 48

/** Ближе этого к низу лента считается докрученной до конца: запас на дробные пиксели. */
const AT_BOTTOM_PX = 2

interface ChatViewProps {
  chatId: string
  visible: boolean
  focused: boolean
}

/** Пока тянут разделитель, рабочая область перерисовывается на каждое движение: чат — нет. */
export const ChatView = memo(function ChatView({ chatId, visible, focused }: ChatViewProps) {
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
  const lastUserMessage = conversation.items.findLast((item) => item.kind === 'user')?.id

  /**
   * Следует ли лента за агентом, решает её положение, а не колесо или клики: так её не сбивают
   * ни инерция трекпада, ни клик мимо сообщений. Лента отпускает низ, как только её сдвинули
   * вверх, а не когда отлистали далеко: иначе каждое слово агента возвращало бы назад.
   * Сжатие ленты тоже уменьшает scrollTop, но оставляет её внизу.
   */
  const trackScroll = (scroller: HTMLDivElement) => {
    const { scrollTop, scrollHeight, clientHeight } = scroller
    if (clientHeight === 0) {
      // Скрытый чат: у ленты нет размеров, и положение ничего не значит.
      return
    }
    const fromBottom = scrollHeight - scrollTop - clientHeight
    const movedDown = scrollTop > lastScrollTop.current
    const movedUp = scrollTop < lastScrollTop.current
    lastScrollTop.current = scrollTop
    if (fromBottom <= AT_BOTTOM_PX || (movedDown && fromBottom <= STICK_TO_BOTTOM_PX)) {
      stickToBottom.current = true
    } else if (movedUp) {
      stickToBottom.current = false
    }
  }

  const scrollToBottom = () => {
    const scroller = scrollRef.current
    if (!scroller) {
      return
    }
    // Агент пишет каждый кадр, и прокрутка вверх доходит сюда раньше, чем событие scroll:
    // без этой проверки лента вернула бы пользователя вниз, не дав ему отлистать.
    trackScroll(scroller)
    if (stickToBottom.current) {
      scroller.scrollTop = scroller.scrollHeight
      lastScrollTop.current = scroller.scrollTop
    }
  }

  // Новое сообщение пользователя: он ждёт ответа, лента снова следует за агентом.
  useLayoutEffect(() => {
    stickToBottom.current = true
  }, [lastUserMessage])

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

  if (!project || !chat) {
    return null
  }

  const started = conversation.items.length > 0

  return (
    <div className="chat-view" data-empty={!started && !conversation.loading}>
      <div
        ref={scrollRef}
        className="chat-view__scroll"
        onScroll={(event) => trackScroll(event.currentTarget)}
      >
        <div ref={columnRef} className="chat-view__column">
          {started && (
            <Timeline
              chatId={chat.id}
              items={conversation.items}
              running={conversation.running}
              agent={chat.agent}
              turnTokens={conversation.turnTokens ?? 0}
              visible={visible}
            />
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
})
