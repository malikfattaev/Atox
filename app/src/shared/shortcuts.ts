/** Горячая клавиша: accelerator в формате Electron — для меню, `keys` — только для показа. */
export interface Shortcut {
  label: string
  /** Сочетание по умолчанию; такие клавиши можно переназначить в настройках. */
  accelerator?: string
  /** Сочетание, которое обрабатывает само окно, а не меню (например, ⌘1…⌘9); не меняется. */
  keys?: string
}

/** Горячие клавиши приложения: по ним строится меню, и они же перечислены в настройках. */
export const SHORTCUTS = {
  newChat: { label: 'New chat', accelerator: 'CmdOrCtrl+N' },
  closeChat: { label: 'Close chat', accelerator: 'CmdOrCtrl+W' },
  previousChat: { label: 'Previous chat', accelerator: 'CmdOrCtrl+Shift+[' },
  nextChat: { label: 'Next chat', accelerator: 'CmdOrCtrl+Shift+]' },
  chatByNumber: { label: 'Go to chat by number', keys: '⌘1 – ⌘9' },
  openChatBeside: { label: 'Open chat to the side', keys: '⌘ Click' },
  openProject: { label: 'Open project', accelerator: 'CmdOrCtrl+O' },
  find: { label: 'Find in terminal', accelerator: 'CmdOrCtrl+F' },
  newLine: { label: 'New line without sending', keys: '⇧↩' },
  zoomIn: { label: 'Increase font size', accelerator: 'CmdOrCtrl+Plus' },
  zoomOut: { label: 'Decrease font size', accelerator: 'CmdOrCtrl+-' },
  actualSize: { label: 'Default font size', accelerator: 'CmdOrCtrl+0' },
  toggleSidebar: { label: 'Show or hide sidebar', accelerator: 'CmdOrCtrl+B' },
  openSettings: { label: 'Settings', accelerator: 'CmdOrCtrl+,' }
} as const satisfies Record<string, Shortcut>

export type ShortcutId = keyof typeof SHORTCUTS

/** Свои сочетания вместо стандартных — в формате accelerator Electron. */
export type ShortcutOverrides = Partial<Record<ShortcutId, string>>

/** Разделы списка горячих клавиш в настройках. */
export const SHORTCUT_GROUPS: ReadonlyArray<{ title: string; shortcuts: readonly ShortcutId[] }> = [
  {
    title: 'Chats',
    shortcuts: [
      'newChat',
      'closeChat',
      'previousChat',
      'nextChat',
      'chatByNumber',
      'openChatBeside',
      'openProject'
    ]
  },
  {
    title: 'Terminal',
    shortcuts: ['find', 'newLine', 'zoomIn', 'zoomOut', 'actualSize']
  },
  {
    title: 'Window',
    shortcuts: ['toggleSidebar', 'openSettings']
  }
]

/**
 * Сочетания, занятые системой и стандартными пунктами меню: назначить их другому действию
 * нельзя, иначе пропало бы копирование, выход из приложения и т. п.
 */
const RESERVED_SHORTCUTS: ReadonlyArray<{ accelerator: string; label: string }> = [
  { accelerator: 'CmdOrCtrl+Q', label: 'Quit' },
  { accelerator: 'CmdOrCtrl+H', label: 'Hide' },
  { accelerator: 'Alt+CmdOrCtrl+H', label: 'Hide others' },
  { accelerator: 'CmdOrCtrl+M', label: 'Minimize' },
  { accelerator: 'CmdOrCtrl+Z', label: 'Undo' },
  { accelerator: 'Shift+CmdOrCtrl+Z', label: 'Redo' },
  { accelerator: 'CmdOrCtrl+X', label: 'Cut' },
  { accelerator: 'CmdOrCtrl+C', label: 'Copy' },
  { accelerator: 'CmdOrCtrl+V', label: 'Paste' },
  { accelerator: 'CmdOrCtrl+A', label: 'Select all' },
  ...Array.from({ length: 9 }, (_, index) => ({
    accelerator: `CmdOrCtrl+${index + 1}`,
    label: SHORTCUTS.chatByNumber.label
  }))
]

/** Модификаторы в порядке macOS: ⌃⌥⇧⌘. */
const MODIFIERS: ReadonlyArray<readonly [name: string, symbol: string]> = [
  ['Ctrl', '⌃'],
  ['Alt', '⌥'],
  ['Shift', '⇧'],
  ['CmdOrCtrl', '⌘']
]

