import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  AGENTS,
  resolveAgentCommand,
  TERMINAL_AGENT_ID,
  type AgentCommands,
  type AgentId
} from '../shared/agents'
import { resolveShell } from './terminals'

const execFileAsync = promisify(execFile)

/**
 * Печатает те из переданных программ, которые найдены в PATH. Завершается успешно, даже если
 * последней программы нет: иначе код выхода цикла — от неудачного `command -v`.
 */
const FIND_PROGRAMS_SCRIPT =
  'for p in "$@"; do command -v "$p" >/dev/null 2>&1 && echo "$p"; done; exit 0'

/** Интерактивная оболочка читает .zshrc; если он завис, поиск не должен держать меню. */
const DETECT_TIMEOUT_MS = 5000

/**
 * Какие агенты установлены. Программы ищутся в интерактивной оболочке входа — с тем же PATH,
 * что и в терминалах чатов: nvm и установщики агентов часто дописывают его только в .zshrc.
 * Ответ отдаётся из кеша и обновляется в фоне: меню нового чата открывается без задержки.
 */
export class AgentDetector {
  private available: Promise<AgentId[]> | null = null

  constructor(private readonly getCommands: () => AgentCommands) {}

  list(): Promise<AgentId[]> {
    const cached = this.available
    const fresh = this.detect()
    // Первый запрос ждёт поиска, следующие получают прошлый ответ, пока идёт новый.
    fresh.then(
      (agents) => {
        this.available = Promise.resolve(agents)
      },
      () => undefined
    )
    return cached ?? fresh
  }

  private async detect(): Promise<AgentId[]> {
    const commands = this.getCommands()
    const programs = new Map<AgentId, string>()
    for (const agent of AGENTS) {
      const program = resolveAgentCommand(agent.id, commands).split(/\s+/)[0]
      if (program) {
        programs.set(agent.id, program)
      }
    }
    const requested = new Set(programs.values())
    const { stdout } = await execFileAsync(
      resolveShell(),
      ['-l', '-i', '-c', FIND_PROGRAMS_SCRIPT, 'find-agents', ...requested],
      { timeout: DETECT_TIMEOUT_MS }
    ).catch(() => ({ stdout: '' }))
    // Кроме имён программ, .zshrc может что-нибудь напечатать — берём только знакомые строки.
    const found = new Set(stdout.split('\n').filter((line) => requested.has(line)))
    return AGENTS.filter(
      (agent) =>
        agent.id === TERMINAL_AGENT_ID || found.has(programs.get(agent.id) ?? '')
    ).map(({ id }) => id)
  }
}
