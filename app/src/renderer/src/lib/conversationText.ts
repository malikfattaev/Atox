import type { TimelineItem, ToolKind } from '../../../shared/conversation'

/** Названия уровней эффорта; неизвестный уровень показывается как есть, с заглавной буквы. */
const EFFORT_LABELS: Record<string, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
  ultra: 'Ultra'
}

export function effortLabel(effort: string): string {
  return EFFORT_LABELS[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1)
}

/** Как назвать в сводке N вызовов инструмента: «Ran 2 commands», «Read a file». */
const TOOL_SUMMARIES: Record<ToolKind, (count: number) => string> = {
  command: (count) => `ran ${plural(count, 'command')}`,
  edit: (count) => `edited ${plural(count, 'file')}`,
  read: (count) => `read ${plural(count, 'file')}`,
  search: (count) => `searched ${count === 1 ? 'once' : `${count} times`}`,
  web: (count) => `browsed ${plural(count, 'page')}`,
  agent: (count) => `ran ${plural(count, 'subagent')}`,
  other: (count) => `used ${plural(count, 'tool')}`
}

/** Порядок в сводке: сначала то, что меняет проект, потом чтение и поиск. */
const SUMMARY_ORDER: readonly ToolKind[] = [
  'command',
  'edit',
  'agent',
  'read',
  'search',
  'web',
  'other'
]

/** Сколько видов действий перечислять в сводке; остальные — «and N more». */
const SUMMARY_KINDS_LIMIT = 3

/** Сводка группы действий агента: «Ran 2 commands, edited 3 files». */
export function summarizeActivity(items: readonly TimelineItem[]): string {
  const counts = new Map<ToolKind, number>()
  for (const item of items) {
    if (item.kind === 'tool') {
      counts.set(item.tool, (counts.get(item.tool) ?? 0) + 1)
    }
  }
  if (counts.size === 0) {
    return 'Thought'
  }
  const parts = SUMMARY_ORDER.filter((kind) => counts.has(kind)).map((kind) =>
    TOOL_SUMMARIES[kind](counts.get(kind)!)
  )
  const shown = parts.slice(0, SUMMARY_KINDS_LIMIT)
  const rest = parts.length - shown.length
  const text = [...shown, ...(rest > 0 ? [`${rest} more`] : [])].join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Подпись строки действия: глагол по виду инструмента. */
export function toolVerb(tool: ToolKind, running: boolean): string {
  switch (tool) {
    case 'command':
      return running ? 'Running' : 'Ran'
    case 'edit':
      return running ? 'Editing' : 'Edited'
    case 'read':
      return running ? 'Reading' : 'Read'
    case 'search':
      return running ? 'Searching' : 'Searched'
    case 'web':
      return running ? 'Browsing' : 'Browsed'
    case 'agent':
      return running ? 'Running agent' : 'Agent'
    case 'other':
      return running ? 'Using' : 'Used'
  }
}

/** «12s», «1m 20s», «1h 5m». */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function plural(count: number, noun: string): string {
  return count === 1 ? `a ${noun}` : `${count} ${noun}s`
}

/** «950», «16k», «1.2M» — токены коротко, как у агентов. */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) {
    return String(tokens)
  }
  if (tokens < 1_000_000) {
    return `${Number((tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0))}k`
  }
  return `${Number((tokens / 1_000_000).toFixed(1))}M`
}

/** Чем занят агент, пока не видно действий: глагол выбирается на весь ответ. */
const WORKING_VERBS = [
  'Thinking',
  'Pondering',
  'Brewing',
  'Tinkering',
  'Mulling',
  'Crafting',
  'Noodling',
  'Percolating',
  'Simmering',
  'Musing'
] as const

/**
 * Подпись работающего агента: рассуждает он или пишет ответ, а в остальное время — глагол
 * на весь ответ. Какую команду он выполняет, видно в группе действий над подписью.
 */
export function workingLabel(items: readonly TimelineItem[], seed: string): string {
  switch (items.at(-1)?.kind) {
    case 'reasoning':
      return 'Thinking'
    case 'assistant':
      return 'Writing'
    default:
      return WORKING_VERBS[hashString(seed) % WORKING_VERBS.length]!
  }
}

/** Простой устойчивый хеш строки: один и тот же ответ всегда получает один и тот же глагол. */
function hashString(value: string): number {
  let hash = 0
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return hash
}
