import { Terminal } from '@xterm/headless'

/**
 * Видимый экран терминала по накопленному выводу: вывод проигрывается в эмуляторе без
 * отрисовки. Делается разово по запросу, поэтому постоянной нагрузки не создаёт.
 */
export function renderScreen(output: string, cols: number, rows: number): Promise<string[]> {
  const terminal = new Terminal({ cols, rows, scrollback: 0, allowProposedApi: true })
  return new Promise((resolve) => {
    terminal.write(output, () => {
      const buffer = terminal.buffer.active
      const lines = Array.from(
        { length: rows },
        (_, row) => buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? ''
      )
      terminal.dispose()
      resolve(lines)
    })
  })
}
