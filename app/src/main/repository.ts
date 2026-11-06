import { setTimeout as delay } from 'node:timers/promises'
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
import { BACKGROUND_GIT_ENVIRONMENT, CommandError, errorMessage, runCommand } from './processes'
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
 * Одна страница одного списка — первая или следующая после курсора `$after`. Списки
 * запрашиваются отдельно и одновременно: в одном запросе GitHub выполняет их по очереди и на
 * большом репозитории не укладывается в своё ограничение по времени — отвечает 504.
 * `{owner}` и `{repo}` gh подставляет сам — из удалённого репозитория папки проекта.
 */
function listQuery(kind: GitHubKind, state: ListState, paged: boolean): string {
  const variables = [
    '$owner: String!',
    '$name: String!',
    '$first: Int!',
    ...(paged ? ['$after: String!'] : []),
    // Объявленная, но не использованная переменная — ошибка GraphQL, а метки есть только у issue.
    ...(kind === 'issues' ? ['$labelLimit: Int!'] : [])
  ]
  return `
query(${variables.join(', ')}) {
  repository(owner: $owner, name: $name) {
    url
    nameWithOwner
    list: ${connectionField(kind, state, '$first', paged ? '$after' : undefined)}
  }
}
${FRAGMENTS[kind].text}`
}

/**
 * Ответ GitHub, после которого запрос стоит повторить: шлюз не дождался сервера или тот
 * перегружен. Так бывает на больших репозиториях, и обычно следующий запрос проходит.
 */
const GATEWAY_ERROR = /\bHTTP 50[234]\b/

/** Паузы перед повторами запроса к GitHub после ответа шлюза. */
const GITHUB_RETRY_DELAYS_MS = [1_000, 3_000]

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

/** Страница списка и сам репозиторий: его адрес приходит с каждым списком. */
interface ListResponse<Kind extends GitHubKind> {
  url: string
  nameWithOwner: string
  list: Connection<GitHubNodes[Kind]>
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
    // Первая страница списка; если раньше загрузили больше, догружаем остальное.
    const listing = async <Kind extends GitHubKind>(kind: Kind, state: ListState) => {
      const response = await this.listPage(path, kind, state, null, GITHUB_PAGE_SIZE, token)
      const first = toListing(response.list, converter(kind))
      const missing = Math.max(loaded?.[kind][state] ?? 0, GITHUB_PAGE_SIZE) - first.items.length
      if (missing <= 0 || !first.next) {
        return { response, listing: first }
      }
      const rest = await this.githubPage(path, kind, state, first.next, missing, token)
      return {
        response,
        listing: { ...first, items: [...first.items, ...rest.items], next: rest.next }
      }
    }

    const [openPullRequests, closedPullRequests, openIssues, closedIssues] = await Promise.all([
      listing('pullRequests', 'open'),
      listing('pullRequests', 'closed'),
      listing('issues', 'open'),
      listing('issues', 'closed')
    ])
    return {
      url: openPullRequests.response.url,
      name: openPullRequests.response.nameWithOwner,
      pullRequests: { open: openPullRequests.listing, closed: closedPullRequests.listing },
      issues: { open: openIssues.listing, closed: closedIssues.listing }
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
      const response: ListResponse<Kind> = await this.listPage(
        path,
        kind,
        state,
        next,
        Math.min(count - items.length, GITHUB_PAGE_SIZE),
        token
      )
      const page: Page<GitHubItems[Kind]> = toListing(response.list, converter(kind))
      items.push(...page.items)
      next = page.next
    }
    return { items, next }
  }

  /** `first` элементов списка — с начала (`after` — `null`) или после курсора. */
  private listPage<Kind extends GitHubKind>(
    path: string,
    kind: Kind,
    state: ListState,
    after: string | null,
    first: number,
    token?: string
  ): Promise<ListResponse<Kind>> {
    return this.graphql(
      path,
      listQuery(kind, state, after !== null),
      {
        first,
        ...(after !== null && { after }),
        ...(kind === 'issues' && { labelLimit: LABEL_LIMIT })
      },
      token
    )
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
    const output = await this.withGatewayRetries(() =>
      this.run('gh', args, path, token ? { GH_TOKEN: token } : {})
    )
    const repository = (JSON.parse(output) as { data?: { repository: Repository | null } }).data
      ?.repository
    if (!repository) {
      throw new Error('GitHub returned no repository')
    }
    return repository
  }

  /** Повторяет запрос, пока GitHub отвечает ошибкой шлюза, но не больше заданного числа раз. */
  private async withGatewayRetries<T>(request: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await request()
      } catch (error) {
        const pause = GITHUB_RETRY_DELAYS_MS[attempt]
        if (pause === undefined || !isGatewayError(error)) {
          throw error
        }
        console.warn(`GitHub request failed, retrying in ${pause / 1000} s`, error)
        await delay(pause)
      }
    }
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
    const env = {
      ...(await this.shell.get()),
      ...(program === 'git' && BACKGROUND_GIT_ENVIRONMENT),
      ...extraEnvironment
    }
    return runCommand(program, args, { cwd, env, ...(input !== undefined && { input }) })
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

function isGatewayError(error: unknown): boolean {
  return error instanceof CommandError && GATEWAY_ERROR.test(error.stderr)
}

function classifyGitHubError(error: unknown): RepositoryError {
  if (isGatewayError(error)) {
    return { kind: 'failed', message: 'GitHub didn’t respond in time. Try again in a moment.' }
  }
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
