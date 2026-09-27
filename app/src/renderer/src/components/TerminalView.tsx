import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon, type ISearchDecorationOptions } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { useChatActivityTracker } from '../hooks/ChatActivityContext'
import { useSettings } from '../hooks/SettingsContext'
import { colorSchemeQuery, readTerminalAppearance } from '../lib/terminalTheme'
import { TerminalFindBar } from './TerminalFindBar'

const { atox } = window

/** Программы (например, агенты) часто меняют заголовок терминала — сохраняем только устоявшийся. */
const TITLE_SETTLE_DELAY_MS = 500

const SCROLLBACK_LINES = 10_000

const EXIT_MESSAGE = '\r\n\x1b[2mProcess exited. Press any key to restart.\x1b[0m'

/** OSC 9 — уведомление от программы в терминале (так их отправляют, например, агенты). */
const NOTIFICATION_OSC = 9

/** OSC 9;4 — индикатор прогресса (ConEmu), а не уведомление. */
const PROGRESS_OSC_PREFIX = '4;'

const ATTENTION_MESSAGE = 'Needs your attention'

/**
 * Shift+Enter отправляется как ESC + CR (Meta+Enter): так перевод строки без отправки
 * понимают агенты в терминале. Сам xterm отличить его от обычного Enter не даёт.
 */
const SHIFT_ENTER_SEQUENCE = '\x1b\r'

interface TerminalSearch {
  addon: SearchAddon
  decorations: ISearchDecorationOptions
}

interface TerminalViewProps {
  chatId: string
  active: boolean
  /** Номер запроса поиска (⌘F) для этого чата; `null` — панель поиска закрыта. */
  findRequest: number | null
  onCloseFind(): void
  onTitleChange(title: string): void
}

