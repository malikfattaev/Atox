import type { MouseEvent } from 'react'
import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  CircleX,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquare,
  type LucideIcon
} from 'lucide-react'
import type { ContextMenuItem } from '../../../shared/api'
import type {
  CheckStatus,
  Commit,
  Issue,
  IssueState,
  PullRequest,
  PullRequestState,
  ReviewDecision
} from '../../../shared/repository'
import { RepositoryRow } from './RepositoryRow'

const { atox } = window

type RowTone = 'open' | 'merged' | 'closed' | 'muted'

const PULL_REQUEST_LOOK: Record<PullRequestState, { icon: LucideIcon; tone: RowTone }> = {
  open: { icon: GitPullRequest, tone: 'open' },
  draft: { icon: GitPullRequestDraft, tone: 'muted' },
  merged: { icon: GitMerge, tone: 'merged' },
  closed: { icon: GitPullRequestClosed, tone: 'closed' }
}

const ISSUE_LOOK: Record<IssueState, { icon: LucideIcon; tone: RowTone }> = {
  open: { icon: CircleDot, tone: 'open' },
  completed: { icon: CircleCheck, tone: 'merged' },
  'not-planned': { icon: CircleSlash, tone: 'muted' }
}

const CHECKS_LOOK: Record<NonNullable<CheckStatus>, { icon: LucideIcon; label: string }> = {
  success: { icon: CircleCheck, label: 'Checks passed' },
  failure: { icon: CircleX, label: 'Checks failed' },
  pending: { icon: CircleDashed, label: 'Checks running' }
}

const REVIEW_LABEL: Record<NonNullable<ReviewDecision>, string> = {
  approved: 'Approved',
  'changes-requested': 'Changes requested',
  'review-required': 'Review required'
}

/** Пункты контекстного меню строк. */
type ItemAction = 'open' | 'copy-link' | 'copy-id' | 'copy-title' | 'agent'

const openItem = { action: 'open', label: 'Open on GitHub', symbol: 'safari' } as const
const copyLinkItem = { action: 'copy-link', label: 'Copy link', symbol: 'link' } as const

async function showItemMenu(
  event: MouseEvent,
  items: ContextMenuItem<ItemAction>[],
  handlers: Partial<Record<ItemAction, () => void>>
): Promise<void> {
  event.preventDefault()
  const action = await atox.showContextMenu(items)
  if (action) {
    handlers[action]?.()
  }
}

const copy = (text: string) => void navigator.clipboard.writeText(text)
const openUrl = (url: string) => window.open(url, '_blank', 'noreferrer')

interface CommitItemProps {
  commit: Commit
  /** Адрес репозитория на GitHub; `null` — коммит негде открыть. */
  repositoryUrl: string | null
}

export function CommitItem({ commit, repositoryUrl }: CommitItemProps) {
  // Неотправленного коммита на GitHub ещё нет.
  const url = repositoryUrl && !commit.unpushed ? `${repositoryUrl}/commit/${commit.hash}` : null

  return (
    <RepositoryRow
      icon={<GitCommitHorizontal className="icon" />}
      title={commit.subject}
      badges={
        <>
          {commit.tags.map((tag) => (
            <span key={tag} className="repo-badge">
              {tag}
            </span>
          ))}
          {commit.unpushed && (
            <span className="repo-badge repo-badge--accent" title="Not pushed to any remote yet">
              Not pushed
            </span>
          )}
        </>
      }
      meta={[<span className="repo-row__mono">{commit.shortHash}</span>, commit.author]}
      time={commit.committedAt}
      onOpen={url ? () => openUrl(url) : undefined}
      onContextMenu={(event) =>
        void showItemMenu(
          event,
          [
            ...(url ? [openItem, copyLinkItem, { type: 'separator' as const }] : []),
            { action: 'copy-id', label: 'Copy hash', symbol: 'number' },
            { action: 'copy-title', label: 'Copy message', symbol: 'doc.on.doc' }
          ],
          {
            open: () => url && openUrl(url),
            'copy-link': () => url && copy(url),
            'copy-id': () => copy(commit.hash),
            'copy-title': () => copy(commit.subject)
          }
        )
      }
    />
  )
}

