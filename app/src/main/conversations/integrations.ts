import { setTimeout as delay } from 'node:timers/promises'
import type { IntegrationOrigin } from '../../shared/integrations'

/**
 * Сколько ждать, пока серверы MCP подключатся. Удалённые серверы отвечают за несколько секунд;
 * те, что не успели, показываются как подключающиеся, а не задерживают страницу навсегда.
 */
const MCP_STARTUP_TIMEOUT_MS = 20_000

/** Как часто спрашивать агента о серверах, пока они подключаются. */
const MCP_STATUS_POLL_MS = 500

/**
 * Спрашивает состояние серверов, пока какой-нибудь из них ещё подключается, но не дольше
 * {@link MCP_STARTUP_TIMEOUT_MS}; возвращает последний ответ.
 */
export async function waitForMcpStartup<Status>(
  read: () => Promise<Status[]>,
  isStarting: (status: Status) => boolean
): Promise<Status[]> {
  const deadline = Date.now() + MCP_STARTUP_TIMEOUT_MS
  let statuses = await read()
  while (statuses.some(isStarting) && Date.now() < deadline) {
    await delay(MCP_STATUS_POLL_MS)
    statuses = await read()
  }
  return statuses
}

/** Плагин из идентификатора вида `плагин@каталог`. */
export function pluginOrigin(pluginId: string): IntegrationOrigin {
  return { type: 'plugin', plugin: pluginId.split('@')[0] || pluginId }
}

/**
 * Имя без приставки плагина: агенты называют скиллы плагинов `плагин:скилл`, а плагин и так
 * видно по пометке.
 */
export function withoutPluginPrefix(name: string, origin: IntegrationOrigin): string {
  const prefix = origin.type === 'plugin' ? `${origin.plugin}:` : ''
  return prefix && name.startsWith(prefix) && name.length > prefix.length
    ? name.slice(prefix.length)
    : name
}

/** Список по алфавиту, как его удобно просматривать глазами. */
export function byName<Item extends { name: string }>(items: Item[]): Item[] {
  return items.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
}