export function TerminalView({
  chatId,
  active,
  findRequest,
  onCloseFind,
  onTitleChange
}: TerminalViewProps) {
  const { terminalFontSize } = useSettings()
  const activity = useChatActivityTracker()
  // xterm монтируется во внутренний элемент без отступов: FitAddon считает строки
  // по размеру родителя и не учитывает его padding.
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [search, setSearch] = useState<TerminalSearch | null>(null)
  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange
  // Размер шрифта при создании терминала; дальнейшие изменения применяет отдельный эффект.
  const initialFontSizeRef = useRef(terminalFontSize)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const appearance = readTerminalAppearance(container)
    const terminal = new Terminal({
      fontFamily: appearance.fontFamily,
      fontSize: initialFontSizeRef.current,
      theme: appearance.theme,
      cursorBlink: true,
      macOptionIsMeta: true,
      scrollback: SCROLLBACK_LINES,
      // Подсветка совпадений поиска построена на декорациях — это «предлагаемый» API xterm.
      allowProposedApi: true
    })
    const fit = new FitAddon()
    const searchAddon = new SearchAddon()
    terminal.loadAddon(fit)
    terminal.loadAddon(searchAddon)
    // Ссылки открываются через window.open — main-процесс передаёт их системному браузеру.
    terminal.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri)))
    terminal.open(container)
    loadWebglRenderer(terminal)
    terminalRef.current = terminal
    fitRef.current = fit
    setSearch({ addon: searchAddon, decorations: appearance.searchDecorations })

    // Скрытый терминал имеет нулевой размер — подгонять его под контейнер бессмысленно.
    const fitIfVisible = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        fit.fit()
      }
    }
    fitIfVisible()

    let disposed = false
    let attached = false
    let exited = false

    // Всё, что пришло до ответа attach, уже входит в возвращённый снимок вывода.
    const unsubscribeData = atox.terminal.onData(chatId, (data) => {
      if (attached) {
        terminal.write(data)
        activity.reportOutput(chatId)
      }
    })
    const unsubscribeExit = atox.terminal.onExit(chatId, () => {
      exited = true
      attached = false
      terminal.write(EXIT_MESSAGE)
    })

    const attach = async () => {
      try {
        const snapshot = await atox.terminal.attach(chatId, {
          cols: terminal.cols,
          rows: terminal.rows
        })
        if (!disposed) {
          terminal.write(snapshot)
          attached = true
        }
      } catch (error) {
        terminal.write(`\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m`)
      }
    }

    terminal.attachCustomKeyEventHandler((event) => {
      if (!isShiftEnter(event)) {
        return true
      }
      if (event.type === 'keydown') {
        terminal.input(SHIFT_ENTER_SEQUENCE)
      }
      // Все фазы нажатия (keydown, keypress, keyup) скрываем от xterm, иначе он отправит CR.
      return false
    })

    const inputSubscription = terminal.onData((data) => {
      if (exited) {
        exited = false
        terminal.reset()
        void attach()
        return
      }
      activity.reportInput(chatId)
      atox.terminal.write(chatId, data)
    })

    const bellSubscription = terminal.onBell(() =>
      activity.reportAttention(chatId, ATTENTION_MESSAGE)
    )
    const notificationHandler = terminal.parser.registerOscHandler(NOTIFICATION_OSC, (data) => {
      if (data.startsWith(PROGRESS_OSC_PREFIX)) {
        return false
      }
      activity.reportAttention(chatId, data.trim() || ATTENTION_MESSAGE)
      return true
    })

    const resizeSubscription = terminal.onResize((size) => atox.terminal.resize(chatId, size))

    let titleTimer: ReturnType<typeof setTimeout> | undefined
    const titleSubscription = terminal.onTitleChange((title) => {
      clearTimeout(titleTimer)
      const trimmed = title.trim()
      if (trimmed) {
        titleTimer = setTimeout(() => onTitleChangeRef.current(trimmed), TITLE_SETTLE_DELAY_MS)
      }
    })

    const resizeObserver = new ResizeObserver(fitIfVisible)
    resizeObserver.observe(container)

    const applyAppearance = () => {
      const { theme, searchDecorations } = readTerminalAppearance(container)
      terminal.options.theme = theme
      setSearch({ addon: searchAddon, decorations: searchDecorations })
    }
    colorSchemeQuery.addEventListener('change', applyAppearance)

    void attach()

    return () => {
      disposed = true
      clearTimeout(titleTimer)
      colorSchemeQuery.removeEventListener('change', applyAppearance)
      resizeObserver.disconnect()
      inputSubscription.dispose()
      resizeSubscription.dispose()
      titleSubscription.dispose()
      bellSubscription.dispose()
      notificationHandler.dispose()
      unsubscribeData()
      unsubscribeExit()
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
      setSearch(null)
    }
  }, [chatId, activity])

  useEffect(() => {
    const terminal = terminalRef.current
    if (terminal && terminal.options.fontSize !== terminalFontSize) {
      terminal.options.fontSize = terminalFontSize
      if (active) {
        fitRef.current?.fit()
      }
    }
  }, [terminalFontSize, active])

  // Фокус возвращается в терминал при переключении на чат и после закрытия поиска.
  const findOpen = findRequest !== null
  useEffect(() => {
    if (active && !findOpen) {
      fitRef.current?.fit()
      terminalRef.current?.focus()
    }
  }, [active, findOpen])

  return (
    <div className="terminal-view" hidden={!active}>
      <div ref={containerRef} className="terminal-view__host" />
      {search && findRequest !== null && (
        <TerminalFindBar
          search={search.addon}
          decorations={search.decorations}
          focusRequest={findRequest}
          onClose={onCloseFind}
        />
      )}
    </div>
  )
}

function isShiftEnter(event: KeyboardEvent): boolean {
  return (
    event.key === 'Enter' && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
  )
}

/**
 * Отрисовка через WebGL заметно быстрее на объёмном выводе агентов. Если WebGL недоступен
 * или контекст потерян (у браузера лимит одновременных контекстов), xterm остаётся на DOM-отрисовке.
 */
function loadWebglRenderer(terminal: Terminal): void {
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => webgl.dispose())
    terminal.loadAddon(webgl)
  } catch (error) {
    console.warn('WebGL renderer is unavailable, using the DOM renderer', error)
  }
}
