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
import type { AgentCommand, ConversationUsage } from '../../../shared/conversation'
import type { Chat } from '../../../shared/models'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { useAgentCatalog } from '../hooks/useAgentCatalog'
import { useAgentCommands } from '../hooks/useAgentCommands'
import {
  currentModel,
  matchEffort,
  matchModel,
  modelConfiguration
} from '../lib/modelSelection'
import { CommandMenu, filterCommands } from './CommandMenu'
import { ModelPicker } from './ModelPicker'
import { UsageIndicator } from './UsageIndicator'

const { atox } = window

/** Набирается имя команды: «/» в начале и ещё ни одного пробела. */
const COMMAND_NAME = /^\/(\S*)$/

/** Команда с аргументом целиком: «/effort high». */
const COMMAND_LINE = /^\/(\S+)(?:\s+([\s\S]*))?$/

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
  const { configureChat } = useProjectsContext()
  const catalog = useAgentCatalog(chat.agent)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const canSend = text.trim().length > 0

  // Подсказки команд: видны, пока набирается имя команды и их не закрыли Escape.
  const commandQuery = COMMAND_NAME.exec(text)?.[1]
  const commands = useAgentCommands(chat.id, commandQuery !== undefined)
  const [dismissedText, setDismissedText] = useState<string | null>(null)
  const suggestions =
    commandQuery !== undefined && dismissedText !== text ? filterCommands(commands, commandQuery) : []
  const [activeIndex, setActiveIndex] = useState(0)
  const [pickerRequest, setPickerRequest] = useState(0)

  useEffect(() => setActiveIndex(0), [commandQuery])

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

  /** `true` — Atox выполнил команду сам и писать агенту ничего не нужно. */
  const runLocalCommand = (message: string): boolean => {
    const [, name, argument = ''] = COMMAND_LINE.exec(message) ?? []
    if (name !== 'model' && name !== 'effort') {
      return false
    }
    const model = catalog && currentModel(chat, catalog)
    if (catalog && argument && name === 'model') {
      const match = matchModel(catalog, argument)
      if (match) {
        void configureChat(chat.id, modelConfiguration(chat, catalog, match.id))
        return true
      }
    }
    if (model && argument && name === 'effort') {
      const effort = matchEffort(model, argument)
      if (effort !== undefined) {
        void configureChat(chat.id, { effort })
        return true
      }
    }
    // Без аргумента или с незнакомым — меню, где видно, из чего выбирать.
    setPickerRequest((request) => request + 1)
    return true
  }

  const submit = (value: string) => {
    const message = value.trim()
    if (!message) {
      return
    }
    if (!runLocalCommand(message)) {
      void atox.conversations.send(chat.id, message)
    }
    setText('')
  }

  const send = () => submit(text)

  /** Выбор подсказки: команда с аргументами дописывается в поле, без них — сразу выполняется. */
  const chooseCommand = (command: AgentCommand, run: boolean) => {
    if (run && !command.argumentHint) {
      submit(`/${command.name}`)
    } else {
      setText(`/${command.name} `)
    }
    inputRef.current?.focus()
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
    if (event.nativeEvent.isComposing) {
      return
    }
    const active = suggestions[activeIndex]
    if (active) {
      const handled = () => {
        event.preventDefault()
        return true
      }
      if (event.key === 'ArrowDown' && handled()) {
        setActiveIndex((index) => (index + 1) % suggestions.length)
        return
      }
      if (event.key === 'ArrowUp' && handled()) {
        setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length)
        return
      }
      if (event.key === 'Tab' && handled()) {
        chooseCommand(active, false)
        return
      }
      if (event.key === 'Enter' && !event.shiftKey && handled()) {
        chooseCommand(active, true)
        return
      }
      if (event.key === 'Escape' && handled()) {
        setDismissedText(text)
        return
      }
    }
    // Enter с Shift — новая строка, а не отправка.
    if (event.key === 'Enter' && !event.shiftKey) {
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
      {suggestions.length > 0 && (
        <CommandMenu
          commands={suggestions}
          activeIndex={activeIndex}
          onHover={setActiveIndex}
          onChoose={(command) => chooseCommand(command, true)}
        />
      )}
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
        <ModelPicker chat={chat} started={started} openRequest={pickerRequest} />
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
