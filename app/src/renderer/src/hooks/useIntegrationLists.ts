import { useCallback, useRef, useState } from 'react'
import { AGENTS, type AgentId } from '../../../shared/agents'
import type { IntegrationKind, IntegrationList } from '../../../shared/integrations'
import { ipcErrorMessage } from '../lib/ipcError'

const { atox } = window

interface Entry {
  /** Последний ответ агента; нет — ещё не отвечал. */
  result?: IntegrationList<IntegrationKind>
  /** Агента спрашивают сейчас: прежний ответ остаётся на экране, пока не придёт новый. */
  loading: boolean
}

export interface IntegrationLists {
  /** Ответ агента; `undefined` — его ещё не было. */
  result<Kind extends IntegrationKind>(kind: Kind, agent: AgentId): IntegrationList<Kind> | undefined
  /** Хотя бы один агент ещё отвечает на этот вопрос. */
  loading(kind: IntegrationKind): boolean
  /** Спрашивает агентов, если их ещё не спрашивали. */
  load(kind: IntegrationKind): void
  /** Спрашивает заново, например после того как пользователь что-то поставил. */
  refresh(kind: IntegrationKind): void
}

/**
 * Плагины, скиллы и серверы MCP всех агентов для страницы настроек. Ответы живут, пока она
 * открыта: разделы переключаются без новых запросов, а при следующем открытии списки свежие.
 * Каждый агент отвечает сам по себе — быстрый не ждёт медленного.
 */
export function useIntegrationLists(projectId: string | null): IntegrationLists {
  const [entries, setEntries] = useState<ReadonlyMap<string, Entry>>(new Map())
  // Номер последнего запроса по ключу: ответ на устаревший запрос не затирает свежий.
  const requests = useRef(new Map<string, number>())
  const lastRequest = useRef(0)

  const request = useCallback(
    (kind: IntegrationKind, force: boolean) => {
      for (const { id: agent } of AGENTS) {
        const key = entryKey(kind, agent, projectId)
        if (!force && requests.current.has(key)) {
          continue
        }
        const requestId = ++lastRequest.current
        requests.current.set(key, requestId)
        setEntries((current) => withEntry(current, key, { ...current.get(key), loading: true }))
        void atox.agents
          .integrations(agent, kind, projectId)
          .catch(
            (error): IntegrationList<IntegrationKind> => ({
              status: 'failed',
              message: ipcErrorMessage(error)
            })
          )
          .then((result) => {
            if (requests.current.get(key) === requestId) {
              setEntries((current) => withEntry(current, key, { result, loading: false }))
            }
          })
      }
    },
    [projectId]
  )

  return {
    result: <Kind extends IntegrationKind>(kind: Kind, agent: AgentId) =>
      // Ключ включает вид списка, поэтому под ним лежит ответ именно этого вида.
      entries.get(entryKey(kind, agent, projectId))?.result as IntegrationList<Kind> | undefined,
    loading: (kind) =>
      AGENTS.some(({ id }) => entries.get(entryKey(kind, id, projectId))?.loading ?? true),
    load: useCallback((kind: IntegrationKind) => request(kind, false), [request]),
    refresh: useCallback((kind: IntegrationKind) => request(kind, true), [request])
  }
}

function entryKey(kind: IntegrationKind, agent: AgentId, projectId: string | null): string {
  return `${kind}\0${agent}\0${projectId ?? ''}`
}

function withEntry(
  entries: ReadonlyMap<string, Entry>,
  key: string,
  entry: Entry
): ReadonlyMap<string, Entry> {
  return new Map(entries).set(key, entry)
}
