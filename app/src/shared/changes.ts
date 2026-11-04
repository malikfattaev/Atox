/** Как изменён файл относительно последнего коммита. */
export type FileChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'

/** Файл, изменённый в папке проекта и ещё не закоммиченный. */
export interface FileChange {
  /** Путь от корня репозитория. */
  path: string
  /** Прежний путь переименованного файла. */
  previousPath?: string
  kind: FileChangeKind
  /** Добавленные и удалённые строки; `null` — файл двоичный. */
  additions: number | null
  deletions: number | null
}

export type ChangesResult =
  | { ok: true; files: FileChange[] }
  | { ok: false; error: { kind: 'not-git' } | { kind: 'failed'; message: string } }

export type DiffLineKind = 'hunk' | 'context' | 'added' | 'removed'

export interface DiffLine {
  kind: DiffLineKind
  /** Текст строки без знака `+`, `-` или пробела в начале. */
  text: string
}

/** Изменения одного файла построчно. */
export interface FileDiff {
  lines: DiffLine[]
  /** Файл двоичный: строк у него нет. */
  binary: boolean
  /** Изменений слишком много — показано только начало. */
  truncated: boolean
}

/** Больше строк в панели не прочитать, а окно на огромном diff заметно тормозит. */
export const DIFF_LINE_LIMIT = 2000

/** Разбирает вывод `git diff` одного файла: заголовки опускаются, остаются блоки и строки. */
export function parseDiff(patch: string): FileDiff {
  const lines: DiffLine[] = []
  let inHunk = false
  let binary = false
  let truncated = false
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true
      // В заголовке блока после координат git пишет функцию или раздел, где он начинается.
      lines.push({ kind: 'hunk', text: line.replace(/^@@[^@]*@@ ?/, '') })
    } else if (!inHunk) {
      binary ||= line.startsWith('Binary files ')
      continue
    } else if (line.startsWith('+')) {
      lines.push({ kind: 'added', text: line.slice(1) })
    } else if (line.startsWith('-')) {
      lines.push({ kind: 'removed', text: line.slice(1) })
    } else if (line.startsWith(' ')) {
      lines.push({ kind: 'context', text: line.slice(1) })
    } else if (line.startsWith('diff --git')) {
      inHunk = false
    }
    // «\ No newline at end of file» и пустой хвост вывода не показываем.
    if (lines.length >= DIFF_LINE_LIMIT) {
      truncated = true
      break
    }
  }
  return { lines, binary, truncated }
}