/**
 * Клавиши по физическому положению (KeyboardEvent.code), а не по символу: на русской
 * раскладке ⌘N остаётся ⌘N, как и в остальных приложениях macOS.
 */
const CODE_KEYS: Readonly<Record<string, string>> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown'
}

const KEY_SYMBOLS: Readonly<Record<string, string>> = {
  Plus: '+',
  '-': '−',
  Enter: '↩',
  Tab: '⇥',
  Space: 'Space',
  Backspace: '⌫',
  Delete: '⌦',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Home: '↖',
  End: '↘',
  PageUp: '⇞',
  PageDown: '⇟'
}

const KNOWN_KEYS = new Set([...Object.values(CODE_KEYS), 'Plus'])

/** Клавиша accelerator по KeyboardEvent.code; `null` — модификатор или неподдерживаемая клавиша. */
export function keyFromCode(code: string): string | null {
  const letterOrDigit = /^(?:Key([A-Z])|Digit(\d))$/.exec(code)
  if (letterOrDigit) {
    return letterOrDigit[1] ?? letterOrDigit[2]!
  }
  if (/^F(?:[1-9]|1[0-2])$/.test(code)) {
    return code
  }
  return CODE_KEYS[code] ?? null
}

/** Разбирает accelerator на модификаторы и клавишу; «Plus» — клавиша, а не разделитель. */
function parseAccelerator(accelerator: string): { modifiers: string[]; key: string } {
  const parts = accelerator.split('+').filter(Boolean)
  const key = parts.pop() ?? ''
  return { modifiers: parts, key }
}

/** Accelerator с модификаторами в одном порядке: так одинаковые сочетания совпадают строкой. */
export function canonicalAccelerator(accelerator: string): string {
  const { modifiers, key } = parseAccelerator(accelerator)
  return [
    ...MODIFIERS.filter(([name]) => modifiers.includes(name)).map(([name]) => name),
    key
  ].join('+')
}

/**
 * Годится ли сочетание для горячей клавиши. Нужен ⌘ или ⌃: сочетание без них перехватывало бы
 * обычный набор текста в терминале.
 */
export function isValidAccelerator(accelerator: string): boolean {
  const { modifiers, key } = parseAccelerator(accelerator)
  const knownModifiers = modifiers.every((modifier) =>
    MODIFIERS.some(([name]) => name === modifier)
  )
  const knownKey = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-2]))$/.test(key) || KNOWN_KEYS.has(key)
  const hasCommandModifier = modifiers.includes('CmdOrCtrl') || modifiers.includes('Ctrl')
  return knownModifiers && knownKey && hasCommandModifier
}

/** Сочетание действия с учётом настроек; `undefined` — у действия нет переназначаемой клавиши. */
export function resolveAccelerator(
  id: ShortcutId,
  overrides: ShortcutOverrides
): string | undefined {
  const shortcut: Shortcut = SHORTCUTS[id]
  return shortcut.accelerator && (overrides[id] ?? shortcut.accelerator)
}

/** Чем уже занято сочетание, кроме самого действия `id`; `null` — свободно. */
export function findShortcutConflict(
  id: ShortcutId,
  accelerator: string,
  overrides: ShortcutOverrides
): string | null {
  const wanted = canonicalAccelerator(accelerator)
  const reserved = RESERVED_SHORTCUTS.find(
    (shortcut) => canonicalAccelerator(shortcut.accelerator) === wanted
  )
  if (reserved) {
    return reserved.label
  }
  const other = (Object.keys(SHORTCUTS) as ShortcutId[]).find((otherId) => {
    const otherAccelerator = otherId !== id && resolveAccelerator(otherId, overrides)
    return otherAccelerator && canonicalAccelerator(otherAccelerator) === wanted
  })
  return other ? SHORTCUTS[other].label : null
}

/** Сочетание так, как его показывает macOS: `CmdOrCtrl+Shift+[` → `⇧⌘[`. */
export function formatAccelerator(accelerator: string): string {
  const { modifiers, key } = parseAccelerator(accelerator)
  const symbols = MODIFIERS.filter(([name]) => modifiers.includes(name)).map(([, symbol]) => symbol)
  return [...symbols, KEY_SYMBOLS[key] ?? key.toUpperCase()].join('')
}

/** Сочетание действия для показа с учётом настроек. */
export function formatShortcut(id: ShortcutId, overrides: ShortcutOverrides): string {
  const shortcut: Shortcut = SHORTCUTS[id]
  const accelerator = resolveAccelerator(id, overrides)
  return accelerator ? formatAccelerator(accelerator) : (shortcut.keys ?? '')
}
