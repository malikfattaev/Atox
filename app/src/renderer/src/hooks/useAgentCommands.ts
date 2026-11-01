import { useEffect, useState } from 'react'
import type { AgentCommand } from '../../../shared/conversation'

const { atox } = window

/** Команды, которые Atox выполняет сам: они меняют настройки чата, а не пишут агенту. */
export const LOCAL_COMMANDS: readonly AgentCommand[] = [
  { name: 'model', description: 'Choose the model for this chat', argumentHint: '[model]' },
  { name: 'effort', description: 'Choose how hard the model thinks', argumentHint: '[level]' }
]

/**
 * Команды для подсказок после «/»: свои команды Atox и команды агента. Агента спрашивают,
 * только когда подсказки впервые понадобились.
 */
export function useAgentCommands(chatId: string, needed: boolean): readonly AgentCommand[] {
  const [agentCommands, setAgentCommands] = useState<AgentCommand[] | null>(null)
  const requested = needed || agentCommands !== null

  useEffect(() => {
    if (!requested) {
      return
    }
    let cancelled = false
    void atox.conversations.commands(chatId).then((commands) => {
      if (!cancelled) {
        setAgentCommands(commands)
      }
    })
    return () => {
      cancelled = true
    }
  }, [chatId, requested])

  const local = new Set(LOCAL_COMMANDS.map(({ name }) => name))
  return [...LOCAL_COMMANDS, ...(agentCommands ?? []).filter(({ name }) => !local.has(name))]
}
