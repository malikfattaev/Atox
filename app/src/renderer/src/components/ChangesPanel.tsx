import { useEffect, useState, type CSSProperties } from 'react'
import { ChevronRight, RefreshCw, Undo2 } from 'lucide-react'
import type { FileChange, FileChangeKind, FileDiff } from '../../../shared/changes'
import { TERMINAL_WIDTH } from '../../../shared/settings'
import { useProjectChanges } from '../hooks/useProjectChanges'
import { useSettings } from '../hooks/SettingsContext'
import { PanelResizer } from './PanelResizer'

const { atox } = window

/** Буква вида изменения, как в редакторах: M — изменён, U — новый, ещё не добавлен в git. */
const KIND_LETTERS: Record<FileChangeKind, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U'
}

const KIND_LABELS: Record<FileChangeKind, string> = {
  modified: 'Modified',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  untracked: 'New file'
}

interface ChangesPanelProps {
  projectId: string
}

/**
 * Панель справа от чатов: файлы, которые изменены в проекте с последнего коммита, и сами
 * изменения построчно. Делит место и ширину с терминалом.
 */
export function ChangesPanel({ projectId }: ChangesPanelProps) {
  const { terminalWidth } = useSettings()
  // Пока тянут край, ширина живёт здесь; в настройки попадает только итоговая.
  const [draftWidth, setDraftWidth] = useState<number | null>(null)
  const width = draftWidth ?? terminalWidth
  const { result, refresh } = useProjectChanges(projectId)
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(new Set())
  const files = result?.ok ? result.files : null

  useEffect(() => setExpandedPaths(new Set()), [projectId])

  const toggle = (path: string) =>
    setExpandedPaths((paths) => {
      const next = new Set(paths)
      if (!next.delete(path)) {
        next.add(path)
      }
      return next
    })

  const discard = async (path: string) => {
    if (await atox.changes.discard(projectId, path)) {
      refresh()
    }
  }

  return (
    <aside className="changes-panel" style={{ '--terminal-width': `${width}px` } as CSSProperties}>
      <header className="changes-panel__header">
        <h2 className="changes-panel__title">Changes</h2>
        {files && files.length > 0 && (
          <>
            <span className="changes-panel__count">{files.length}</span>
            <DiffStat {...totals(files)} />
          </>
        )}
        <button
          type="button"
          className="changes-panel__refresh icon-button"
          aria-label="Refresh"
          title="Refresh"
          onClick={refresh}
        >
          <RefreshCw className="icon" />
        </button>
      </header>

      <div className="changes-panel__body">
        {result && !result.ok && (
          <p className="changes-panel__message">
            {result.error.kind === 'not-git'
              ? 'This project is not a git repository'
              : result.error.message}
          </p>
        )}
        {files?.length === 0 && <p className="changes-panel__message">No changes</p>}
        {files && files.length > 0 && (
          <ul className="changes-panel__files">
            {files.map((file) => (
              <ChangedFile
                key={file.path}
                projectId={projectId}
                file={file}
                expanded={expandedPaths.has(file.path)}
                onToggle={() => toggle(file.path)}
                onDiscard={() => void discard(file.path)}
              />
            ))}
          </ul>
        )}
      </div>

      <PanelResizer
        width={width}
        bounds={TERMINAL_WIDTH}
        edge="left"
        label="Resize changes"
        onDrag={setDraftWidth}
        onCommit={(next) => atox.settings.update({ terminalWidth: next })}
      />
    </aside>
  )
}

interface ChangedFileProps {
  projectId: string
  file: FileChange
  expanded: boolean
  onToggle(): void
  onDiscard(): void
}

function ChangedFile({ projectId, file, expanded, onToggle, onDiscard }: ChangedFileProps) {
  const diff = useFileDiff(projectId, file, expanded)
  const slash = file.path.lastIndexOf('/')
  const name = file.path.slice(slash + 1)
  const directory = slash >= 0 ? file.path.slice(0, slash) : ''
  const title = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path

  return (
    <li className="changed-file" data-expanded={expanded}>
      <div className="changed-file__row">
        <button
          type="button"
          className="changed-file__toggle"
          aria-expanded={expanded}
          title={title}
          onClick={onToggle}
        >
          <ChevronRight className="changed-file__chevron" aria-hidden />
          <span className="changed-file__name">{name}</span>
          {directory && <span className="changed-file__directory">{directory}</span>}
          {file.additions === null ? (
            <span className="changed-file__binary">Binary</span>
          ) : (
            <DiffStat additions={file.additions} deletions={file.deletions ?? 0} />
          )}
          <span className="changed-file__kind" data-kind={file.kind} title={KIND_LABELS[file.kind]}>
            {KIND_LETTERS[file.kind]}
          </span>
        </button>
        <button
          type="button"
          className="changed-file__discard"
          aria-label={`Discard changes to ${name}`}
          title="Discard changes"
          onClick={onDiscard}
        >
          <Undo2 className="icon" />
        </button>
      </div>
      {expanded && <DiffView diff={diff} />}
    </li>
  )
}

/** Изменения файла построчно, пока он раскрыт; перечитываются, когда файл меняется. */
function useFileDiff(projectId: string, file: FileChange, expanded: boolean) {
  const [diff, setDiff] = useState<FileDiff | null | undefined>(undefined)
  // Без изменения счётчиков строк файл тот же: перечитывать diff незачем.
  const version = `${file.kind}:${file.additions}:${file.deletions}`
  useEffect(() => {
    if (!expanded) {
      return
    }
    let current = true
    void atox.changes.diff(projectId, file.path).then((next) => {
      if (current) {
        setDiff(next)
      }
    })
    return () => {
      current = false
    }
  }, [projectId, file.path, version, expanded])
  return diff
}

function DiffView({ diff }: { diff: FileDiff | null | undefined }) {
  if (diff === undefined) {
    return null
  }
  if (diff === null || (!diff.binary && diff.lines.length === 0)) {
    return <p className="diff__note">No changes in the content</p>
  }
  if (diff.binary) {
    return <p className="diff__note">Binary file</p>
  }
  return (
    <div className="diff">
      <div className="diff__lines">
        {diff.lines.map((line, index) =>
          line.kind === 'hunk' ? (
            // Первый блок начинается сразу под именем файла — разделитель там не нужен.
            index > 0 && (
              <div key={index} className="diff__hunk">
                {line.text}
              </div>
            )
          ) : (
            <div key={index} className="diff__line" data-kind={line.kind}>
              {line.text}
            </div>
          )
        )}
      </div>
      {diff.truncated && <p className="diff__note">The rest of the changes are too long to show</p>}
    </div>
  )
}

function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="diff-stat">
      {additions > 0 && <span className="diff-stat__added">+{additions}</span>}
      {deletions > 0 && <span className="diff-stat__removed">−{deletions}</span>}
    </span>
  )
}

function totals(files: readonly FileChange[]) {
  return files.reduce(
    (sum, file) => ({
      additions: sum.additions + (file.additions ?? 0),
      deletions: sum.deletions + (file.deletions ?? 0)
    }),
    { additions: 0, deletions: 0 }
  )
}
