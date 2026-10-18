import { IS_MAC } from './platform'

/** Горячая клавиша: accelerator в формате Electron — для меню, `keys` — только для показа. */
export interface Shortcut {
  label: string
  /** Сочетание по умолчанию; такие клавиши можно переназначить в настройках. */
  accelerator?: string
  /** Сочетание, которое обрабатывает само окно, а не меню (например, ⌘1…⌘9); не меняется. */
  keys?: string
}

/**
 * Сочетание для macOS и для Linux. На Linux команды приложения — с Ctrl+Shift, как в терминалах
 * Linux: Ctrl с буквой нужен самому терминалу (Ctrl+W стирает слово, Ctrl+F — шаг вперёд).
 */
const byPlatform = (mac: string, linux: string): string => (IS_MAC ? mac : linux)

/** Горячие клавиши приложения: по ним строится меню, и они же перечислены в настройках. */
export const SHORTCUTS = {
  newChat: { label: 'New chat', accelerator: byPlatform('CmdOrCtrl+N', 'Ctrl+Shift+N') },
  closeChat: { label: 'Close chat', accelerator: byPlatform('CmdOrCtrl+W', 'Ctrl+Shift+W') },
  previousChat: {
    label: 'Previous chat',
    accelerator: byPlatform('CmdOrCtrl+Shift+[', 'Ctrl+PageUp')
  },
  nextChat: { label: 'Next chat', accelerator: byPlatform('CmdOrCtrl+Shift+]', 'Ctrl+PageDown') },
  chatByNumber: { label: 'Go to chat by number', keys: byPlatform('⌘1 – ⌘9', 'Alt+1 – Alt+9') },
  openChatBeside: { label: 'Open chat to the side', keys: byPlatform('⌘ Click', 'Ctrl+Click') },
  openProject: { label: 'Open project', accelerator: byPlatform('CmdOrCtrl+O', 'Ctrl+Shift+O') },
  find: { label: 'Find in terminal', accelerator: byPlatform('CmdOrCtrl+F', 'Ctrl+Shift+F') },
  newLine: { label: 'New line without sending', keys: byPlatform('⇧↩', 'Shift+Enter') },
  zoomIn: { label: 'Increase font size', accelerator: byPlatform('CmdOrCtrl+Plus', 'Ctrl+Plus') },
  zoomOut: { label: 'Decrease font size', accelerator: byPlatform('CmdOrCtrl+-', 'Ctrl+-') },
  actualSize: { label: 'Default font size', accelerator: byPlatform('CmdOrCtrl+0', 'Ctrl+0') },
  toggleSidebar: {
    label: 'Show or hide sidebar',
    accelerator: byPlatform('CmdOrCtrl+B', 'Ctrl+Shift+B')
  },
  spaceByNumber: { label: 'Go to space by number', keys: byPlatform('⌃1 – ⌃9', 'Ctrl+1 – Ctrl+9') },
  openSettings: { label: 'Settings', accelerator: byPlatform('CmdOrCtrl+,', 'Ctrl+,') }
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
    shortcuts: ['spaceByNumber', 'toggleSidebar', 'openSettings']
  }
]

/** Копирование и вставка в терминале Linux: Ctrl+C и Ctrl+V там остаются за программой. */
export const LINUX_COPY_ACCELERATOR = 'Ctrl+Shift+C'
export const LINUX_PASTE_ACCELERATOR = 'Ctrl+Shift+V'
/** Выход на Linux — с Shift, чтобы случайный Ctrl+Q в терминале не закрыл приложение. */
export const LINUX_QUIT_ACCELERATOR = 'Ctrl+Shift+Q'

/** Сочетания выбора чата и пространства по номеру — их обрабатывает само окно. */
const numberedShortcuts = (modifier: string, label: string) =>
  Array.from({ length: 9 }, (_, index) => ({ accelerator: `${modifier}+${index + 1}`, label }))

/**
 * Сочетания, занятые системой и стандартными пунктами меню: назначить их другому действию
 * нельзя, иначе пропало бы копирование, выход из приложения и т. п.
 */
