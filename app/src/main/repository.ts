import { execFile } from 'node:child_process'
import type {
  CheckStatus,
  Commit,
  GitHubCounts,
  GitHubItems,
  GitHubKind,
  GitHubOverview,
  Issue,
  IssueState,
  ListState,
  Listing,
  Page,
  PullRequest,
  RepositoryError,
  RepositoryResult,
  ReviewDecision
} from '../shared/repository'
import type { ShellEnvironment } from './shellEnvironment'

/** Сколько коммитов загружать за раз: дальше список подгружается при прокрутке. */
const COMMIT_PAGE_SIZE = 100
/**
 * Сколько PR или issue загружать за раз. Больше не просим и при обновлении: на большом
 * репозитории запрос с сотней PR и их проверками GitHub отклоняет как слишком тяжёлый.
 */
const GITHUB_PAGE_SIZE = 50
/** Сколько меток issue показывать. */
const LABEL_LIMIT = 4

/** Сколько ждать ответа git и GitHub, прежде чем считать запрос неудавшимся. */
const COMMAND_TIMEOUT_MS = 20_000
/** Ответ GitHub со страницами PR и issue — до нескольких сотен килобайт. */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/** Разделители полей и записей в выводе `git log`: в сообщениях коммитов они не встречаются. */
const FIELD_SEPARATOR = '\x1f'
const RECORD_SEPARATOR = '\x1e'
const TAG_PREFIX = 'tag: '

/** Курсор коммитов — вершина, от которой листаем, и сколько коммитов уже пропущено. */
const COMMIT_CURSOR = /^([0-9a-f]{40,64}):(\d+)$/

/** Фильтр по состоянию в запросе GitHub для каждого списка. */
const LIST_STATES: Record<GitHubKind, Record<ListState, string>> = {
  pullRequests: { open: 'OPEN', closed: '[MERGED, CLOSED]' },
  issues: { open: 'OPEN', closed: 'CLOSED' }
}

const LISTS: ReadonlyArray<readonly [GitHubKind, ListState]> = [
  ['pullRequests', 'open'],
  ['pullRequests', 'closed'],
  ['issues', 'open'],
  ['issues', 'closed']
]

/**
 * Поля элементов каждого списка. Статус CI, решение ревью и число комментариев приходят
 * сразу, без их текста.
 */
const FRAGMENTS: Record<GitHubKind, { name: string; text: string }> = {
  pullRequests: {
    name: 'PullRequests',
    text: `
fragment PullRequests on PullRequestConnection {
  totalCount
  pageInfo { hasNextPage endCursor }
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
}`
  },
  issues: {
    name: 'Issues',
    text: `
fragment Issues on IssueConnection {
  totalCount
  pageInfo { hasNextPage endCursor }
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
}`
  }
}

type ListAlias = `${ListState}${Capitalize<GitHubKind>}`

/** Имя списка в запросе и его переменной размера, например `openPullRequests`. */
function listAlias(kind: GitHubKind, state: ListState): ListAlias {
  return `${state}${kind.charAt(0).toUpperCase()}${kind.slice(1)}` as ListAlias
}

/** Список одного вида и состояния, свежие изменения сверху. */
function connectionField(kind: GitHubKind, state: ListState, first: string, after?: string) {
  const arguments_ = [
    `states: ${LIST_STATES[kind][state]}`,
    `first: ${first}`,
    ...(after ? [`after: ${after}`] : []),
    'orderBy: {field: UPDATED_AT, direction: DESC}'
  ]
  return `${kind}(${arguments_.join(', ')}) { ...${FRAGMENTS[kind].name} }`
}

/**
 * Один запрос GraphQL вместо нескольких вызовов `gh pr list` и `gh issue list`: первые
 * страницы всех четырёх списков сразу. `{owner}` и `{repo}` gh подставляет сам — из
 * удалённого репозитория папки проекта.
 */
const OVERVIEW_QUERY = `
query($owner: String!, $name: String!, $labelLimit: Int!, ${LISTS.map(
  ([kind, state]) => `$${listAlias(kind, state)}: Int!`
).join(', ')}) {
  repository(owner: $owner, name: $name) {
    url
    nameWithOwner
${LISTS.map(
  ([kind, state]) =>
    `    ${listAlias(kind, state)}: ${connectionField(kind, state, `$${listAlias(kind, state)}`)}`
).join('\n')}
  }
}
${FRAGMENTS.pullRequests.text}
${FRAGMENTS.issues.text}`

