import type { McpServerStatus, Query, SlashCommand } from '@anthropic-ai/claude-agent-sdk'
import type {
  IntegrationOrigin,
  McpServerInfo,
  McpServerState,
  PluginInfo,
  SkillInfo
} from '../../shared/integrations'
import { byName, waitForMcpStartup, withoutPluginPrefix } from './integrations'

/*
 * Плагины, скиллы и серверы MCP Claude Code — из ответов самого Claude Code в сессии без
 * разговора: он сам собирает их из настроек пользователя, проекта и плагинов.
 */

/** Каталог служебных плагинов, встроенных в Claude Code: пользователь их не ставил. */
const BUILTIN_MARKETPLACE = 'builtin'

/** Каталог плагинов, которые Claude Code подтянул из аккаунта на claude.ai. */
const SYNCED_MARKETPLACE = 'synced'

const CLAUDE_AI = 'claude.ai'

/** Приставка, с которой Claude Code называет серверы MCP из аккаунта на claude.ai. */
const CLAUDE_AI_SERVER_PREFIX = `${CLAUDE_AI} `

/** Серверы плагинов Claude Code называет `plugin:плагин:сервер`. */
const PLUGIN_SERVER_PATTERN = /^plugin:([^:]+):(.+)$/

/**
 * Откуда скилл, Claude Code дописывает в конец описания: `… (user)`. Скиллам плагинов он вместо
 * этого ставит в начало имя плагина: `(marketing) …`.
 */
const SKILL_SOURCE_SUFFIX = /^([\s\S]*?)\s*\(([^()]+)\)$/

const SKILL_SOURCES: Record<string, IntegrationOrigin> = {
  user: { type: 'user' },
  project: { type: 'project' },
  'claude.ai sync': { type: 'account', service: CLAUDE_AI },
  managed: { type: 'managed' },
  policySettings: { type: 'managed' }
}

const MCP_STATES: Record<McpServerStatus['status'], McpServerState> = {
  connected: 'connected',
  'needs-auth': 'needs-auth',
  failed: 'failed',
  pending: 'connecting',
  disabled: 'disabled'
}

export async function readClaudePlugins(session: Query): Promise<PluginInfo[]> {
  // С `holdOnCacheImpact` Claude Code ничего не перезагружает, если это что-то изменит в сессии,
  // а списки всё равно присылает.
  const { plugins } = await session.reloadPlugins({ holdOnCacheImpact: true })
  return byName(
    plugins.flatMap(({ name, path, source, version }): PluginInfo[] => {
      const marketplace = source?.split('@')[1]
      if (marketplace === BUILTIN_MARKETPLACE || path === BUILTIN_MARKETPLACE) {
        return []
      }
      return [
        {
          id: source ?? path,
          name,
          enabled: true,
          ...(version && { version }),
          ...(marketplace && {
            marketplace: marketplace === SYNCED_MARKETPLACE ? CLAUDE_AI : marketplace
          })
        }
      ]
    })
  )
}

export async function readClaudeSkills(session: Query): Promise<SkillInfo[]> {
  const { skills } = await session.reloadSkills()
  return byName(
    skills
      // Встроенные скиллы — часть самого Claude Code, а не то, что поставил пользователь.
      .filter(({ builtin }) => !builtin)
      .map(toSkill)
  )
}

function toSkill({ name, description }: SlashCommand): SkillInfo {
  const plugin = name.includes(':') ? name.slice(0, name.indexOf(':')) : null
  const pluginPrefix = `(${plugin}) `
  if (plugin && description.startsWith(pluginPrefix)) {
    const origin: IntegrationOrigin = { type: 'plugin', plugin }
    return {
      id: name,
      name: withoutPluginPrefix(name, origin),
      description: description.slice(pluginPrefix.length),
      origin,
      enabled: true
    }
  }
  const [, text = description, source = ''] = SKILL_SOURCE_SUFFIX.exec(description) ?? []
  const origin = SKILL_SOURCES[source]
  return {
    id: name,
    name,
    // Незнакомое пояснение в скобках не отрезаем: это может быть часть описания.
    description: origin ? text : description,
    origin: origin ?? { type: 'user' },
    enabled: true
  }
}

export async function readClaudeMcpServers(session: Query): Promise<McpServerInfo[]> {
  const servers = await waitForMcpStartup(
    () => session.mcpServerStatus(),
    ({ status }) => status === 'pending'
  )
  return byName(servers.map(toMcpServer))
}

function toMcpServer(server: McpServerStatus): McpServerInfo {
  const { origin, name } = mcpServerOrigin(server)
  return {
    id: server.name,
    name,
    state: MCP_STATES[server.status] ?? 'failed',
    origin,
    ...(server.error && { error: server.error }),
    ...(server.status === 'connected' && server.tools && { tools: server.tools.length })
  }
}

/** Откуда сервер и как его назвать без служебной приставки. */
function mcpServerOrigin(server: McpServerStatus): { origin: IntegrationOrigin; name: string } {
  const plugin = PLUGIN_SERVER_PATTERN.exec(server.name)
  if (plugin?.[1] && plugin[2]) {
    return { origin: { type: 'plugin', plugin: plugin[1] }, name: plugin[2] }
  }
  switch (server.source ?? server.scope) {
    case 'claudeai':
      return {
        origin: { type: 'account', service: CLAUDE_AI },
        name: server.name.startsWith(CLAUDE_AI_SERVER_PREFIX)
          ? server.name.slice(CLAUDE_AI_SERVER_PREFIX.length)
          : server.name
      }
    // `local` — личные настройки пользователя для этого проекта.
    case 'project':
    case 'local':
      return { origin: { type: 'project' }, name: server.name }
    case 'managed':
    case 'enterprise':
      return { origin: { type: 'managed' }, name: server.name }
    default:
      return { origin: { type: 'user' }, name: server.name }
  }
}