const RESERVED_SHORTCUTS: ReadonlyArray<{ accelerator: string; label: string }> = IS_MAC
  ? [
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
      ...numberedShortcuts('CmdOrCtrl', SHORTCUTS.chatByNumber.label),
      ...numberedShortcuts('Ctrl', SHORTCUTS.spaceByNumber.label)
    ]
  : [
      { accelerator: LINUX_QUIT_ACCELERATOR, label: 'Quit' },
      { accelerator: LINUX_COPY_ACCELERATOR, label: 'Copy' },
      { accelerator: LINUX_PASTE_ACCELERATOR, label: 'Paste' },
      // Без этих сочетаний в терминале не прервать программу и не закрыть оболочку.
      { accelerator: 'Ctrl+C', label: 'Interrupt in terminal' },
      { accelerator: 'Ctrl+D', label: 'End of input in terminal' },
      { accelerator: 'Ctrl+Z', label: 'Suspend in terminal' },
      ...numberedShortcuts('Alt', SHORTCUTS.chatByNumber.label),
      ...numberedShortcuts('Ctrl', SHORTCUTS.spaceByNumber.label)
    ]

/**
 * Модификаторы в порядке платформы: ⌃⌥⇧⌘ на macOS, Ctrl+Alt+Shift на Linux. CmdOrCtrl на Linux —
 * тот же Ctrl, поэтому там его нет: сочетания с ним сводятся к Ctrl.
 */
const MODIFIERS: ReadonlyArray<readonly [name: string, symbol: string]> = IS_MAC
  ? [
      ['Ctrl', '⌃'],
      ['Alt', '⌥'],
      ['Shift', '⇧'],
      ['CmdOrCtrl', '⌘']
    ]
  : [
      ['Ctrl', 'Ctrl'],
      ['Alt', 'Alt'],
      ['Shift', 'Shift']
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

const KEY_SYMBOLS: Readonly<Record<string, string>> = IS_MAC
  ? {
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
  : { Plus: '+', Up: '↑', Down: '↓', Left: '←', Right: '→', PageUp: 'PgUp', PageDown: 'PgDn' }

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
  const modifiers = IS_MAC ? parts : parts.map((part) => (part === 'CmdOrCtrl' ? 'Ctrl' : part))
  return { modifiers, key }
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

/**
 * Сочетание так, как его показывает система: `CmdOrCtrl+Shift+[` → `⇧⌘[` на macOS,
 * `Ctrl+Shift+N` → `Ctrl+Shift+N` на Linux.
 */
export function formatAccelerator(accelerator: string): string {
  const { modifiers, key } = parseAccelerator(accelerator)
  const symbols = MODIFIERS.filter(([name]) => modifiers.includes(name)).map(([, symbol]) => symbol)
  const name = KEY_SYMBOLS[key] ?? (key.length === 1 ? key.toUpperCase() : key)
  return [...symbols, name].join(IS_MAC ? '' : '+')
}

/** Сочетание действия для показа с учётом настроек. */
export function formatShortcut(id: ShortcutId, overrides: ShortcutOverrides): string {
  const shortcut: Shortcut = SHORTCUTS[id]
  const accelerator = resolveAccelerator(id, overrides)
  return accelerator ? formatAccelerator(accelerator) : (shortcut.keys ?? '')
}

/**
 * Сочетание нажатой клавиши в формате accelerator; `null` — модификатор или неподдерживаемая
 * клавиша. ⌘ на macOS — CmdOrCtrl; сочетания с Super на Linux принадлежат оконному менеджеру.
 */
export function acceleratorFromEvent(event: {
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}): string | null {
  const key = keyFromCode(event.code)
  if (!key || (event.metaKey && !IS_MAC)) {
    return null
  }
  return canonicalAccelerator(
    [
      event.ctrlKey && 'Ctrl',
      event.altKey && 'Alt',
      event.shiftKey && 'Shift',
      event.metaKey && 'CmdOrCtrl',
      key
    ]
      .filter(Boolean)
      .join('+')
  )
}

/** Сочетания команд приложения с учётом настроек — окно не должно отдавать их терминалу. */
export function menuAccelerators(overrides: ShortcutOverrides): Set<string> {
  const accelerators = (Object.keys(SHORTCUTS) as ShortcutId[]).flatMap(
    (id) => resolveAccelerator(id, overrides) ?? []
  )
  if (!IS_MAC) {
    accelerators.push(LINUX_COPY_ACCELERATOR, LINUX_PASTE_ACCELERATOR, LINUX_QUIT_ACCELERATOR)
  }
  return new Set(accelerators.map(canonicalAccelerator))
}

/** Клик с ⌘ на macOS и с Ctrl на Linux: открывает чат рядом с текущим. */
export function isCommandClick(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return IS_MAC ? event.metaKey : event.ctrlKey
}
