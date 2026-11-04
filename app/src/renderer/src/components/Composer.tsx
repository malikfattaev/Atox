import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp, FileText, Plus, Square, X } from 'lucide-react'
import { findAgent } from '../../../shared/agents'
import {
  isChatCommand,
  type AgentCommand,
  type ConversationUsage
} from '../../../shared/conversation'
import type { Chat } from '../../../shared/models'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { useAgentCatalog } from '../hooks/useAgentCatalog'
import { LOCAL_COMMAND_ALIASES, useAgentCommands } from '../hooks/useAgentCommands'
import { attachFiles, attachPicked, fileName, type Attachment } from '../lib/attachments'
import {
  currentModel,
  matchEffort,
  matchModel,
  modelConfiguration
} from '../lib/modelSelection'
import { CommandMenu, filterCommands } from './CommandMenu'
import { ImageViewer } from './ImageViewer'
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
  const { configureChat, removeChat } = useProjectsContext()
  const catalog = useAgentCatalog(chat.agent)
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [viewedImage, setViewedImage] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const canSend = text.trim().length > 0 || attachments.length > 0

  // Подсказки команд: видны, пока набирается имя команды и их не закрыли Escape.
  const commandQuery = COMMAND_NAME.exec(text)?.[1]
  const commands = useAgentCommands(chat.id, chat.agent, commandQuery !== undefined)
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

  // Escape останавливает агента, как в терминале. Escape, который уже что-то закрыл
  // (подсказки, переименование), агента не трогает.
  useEffect(() => {
    if (!focused || !running) {
      return
    }
    const stopOnEscape = (event: globalThis.KeyboardEvent) => {
      const target = event.target
      const editingElsewhere =
        target instanceof HTMLElement &&
        target !== inputRef.current &&
        (target.isContentEditable || target.matches('input, textarea, select'))
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !event.isComposing &&
        !editingElsewhere &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault()
        void atox.conversations.interrupt(chat.id)
      }
    }
    window.addEventListener('keydown', stopOnEscape)
    return () => window.removeEventListener('keydown', stopOnEscape)
  }, [focused, running, chat.id])

  // Поле растёт вместе с текстом, пока не упрётся в max-height из стилей.
  useLayoutEffect(() => {
    const input = inputRef.current
    if (input) {
      fitToContent(input)
    }
  }, [text])

  // Поле стало уже или шире (раздвинули чаты, скрыли сайдбар): строки перенеслись иначе.
  useEffect(() => {
    const input = inputRef.current
    if (!input) {
      return
    }
    let width = input.clientWidth
    const observer = new ResizeObserver(() => {
      if (input.clientWidth !== width) {
        width = input.clientWidth
        fitToContent(input)
      }
    })
    observer.observe(input)
    return () => observer.disconnect()
  }, [])

  /** `true` — Atox выполнил команду сам и писать агенту ничего не нужно. */
  const runLocalCommand = (message: string): boolean => {
    const [, typed, argument = ''] = COMMAND_LINE.exec(message) ?? []
    const name = typed && (LOCAL_COMMAND_ALIASES[typed] ?? typed)
    if (name === 'exit') {
      void removeChat(chat.id)
      return true
    }
    if (isChatCommand(name)) {
      void atox.conversations.runCommand(chat.id, name)
      return true
    }
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
    if (!message && attachments.length === 0) {
      return
    }
    if (attachments.length > 0 || !runLocalCommand(message)) {
      const pathsOf = (kind: Attachment['kind']) =>
        attachments.filter((attachment) => attachment.kind === kind).map(({ path }) => path)
      void atox.conversations.send(chat.id, message, {
        images: pathsOf('image'),
        files: pathsOf('file')
      })
      setAttachments([])
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

  /** Добавляет вложения в конец; файл, который уже приложен, второй раз не добавляется. */
  const addAttachments = (added: readonly Attachment[]) =>
    setAttachments((current) => [
      ...current,
      ...added.filter(({ path }) => !current.some((attachment) => attachment.path === path))
    ])

  /** Прикладывает вставленные или перетащенные файлы. `true` — среди них было что приложить. */
  const addFiles = (files: readonly File[]): boolean => {
    if (files.length === 0) {
      return false
    }
    void attachFiles(files)
      .then(addAttachments)
      .catch((error) => console.error('Failed to attach the files', error))
    inputRef.current?.focus()
    return true
  }

  const pickFiles = async () => {
    addAttachments((await atox.files.pick()).map(attachPicked))
    inputRef.current?.focus()
  }

  const addFilesRef = useRef(addFiles)
  addFilesRef.current = addFiles

  // Картинку можно вставить и бросить в любое место чата, а не только в поле ввода.
  useEffect(() => {
    const view = inputRef.current?.closest<HTMLElement>('.chat-view')
    if (!focused || !view) {
      return
    }
    const acceptPaste = (event: ClipboardEvent) => {
      const target = event.target
      const editingElsewhere =
        target instanceof HTMLElement &&
        target !== inputRef.current &&
        (target.isContentEditable || target.matches('input, textarea, select'))
      const files = [...(event.clipboardData?.files ?? [])]
      if (!editingElsewhere && files.length > 0 && addFilesRef.current(files)) {
        event.preventDefault()
      }
    }
    const allowDrop = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault()
      }
    }
    const acceptDrop = (event: DragEvent) => {
      const files = [...(event.dataTransfer?.files ?? [])]
      if (files.length > 0) {
        event.preventDefault()
        addFilesRef.current(files)
      }
    }
    window.addEventListener('paste', acceptPaste)
    view.addEventListener('dragover', allowDrop)
    view.addEventListener('drop', acceptDrop)
    return () => {
      window.removeEventListener('paste', acceptPaste)
      view.removeEventListener('dragover', allowDrop)
      view.removeEventListener('drop', acceptDrop)
    }
  }, [focused])

  const agentName = findAgent(chat.agent)?.name ?? chat.agent

  const removeAttachment = (path: string) =>
    setAttachments((current) => current.filter((attachment) => attachment.path !== path))

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
    >
      {suggestions.length > 0 && (
        <CommandMenu
          commands={suggestions}
          activeIndex={activeIndex}
          onHover={setActiveIndex}
          onChoose={(command) => chooseCommand(command, true)}
        />
      )}
      {/* Само поле: вложения, «+», текст и отправка. Остальное — под ним и не мешает писать. */}
      <div className="composer__box">
        {attachments.length > 0 && (
          <ul className="composer__attachments">
            {attachments.map((attachment) => (
              <li
                key={attachment.path}
                className="composer__attachment"
                data-kind={attachment.kind}
                title={attachment.path}
              >
                {attachment.kind === 'image' ? (
                  <button
                    type="button"
                    className="composer__attachment-preview"
                    aria-label="Open image"
                    onClick={() => setViewedImage(attachment.preview)}
                  >
                    <img src={attachment.preview} alt="" />
                  </button>
                ) : (
                  <>
                    <FileText className="icon composer__attachment-icon" aria-hidden />
                    <span className="composer__attachment-name">{fileName(attachment.path)}</span>
                  </>
                )}
                <button
                  type="button"
                  className="composer__attachment-remove"
                  aria-label={`Remove ${fileName(attachment.path)}`}
                  title="Remove"
                  onClick={() => removeAttachment(attachment.path)}
                >
                  <X className="icon" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="composer__row">
          <button
            type="button"
            className="composer__attach"
            aria-label="Attach files"
            title="Attach files"
            onClick={() => void pickFiles()}
          >
            <Plus className="icon" />
          </button>
          <textarea
            ref={inputRef}
            className="composer__input"
            rows={1}
            value={text}
            placeholder={running ? `Send a follow-up to ${agentName}` : `Ask ${agentName} anything`}
            spellCheck={false}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          {running && !canSend ? (
            <button
              type="button"
              className="composer__button"
              aria-label="Stop"
              title="Stop (Esc)"
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
      <div className="composer__footer">
        <ModelPicker chat={chat} started={started} openRequest={pickerRequest} />
        {usage && <UsageIndicator usage={usage} />}
      </div>
      {viewedImage && <ImageViewer src={viewedImage} onClose={() => setViewedImage(null)} />}
    </form>
  )
}

/** Высота поля ввода по его тексту. */
function fitToContent(input: HTMLTextAreaElement): void {
  input.style.height = 'auto'
  input.style.height = `${input.scrollHeight}px`
}
