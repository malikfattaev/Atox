/** Агент, с которым идёт разговор в чате: Atox управляет его CLI через служебный протокол. */
export interface Agent {
  id: string
  name: string
  /** Программа агента, которую ищем на компьютере пользователя. */
  program: string
}

export const AGENTS = [
  { id: 'claude', name: 'Claude', program: 'claude' },
  { id: 'codex', name: 'Codex', program: 'codex' }
] as const satisfies readonly Agent[]

export type AgentId = (typeof AGENTS)[number]['id']

export const DEFAULT_AGENT_ID: AgentId = 'claude'

export function findAgent(id: string | undefined): (typeof AGENTS)[number] | undefined {
  return AGENTS.find((agent) => agent.id === id)
}

export function isAgentId(id: unknown): id is AgentId {
  return typeof id === 'string' && findAgent(id) !== undefined
}
