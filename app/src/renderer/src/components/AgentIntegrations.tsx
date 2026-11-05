import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { AGENTS } from '../../../shared/agents'
import type {
  IntegrationItems,
  IntegrationKind,
  IntegrationList,
  IntegrationOrigin,
  McpServerInfo,
  McpServerState,
  PluginInfo,
  SkillInfo
} from '../../../shared/integrations'
import type { IntegrationLists } from '../hooks/useIntegrationLists'
import { AgentIcon } from './AgentIcon'

/** Как показывать список одного вида. */
interface KindView<Kind extends IntegrationKind> {
  /** Во множественном числе, для пояснений: «its plugins». */
  noun: string
  /** Бывают ли у проекта свои: плагины ставятся только пользователю. */
  projectScoped: boolean
  loading: string
  empty: string
  row(item: IntegrationItems[Kind][number]): ReactNode
  /** По чему ищет фильтр: всё, что видно в строке. */
  terms(item: IntegrationItems[Kind][number]): (string | null | undefined)[]
}

const MCP_STATE_LABELS: Record<McpServerState, string> = {
  connected: 'Connected',
  'needs-auth': 'Needs sign-in',
  failed: 'Failed',
  connecting: 'Connecting…',
  disabled: 'Disabled'
}

interface AgentIntegrationsProps {
  kind: IntegrationKind
  lists: IntegrationLists
  /** Проект, настройки которого попадают в списки; нет — только настройки пользователя. */
  projectName: string | null
}

/** Раздел настроек: плагины, скиллы или серверы MCP — блоками по агентам. */
export function AgentIntegrations({ kind, lists, projectName }: AgentIntegrationsProps) {
  const [query, setQuery] = useState('')
  const { load } = lists

  useEffect(() => load(kind), [load, kind])

  const loading = lists.loading(kind)

  return (
    <div className="settings__group">
      <div className="integrations__toolbar">
        <p className="integrations__scope">
          {KINDS[kind].projectScoped &&
            (projectName
              ? `Includes ${KINDS[kind].noun} from the “${projectName}” project.`
              : `Open a project to also see its ${KINDS[kind].noun}.`)}
        </p>
        <label className="repository__search">
          <Search className="repository__search-icon" />
          <input
            type="search"
            placeholder="Filter"
            aria-label="Filter"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Escape сначала очищает фильтр и только потом закрывает настройки.
              if (event.key === 'Escape' && query) {
                event.stopPropagation()
                setQuery('')
              }
            }}
          />
        </label>
        <button
          type="button"
          className="icon-button"
          aria-label="Refresh"
          title="Refresh"
          data-loading={loading}
          disabled={loading}
          onClick={() => lists.refresh(kind)}
        >
          <RefreshCw className="icon repository__refresh-icon" />
        </button>
      </div>

      {AGENTS.map((agent) => (
        <AgentSection
          key={agent.id}
          agent={agent}
          kind={kind}
          result={lists.result(kind, agent.id)}
          query={query}
        />
      ))}
    </div>
  )
}

interface AgentSectionProps<Kind extends IntegrationKind> {
  agent: (typeof AGENTS)[number]
  kind: Kind
  result: IntegrationList<Kind> | undefined
  query: string
}

function AgentSection<Kind extends IntegrationKind>({
  agent,
  kind,
  result,
  query
}: AgentSectionProps<Kind>) {
  const view: KindView<Kind> = KINDS[kind]
  const items: IntegrationItems[Kind] | null = result?.status === 'ok' ? result.items : null
  const visible = items?.filter((item) => matches(view.terms(item), query)) ?? null
  return (
    <section className="settings__subgroup" aria-label={agent.name}>
      <h3 className="integrations__agent">
        <AgentIcon agent={agent.id} className="integrations__agent-icon" />
        {agent.name}
        {items && items.length > 0 && <span className="integrations__count">{items.length}</span>}
      </h3>
      <div className="settings__card">
        {!result ? (
          <Message>{view.loading}</Message>
        ) : result.status === 'not-installed' ? (
          <Message detail={`Install the ${agent.name} CLI to see its ${view.noun} here.`}>
            {agent.name} isn’t installed
          </Message>
        ) : result.status === 'failed' ? (
          <Message detail={result.message}>
            {agent.name} didn’t report its {view.noun}
          </Message>
        ) : visible && visible.length > 0 ? (
          <ul className="integrations__list">
            {visible.map((item) => (
              <Fragment key={item.id}>{view.row(item)}</Fragment>
            ))}
          </ul>
        ) : (
          <Message>
            {items && items.length > 0 ? `Nothing matches “${query.trim()}”` : view.empty}
          </Message>
        )}
      </div>
    </section>
  )
}