/** Следующая страница одного списка — после курсора предыдущей. */
function pageQuery(kind: GitHubKind, state: ListState): string {
  // Объявленная, но не использованная переменная — ошибка GraphQL, а метки есть только у issue.
  const labelVariable = kind === 'issues' ? ', $labelLimit: Int!' : ''
  return `
query($owner: String!, $name: String!, $first: Int!, $after: String!${labelVariable}) {
  repository(owner: $owner, name: $name) {
    list: ${connectionField(kind, state, '$first', '$after')}
  }
}
${FRAGMENTS[kind].text}`
}

/** Хост GitHub, токен которого gh берёт из `GH_TOKEN`. */
const GITHUB_HOST = 'github.com'

/** Учётная запись из `gh auth status --json hosts`. */
interface GitHubAccount {
  login: string
  active: boolean
  state: string
}

/** Автор удалённой учётной записи GitHub — вместо него GitHub отдаёт `null`. */
const GHOST_AUTHOR = 'ghost'

interface Connection<Node> {
  totalCount: number
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
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

interface GitHubNodes {
  pullRequests: PullRequestNode
  issues: IssueNode
}

type OverviewRepository = { url: string; nameWithOwner: string } & Record<
  ListAlias,
  Connection<GitHubNodes[GitHubKind]>
>

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
 * из git, а PR и issue — с GitHub через `gh`: под активной учётной записью, а если у неё нет
 * доступа к репозиторию — под той из остальных, у которой он есть.
 */
export class RepositoryReader {
  /** Токен учётной записи gh, у которой есть доступ к репозиторию папки, если это не активная. */
  private readonly accessTokens = new Map<string, string>()

  constructor(private readonly shell: ShellEnvironment) {}

  /** Коммиты текущей ветки — не меньше `loaded`, чтобы обновление не укоротило список. */
  async commits(path: string, loaded = 0): Promise<RepositoryResult<Listing<Commit>>> {
    try {
      // Листаем от конкретного коммита, а не от HEAD: новые коммиты не сдвинут следующие страницы.
      const head = (await this.run('git', ['rev-parse', '--verify', 'HEAD^{commit}'], path)).trim()
      const [page, total] = await Promise.all([
        this.commitPage(path, head, 0, Math.max(loaded, COMMIT_PAGE_SIZE)),
        this.run('git', ['rev-list', '--count', head], path)
      ])
      return { ok: true, data: { ...page, total: Number(total.trim()) } }
    } catch (error) {
      if (!(await this.isRepository(path))) {
        return { ok: false, error: { kind: 'not-git' } }
      }
      // В новом репозитории ещё нет коммитов — тогда HEAD никуда не указывает.
      if (!(await this.hasCommits(path))) {
        return { ok: true, data: { items: [], next: null, total: 0 } }
      }
      return { ok: false, error: { kind: 'failed', message: errorMessage(error) } }
    }
  }

  async moreCommits(path: string, cursor: string): Promise<RepositoryResult<Page<Commit>>> {
    const match = COMMIT_CURSOR.exec(cursor)
    if (!match) {
      return { ok: false, error: { kind: 'failed', message: 'Invalid commit cursor' } }
    }
    const [, head = '', skipped = '0'] = match
    try {
      return { ok: true, data: await this.commitPage(path, head, Number(skipped), COMMIT_PAGE_SIZE) }
    } catch (error) {
      return { ok: false, error: { kind: 'failed', message: errorMessage(error) } }
    }
  }

  /** Первые страницы PR и issue — каждого списка не меньше, чем уже загружено. */
  github(path: string, loaded?: GitHubCounts): Promise<RepositoryResult<GitHubOverview>> {
    return this.withGitHubAccess(path, (token) => this.queryOverview(path, loaded, token))
  }

  moreGitHub<Kind extends GitHubKind>(
    path: string,
    kind: Kind,
    state: ListState,
    cursor: string
  ): Promise<RepositoryResult<Page<GitHubItems[Kind]>>> {
    return this.withGitHubAccess(path, (token) =>
      this.githubPage(path, kind, state, cursor, GITHUB_PAGE_SIZE, token)
    )
  }

