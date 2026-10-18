import { useEffect, useState, type KeyboardEvent } from 'react'
import { IS_MAC } from '../../../shared/platform'
import {
  acceleratorFromEvent,
  canonicalAccelerator,
  findShortcutConflict,
  formatShortcut,
  isValidAccelerator,
  resolveAccelerator,
  SHORTCUTS,
  type ShortcutId,
  type ShortcutOverrides
} from '../../../shared/shortcuts'

const { atox } = window

/** Пометка, по которой команды окна (⌘1…⌘9) пропускают нажатия, пока записывается сочетание. */
export const SHORTCUT_RECORDER_ATTRIBUTE = 'data-shortcut-recorder'

const RECORDING_PROMPT = 'Type shortcut'
const MISSING_MODIFIER_HINT = IS_MAC ? 'Add ⌘ or ⌃' : 'Add Ctrl'

interface ShortcutRecorderProps {
  id: ShortcutId
  overrides: ShortcutOverrides
  recording: boolean
  onRecordingChange(recording: boolean): void
  /** Новое сочетание; совпадающее со стандартным сохраняется как сброс. */
  onRecord(accelerator: string | null): void
}

/**
 * Сочетание клавиш, которое меняют, нажав на него и набрав новое. Esc отменяет запись;
 * занятое сочетание не принимается — вместо него видно, чем оно занято.
 */
export function ShortcutRecorder({
  id,
  overrides,
  recording,
  onRecordingChange,
  onRecord
}: ShortcutRecorderProps) {
  const [hint, setHint] = useState<string | null>(null)

  // Пока идёт запись, горячие клавиши меню выключены, чтобы нажатое не выполнилось как команда.
  useEffect(() => {
    if (!recording) {
      return
    }
    atox.shortcuts.setRecording(true)
    return () => {
      atox.shortcuts.setRecording(false)
      setHint(null)
    }
  }, [recording])

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) {
      return
    }
    // Нажатия при записи не должны ни закрыть настройки, ни переключить фокус.
    event.preventDefault()
    event.stopPropagation()
    const noModifiers = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
    if (event.key === 'Escape' && noModifiers) {
      onRecordingChange(false)
      return
    }
    const accelerator = acceleratorFromEvent(event.nativeEvent)
    if (!accelerator) {
      return
    }
    if (!isValidAccelerator(accelerator)) {
      setHint(MISSING_MODIFIER_HINT)
      return
    }
    const conflict = findShortcutConflict(id, accelerator, overrides)
    if (conflict) {
      setHint(`Used by ${conflict}`)
      return
    }
    const isDefault = accelerator === canonicalAccelerator(resolveAccelerator(id, {}) ?? '')
    onRecord(isDefault ? null : accelerator)
    onRecordingChange(false)
  }

  const keys = formatShortcut(id, overrides)

  return (
    <button
      type="button"
      className="shortcut-keys shortcut-keys--editable"
      data-recording={recording}
      data-hint={Boolean(hint)}
      aria-label={`${SHORTCUTS[id].label}: ${keys}. Press to change`}
      {...{ [SHORTCUT_RECORDER_ATTRIBUTE]: true }}
      onClick={() => onRecordingChange(!recording)}
      onKeyDown={handleKeyDown}
      onBlur={() => recording && onRecordingChange(false)}
    >
      {recording ? (hint ?? RECORDING_PROMPT) : keys}
    </button>
  )
}
