import { execFile } from 'node:child_process'
import type {
  CheckStatus,
  Commit,
  GitHubOverview,
  Issue,
  IssueState,
  Listing,
  PullRequest,
  RepositoryError,
  RepositoryResult,
  ReviewDecision
} from '../shared/repository'
import type { ShellEnvironment } from './shellEnvironment'

/** Сколько коммитов текущей ветки показывать. */
const COMMIT_LIMIT = 100
/** Сколько открытых PR и issue загружать — обычно их меньше. */
const OPEN_LIMIT = 50
/** Сколько недавно закрытых PR и issue загружать: старые нужны редко. */
const CLOSED_LIMIT = 30
/** Сколько меток issue показывать. */
const LABEL_LIMIT = 4

/** Сколько ждать ответа git и GitHub, прежде чем считать запрос неудавшимся. */
const COMMAND_TIMEOUT_MS = 20_000
/** Ответ GitHub со всеми PR и issue — до нескольких сотен килобайт. */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/** Разделители полей и записей в выводе `git log`: в сообщениях коммитов они не встречаются. */
const FIELD_SEPARATOR = '\x1f'
const RECORD_SEPARATOR = '\x1e'
const TAG_PREFIX = 'tag: '

/**
 * Один запрос GraphQL вместо нескольких вызовов `gh pr list` и `gh issue list`: так быстрее,
 * и сразу приходят статус CI, решение ревью и число комментариев без их текста.
 * `{owner}` и `{repo}` gh подставляет сам — из удалённого репозитория папки проекта.
 */
const OVERVIEW_QUERY = `
query($owner: String!, $name: String!, $openLimit: Int!, $closedLimit: Int!, $labelLimit: Int!) {
  repository(owner: $owner, name: $name) {
    url
    nameWithOwner
    openPullRequests: pullRequests(states: OPEN, first: $openLimit, orderBy: {field: UPDATED_AT, direction: DESC}) {
      ...PullRequests
    }
    closedPullRequests: pullRequests(states: [MERGED, CLOSED], first: $closedLimit, orderBy: {field: UPDATED_AT, direction: DESC}) {
      ...PullRequests
    }
    openIssues: issues(states: OPEN, first: $openLimit, orderBy: {field: UPDATED_AT, direction: DESC}) {
      ...Issues
    }
    closedIssues: issues(states: CLOSED, first: $closedLimit, orderBy: {field: UPDATED_AT, direction: DESC}) {
      ...Issues
    }
  }
}

fragment PullRequests on PullRequestConnection {
  totalCount
  nodes {
    number
    title
    url
    state
    isDraft
    updatedAt
    headRefName
    additions
    deletions
    reviewDecision
    author { login }
    comments { totalCount }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  }
}

fragment Issues on IssueConnection {
  totalCount
  nodes {
    number
    title
    url
    state
    stateReason
    updatedAt
    author { login }
    comments { totalCount }
    labels(first: $labelLimit) { nodes { name color } }
  }
}
`

/** Автор удалённой учётной записи GitHub — вместо него GitHub отдаёт `null`. */
const GHOST_AUTHOR = 'ghost'

interface Connection<Node> {
  totalCount: number
  nodes: Node[]
}

interface PullRequestNode {
  number: number
  title: string
  url: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  isDraft: boolean
  updatedAt: string
  headRefName: string
  additions: number
  deletions: number
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  author: { login: string } | null
  comments: { totalCount: number }
  commits: { nodes: Array<{ commit: { statusCheckRollup: { state: string } | null } }> }
}

interface IssueNode {
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED'
  stateReason: string | null
  updatedAt: string
  author: { login: string } | null
  comments: { totalCount: number }
  labels: { nodes: Array<{ name: string; color: string }> } | null
}

interface OverviewResponse {
  data?: {
    repository: {
      url: string
      nameWithOwner: string
      openPullRequests: Connection<PullRequestNode>
      closedPullRequests: Connection<PullRequestNode>
      openIssues: Connection<IssueNode>
      closedIssues: Connection<IssueNode>
    } | null
  }
}

/** Ошибка запуска программы: код выхода и то, что она написала в stderr. */
class CommandError extends Error {
  constructor(
    readonly code: string | number | undefined,
    readonly stderr: string
  ) {
    super(stderr.trim() || `Command failed with code ${code}`)
  }
}

/**
 * Коммиты, pull request'ы и issue репозитория в папке проекта. Коммиты читаются локально
 * из git, а PR и issue — с GitHub через `gh`, под той учётной записью, что у пользователя
 * в терминале.
 */
