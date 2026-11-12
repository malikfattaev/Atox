import { useEffect, useMemo, useRef, useState } from 'react'
import { Lock, Search, X } from 'lucide-react'
import type { AvailableRepository, BoardRepository } from '../../../shared/board'
import { ipcErrorMessage } from '../lib/ipcError'

interface BoardRepositoryPickerProps {
  selected: readonly BoardRepository[]
  onSave(repositories: BoardRepository[]): void
  onClose(): void
}

/** Окно выбора репозиториев доски: все репозитории учётных записей `gh` по владельцам. */
export function BoardRepositoryPicker({ selected, onSave, onClose }: BoardRepositoryPickerProps) {
  const [available, setAvailable] = useState<AvailableRepository[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState(() => new Set(selected.map(({ fullName }) => fullName)))
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void window.atox.board.availableRepositories().then(setAvailable, (reason: unknown) =>
      setError(ipcErrorMessage(reason))
    )
    searchRef.current?.focus()
  }, [])

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Esc закрывает окно, а не страницу доски под ним.
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const byOwner = new Map<string, AvailableRepository[]>()
    for (const repository of available ?? []) {
      if (!needle || repository.fullName.toLowerCase().includes(needle)) {
        byOwner.set(repository.owner, [...(byOwner.get(repository.owner) ?? []), repository])
      }
    }
    return [...byOwner.entries()]
  }, [available, query])

  const toggle = (fullName: string) =>
    setChosen((current) => {
      const next = new Set(current)
      if (!next.delete(fullName)) {
        next.add(fullName)
      }
      return next
    })

  const save = () => {
    // Уже выбранные репозитории, которых нет в списке (учётная запись вышла из gh), остаются.
    const listed = new Map((available ?? []).map((repository) => [repository.fullName, repository]))
    const kept = selected.filter(({ fullName }) => chosen.has(fullName) && !listed.has(fullName))
    const added = [...chosen].flatMap((fullName) => {
      const repository = listed.get(fullName)
      return repository ? [{ fullName, account: repository.account }] : []
    })
    onSave([...kept, ...added])
  }

  return (
    <div className="modal" role="presentation" onMouseDown={onClose}>
      <div
        className="modal__dialog repo-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="repo-picker-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          <div>
            <h2 id="repo-picker-title" className="modal__title">
              Repositories
            </h2>
            <p className="modal__subtitle">
              Open issues of the chosen repositories become tasks on the board.
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X className="icon" />
          </button>
        </header>

        <label className="repo-picker__search">
          <Search className="repo-picker__search-icon" />
          <input
            ref={searchRef}
            type="search"
            placeholder="Search repositories"
            value={query}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <div className="repo-picker__list">
          {error ? (
            <p className="repo-picker__status">Couldn’t load repositories: {error}</p>
          ) : available === null ? (
            <p className="repo-picker__status">Loading repositories from GitHub…</p>
          ) : groups.length === 0 ? (
            <p className="repo-picker__status">
              {available.length === 0
                ? 'No repositories. Sign in with gh auth login in Terminal.'
                : 'Nothing matches your search.'}
            </p>
          ) : (
            groups.map(([owner, repositories]) => (
              <section key={owner} className="repo-picker__group">
                <h3 className="repo-picker__owner">
                  <img
                    className="repo-picker__avatar"
                    src={repositories[0]!.ownerAvatarUrl}
                    alt=""
                  />
                  {owner}
                </h3>
                {repositories.map((repository) => (
                  <label key={repository.fullName} className="repo-picker__row">
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={chosen.has(repository.fullName)}
                      onChange={() => toggle(repository.fullName)}
                    />
                    <span className="repo-picker__name">
                      {repository.fullName.slice(owner.length + 1)}
                      {repository.isPrivate && (
                        <Lock className="repo-picker__lock" aria-label="Private" />
                      )}
                    </span>
                    <span className="repo-picker__issues">
                      {repository.openIssues === 1 ? '1 issue' : `${repository.openIssues} issues`}
                    </span>
                  </label>
                ))}
              </section>
            ))
          )}
        </div>

        <footer className="modal__footer">
          <span className="modal__note">
            {chosen.size === 1 ? '1 repository' : `${chosen.size} repositories`} selected
          </span>
          <button type="button" className="settings__button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="settings__button settings__button--primary"
            disabled={available === null}
            onClick={save}
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  )
}
