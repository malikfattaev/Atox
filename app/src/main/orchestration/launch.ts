import {
  findAgent,
  resolveAgentCommand,
  type AgentCommands,
  type AgentId
} from '../../shared/agents'

/**
 * Что добавить к команде агента, чтобы он работал с Atox без лишних вопросов:
 * Claude Code сразу разрешено запускать `atox`, а помощник Codex не останавливается
 * на предложении обновиться — ответить на него некому.
 */
const LAUNCH_ARGS: Partial<Record<AgentId, { always?: string; worker?: string }>> = {
  claude: { always: `--allowedTools 'Bash(atox:*)'` },
  codex: { worker: '-c check_for_update_on_startup=false' }
}

/**
 * Команда запуска агента чата. Флаги добавляются, только если в настройках оставлена
 * программа агента по умолчанию: у другой программы их может не быть.
 */
export function agentLaunchCommand(
  agent: AgentId | undefined,
  overrides: AgentCommands,
  { worker }: { worker: boolean }
): string {
  const command = resolveAgentCommand(agent, overrides)
  const defaultProgram = findAgent(agent)?.command
  const args = agent && LAUNCH_ARGS[agent]
  if (!args || !defaultProgram || command.split(/\s+/)[0] !== defaultProgram) {
    return command
  }
  return [command, args.always, worker ? args.worker : undefined].filter(Boolean).join(' ')
}