export class RepositoryReader {
  constructor(private readonly shell: ShellEnvironment) {}

  async commits(path: string): Promise<RepositoryResult<Commit[]>> {
    try {
      const [log, unpushed] = await Promise.all([
        this.run('git', ['log', `-n${COMMIT_LIMIT}`, `--format=${LOG_FORMAT}`, 'HEAD'], path),
        this.unpushedCommits(path)
      ])
      return { ok: true, data: parseLog(log, unpushed) }
    } catch (error) {
      if (!(await this.isRepository(path))) {
        return { ok: false, error: { kind: 'not-git' } }
      }
      // В новом репозитории ещё нет коммитов — тогда HEAD никуда не указывает.
      if (!(await this.hasCommits(path))) {
        return { ok: true, data: [] }
      }
      return { ok: false, error: { kind: 'failed', message: errorMessage(error) } }
    }
  }

  async github(path: string): Promise<RepositoryResult<GitHubOverview>> {
    try {
      return { ok: true, data: await this.queryOverview(path) }
    } catch (error) {
      // Репозиторий может принадлежать другой учётной записи gh, чем активная. Тогда пробуем
      // токен, с которым git этого репозитория ходит на GitHub, — у него доступ точно есть.
      if (isInaccessibleRepository(error)) {
        const token = await this.gitCredentialToken(path)
        if (token) {
          try {
            return { ok: true, data: await this.queryOverview(path, token) }
          } catch {
            // Не помог и токен git — показываем исходную ошибку.
          }
        }
      }
      return { ok: false, error: classifyGitHubError(error) }
    }
  }

  private async queryOverview(path: string, token?: string): Promise<GitHubOverview> {
    const output = await this.run(
      'gh',
      [
        'api',
        'graphql',
        '-F',
        'owner={owner}',
        '-F',
        'name={repo}',
        '-F',
        `openLimit=${OPEN_LIMIT}`,
        '-F',
        `closedLimit=${CLOSED_LIMIT}`,
        '-F',
        `labelLimit=${LABEL_LIMIT}`,
        '-f',
        `query=${OVERVIEW_QUERY}`
      ],
      path,
      token ? { GH_TOKEN: token } : {}
    )
    const repository = (JSON.parse(output) as OverviewResponse).data?.repository
    if (!repository) {
      throw new Error('GitHub returned no repository')
    }
    return {
      url: repository.url,
      name: repository.nameWithOwner,
      pullRequests: toListing(
        repository.openPullRequests,
        repository.closedPullRequests,
        toPullRequest
      ),
      issues: toListing(repository.openIssues, repository.closedIssues, toIssue)
    }
  }

  /**
   * Коммиты, которых нет ни в одной удалённой ветке. Если удалённых репозиториев нет вовсе,
   * отмечать нечего: иначе неотправленным оказался бы каждый коммит.
   */
  private async unpushedCommits(path: string): Promise<Set<string>> {
    const remotes = await this.run('git', ['remote'], path).catch(() => '')
    if (!remotes.trim()) {
      return new Set()
    }
    const output = await this.run(
      'git',
      ['rev-list', `-n${COMMIT_LIMIT}`, 'HEAD', '--not', '--remotes'],
      path
    ).catch(() => '')
    return new Set(output.split('\n').filter(Boolean))
  }

  private isRepository(path: string): Promise<boolean> {
    return this.run('git', ['rev-parse', '--git-dir'], path).then(
      () => true,
      () => false
    )
  }

  private hasCommits(path: string): Promise<boolean> {
    return this.run('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], path).then(
      () => true,
      () => false
    )
  }

  /** Токен GitHub из помощника учётных данных git; `null` — git его не знает. */
  private async gitCredentialToken(path: string): Promise<string | null> {
    try {
      const output = await this.run(
        'git',
        ['credential', 'fill'],
        path,
        {
          // Без этого git, не найдя учётных данных, спросил бы их в терминале, которого нет.
          GIT_TERMINAL_PROMPT: '0'
        },
        'protocol=https\nhost=github.com\n\n'
      )
      const password = output
        .split('\n')
        .find((line) => line.startsWith('password='))
        ?.slice('password='.length)
      return password || null
    } catch {
      return null
    }
  }

