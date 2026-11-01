import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent
} from 'react'
import { ArrowUp, Square } from 'lucide-react'
import { findAgent } from '../../../shared/agents'
import type { ConversationUsage } from '../../../shared/conversation'
import type { Chat } from '../../../shared/models'
import { ModelPicker } from './ModelPicker'
import { UsageIndicator } from './UsageIndicator'

const { atox } = window

interface ComposerProps {
  chat: Chat
  /** Агент работает: кнопка отправки становится кнопкой остановки. */
  running: boolean
  /** В чате уже есть сообщения. */
  started: boolean
  /** Чат выбран: поле ввода получает фокус. */
  focused: boolean
  usage: ConversationUsage | undefined
}

export function Composer({ chat, running, started, focused, usage }: ComposerProps) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const canSend = text.trim().length > 0

  useEffect(() => {
    if (focused) {
      inputRef.current?.focus()
    }
  }, [focused])

  // Поле растёт вместе с текстом, пока не упрётся в max-height из стилей.
  useLayoutEffect(() => {
    const input = inputRef.current
    if (input) {
      input.style.height = 'auto'
      input.style.height = `${input.scrollHeight}px`
    }
  }, [text])

  const send = () => {
    if (!canSend) {
      return
    }
    void atox.conversations.send(chat.id, text)
    setText('')
  }

  const insert = (value: string) => {
    const input = inputRef.current
    if (!input) {
      setText((current) => current + value)
      return
    }
    const { selectionStart, selectionEnd } = input
    const next = text.slice(0, selectionStart) + value + text.slice(selectionEnd)
    setText(next)
    requestAnimationFrame(() => {
      input.selectionStart = input.selectionEnd = selectionStart + value.length
    })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter во время набора иероглифов или с Shift — не отправка.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  // Картинка из буфера сохраняется в файл: агент получает путь к нему, как в терминале.
  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'))
    if (images.length === 0) {
      return
    }
    event.preventDefault()
    void Promise.all(images.map((image) => atox.files.savePastedImage(image)))
      .then((paths) => insert(joinPaths(paths)))
      .catch((error) => console.error('Failed to paste the image', error))
  }

  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    const paths = [...event.dataTransfer.files]
      .map((file) => atox.files.getPath(file))
      .filter(Boolean)
    if (paths.length > 0) {
      event.preventDefault()
      insert(joinPaths(paths))
      inputRef.current?.focus()
    }
  }

  const agentName = findAgent(chat.agent)?.name ?? chat.agent

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <textarea
        ref={inputRef}
        className="composer__input"
        rows={1}
        value={text}
        placeholder={running ? `Send a follow-up to ${agentName}` : `Ask ${agentName} anything`}
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
      />
      <div className="composer__footer">
        <ModelPicker chat={chat} started={started} />
        <div className="composer__actions">
          {usage && <UsageIndicator usage={usage} />}
          {running && !canSend ? (
            <button
              type="button"
              className="composer__button"
              aria-label="Stop"
              title="Stop"
              onClick={() => void atox.conversations.interrupt(chat.id)}
            >
              <Square className="icon composer__stop-icon" />
            </button>
          ) : (
            <button
              type="submit"
              className="composer__button"
              aria-label="Send"
              title="Send"
              disabled={!canSend}
            >
              <ArrowUp className="icon" />
            </button>
          )}
        </div>
      </div>
    </form>
  )
}

/** Пути через пробел; путь с пробелами — в кавычках, чтобы агент прочитал его целиком. */
function joinPaths(paths: readonly string[]): string {
  return paths.map((path) => (/\s/.test(path) ? `"${path}"` : path)).join(' ')
}
