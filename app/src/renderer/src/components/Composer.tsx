import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp, CircleAlert, FileText, LoaderCircle, Plus, Square, X } from 'lucide-react'
import {
  isChatCommand,
  type AgentCommand,
  type ConversationUsage
} from '../../../shared/conversation'
import type { Chat } from '../../../shared/models'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { useAgentCatalog } from '../hooks/useAgentCatalog'
import { LOCAL_COMMAND_ALIASES, useAgentCommands } from '../hooks/useAgentCommands'
import {
  attachFiles,
  attachPicked,
  fileName,
  type AttachFailure,
  type Attachment
} from '../lib/attachments'
import {
  newPendingId,
  updateDraft,
  useComposerDraft,
  type ComposerDraft
} from '../lib/composerDrafts'
import { ipcErrorMessage } from '../lib/ipcError'
import { currentModel, matchEffort, matchModel, modelConfiguration } from '../lib/modelSelection'
import { CommandMenu, filterCommands } from './CommandMenu'
import { ImageViewer } from './ImageViewer'
import { imageContextMenu, type ShownImage } from '../lib/imageActions'
import { ModelPicker } from './ModelPicker'
import { UsageIndicator } from './UsageIndicator'

const { atox } = window

/** Набирается имя команды: «/» в начале и ещё ни одного пробела. */
const COMMAND_NAME = /^\/(\S*)$/

/** Команда с аргументом целиком: «/effort high». */
const COMMAND_LINE = /^\/(\S+)(?:\s+([\s\S]*))?$/

function attachFailureMessage(failures: readonly AttachFailure[]): string {
  return failures
    .map(({ name, message }) => `Could not attach ${name || 'the file'}: ${message}`)
    .join('\n')
}

interface ComposerProps {
  chat: Chat
  /** Агент работает: кнопка отправки становится кнопкой остановки. */
  running: boolean
  /** В чате уже есть сообщения. */
  started: boolean
  /** Чат выбран: поле ввода получает фокус. */
  focused: boolean
  usage: ConversationUsage | undefined
  /** Пользователь отправил сообщение или команду из этого поля. */
  onSend(): void
}

