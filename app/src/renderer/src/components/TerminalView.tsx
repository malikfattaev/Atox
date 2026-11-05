import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { IS_MAC } from '../../../shared/platform'
import {
  acceleratorFromEvent,
  LINUX_COPY_ACCELERATOR,
  menuAccelerators
} from '../../../shared/shortcuts'
import { useSettings } from '../hooks/SettingsContext'
import { colorSchemeQuery } from '../lib/colorScheme'
import { ipcErrorMessage } from '../lib/ipcError'
import { formatPathsForShell } from '../lib/shellPaths'
import { registerTerminalIdentity } from '../lib/terminalIdentity'
import { readTerminalAppearance } from '../lib/terminalTheme'

const { atox } = window

const SCROLLBACK_LINES = 10_000

/**
 * Новый размер передаётся оболочке, когда он устоялся: пока тянут край панели или окна,
 * программа в терминале иначе перерисовывала бы весь экран на каждом кадре.
 */
const PTY_RESIZE_DELAY_MS = 100

/**
 * Shift+Enter отправляется как ESC + CR (Meta+Enter): так перевод строки без отправки
 * понимают агенты в терминале. Сам xterm отличить его от обычного Enter не даёт.
 */
const SHIFT_ENTER_SEQUENCE = '\x1b\r'

interface TerminalViewProps {
  projectId: string
  /** Терминал на экране; скрытый остаётся подключённым и копит вывод. */
  visible: boolean
  /** Растёт, когда терминал нужно сфокусировать, — например, панель только что открыли. */
  focusRequest: number
  /** Оболочка завершилась. */
  onExit(projectId: string): void
}

export function TerminalView({ projectId, visible, focusRequest, onExit }: TerminalViewProps) {
  const { shortcuts } = useSettings()
  // Сочетания меню читает обработчик клавиш терминала, который создаётся один раз.
  const menuAcceleratorsRef = useRef(menuAccelerators(shortcuts))
  menuAcceleratorsRef.current = menuAccelerators(shortcuts)
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit
  // xterm монтируется в элемент без отступов: FitAddon считает строки по размеру родителя
  // и не учитывает его padding.
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const terminal = new Terminal({
      ...readTerminalAppearance(container),
      // Мигающий курсор перерисовывает терминал дважды в секунду, даже когда в нём ничего
      // не происходит. Как и в Terminal.app, курсор не мигает.
      cursorBlink: false,
      macOptionIsMeta: true,
      scrollback: SCROLLBACK_LINES
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    // Ссылки открываются через window.open — main-процесс передаёт их системному браузеру.
    terminal.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri)))
    terminal.open(container)
    loadWebglRenderer(terminal)
    terminalRef.current = terminal
    fitRef.current = fit

    // У скрытого терминала нет размеров — подгонять его под контейнер бессмысленно.
    const fitIfVisible = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        fit.fit()
      }
    }
    fitIfVisible()

    let disposed = false
    let attached = false

    // Всё, что пришло до ответа attach, уже входит в возвращённый снимок вывода.
    const unsubscribeData = atox.terminals.onData(projectId, (data) => {
      if (attached) {
        terminal.write(data)
      }
    })
    const unsubscribeExit = atox.terminals.onExit(projectId, () => onExitRef.current(projectId))

    atox.terminals
      .attach(projectId, { cols: terminal.cols, rows: terminal.rows })
      .then((snapshot) => {
        if (!disposed) {
          terminal.write(snapshot)
          attached = true
        }
      })
      .catch((error: unknown) => {
        // Например, папку проекта переместили: причина остаётся видна в самом терминале.
        terminal.write(`\x1b[31m${ipcErrorMessage(error)}\x1b[0m`)
      })

    terminal.attachCustomKeyEventHandler((event) => {
      if (!IS_MAC) {
        const accelerator = acceleratorFromEvent(event)
        // Выделение xterm — не выделение страницы, и стандартное копирование его не видит.
        if (accelerator === LINUX_COPY_ACCELERATOR) {
          if (event.type === 'keydown' && terminal.hasSelection()) {
            void navigator.clipboard.writeText(terminal.getSelection())
          }
          return false
        }
        // Команды приложения на Linux — с Ctrl, как и управляющие клавиши терминала: xterm
        // отправил бы их программе, а они должны дойти до меню.
        if (accelerator && menuAcceleratorsRef.current.has(accelerator)) {
          return false
        }
      }
      if (!isShiftEnter(event)) {
        return true
      }
      if (event.type === 'keydown') {
        terminal.input(SHIFT_ENTER_SEQUENCE)
      }
      // Все фазы нажатия (keydown, keypress, keyup) скрываем от xterm, иначе он отправит CR.
      return false
    })

    const inputSubscription = terminal.onData((data) => atox.terminals.write(projectId, data))
    const identityHandler = registerTerminalIdentity(terminal)

    // Файлы, брошенные в терминал, вставляются путями, как в Terminal.app.
    const handleDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }
    }
    const handleDrop = (event: DragEvent) => {
      const files = event.dataTransfer?.files
      if (files && files.length > 0) {
        event.preventDefault()
        const paths = Array.from(files, (file) => atox.files.getPath(file)).filter(Boolean)
        if (paths.length > 0) {
          terminal.paste(formatPathsForShell(paths))
          terminal.focus()
        }
      }
    }
    container.addEventListener('dragover', handleDragOver)
    container.addEventListener('drop', handleDrop)

    let ptyResizeTimer: ReturnType<typeof setTimeout> | undefined
    const resizeSubscription = terminal.onResize((size) => {
      clearTimeout(ptyResizeTimer)
      ptyResizeTimer = setTimeout(() => atox.terminals.resize(projectId, size), PTY_RESIZE_DELAY_MS)
    })

    const resizeObserver = new ResizeObserver(fitIfVisible)
    resizeObserver.observe(container)

    const applyAppearance = () => {
      terminal.options.theme = readTerminalAppearance(container).theme
    }
    colorSchemeQuery.addEventListener('change', applyAppearance)

    return () => {
      disposed = true
      clearTimeout(ptyResizeTimer)
      colorSchemeQuery.removeEventListener('change', applyAppearance)
      container.removeEventListener('dragover', handleDragOver)
      container.removeEventListener('drop', handleDrop)
      resizeObserver.disconnect()
      inputSubscription.dispose()
      resizeSubscription.dispose()
      identityHandler.dispose()
      unsubscribeData()
      unsubscribeExit()
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
  }, [projectId])

  // Показанный терминал подгоняется под своё место: пока он был скрыт, размер не менялся.
  useEffect(() => {
    if (visible) {
      fitRef.current?.fit()
    }
  }, [visible])

  useEffect(() => {
    if (visible) {
      terminalRef.current?.focus()
    }
  }, [visible, focusRequest])

  return (
    <div className="terminal-view" hidden={!visible}>
      <div ref={containerRef} className="terminal-view__host" />
    </div>
  )
}

function isShiftEnter(event: KeyboardEvent): boolean {
  return (
    event.key === 'Enter' && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
  )
}

/**
 * Отрисовка через WebGL заметно быстрее на объёмном выводе. Если WebGL недоступен или контекст
 * потерян (у браузера лимит одновременных контекстов), xterm остаётся на DOM-отрисовке.
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