  /**
   * Запускает программу в папке проекта с окружением оболочки входа: из Finder приложение
   * получает урезанный PATH, в котором нет установленного через Homebrew `gh`.
   */
  private async run(
    program: string,
    args: string[],
    cwd: string,
    extraEnvironment: Record<string, string> = {},
    input?: string
  ): Promise<string> {
    const env = { ...(await this.shell.get()), ...extraEnvironment }
    return new Promise((resolve, reject) => {
      const child = execFile(
        program,
        args,
        { cwd, env, timeout: COMMAND_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
        (error, stdout, stderr) => {
          if (error) {
            reject(new CommandError(error.code, String(stderr)))
          } else {
            resolve(String(stdout))
          }
        }
      )
      child.stdin?.end(input)
    })
  }
}

const LOG_FORMAT = ['%H', '%h', '%s', '%an', '%ct', '%D'].join('%x1f') + '%x1e'

function parseLog(output: string, unpushed: ReadonlySet<string>): Commit[] {
  return output
    .split(RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = '', shortHash = '', subject = '', author = '', time = '0', refs = ''] =
        record.split(FIELD_SEPARATOR)
      return {
        hash,
        shortHash,
        subject,
        author,
        committedAt: Number(time) * 1000,
        tags: refs
          .split(', ')
          .filter((ref) => ref.startsWith(TAG_PREFIX))
          .map((ref) => ref.slice(TAG_PREFIX.length)),
        unpushed: unpushed.has(hash)
      }
    })
}

function toListing<Node, Item>(
  open: Connection<Node>,
  closed: Connection<Node>,
  convert: (node: Node) => Item
): Listing<Item> {
  return {
    open: open.nodes.map(convert),
    closed: closed.nodes.map(convert),
    openCount: open.totalCount,
    closedCount: closed.totalCount
  }
}

function toPullRequest(node: PullRequestNode): PullRequest {
  return {
    number: node.number,
    title: node.title,
    url: node.url,
    state:
      node.state === 'MERGED'
        ? 'merged'
        : node.state === 'CLOSED'
          ? 'closed'
          : node.isDraft
            ? 'draft'
            : 'open',
    author: node.author?.login ?? GHOST_AUTHOR,
    branch: node.headRefName,
    updatedAt: Date.parse(node.updatedAt),
    comments: node.comments.totalCount,
    additions: node.additions,
    deletions: node.deletions,
    checks: toCheckStatus(node.commits.nodes[0]?.commit.statusCheckRollup?.state),
    review: toReviewDecision(node.reviewDecision)
  }
}

function toIssue(node: IssueNode): Issue {
  const state: IssueState =
    node.state === 'OPEN'
      ? 'open'
      : node.stateReason === 'NOT_PLANNED'
        ? 'not-planned'
        : 'completed'
  return {
    number: node.number,
    title: node.title,
    url: node.url,
    state,
    author: node.author?.login ?? GHOST_AUTHOR,
    updatedAt: Date.parse(node.updatedAt),
    comments: node.comments.totalCount,
    labels: (node.labels?.nodes ?? []).map(({ name, color }) => ({ name, color: `#${color}` }))
  }
}

function toCheckStatus(state: string | undefined): CheckStatus {
  switch (state) {
    case 'SUCCESS':
      return 'success'
    case 'FAILURE':
    case 'ERROR':
      return 'failure'
    case 'PENDING':
    case 'EXPECTED':
      return 'pending'
    default:
      return null
  }
}

function toReviewDecision(decision: PullRequestNode['reviewDecision']): ReviewDecision {
  switch (decision) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes-requested'
    case 'REVIEW_REQUIRED':
      return 'review-required'
    default:
      return null
  }
}

/** GitHub не нашёл репозиторий: его нет или у активной учётной записи gh нет к нему доступа. */
function isInaccessibleRepository(error: unknown): boolean {
  return error instanceof CommandError && error.stderr.includes('Could not resolve to a Repository')
}

function classifyGitHubError(error: unknown): RepositoryError {
  if (error instanceof CommandError) {
    if (error.code === 'ENOENT') {
      return { kind: 'gh-missing' }
    }
    if (error.stderr.includes('not a git repository')) {
      return { kind: 'not-git' }
    }
    if (error.stderr.includes('gh auth login')) {
      return { kind: 'gh-signed-out' }
    }
    if (
      error.stderr.includes('no git remotes found') ||
      error.stderr.includes('known GitHub host')
    ) {
      return { kind: 'not-github' }
    }
  }
  return { kind: 'failed', message: errorMessage(error) }
}

/** Первая содержательная строка ошибки — без префиксов `gh:` и `fatal:`. */
function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const line = text.split('\n').find((candidate) => candidate.trim()) ?? text
  return line.replace(/^(gh|fatal|error):\s*/i, '').trim()
}