export function Composer({ chat, running, started, focused, usage, onSend }: ComposerProps) {
  const { configureChat, removeChat } = useProjectsContext()
  const catalog = useAgentCatalog(chat.agent)
  // Черновик хранится вне компонента: выгруженный чат не теряет набранное.
  const { text, attachments, pending, error } = useComposerDraft(chat.id)
  const chatId = chat.id
  const update = (change: (draft: ComposerDraft) => Partial<ComposerDraft>) =>
    updateDraft(chatId, change)
  const setText = (value: string) => update(() => ({ text: value }))
  const setError = (value: string | null) => update(() => ({ error: value }))
  const [viewedImage, setViewedImage] = useState<ShownImage | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const hasContent = text.trim().length > 0 || attachments.length > 0
  // Пока вложение готовится, сообщение ушло бы без него.
  const canSend = hasContent && pending.length === 0

  // Подсказки команд: видны, пока набирается имя команды и их не закрыли Escape.
  const commandQuery = COMMAND_NAME.exec(text)?.[1]
  const commands = useAgentCommands(chat.id, chat.agent, commandQuery !== undefined)
  const [dismissedText, setDismissedText] = useState<string | null>(null)
  const suggestions =
    commandQuery !== undefined && dismissedText !== text
      ? filterCommands(commands, commandQuery)
      : []
  const [activeIndex, setActiveIndex] = useState(0)
  const [pickerRequest, setPickerRequest] = useState(0)

  useEffect(() => setActiveIndex(0), [commandQuery])

  useEffect(() => {
    const input = inputRef.current
    if (!focused || !input) {
      return
    }
    // Чат выбрали кликом внутри него — например, в поле ответа на вопрос агента в соседней
    // панели: фокус остаётся там, куда кликнули.
    const focusedElement = document.activeElement
    const focusInsideChat =
      focusedElement !== null &&
      focusedElement !== document.body &&
      Boolean(input.closest('.chat-view')?.contains(focusedElement))
    if (!focusInsideChat) {
      input.focus()
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
    if ((!message && attachments.length === 0) || pending.length > 0) {
      return
    }
    setError(null)
    onSend()
    if (attachments.length > 0 || !runLocalCommand(message)) {
      const sent = attachments
      const pathsOf = (kind: Attachment['kind']) =>
        sent.filter((attachment) => attachment.kind === kind).map(({ path }) => path)
      atox.conversations
        .send(chat.id, message, {
          images: pathsOf('image'),
          files: pathsOf('file')
        })
        .catch((sendError: unknown) => {
          // Сообщение не ушло: возвращаем его в поле, чтобы не набирать заново. Если пользователь
          // уже начал писать следующее, неотправленное встаёт перед ним.
          update((draft) => ({
            text: draft.text ? `${value}\n${draft.text}` : value,
            attachments: [
              ...sent,
              ...draft.attachments.filter(
                ({ path }) => !sent.some((attachment) => attachment.path === path)
              )
            ],
            error: `Could not send the message: ${ipcErrorMessage(sendError)}`
          }))
        })
      update(() => ({ text: '', attachments: [] }))
    } else {
      setText('')
    }
    // Кнопка, которой отправили, сменяется кнопкой остановки или гаснет — фокус не должен
    // уйти вместе с ней.
    inputRef.current?.focus()
  }

  const stop = () => {
    void atox.conversations.interrupt(chat.id)
    // После остановки кнопка «Стоп» пропадает: фокус остаётся в поле, а не уходит в body.
    inputRef.current?.focus()
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
    update(({ attachments: current }) => ({
      attachments: [
        ...current,
        ...added.filter(({ path }) => !current.some((attachment) => attachment.path === path))
      ]
    }))

  /** Прикладывает вставленные или перетащенные файлы. `true` — среди них было что приложить. */
  const addFiles = (files: readonly File[]): boolean => {
    if (files.length === 0) {
      return false
    }
    const added = files.map((file) => ({ id: newPendingId(), name: file.name }))
    update((draft) => ({ pending: [...draft.pending, ...added] }))
    void attachFiles(files).then(({ attachments: attached, failures }) => {
      update((draft) => ({
        pending: draft.pending.filter((entry) => !added.includes(entry)),
        ...(failures.length > 0 && { error: attachFailureMessage(failures) })
      }))
      addAttachments(attached)
    })
    inputRef.current?.focus()
    return true
  }

  const pickFiles = async () => {
    addAttachments((await atox.files.pick()).map(attachPicked))
    inputRef.current?.focus()
  }

  /** Вставляет текст в поле на место курсора — как обычная вставка, но из любого места чата. */
  const insertIntoInput = (inserted: string) => {
    const input = inputRef.current
    if (!input) {
      return
    }
    input.focus()
    input.setRangeText(inserted, input.selectionStart, input.selectionEnd, 'end')
    setText(input.value)
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
      const clipboard = event.clipboardData
      const files = [...(clipboard?.files ?? [])]
      if (editingElsewhere || !clipboard || files.length === 0) {
        return
      }
      // Таблицы и текстовые редакторы кладут в буфер вместе с текстом его картинку. Файлы,
      // скопированные в Finder, тоже приходят с текстом — их именами, — но лежат на диске.
      const text = clipboard.getData('text/plain')
      const copiedFromDisk = files.some((file) => atox.files.getPath(file))
      if (text && !copiedFromDisk) {
        if (target !== inputRef.current) {
          event.preventDefault()
          insertIntoInput(text)
        }
        return
      }
      if (addFilesRef.current(files)) {
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

  const removeAttachment = (path: string) =>
    update((draft) => ({
      attachments: draft.attachments.filter((attachment) => attachment.path !== path)
    }))

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
      {error && (
        <div className="composer__error" role="alert">
          <CircleAlert className="icon" aria-hidden />
          <span className="composer__error-text">{error}</span>
          <button
            type="button"
            className="composer__error-close"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={() => setError(null)}
          >
            <X className="icon" />
          </button>
        </div>
      )}
      {/* Само поле: вложения, «+», текст и отправка. Остальное — под ним и не мешает писать. */}
      <div className="composer__box">
        {(attachments.length > 0 || pending.length > 0) && (
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
                    onClick={() =>
                      setViewedImage({
                        src: attachment.preview,
                        path: attachment.path
                      })
                    }
                    onContextMenu={imageContextMenu({
                      src: attachment.preview,
                      path: attachment.path
                    })}
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
            {pending.map(({ id, name }) => (
              <li
                key={`pending:${id}`}
                className="composer__attachment"
                data-kind="pending"
                title={name}
                role="status"
                aria-label={`Attaching ${name}`}
              >
                <LoaderCircle className="icon activity__spinner" aria-hidden />
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
            placeholder={running ? 'Send a follow-up' : 'Ask me anything'}
            spellCheck={false}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          {running && !hasContent ? (
            <button
              type="button"
              className="composer__button"
              aria-label="Stop"
              title="Stop (Esc)"
              onClick={stop}
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
      {/* В пустом чате только поле: новый чат начинает агент по умолчанию, сменить его можно потом. */}
      <div className="composer__footer" data-hidden={!started}>
        <ModelPicker chat={chat} openRequest={pickerRequest} />
        {usage && <UsageIndicator usage={usage} />}
      </div>
      {viewedImage && <ImageViewer image={viewedImage} onClose={() => setViewedImage(null)} />}
    </form>
  )
}