  /**
   * Запрос к GitHub под учётной записью gh. Репозиторий может быть доступен не активной
   * учётной записи, а другой — например, рабочий при активной личной. Тогда пробуем токен,
   * с которым git этого репозитория ходит на GitHub, и токены остальных учётных записей gh,
   * а подошедший запоминаем для папки, чтобы следующие запросы шли сразу с ним.
   */
  private async withGitHubAccess<Data>(
    path: string,
    request: (token?: string) => Promise<Data>
  ): Promise<RepositoryResult<Data>> {
    const remembered = this.accessTokens.get(path)
    try {
      return { ok: true, data: await request(remembered) }
    } catch (error) {
      if (!isInaccessibleRepository(error)) {
        return { ok: false, error: classifyGitHubError(error) }
      }
      this.accessTokens.delete(path)
      const tried = new Set(remembered ? [remembered] : [])
      for await (const token of this.alternativeTokens(path, remembered === undefined)) {
        if (tried.has(token)) {
          continue
        }
        tried.add(token)
        try {
          const data = await request(token)
          this.accessTokens.set(path, token)
          return { ok: true, data }
        } catch (retryError) {
          if (!isInaccessibleRepository(retryError)) {
            return { ok: false, error: classifyGitHubError(retryError) }
          }
        }
      }
      // Доступа нет ни у одной учётной записи — показываем исходную ошибку.
      return { ok: false, error: classifyGitHubError(error) }
    }
  }

  /**
   * Токены, с которыми ещё можно попробовать запрос: сначала токен git этого репозитория,
   * затем токены учётных записей gh. Активную пропускаем, если запрос с ней уже не удался.
   */
  private async *alternativeTokens(path: string, skipActive: boolean): AsyncGenerator<string> {
    const gitToken = await this.gitCredentialToken(path)
    if (gitToken) {
      yield gitToken
    }
    for (const account of await this.githubAccounts(path)) {
      if (skipActive && account.active) {
        continue
      }
      const token = await this.run(
        'gh',
        ['auth', 'token', '--hostname', GITHUB_HOST, '--user', account.login],
        path
      ).then(
        (output) => output.trim(),
        () => ''
      )
      if (token) {
        yield token
      }
    }
  }

  /** Учётные записи github.com, в которые выполнен вход в gh; пусто, если gh их не сообщил. */
  private async githubAccounts(path: string): Promise<GitHubAccount[]> {
    try {
      const output = await this.run(
        'gh',
        ['auth', 'status', '--hostname', GITHUB_HOST, '--json', 'hosts'],
        path
      )
      const { hosts } = JSON.parse(output) as { hosts?: Record<string, GitHubAccount[]> }
      return (hosts?.[GITHUB_HOST] ?? []).filter((account) => account.state === 'success')
    } catch {
      return []
    }
  }

  private async queryOverview(
    path: string,
    loaded: GitHubCounts | undefined,
    token?: string
  ): Promise<GitHubOverview> {
    const wanted = (kind: GitHubKind, state: ListState) =>
      Math.max(loaded?.[kind][state] ?? 0, GITHUB_PAGE_SIZE)
    const repository = await this.graphql<OverviewRepository>(
      path,
      OVERVIEW_QUERY,
      {
        labelLimit: LABEL_LIMIT,
        ...Object.fromEntries(LISTS.map(([kind, state]) => [listAlias(kind, state), GITHUB_PAGE_SIZE]))
      },
      token
    )

    // Если раньше загрузили больше первой страницы, догружаем остальное.
    const listing = async <Kind extends GitHubKind>(
      kind: Kind,
      state: ListState
    ): Promise<Listing<GitHubItems[Kind]>> => {
      const connection = repository[listAlias(kind, state)] as Connection<GitHubNodes[Kind]>
      const first = toListing(connection, converter(kind))
      const missing = wanted(kind, state) - first.items.length
      if (missing <= 0 || !first.next) {
        return first
      }
      const rest = await this.githubPage(path, kind, state, first.next, missing, token)
      return { ...first, items: [...first.items, ...rest.items], next: rest.next }
    }

    const [openPullRequests, closedPullRequests, openIssues, closedIssues] = await Promise.all([
      listing('pullRequests', 'open'),
      listing('pullRequests', 'closed'),
      listing('issues', 'open'),
      listing('issues', 'closed')
    ])
    return {
      url: repository.url,
      name: repository.nameWithOwner,
      pullRequests: { open: openPullRequests, closed: closedPullRequests },
      issues: { open: openIssues, closed: closedIssues }
    }
  }

