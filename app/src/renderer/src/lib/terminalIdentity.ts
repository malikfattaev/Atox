import type { IDisposable, Terminal } from '@xterm/xterm'

/** XTVERSION (`CSI > q`, а также `CSI > 0 q`) — запрос имени и версии терминала. */
const XTVERSION = { prefix: '>', final: 'q' } as const

/**
 * Отвечает на XTVERSION, которого нет в xterm. По ответу программы узнают терминал и уточняют
 * его возможности: Claude Code, например, только после него спрашивает о синхронном выводе
 * (DEC 2026) — без синхронного вывода каждая перерисовка агента мерцает и дёргает прокрутку.
 */
export function registerTerminalIdentity(terminal: Terminal): IDisposable {
  return terminal.parser.registerCsiHandler(XTVERSION, (params) => {
    if (params.some((param) => param !== 0)) {
      return false
    }
    // Ответ уходит программе как вывод терминала, а не как ввод пользователя.
    terminal.input(`\x1bP>|${__APP_NAME__}(${__APP_VERSION__})\x1b\\`, false)
    return true
  })
}
