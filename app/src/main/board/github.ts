import { homedir } from 'node:os'
import type { AvailableRepository, BoardLabel, BoardRepository } from '../../shared/board'
import type { GitHubAccounts } from '../githubAccounts'
import { runCommand } from '../processes'
import type { ShellEnvironment } from '../shellEnvironment'

/** Больше GitHub за один запрос не отдаёт. */
const PAGE_SIZE = 100

/**
 * Сколько открытых issue одного репозитория читать. В репозитории с тысячами задач доска
 * всё равно не для них, а каждая страница — отдельный запрос.
 */
const MAX_ISSUES_PER_REPOSITORY = 500

/** Сколько закрытых issue с карточками спрашивать за раз: столько id GitHub принимает в `nodes`. */
const NODES_BATCH_SIZE = 100

const REPOSITORIES_QUERY = `query($cursor: String) {
  viewer {
    repositories(
      first: ${PAGE_SIZE}
      after: $cursor
      affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        nameWithOwner
        isPrivate
        isArchived
        hasIssuesEnabled
        pushedAt
        owner { login avatarUrl }
        issues(states: OPEN) { totalCount }
      }
    }
  }
}`

const ISSUE_FIELDS = `
  id
  number
  title
  url
  state
  updatedAt
  author { login }
  labels(first: 10) { nodes { name color } }
  repository { nameWithOwner owner { login avatarUrl } }
`

const ISSUES_QUERY = `query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issues(first: ${PAGE_SIZE}, after: $cursor, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { ${ISSUE_FIELDS} }
    }
  }
}`

const NODES_QUERY = `query($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Issue { ${ISSUE_FIELDS} } }
}`

const ISSUE_BODY_QUERY = `query($id: ID!) {
  node(id: $id) { ... on Issue { body } }
}`

interface PageInfo {
  hasNextPage: boolean
  endCursor: string | null
}

interface RepositoryNode {
  nameWithOwner: string
  isPrivate: boolean
  isArchived: boolean
  hasIssuesEnabled: boolean
  pushedAt: string | null
  owner: { login: string; avatarUrl: string }
  issues: { totalCount: number }
}

interface IssueNode {
  id: string
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED'
  updatedAt: string
  author: { login: string } | null
  labels: { nodes: { name: string; color: string }[] }
  repository: { nameWithOwner: string; owner: { login: string; avatarUrl: string } }
}

/** Issue в том виде, в каком он приходит с GitHub, — без колонки доски. */
export interface GitHubIssue {
  id: string
  repository: string
  owner: string
  ownerAvatarUrl: string
  number: number
  title: string
  url: string
  state: 'open' | 'closed'
  labels: BoardLabel[]
  author: string | null
  updatedAt: number
}

type Variables = Record<string, string | string[] | null>

/** Запросы доски к GitHub под учётными записями `gh`. */
export class BoardGitHub {
  constructor(
    private readonly shell: ShellEnvironment,
    private readonly accounts: GitHubAccounts
  ) {}

  /**
   * Репозитории всех учётных записей, у которых включены issue. Репозиторий, доступный
   * нескольким учётным записям, достаётся первой — активной, если она к нему допущена.
   */
  async availableRepositories(): Promise<AvailableRepository[]> {
    const accounts = [...(await this.accounts.list())].sort(
      (left, right) => Number(right.active) - Number(left.active)
    )
    const perAccount = await Promise.all(
      accounts.map(async ({ login }) => {
        const repositories: AvailableRepository[] = []
        let cursor: string | null = null
        do {
          type Response = {
            viewer: { repositories: { pageInfo: PageInfo; nodes: RepositoryNode[] } }
          }
          const page: Response['viewer']['repositories'] = (
            await this.query<Response>(login, REPOSITORIES_QUERY, { cursor })
          ).viewer.repositories
          for (const node of page.nodes) {
            if (node.hasIssuesEnabled && !node.isArchived) {
              repositories.push({
                fullName: node.nameWithOwner,
                account: login,
                owner: node.owner.login,
                ownerAvatarUrl: node.owner.avatarUrl,
                isPrivate: node.isPrivate,
                openIssues: node.issues.totalCount,
                pushedAt: node.pushedAt ? Date.parse(node.pushedAt) : 0
              })
            }
          }
          cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
        } while (cursor)
        return repositories
      })
    )
    const byName = new Map<string, AvailableRepository>()
    for (const repository of perAccount.flat()) {
      if (!byName.has(repository.fullName)) {
        byName.set(repository.fullName, repository)
      }
    }
    return [...byName.values()].sort((left, right) => right.pushedAt - left.pushedAt)
  }