function Message({ children, detail }: { children: ReactNode; detail?: string }) {
  return (
    <div className="settings__row integrations__message">
      <span className="settings__label">
        <span>{children}</span>
        {detail && <span className="settings__description">{detail}</span>}
      </span>
    </div>
  )
}

function PluginRow({ plugin }: { plugin: PluginInfo }) {
  return (
    <Row
      name={plugin.name}
      meta={plugin.version && <span className="integrations__version">{plugin.version}</span>}
      tags={
        <>
          {plugin.marketplace && <Tag>{plugin.marketplace}</Tag>}
          {!plugin.enabled && <Tag>Disabled</Tag>}
        </>
      }
      description={plugin.description}
    />
  )
}

function SkillRow({ skill }: { skill: SkillInfo }) {
  return (
    <Row
      name={skill.name}
      tags={
        <>
          <OriginTag origin={skill.origin} />
          {!skill.enabled && <Tag>Disabled</Tag>}
        </>
      }
      description={skill.description}
    />
  )
}

function McpServerRow({ server }: { server: McpServerInfo }) {
  const status =
    server.state === 'connected' && server.tools !== undefined
      ? `${server.tools} ${server.tools === 1 ? 'tool' : 'tools'}`
      : MCP_STATE_LABELS[server.state]
  return (
    <Row
      name={server.name}
      leading={<span className="integrations__state-dot" data-state={server.state} />}
      tags={<OriginTag origin={server.origin} />}
      status={
        <span className="integrations__state" data-state={server.state}>
          {status}
        </span>
      }
      description={server.error}
      descriptionTone={server.state === 'failed' ? 'danger' : 'muted'}
    />
  )
}

interface RowProps {
  name: string
  leading?: ReactNode
  /** Сразу после имени, например версия. */
  meta?: ReactNode
  tags?: ReactNode
  /** Справа, например состояние сервера. */
  status?: ReactNode
  description?: string | undefined
  descriptionTone?: 'muted' | 'danger'
}

function Row({ name, leading, meta, tags, status, description, descriptionTone }: RowProps) {
  return (
    <li className="integrations__row">
      {leading}
      <div className="integrations__body">
        <div className="integrations__title">
          <span className="integrations__name">{name}</span>
          {meta}
          {tags}
        </div>
        {description && (
          // Длинное описание сжато до пары строк, а целиком видно в подсказке.
          <p className="integrations__description" data-tone={descriptionTone} title={description}>
            {description}
          </p>
        )}
      </div>
      {status}
    </li>
  )
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="integrations__tag">{children}</span>
}

function OriginTag({ origin }: { origin: IntegrationOrigin }) {
  const label = originLabel(origin)
  return label ? <Tag>{label}</Tag> : null
}

/** Пометка источника; у настроек пользователя — обычного случая — её нет. */
function originLabel(origin: IntegrationOrigin): string | null {
  switch (origin.type) {
    case 'user':
      return null
    case 'project':
      return 'Project'
    case 'plugin':
      return origin.plugin
    case 'account':
      return origin.service
    case 'managed':
      return 'Managed'
  }
}

const KINDS: { [Kind in IntegrationKind]: KindView<Kind> } = {
  plugins: {
    noun: 'plugins',
    projectScoped: false,
    loading: 'Loading plugins…',
    empty: 'No plugins installed',
    row: (plugin) => <PluginRow plugin={plugin} />,
    terms: (plugin) => [plugin.name, plugin.description, plugin.marketplace]
  },
  skills: {
    noun: 'skills',
    projectScoped: true,
    loading: 'Loading skills…',
    empty: 'No skills yet',
    row: (skill) => <SkillRow skill={skill} />,
    terms: (skill) => [skill.name, skill.description, originLabel(skill.origin)]
  },
  mcp: {
    noun: 'MCP servers',
    projectScoped: true,
    // Агент отвечает, когда серверы подключатся, — это заметно дольше остальных списков.
    loading: 'Connecting to servers… This can take a few seconds.',
    empty: 'No MCP servers',
    row: (server) => <McpServerRow server={server} />,
    terms: (server) => [
      server.name,
      server.error,
      originLabel(server.origin),
      MCP_STATE_LABELS[server.state]
    ]
  }
}

function matches(terms: (string | null | undefined)[], query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  return !needle || terms.some((term) => term?.toLocaleLowerCase().includes(needle))
}