interface PullRequestItemProps {
  pullRequest: PullRequest
  onReview(pullRequest: PullRequest): void
}

export function PullRequestItem({ pullRequest, onReview }: PullRequestItemProps) {
  const { icon: Icon, tone } = PULL_REQUEST_LOOK[pullRequest.state]
  const checks = pullRequest.checks && CHECKS_LOOK[pullRequest.checks]
  const active = pullRequest.state === 'open' || pullRequest.state === 'draft'
  const review = () => onReview(pullRequest)

  return (
    <RepositoryRow
      icon={<Icon className="icon" />}
      tone={tone}
      title={pullRequest.title}
      badges={
        pullRequest.review &&
        active && (
          <span className="repo-badge" data-review={pullRequest.review}>
            {REVIEW_LABEL[pullRequest.review]}
          </span>
        )
      }
      meta={[`#${pullRequest.number}`, pullRequest.author, pullRequest.branch]}
      aside={
        <>
          {checks && (
            <span className="repo-stat" data-checks={pullRequest.checks} title={checks.label}>
              <checks.icon className="repo-stat__icon" />
            </span>
          )}
          <CommentCount count={pullRequest.comments} />
          <span className="repo-stat repo-stat--diff" title="Lines added and removed">
            <span className="repo-stat__added">+{pullRequest.additions}</span>
            <span className="repo-stat__removed">−{pullRequest.deletions}</span>
          </span>
        </>
      }
      time={pullRequest.updatedAt}
      action={
        active ? { label: 'Review', title: 'Review in a new chat', onClick: review } : undefined
      }
      onOpen={() => openUrl(pullRequest.url)}
      onContextMenu={(event) =>
        void showItemMenu(
          event,
          [
            openItem,
            copyLinkItem,
            { action: 'copy-id', label: 'Copy number', symbol: 'number' },
            { type: 'separator' },
            { action: 'agent', label: 'Review in new chat', symbol: 'square.and.pencil' }
          ],
          {
            open: () => openUrl(pullRequest.url),
            'copy-link': () => copy(pullRequest.url),
            'copy-id': () => copy(`#${pullRequest.number}`),
            agent: review
          }
        )
      }
    />
  )
}

interface IssueItemProps {
  issue: Issue
  onFix(issue: Issue): void
}

export function IssueItem({ issue, onFix }: IssueItemProps) {
  const { icon: Icon, tone } = ISSUE_LOOK[issue.state]
  const fix = () => onFix(issue)

  return (
    <RepositoryRow
      icon={<Icon className="icon" />}
      tone={tone}
      title={issue.title}
      badges={issue.labels.map((label) => (
        <span key={label.name} className="repo-badge">
          <span className="repo-badge__dot" style={{ background: label.color }} />
          {label.name}
        </span>
      ))}
      meta={[`#${issue.number}`, issue.author]}
      aside={<CommentCount count={issue.comments} />}
      time={issue.updatedAt}
      action={
        issue.state === 'open'
          ? { label: 'Fix', title: 'Fix in a new chat', onClick: fix }
          : undefined
      }
      onOpen={() => openUrl(issue.url)}
      onContextMenu={(event) =>
        void showItemMenu(
          event,
          [
            openItem,
            copyLinkItem,
            { action: 'copy-id', label: 'Copy number', symbol: 'number' },
            { type: 'separator' },
            { action: 'agent', label: 'Fix in new chat', symbol: 'square.and.pencil' }
          ],
          {
            open: () => openUrl(issue.url),
            'copy-link': () => copy(issue.url),
            'copy-id': () => copy(`#${issue.number}`),
            agent: fix
          }
        )
      }
    />
  )
}

function CommentCount({ count }: { count: number }) {
  if (count === 0) {
    return null
  }
  return (
    <span className="repo-stat" title={`${count} ${count === 1 ? 'comment' : 'comments'}`}>
      <MessageSquare className="repo-stat__icon" />
      {count}
    </span>
  )
}
