/** Кому назначена задача: кому угодно, одной из учётных записей пользователя или никому. */
export type AssigneeFilter = 'anyone' | 'me' | 'unassigned'

export const ASSIGNEE_LABELS: Record<AssigneeFilter, string> = {
  anyone: 'Anyone',
  me: 'Me',
  unassigned: 'Unassigned'
}

/** `myLogins` — логины учётных записей `gh` пользователя, в нижнем регистре. */
export function matchesAssignee(
  assignees: readonly string[],
  filter: AssigneeFilter,
  myLogins: ReadonlySet<string>
): boolean {
  switch (filter) {
    case 'anyone':
      return true
    case 'unassigned':
      return assignees.length === 0
    case 'me':
      return assignees.some((login) => myLogins.has(login.toLowerCase()))
  }
}
