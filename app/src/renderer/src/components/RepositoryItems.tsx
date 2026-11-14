import type { MouseEvent } from 'react'
import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  CircleX,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Hash,
  Link,
  MessageSquare,
  type LucideIcon
} from 'lucide-react'
import type {
  CheckStatus,
  Issue,
  IssueState,
  PullRequest,
  PullRequestState,
  ReviewDecision
} from '../../../shared/repository'
import { githubAvatarUrl } from '../lib/github'
import { showMenu, type MenuItem } from '../lib/menu'
import { RepositoryRow } from './RepositoryRow'

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
type ItemAction = 'open' | 'copy-link' | 'copy-id'

const openItem = { action: 'open', label: 'Open on GitHub', icon: <ExternalLink /> } as const
const copyLinkItem = { action: 'copy-link', label: 'Copy link', icon: <Link /> } as const

async function showItemMenu(
  event: MouseEvent,
  items: MenuItem<ItemAction>[],
  handlers: Partial<Record<ItemAction, () => void>>
): Promise<void> {
  event.preventDefault()
  const action = await showMenu(items, event)
  if (action) {
    handlers[action]?.()
  }
}

const copy = (text: string) => void navigator.clipboard.writeText(text)
const openUrl = (url: string) => window.open(url, '_blank', 'noreferrer')

interface PullRequestItemProps {
  pullRequest: PullRequest
}

export function PullRequestItem({ pullRequest }: PullRequestItemProps) {
  const { icon: Icon, tone } = PULL_REQUEST_LOOK[pullRequest.state]
  const checks = pullRequest.checks && CHECKS_LOOK[pullRequest.checks]
  const active = pullRequest.state === 'open' || pullRequest.state === 'draft'

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
      meta={[`#${pullRequest.number}`, <Author login={pullRequest.author} />, pullRequest.branch]}
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
      onOpen={() => openUrl(pullRequest.url)}
      onContextMenu={(event) =>
        void showItemMenu(
          event,
          [
            openItem,
            copyLinkItem,
            { action: 'copy-id', label: 'Copy number', icon: <Hash /> }
          ],
          {
            open: () => openUrl(pullRequest.url),
            'copy-link': () => copy(pullRequest.url),
            'copy-id': () => copy(`#${pullRequest.number}`)
          }
        )
      }
    />
  )
}

interface IssueItemProps {
  issue: Issue
}

export function IssueItem({ issue }: IssueItemProps) {
  const { icon: Icon, tone } = ISSUE_LOOK[issue.state]

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
      meta={[`#${issue.number}`, <Author login={issue.author} />]}
      aside={
        <>
          <Assignees logins={issue.assignees} />
          <CommentCount count={issue.comments} />
        </>
      }
      time={issue.updatedAt}
      onOpen={() => openUrl(issue.url)}
      onContextMenu={(event) =>
        void showItemMenu(
          event,
          [
            openItem,
            copyLinkItem,
            { action: 'copy-id', label: 'Copy number', icon: <Hash /> }
          ],
          {
            open: () => openUrl(issue.url),
            'copy-link': () => copy(issue.url),
            'copy-id': () => copy(`#${issue.number}`)
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

/** Сколько аватаров исполнителей помещается в строке. */
const MAX_ASSIGNEE_AVATARS = 3

function Author({ login }: { login: string }) {
  return (
    <span className="repo-author">
      <img className="repo-avatar" src={githubAvatarUrl(login)} alt="" />
      {login}
    </span>
  )
}

function Assignees({ logins }: { logins: readonly string[] }) {
  if (logins.length === 0) {
    return null
  }
  return (
    <span className="repo-assignees" title={`Assigned to ${logins.join(', ')}`}>
      {logins.slice(0, MAX_ASSIGNEE_AVATARS).map((login) => (
        <img key={login} className="repo-avatar" src={githubAvatarUrl(login)} alt="" />
      ))}
    </span>
  )
}
