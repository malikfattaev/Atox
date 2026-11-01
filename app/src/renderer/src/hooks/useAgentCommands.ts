import { useEffect, useState } from 'react'
import type { AgentId } from '../../../shared/agents'
import type { AgentCommand } from '../../../shared/conversation'

const { atox } = window

/** Команды, которые Atox выполняет сам: они меняют настройки чата, а не пишут агенту. */
export const LOCAL_COMMANDS: readonly AgentCommand[] = [
  { name: 'model', description: 'Choose the model for this chat', argumentHint: '[model]' },
  { name: 'effort', description: 'Choose how hard the model thinks', argumentHint: '[level]' }
]

/**
 * Команды для подсказок после «/»: свои команды Atox и команды агента. Агента спрашивают,
 * только когда подсказки впервые понадобились, и заново — если в чате сменили агента.
 */
export function useAgentCommands(
  chatId: string,
  agent: AgentId,
  needed: boolean
): readonly AgentCommand[] {
  const key = `${chatId}\0${agent}`
  const [loaded, setLoaded] = useState<{ key: string; commands: AgentCommand[] } | null>(null)
  const agentCommands = loaded?.key === key ? loaded.commands : null
  const requested = needed || loaded !== null

  useEffect(() => {
    if (!requested) {
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
  }, [chatId, key, requested])

  const local = new Set(LOCAL_COMMANDS.map(({ name }) => name))
  return [...LOCAL_COMMANDS, ...(agentCommands ?? []).filter(({ name }) => !local.has(name))]
}
