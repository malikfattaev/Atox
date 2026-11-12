import type { GitHubIssue } from './github'
import type { IssueWorktree } from './worktrees'

/**
 * Задание агенту доски: issue целиком и то, как сдать работу, — ветка, коммиты, pull request,
 * который закроет issue. Агент видит только это сообщение и папку worktree.
 */
export function formatIssueTask(
  issue: GitHubIssue,
  body: string,
  worktree: IssueWorktree,
  message?: string
): string {
  const reference = `${issue.repository}#${issue.number}`
  return `You are working on GitHub issue ${reference} from the Atox board. This folder is a git worktree on branch \`${worktree.branch}\`, made for this task from the latest default branch; other agents may be working on other issues of the same repository in their own worktrees.

Issue: ${issue.title}
${issue.url}

${body.trim() || '(The issue has no description.)'}
${message ? `\nA note from the user who started this task (follow it where it differs from the issue):\n${message.trim()}\n` : ''}
Do the task end to end:
1. Make the change and verify it: build, run the tests, or run whatever proves it works.
2. Commit on \`${worktree.branch}\` and push it: git push -u origin ${worktree.branch}
3. Open a pull request with gh. Its body must contain "Closes ${reference}".

If something blocks you (missing access, unclear requirements), stop and explain what you need instead of guessing. Finish with a short summary of what you did and the pull request link.`
}
