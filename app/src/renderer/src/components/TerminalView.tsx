import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { colorSchemeQuery, readTerminalAppearance } from '../lib/terminalTheme'

const { atox } = window

/** Программы (например, агенты) часто меняют заголовок терминала — сохраняем только устоявшийся. */
const TITLE_SETTLE_DELAY_MS = 500

const SCROLLBACK_LINES = 10_000

const EXIT_MESSAGE = '\r\n\x1b[2mПроцесс завершён. Нажмите любую клавишу, чтобы перезапустить.\x1b[0m'

interface TerminalViewProps {
  chatId: string
  active: boolean
  onTitleChange(title: string): void
}

export function TerminalView({ chatId, active, onTitleChange }: TerminalViewProps) {
  // xterm монтируется во внутренний элемент без отступов: FitAddon считает строки
  // по размеру родителя и не учитывает его padding.
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const terminal = new Terminal({
      ...readTerminalAppearance(container),
      cursorBlink: true,
      macOptionIsMeta: true,
      scrollback: SCROLLBACK_LINES
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(container)
    terminalRef.current = terminal
    fitRef.current = fit

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

    const inputSubscription = terminal.onData((data) => {
      if (exited) {
        exited = false
        terminal.reset()
        void attach()
        return
      }
      atox.terminal.write(chatId, data)
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
      const { theme } = readTerminalAppearance(container)
      terminal.options.theme = theme
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
      unsubscribeData()
      unsubscribeExit()
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
  }, [chatId])

  useEffect(() => {
    if (active) {
      fitRef.current?.fit()
      terminalRef.current?.focus()
    }
  }, [active])

  return (
    <div className="terminal-view" hidden={!active}>
      <div ref={containerRef} className="terminal-view__host" />
    </div>
  )
}
