import { useEffect, useState } from 'react'
import type { AgentId } from '../../../shared/agents'
import type { AgentCommand } from '../../../shared/conversation'

const { atox } = window

/**
 * Команды, которые Atox выполняет сам, а не пишет агенту: меняют настройки чата, показывают
 * лимиты и контекст карточкой, начинают разговор заново или закрывают чат.
 */
export const LOCAL_COMMANDS: readonly AgentCommand[] = [
  { name: 'model', description: 'Choose the model for this chat', argumentHint: '[model]' },
  { name: 'effort', description: 'Choose how hard the model thinks', argumentHint: '[level]' },
  { name: 'usage', description: 'Show plan usage limits' },
  { name: 'context', description: 'Show what fills the context window' },
  { name: 'clear', description: 'Start a new conversation in this chat' },
  { name: 'exit', description: 'Close this chat' }
]

/** Другие имена команд Atox — как в Claude Code. В подсказках их нет. */
export const LOCAL_COMMAND_ALIASES: Readonly<Record<string, string>> = {
  quit: 'exit',
  reset: 'clear',
  new: 'clear'
}

/**
 * Команды для подсказок после «/»: свои команды Atox и команды агента. Агента спрашивают,
 * только когда подсказки понадобились, — каждый раз заново: Atox помнит ответ недолго, и так
 * подхватываются новые скиллы и команды. Пока ответ идёт, видны прежние команды.
 */
export function useAgentCommands(
  chatId: string,
  agent: AgentId,
  needed: boolean
): readonly AgentCommand[] {
  const key = `${chatId}\0${agent}`
  const [loaded, setLoaded] = useState<{ key: string; commands: AgentCommand[] } | null>(null)
  const agentCommands = loaded?.key === key ? loaded.commands : null

  useEffect(() => {
    if (!needed) {
      return
    }
    let cancelled = false
    void atox.conversations.commands(chatId).then((commands) => {
      if (!cancelled) {
        setLoaded({ key, commands })
      }
    })
    return () => {
      cancelled = true
    }
  }, [chatId, key, needed])

  const local = new Set([
    ...LOCAL_COMMANDS.map(({ name }) => name),
    ...Object.keys(LOCAL_COMMAND_ALIASES)
  ])
  return [...LOCAL_COMMANDS, ...(agentCommands ?? []).filter(({ name }) => !local.has(name))]
}
