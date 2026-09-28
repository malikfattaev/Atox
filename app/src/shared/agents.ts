/** CLI-агент, который запускается в терминале нового чата. */
export interface Agent {
  id: string
  name: string
  /** Команда запуска по умолчанию; пустая строка — просто оболочка без агента. */
  command: string
  /** Имя SF Symbol для пункта меню. */
  symbol: string
}

export const AGENTS = [
  { id: 'claude', name: 'Claude Code', command: 'claude', symbol: 'sparkle' },
  { id: 'codex', name: 'Codex', command: 'codex', symbol: 'chevron.left.forwardslash.chevron.right' },
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini', symbol: 'diamond' },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', symbol: 'curlybraces' },
  { id: 'terminal', name: 'Terminal', command: '', symbol: 'apple.terminal' }
] as const satisfies readonly Agent[]

export type AgentId = (typeof AGENTS)[number]['id']

/** Пустой терминал доступен всегда — он не зависит от установленных программ. */
export const TERMINAL_AGENT_ID: AgentId = 'terminal'

export const DEFAULT_AGENT_ID: AgentId = 'claude'

/** Свои команды запуска агентов из настроек, например `claude --continue`. */
export type AgentCommands = Partial<Record<AgentId, string>>

export function findAgent(id: string | undefined): (typeof AGENTS)[number] | undefined {
  return AGENTS.find((agent) => agent.id === id)
}

export function isAgentId(id: unknown): id is AgentId {
  return typeof id === 'string' && findAgent(id) !== undefined
}

/** Команда, которой запускается агент чата: своя из настроек или по умолчанию. */
export function resolveAgentCommand(id: AgentId | undefined, overrides: AgentCommands): string {
  const agent = findAgent(id ?? TERMINAL_AGENT_ID)
  return overrides[agent?.id ?? TERMINAL_AGENT_ID] || (agent?.command ?? '')
}