  /** Открытые issue репозитория, недавно обновлённые первыми. */
  async openIssues({ fullName, account }: BoardRepository): Promise<GitHubIssue[]> {
    const [owner = '', name = ''] = fullName.split('/')
    const issues: GitHubIssue[] = []
    let cursor: string | null = null
    do {
      type Response = {
        repository: { issues: { pageInfo: PageInfo; nodes: IssueNode[] } } | null
      }
      const repository: Response['repository'] = (
        await this.query<Response>(account, ISSUES_QUERY, { owner, name, cursor })
      ).repository
      if (!repository) {
        throw new Error(`${fullName} is not available to ${account}`)
      }
      issues.push(...repository.issues.nodes.map(toIssue))
      const { hasNextPage, endCursor }: PageInfo = repository.issues.pageInfo
      cursor = hasNextPage && issues.length < MAX_ISSUES_PER_REPOSITORY ? endCursor : null
    } while (cursor)
    return issues
  }

  /** Issue по их id — так читаются закрытые задачи, у которых на доске остались карточки. */
  async issuesById(account: string, ids: string[]): Promise<GitHubIssue[]> {
    const issues: GitHubIssue[] = []
    for (let start = 0; start < ids.length; start += NODES_BATCH_SIZE) {
      const batch = ids.slice(start, start + NODES_BATCH_SIZE)
      const nodes = await this.nodes(account, batch).catch(async () => {
        // Один удалённый или недоступный issue проваливает весь запрос: тогда — по одному,
        // чтобы из-за него не пропали остальные.
        const single = await Promise.all(
          batch.map((id) => this.nodes(account, [id]).catch(() => []))
        )
        return single.flat()
      })
      issues.push(...nodes.map(toIssue))
    }
    return issues
  }

  private async nodes(account: string, ids: string[]): Promise<IssueNode[]> {
    const { nodes } = await this.query<{ nodes: (IssueNode | null)[] }>(account, NODES_QUERY, {
      ids
    })
    // Объект, который оказался не issue, приходит без полей.
    return nodes.filter((node): node is IssueNode => node?.number !== undefined)
  }

  /** Текст issue — его агент получает вместе с заданием. */
  async issueBody(account: string, id: string): Promise<string> {
    const { node } = await this.query<{ node: { body?: string } | null }>(
      account,
      ISSUE_BODY_QUERY,
      { id }
    )
    return node?.body ?? ''
  }

  private async query<Data>(account: string, query: string, variables: Variables): Promise<Data> {
    const token = await this.accounts.token(account)
    if (!token) {
      throw new Error(`GitHub account ${account} is not signed in to gh`)
    }
    const args = ['api', 'graphql', '-f', `query=${query}`]
    for (const [name, value] of Object.entries(variables)) {
      if (Array.isArray(value)) {
        // Список — повторяющимся полем `name[]`.
        args.push(...value.flatMap((item) => ['-f', `${name}[]=${item}`]))
      } else if (value !== null) {
        args.push('-f', `${name}=${value}`)
      }
    }
    const output = await runCommand('gh', args, {
      cwd: homedir(),
      env: { ...(await this.shell.get()), GH_TOKEN: token }
    })
    const response = JSON.parse(output) as { data?: Data; errors?: { message: string }[] }
    if (!response.data) {
      throw new Error(response.errors?.[0]?.message ?? 'GitHub returned no data')
    }
    return response.data
  }
}

function toIssue(node: IssueNode): GitHubIssue {
  return {
    id: node.id,
    repository: node.repository.nameWithOwner,
    owner: node.repository.owner.login,
    ownerAvatarUrl: node.repository.owner.avatarUrl,
    number: node.number,
    title: node.title,
    url: node.url,
    state: node.state === 'OPEN' ? 'open' : 'closed',
    labels: node.labels.nodes.map(({ name, color }) => ({ name, color: `#${color}` })),
    author: node.author?.login ?? null,
    updatedAt: Date.parse(node.updatedAt)
  }
}
