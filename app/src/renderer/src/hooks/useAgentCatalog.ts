import { useEffect, useState } from 'react'
import type { AgentId } from '../../../shared/agents'
import type { AgentCatalog } from '../../../shared/conversation'

const { atox } = window

/** Списки моделей одни на всё окно: агента спрашивают один раз, а не в каждом чате. */
const catalogs = new Map<AgentId, Promise<AgentCatalog | null>>()

export function loadAgentCatalog(agent: AgentId): Promise<AgentCatalog | null> {
  let catalog = catalogs.get(agent)
  if (!catalog) {
    catalog = atox.agents.catalog(agent).catch(() => null)
    catalogs.set(agent, catalog)
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
