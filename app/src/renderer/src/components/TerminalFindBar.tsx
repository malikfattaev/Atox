import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import type { ISearchDecorationOptions, SearchAddon } from '@xterm/addon-search'

interface SearchResults {
  index: number
  count: number
}

interface TerminalFindBarProps {
  search: SearchAddon
  decorations: ISearchDecorationOptions
  /** Меняется при каждом ⌘F — по нему поле поиска снова получает фокус. */
  focusRequest: number
  onClose(): void
}

export function TerminalFindBar({ search, decorations, focusRequest, onClose }: TerminalFindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusRequest])

  useEffect(() => {
    const subscription = search.onDidChangeResults(({ resultIndex, resultCount }) =>
      setResults({ index: resultIndex, count: resultCount })
    )
    return () => {
      subscription.dispose()
      search.clearDecorations()
    }
  }, [search])

  const find = (direction: 'next' | 'previous', term = query, incremental = false) => {
    if (!term) {
      search.clearDecorations()
      setResults(null)
      return
    }
    const options = { decorations, incremental }
    if (direction === 'next') {
      search.findNext(term, options)
    } else {
      search.findPrevious(term, options)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      find(event.shiftKey ? 'previous' : 'next')
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div className="find-bar" role="search">
      <input
        ref={inputRef}
        className="find-bar__input"
        placeholder="Find"
        aria-label="Find in terminal"
        value={query}
        spellCheck={false}
        onChange={(event) => {
          setQuery(event.target.value)
          find('next', event.target.value, true)
        }}
        onKeyDown={handleKeyDown}
      />
      <span className="find-bar__count">{formatResults(query, results)}</span>
      <button
        type="button"
        className="find-bar__button"
        aria-label="Previous match"
        onClick={() => find('previous')}
      >
        <ChevronUp className="icon" />
      </button>
      <button
        type="button"
        className="find-bar__button"
        aria-label="Next match"
        onClick={() => find('next')}
      >
        <ChevronDown className="icon" />
      </button>
      <button type="button" className="find-bar__button" aria-label="Close" onClick={onClose}>
        <X className="icon" />
      </button>
    </div>
  )
}

function formatResults(query: string, results: SearchResults | null): string {
  if (!query || !results) {
    return ''
  }
  if (results.count === 0) {
    return 'No results'
  }
  // Индекс -1 означает, что совпадений больше, чем помечает поиск, и текущее не определено.
  return results.index >= 0 ? `${results.index + 1} of ${results.count}` : `${results.count}+`
}