  /** `count` элементов списка после курсора — страницами по `GITHUB_PAGE_SIZE`. */
  private async githubPage<Kind extends GitHubKind>(
    path: string,
    kind: Kind,
    state: ListState,
    cursor: string,
    count: number,
    token?: string
  ): Promise<Page<GitHubItems[Kind]>> {
    const items: GitHubItems[Kind][] = []
    let next: string | null = cursor
    while (next && items.length < count) {
      const response: { list: Connection<GitHubNodes[Kind]> } = await this.graphql(
        path,
        pageQuery(kind, state),
        {
          first: Math.min(count - items.length, GITHUB_PAGE_SIZE),
          after: next,
          ...(kind === 'issues' ? { labelLimit: LABEL_LIMIT } : {})
        },
        token
      )
      const page: Page<GitHubItems[Kind]> = toListing(response.list, converter(kind))
      items.push(...page.items)
      next = page.next
    }
    return { items, next }
  }

  /** Запрос GraphQL к репозиторию папки проекта; возвращает его поле `repository`. */
  private async graphql<Repository>(
    path: string,
    query: string,
    variables: Record<string, string | number>,
    token?: string
  ): Promise<Repository> {
    const args = ['api', 'graphql', '-F', 'owner={owner}', '-F', 'name={repo}']
    for (const [name, value] of Object.entries(variables)) {
      // Строки — через `-f`: `-F` превратил бы курсор, похожий на число, в число.
      args.push(typeof value === 'number' ? '-F' : '-f', `${name}=${value}`)
    }
    args.push('-f', `query=${query}`)
    const output = await this.run('gh', args, path, token ? { GH_TOKEN: token } : {})
    const repository = (JSON.parse(output) as { data?: { repository: Repository | null } }).data
      ?.repository
    if (!repository) {
      throw new Error('GitHub returned no repository')
    }
    return repository
  }

  /** `limit` коммитов от `head`, пропустив первые `skipped`. */
  private async commitPage(
    path: string,
    head: string,
    skipped: number,
    limit: number
  ): Promise<Page<Commit>> {
    const [log, unpushed] = await Promise.all([
      // На один больше, чтобы знать, есть ли следующая страница.
      this.run(
        'git',
        ['log', `--skip=${skipped}`, `-n${limit + 1}`, `--format=${LOG_FORMAT}`, head],
        path
      ),
      this.unpushedCommits(path, head, skipped + limit)
    ])
    const commits = parseLog(log, unpushed)
    return {
      items: commits.slice(0, limit),
      next: commits.length > limit ? `${head}:${skipped + limit}` : null
    }
  }

  /**
   * Неотправленные коммиты среди первых `limit` от `head` — их нет ни в одной удалённой ветке.
   * Если удалённых репозиториев нет вовсе, отмечать нечего: иначе неотправленным оказался бы
   * каждый коммит.
   */
  private async unpushedCommits(path: string, head: string, limit: number): Promise<Set<string>> {
    const remotes = await this.run('git', ['remote'], path).catch(() => '')
    if (!remotes.trim()) {
      return new Set()
    }
    const output = await this.run(
      'git',
      ['rev-list', `-n${limit}`, head, '--not', '--remotes'],
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
  connection: Connection<Node>,
  convert: (node: Node) => Item
): Listing<Item> {
  return {
    items: connection.nodes.map(convert),
    total: connection.totalCount,
    next: connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null
  }
}

function converter<Kind extends GitHubKind>(
  kind: Kind
): (node: GitHubNodes[Kind]) => GitHubItems[Kind] {
  const converters: { [K in GitHubKind]: (node: GitHubNodes[K]) => GitHubItems[K] } = {
    pullRequests: toPullRequest,
    issues: toIssue
  }
  return converters[kind]
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
