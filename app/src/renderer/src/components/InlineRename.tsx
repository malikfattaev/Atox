import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

interface InlineRenameProps {
  value: string
  label: string
  onSubmit(value: string): void
  onCancel(): void
}

/** Поле переименования прямо в строке: Enter или потеря фокуса сохраняют, Esc отменяет. */
export function InlineRename({ value, label, onSubmit, onCancel }: InlineRenameProps) {
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  // Размонтирование поля тоже вызывает blur — без флага Esc превратился бы в сохранение.
  const finishedRef = useRef(false)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  // При закрытии окна blur не срабатывает — введённое название сохраняем явно.
  const finishRef = useRef<(save: boolean) => void>(() => undefined)
  useEffect(() => {
    const saveOnUnload = () => finishRef.current(true)
    window.addEventListener('beforeunload', saveOnUnload)
    return () => window.removeEventListener('beforeunload', saveOnUnload)
  }, [])

  const finish = (save: boolean) => {
    if (finishedRef.current) {
      return
    }
    finishedRef.current = true

    const trimmed = draft.trim()
    if (save && trimmed && trimmed !== value) {
      onSubmit(trimmed)
    } else {
      onCancel()
    }
  }

  finishRef.current = finish

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      finish(true)
    } else if (event.key === 'Escape') {
      finish(false)
    }
  }

  return (
    <input
      ref={inputRef}
      className="row__input"
      aria-label={label}
      value={draft}
      autoFocus
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => finish(true)}
    />
  )
}
