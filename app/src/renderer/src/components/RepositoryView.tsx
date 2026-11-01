import { Fragment, useEffect, useState, type ReactNode } from 'react'
import {
  ArrowUpRight,
  CircleDot,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  RefreshCw,
  Search,
  X,
  type LucideIcon
} from 'lucide-react'
import type {
  GitHubOverview,
  Issue,
  Listing,
  PullRequest,
  RepositoryError,
  RepositoryResult
} from '../../../shared/repository'
import type { Project } from '../../../shared/models'
import { useProjectsContext } from '../hooks/ProjectsContext'
import { useRepository } from '../hooks/useRepository'
import { CommitItem, IssueItem, PullRequestItem } from './RepositoryItems'

const { atox } = window

export type RepositorySection = 'commits' | 'pulls' | 'issues'
type StateFilter = 'open' | 'closed'

const SECTIONS: ReadonlyArray<{ id: RepositorySection; label: string; icon: LucideIcon }> = [
  { id: 'commits', label: 'Commits', icon: GitCommitHorizontal },
  { id: 'pulls', label: 'Pull requests', icon: GitPullRequest },
  { id: 'issues', label: 'Issues', icon: CircleDot }
]

/** Что ищется в списке: текст заголовка, номер, автор, ветка или хеш. */
interface Searchable {
  title: string
  terms: string[]
}

interface RepositoryViewProps {
  project: Project
  branch: string | null
  section: RepositorySection
  onSectionChange(section: RepositorySection): void
  onClose(): void
}

/**
 * Страница репозитория проекта: коммиты текущей ветки, pull request'ы и issue с GitHub.
 * Разделы переключаются сверху, а PR и issue можно сразу отдать агенту в новом чате.
 */
export function RepositoryView({
  project,
  branch,
  section,
  onSectionChange,
  onClose
}: RepositoryViewProps) {
  const { createChat } = useProjectsContext()
  const { commits, github, loading, refresh } = useRepository(project.id, branch)
  const [stateFilter, setStateFilter] = useState<StateFilter>('open')
  const [query, setQuery] = useState('')
  const overview = github?.ok ? github.data : null

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  /** Новый чат с агентом по умолчанию, которому сразу уходит задача. */
  const startChat = async (prompt: string) => {
    const chatId = await createChat(project.id)
    await atox.conversations.send(chatId, prompt)
  }

  const reviewPullRequest = (pullRequest: PullRequest) =>
    void startChat(
      `Review pull request #${pullRequest.number} “${pullRequest.title}”: ${pullRequest.url}\n\n` +
        'Read its description and diff with gh, then point out bugs and risky changes.'
    )

  const fixIssue = (issue: Issue) =>
    void startChat(
      `Work on GitHub issue #${issue.number} “${issue.title}”: ${issue.url}\n\n` +
        'Read the issue and its comments with gh first, then implement the fix.'
    )

  const counts: Record<RepositorySection, number | null> = {
    commits: commits?.ok ? commits.data.length : null,
    pulls: overview?.pullRequests.openCount ?? null,
    issues: overview?.issues.openCount ?? null
  }

  return (
    <section className="repository" aria-labelledby="repository-title">
      <header className="repository__header">
        <div className="repository__heading">
          <h1 id="repository-title" className="repository__title">
            {project.name}
          </h1>
          {branch && (
            <span className="repository__chip" title="Current branch">
              <GitBranch className="repository__chip-icon" />
              {branch}
            </span>
          )}
          {overview && (
            <a
              className="repository__chip repository__chip--link"
              href={overview.url}
              target="_blank"
              rel="noreferrer"
              title="Open on GitHub"
            >
              {overview.name}
              <ArrowUpRight className="repository__chip-icon" />
            </a>
          )}
        </div>
        <div className="repository__actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Refresh"
            title="Refresh"
            data-loading={loading}
            onClick={refresh}
          >
            <RefreshCw className="icon repository__refresh-icon" />
          </button>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X className="icon" />
          </button>
        </div>
      </header>

      <div className="repository__toolbar">
        <div className="segmented" role="tablist" aria-label="Section">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              className="segmented__item"
              aria-selected={section === id}
              onClick={() => onSectionChange(id)}
            >
              <Icon className="segmented__icon" />
              {label}
              {counts[id] !== null && counts[id] > 0 && (
                <span className="segmented__count">{counts[id]}</span>
              )}
            </button>
          ))}
        </div>

        <div className="repository__filters">
          {section !== 'commits' && overview && (
            <StateFilterPicker
              listing={section === 'pulls' ? overview.pullRequests : overview.issues}
              value={stateFilter}
              onChange={setStateFilter}
            />
          )}
          <label className="repository__search">
            <Search className="repository__search-icon" />
            <input
              type="search"
              placeholder="Filter"
              aria-label="Filter"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // Escape сначала очищает фильтр и только потом закрывает страницу.
                if (event.key === 'Escape' && query) {
                  event.stopPropagation()
                  setQuery('')
                }
              }}
            />
          </label>
        </div>
      </div>

      <div className="repository__body">
        {section === 'commits' && (
          <SectionContent
            result={commits}
            query={query}
            empty="No commits yet"
            items={(data) =>
              data.map((commit) => ({
                key: commit.hash,
                searchable: {
                  title: commit.subject,
                  terms: [commit.hash, commit.author, ...commit.tags]
                },
                node: <CommitItem commit={commit} repositoryUrl={overview?.url ?? null} />
              }))
            }
          />
        )}
        {section === 'pulls' && (
          <SectionContent
            result={github}
            query={query}
            empty={stateFilter === 'open' ? 'No open pull requests' : 'No closed pull requests'}
            items={(data: GitHubOverview) =>
              data.pullRequests[stateFilter].map((pullRequest) => ({
                key: String(pullRequest.number),
                searchable: {
                  title: pullRequest.title,
                  terms: [`#${pullRequest.number}`, pullRequest.author, pullRequest.branch]
                },
                node: <PullRequestItem pullRequest={pullRequest} onReview={reviewPullRequest} />
              }))
            }
          />
        )}
        {section === 'issues' && (
          <SectionContent
            result={github}
            query={query}
            empty={stateFilter === 'open' ? 'No open issues' : 'No closed issues'}
            items={(data: GitHubOverview) =>
              data.issues[stateFilter].map((issue) => ({
                key: String(issue.number),
                searchable: {
                  title: issue.title,
                  terms: [`#${issue.number}`, issue.author, ...issue.labels.map(({ name }) => name)]
                },
                node: <IssueItem issue={issue} onFix={fixIssue} />
              }))
            }
          />
        )}
      </div>
    </section>
  )
}

