import type {
  IntegrationOrigin,
  McpServerInfo,
  McpServerState,
  PluginInfo,
  SkillInfo
} from '../../shared/integrations'
import type { JsonRpcProcess } from './jsonRpc'
import { byName, pluginOrigin, waitForMcpStartup, withoutPluginPrefix } from './integrations'

/*
 * Плагины, скиллы и серверы MCP Codex — из ответов `codex app-server`. Типы — только та часть
 * протокола, которой пользуется Atox; полные печатает `codex app-server generate-ts`.
 */

interface CodexPlugin {
  id: string
  name: string
  installed: boolean
  enabled: boolean
  /** Версия скачанного плагина. */
  localVersion: string | null
  /** Версия в каталоге — у плагинов, которые Codex не хранит у себя. */
  version: string | null
  interface: { displayName: string | null; shortDescription: string | null } | null
}

interface PluginInstalledResponse {
  marketplaces: { name: string; plugins: CodexPlugin[] }[]
}

type SkillScope = 'user' | 'repo' | 'system' | 'admin'

interface CodexSkill {
  name: string
  description: string
  interface?: { shortDescription?: string }
  /** Путь к скиллу: по нему одноимённые скиллы из разных папок различаются. */
  path: string
  scope: SkillScope
  enabled: boolean
  pluginId: string | null
}

interface SkillsListResponse {
  data: { cwd: string; skills: CodexSkill[] }[]
}

type ConnectionStatus =
  | 'notStarted'
  | 'starting'
  | 'connected'
  | 'authenticationRequired'
  | 'failed'
  | 'cancelled'
  | 'disabled'

interface CodexMcpServer {
  name: string
  /** `null` — сервер ещё не запускали в этом разговоре. */
  runtimeStatus: ConnectionStatus | null
  pluginId: string | null
  tools: Record<string, unknown>
  /** Сервер подключился, но не отдал список инструментов. */
  toolsError: string | null
}

interface McpStatusPage {
  data: CodexMcpServer[]
  nextCursor: string | null
}

/** Уведомление о запуске сервера MCP: только в нём Codex объясняет, почему сервер не запустился. */
export const MCP_STARTUP_NOTIFICATION = 'mcpServer/startupStatus/updated'

export interface McpStartupUpdate {
  name: string
  status: 'starting' | 'ready' | 'failed' | 'cancelled'
  error: string | null
}

const MCP_STATES: Record<ConnectionStatus, McpServerState> = {
  notStarted: 'connecting',
  starting: 'connecting',
  connected: 'connected',
  authenticationRequired: 'needs-auth',
  failed: 'failed',
  cancelled: 'failed',
  disabled: 'disabled'
}

export async function readCodexPlugins(rpc: JsonRpcProcess, cwd: string): Promise<PluginInfo[]> {
  const { marketplaces } = await rpc.request<PluginInstalledResponse>('plugin/installed', {
    cwds: [cwd]
  })
  return byName(
    marketplaces.flatMap(({ name: marketplace, plugins }) =>
      plugins
        .filter(({ installed }) => installed)
        .map((plugin): PluginInfo => {
          const description = plugin.interface?.shortDescription
          const version = plugin.localVersion ?? plugin.version
          return {
            id: plugin.id,
            name: plugin.interface?.displayName || plugin.name,
            marketplace,
            enabled: plugin.enabled,
            ...(description && { description }),
            ...(version && { version })
          }
        })
    )
  )
}

export async function readCodexSkills(rpc: JsonRpcProcess, cwd: string): Promise<SkillInfo[]> {
  // Скиллы плагинов из облака Codex добавляет, когда загрузит аккаунт, — а `account/read`
  // отвечает как раз после этого. Без него список приходит без них.
  await rpc.request('account/read', {})
  const { data } = await rpc.request<SkillsListResponse>('skills/list', { cwds: [cwd] })
  return byName(
    data
      .flatMap(({ skills }) => skills)
      // Системные скиллы — часть самого Codex, а не то, что поставил пользователь.
      .filter(({ scope }) => scope !== 'system')
      .map((skill): SkillInfo => {
        const origin = skillOrigin(skill)
        return {
          id: skill.path,
          name: withoutPluginPrefix(skill.name, origin),
          description: skill.description || skill.interface?.shortDescription || '',
          origin,
          enabled: skill.enabled
        }
      })
  )
}

function skillOrigin({ pluginId, scope }: CodexSkill): IntegrationOrigin {
  if (pluginId) {
    return pluginOrigin(pluginId)
  }
  switch (scope) {
    case 'repo':
      return { type: 'project' }
    case 'admin':
      return { type: 'managed' }
    default:
      return { type: 'user' }
  }
}

/**
 * Серверы MCP. Codex подключает их только в разговоре, поэтому для ответа заводится разговор,
 * который не сохраняется в историю и закрывается вместе с процессом. `startupErrors` —
 * причины ошибок из уведомлений о запуске серверов.
 */
export async function readCodexMcpServers(
  rpc: JsonRpcProcess,
  cwd: string,
  startupErrors: ReadonlyMap<string, string>
): Promise<McpServerInfo[]> {
  const { thread } = await rpc.request<{ thread: { id: string } }>('thread/start', {
    cwd,
    ephemeral: true
  })
  const servers = await waitForMcpStartup(
    () => listMcpServers(rpc, thread.id),
    ({ runtimeStatus }) => runtimeStatus === 'starting' || runtimeStatus === 'notStarted'
  )
  return byName(
    servers.map((server): McpServerInfo => {
      const state = server.runtimeStatus ? MCP_STATES[server.runtimeStatus] : 'connecting'
      const error = startupErrors.get(server.name) ?? server.toolsError
      const tools = Object.keys(server.tools).length
      return {
        id: server.name,
        name: server.name,
        state,
        origin: server.pluginId ? pluginOrigin(server.pluginId) : { type: 'user' },
        ...(error && state !== 'connected' && { error }),
        ...(state === 'connected' && { tools })
      }
    })
  )
}

async function listMcpServers(rpc: JsonRpcProcess, threadId: string): Promise<CodexMcpServer[]> {
  const servers: CodexMcpServer[] = []
  let cursor: string | null = null
  do {
    const page: McpStatusPage = await rpc.request<McpStatusPage>('mcpServerStatus/list', {
      threadId,
      // Сами описания инструментов не нужны — только их число и состояние входа.
      detail: 'toolsAndAuthOnly',
      cursor
    })
    servers.push(...page.data)
    cursor = page.nextCursor
  } while (cursor)
  return servers
}
