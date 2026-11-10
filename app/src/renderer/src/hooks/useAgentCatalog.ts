import { useEffect, useSyncExternalStore } from 'react'
import type { AgentId } from '../../../shared/agents'
import {
  AGENT_LISTS_TTL_MS,
  INCOMPLETE_CATALOG_TTL_MS,
  type AgentCatalog
} from '../../../shared/conversation'

const { atox } = window

/** Модели агента; `undefined` — список ещё загружается, `null` — агент не ответил. */
type CatalogState = AgentCatalog | null | undefined

/**
 * Списки моделей одни на всё окно: агента спрашивают не в каждом чате, а раз в
 * `AGENT_LISTS_TTL_MS` — чтобы новые модели появлялись без перезапуска.
 */
const catalogs = new Map<AgentId, CatalogState>()
/** Когда получен каждый список: по этому времени он устаревает. */
const loadedAt = new Map<AgentId, number>()
/** Запросы, которые ещё идут: один на агента. */
const requests = new Map<AgentId, Promise<AgentCatalog | null>>()
const listeners = new Set<() => void>()

function setCatalog(agent: AgentId, catalog: CatalogState): void {
  catalogs.set(agent, catalog)
  listeners.forEach((listener) => listener())
}

/**
 * Загружает модели агента, если их нет или список устарел. Неудачный ответ не запоминается:
 * агента могли установить или войти в него позже, и следующий вызов спросит снова.
 */
export function loadAgentCatalog(agent: AgentId): Promise<AgentCatalog | null> {
  const loaded = catalogs.get(agent)
  const ttl = loaded?.incomplete ? INCOMPLETE_CATALOG_TTL_MS : AGENT_LISTS_TTL_MS
  const fresh = Date.now() - (loadedAt.get(agent) ?? 0) < ttl
  if (loaded && fresh) {
    return Promise.resolve(loaded)
  }
  let request = requests.get(agent)
  if (!request) {
    request = atox.agents.catalog(agent).catch(() => null)
    requests.set(agent, request)
    // Устаревший список остаётся на экране, пока не придёт новый.
    if (!loaded) {
      setCatalog(agent, undefined)
    }
    void request.then((result) => {
      requests.delete(agent)
      if (result) {
        loadedAt.set(agent, Date.now())
      } else {
        loadedAt.delete(agent)
      }
      setCatalog(agent, result ?? loaded ?? null)
    })
  }
  return request
}

// Вход в другой аккаунт меняет модели: старый список забывается и загружается заново.
atox.agents.subscribeListsStale((agent) => {
  loadedAt.delete(agent)
  if (catalogs.has(agent)) {
    void loadAgentCatalog(agent)
  }
})

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Модели агента; `undefined` — список ещё загружается, `null` — агент не ответил. */
export function useAgentCatalog(agent: AgentId): CatalogState {
  const catalog = useSyncExternalStore(subscribe, () => catalogs.get(agent))
  useEffect(() => {
    void loadAgentCatalog(agent)
  }, [agent])
  return catalog
}