function StateFilterPicker({
  listing,
  value,
  onChange
}: {
  listing: Listing<unknown>
  value: StateFilter
  onChange(value: StateFilter): void
}) {
  const options: ReadonlyArray<{ id: StateFilter; label: string; count: number }> = [
    { id: 'open', label: 'Open', count: listing.openCount },
    { id: 'closed', label: 'Closed', count: listing.closedCount }
  ]
  return (
    <div className="segmented segmented--small" role="radiogroup" aria-label="State">
      {options.map(({ id, label, count }) => (
        <button
          key={id}
          type="button"
          role="radio"
          className="segmented__item"
          aria-checked={value === id}
          onClick={() => onChange(id)}
        >
          {label}
          <span className="segmented__count">{count}</span>
        </button>
      ))}
    </div>
  )
}

interface SectionItem {
  key: string
  searchable: Searchable
  node: ReactNode
}

interface SectionContentProps<Data> {
  /** `undefined` — данные ещё ни разу не загружались. */
  result: RepositoryResult<Data> | undefined
  query: string
  empty: string
  items(data: Data): SectionItem[]
}

function SectionContent<Data>({ result, query, empty, items }: SectionContentProps<Data>) {
  if (!result) {
    return <p className="repository__message">Loading…</p>
  }
  if (!result.ok) {
    return <ErrorMessage error={result.error} />
  }
  const all = items(result.data)
  const visible = filterItems(all, query)
  if (visible.length === 0) {
    return (
      <p className="repository__message">
        {all.length === 0 ? empty : `Nothing matches “${query.trim()}”`}
      </p>
    )
  }
  return (
    <ul className="repository__list">
      {visible.map(({ key, node }) => (
        <Fragment key={key}>{node}</Fragment>
      ))}
    </ul>
  )
}

function filterItems(items: SectionItem[], query: string): SectionItem[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return items
  }
  return items.filter(({ searchable }) => {
    const haystack = [searchable.title, ...searchable.terms].join(' ').toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

function ErrorMessage({ error }: { error: RepositoryError }) {
  const { title, hint } = describeError(error)
  return (
    <div className="repository__message repository__message--error">
      <p className="repository__message-title">{title}</p>
      {hint && <p className="repository__message-hint">{hint}</p>}
    </div>
  )
}

function describeError(error: RepositoryError): { title: string; hint?: ReactNode } {
  switch (error.kind) {
    case 'not-git':
      return { title: 'This folder isn’t a git repository' }
    case 'not-github':
      return {
        title: 'No GitHub repository',
        hint: 'Pull requests and issues appear once the project has a remote on GitHub.'
      }
    case 'gh-missing':
      return {
        title: 'GitHub CLI isn’t installed',
        hint: (
          <>
            Install it from <code>cli.github.com</code>, then run <code>gh auth login</code>.
          </>
        )
      }
    case 'gh-signed-out':
      return {
        title: 'Sign in to GitHub CLI',
        hint: (
          <>
            Run <code>gh auth login</code> in a terminal, then refresh.
          </>
        )
      }
    case 'failed':
      return { title: 'Couldn’t load the repository', hint: error.message }
  }
}
