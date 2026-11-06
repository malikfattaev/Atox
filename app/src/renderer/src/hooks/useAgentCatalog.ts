import { useEffect, useState } from 'react'
import type { AgentId } from '../../../shared/agents'
import { AGENT_LISTS_TTL_MS, type AgentCatalog } from '../../../shared/conversation'

const { atox } = window

/**
 * Списки моделей одни на всё окно: агента спрашивают не в каждом чате, а раз в
 * `AGENT_LISTS_TTL_MS` — чтобы новые модели появлялись без перезапуска.
 */
const catalogs = new Map<AgentId, { catalog: Promise<AgentCatalog | null>; expiresAt: number }>()

export function loadAgentCatalog(agent: AgentId): Promise<AgentCatalog | null> {
  const cached = catalogs.get(agent)
  let catalog = cached && cached.expiresAt > Date.now() ? cached.catalog : undefined
  if (!catalog) {
    catalog = atox.agents.catalog(agent).catch(() => null)
    catalogs.set(agent, { catalog, expiresAt: Date.now() + AGENT_LISTS_TTL_MS })
    // Неудачный ответ не запоминается: агента могли установить или войти в него позже.
    void catalog.then((result) => {
      if (!result) {
        catalogs.delete(agent)
      }
    })
  }
  return catalog
}

/** Модели агента; `undefined` — список ещё загружается, `null` — агент не ответил. */
export function useAgentCatalog(agent: AgentId): AgentCatalog | null | undefined {
  const [catalog, setCatalog] = useState<AgentCatalog | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setCatalog(undefined)
    void loadAgentCatalog(agent).then((result) => {
      if (!cancelled) {
        setCatalog(result)
      }
    })
    return () => {
      cancelled = true
    }
  }, [agent])

  return catalog
}
