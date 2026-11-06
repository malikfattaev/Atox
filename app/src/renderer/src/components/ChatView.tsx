import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useConversation } from '../hooks/useConversation'
import type { UserMessage } from '../../../shared/conversation'
import type { Chat } from '../../../shared/models'
import { LinkBaseDirectoryContext } from '../lib/linkTargets'
import { Composer } from './Composer'
import { Timeline } from './Timeline'

/** Докрутив вниз ближе этого, пользователь снова следует за новыми сообщениями. */
const STICK_TO_BOTTOM_PX = 48

/** Ближе этого к низу лента считается докрученной до конца: запас на дробные пиксели. */
const AT_BOTTOM_PX = 2

/** Пустая очередь — одним массивом: новый на каждую отрисовку сбивал бы `memo` у ленты. */
const NO_QUEUED_MESSAGES: readonly UserMessage[] = []

/** Где пользователь оставил ленту чата: следит за агентом или читает историю с этого места. */
interface ScrollPosition {
  top: number
  stickToBottom: boolean
}

/**
 * Положение лент живёт вне компонентов: давно не открытый чат выгружается, а вернувшись в него,
 * пользователь продолжает читать с того же места.
 */
const scrollPositions = new Map<string, ScrollPosition>()

interface ChatViewProps {
  chat: Chat
  /** Папка проекта чата: от неё считаются относительные пути в ссылках из ответов. */
  projectPath: string
  visible: boolean
  focused: boolean
}

/**
 * Чат получает только свои данные, а не весь список проектов: пока тянут разделитель, выбирают
 * другой чат или пишет агент соседнего, рабочая область перерисовывается — этот чат нет.
 */
export const ChatView = memo(function ChatView({
  chat,
  projectPath,
  visible,
  focused
}: ChatViewProps) {
  const chatId = chat.id
  const conversation = useConversation(chatId, visible)
  const scrollRef = useRef<HTMLDivElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  // Пользователь внизу ленты: новые сообщения прокручивают её; отлистал вверх — не мешаем читать.
  const stickToBottom = useRef(scrollPositions.get(chatId)?.stickToBottom ?? true)
  const lastScrollTop = useRef(0)
  // Сохранённое положение ещё не вернули: пока лента грузится, её положение ничего не значит
  // и не должно затереть сохранённое.
  const restoringPosition = useRef(scrollPositions.has(chatId))


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
    if (!restoringPosition.current) {
      scrollPositions.set(chatId, { top: scrollTop, stickToBottom: stickToBottom.current })
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

  // Пользователь отправил сообщение из поля: он ждёт ответа, лента снова следует за агентом.
  // Сообщения от других агентов (atox send, отчёты помощников) читающего историю не сдвигают.
  const followAgent = useCallback(() => {
    stickToBottom.current = true
  }, [])

  // Чат открыли снова после выгрузки: лента возвращается туда, где её оставили. Раньше, чем
  // прокрутка вниз ниже: та уважает уже восстановленное положение.
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    const saved = scrollPositions.get(chatId)
    if (!restoringPosition.current || !visible || conversation.loading || !scroller || !saved) {
      return
    }
    restoringPosition.current = false
    stickToBottom.current = saved.stickToBottom
    if (!saved.stickToBottom) {
      scroller.scrollTop = saved.top
      lastScrollTop.current = scroller.scrollTop
    }
  }, [chatId, visible, conversation.loading])

  useLayoutEffect(() => {
    if (visible) {
      scrollToBottom()
    }
  }, [conversation.items, conversation.queued, conversation.running, visible])

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
  }, [])

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
            // Относительные пути в ссылках из ответов считаются от папки проекта.
            <LinkBaseDirectoryContext.Provider value={projectPath}>
              <Timeline
                chatId={chat.id}
                items={conversation.items}
                queued={conversation.queued ?? NO_QUEUED_MESSAGES}
                running={conversation.running}
                turnTokens={conversation.turnTokens ?? 0}
                visible={visible}
              />
            </LinkBaseDirectoryContext.Provider>
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
          onSend={followAgent}
        />
      </div>
    </div>
  )
})
