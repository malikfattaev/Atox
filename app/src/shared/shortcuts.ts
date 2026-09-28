/** Горячая клавиша: accelerator в формате Electron — для меню, `keys` — только для показа. */
export interface Shortcut {
  label: string
  accelerator?: string
  /** Сочетание, которое обрабатывает само окно, а не меню (например, ⌘1…⌘9). */
  keys?: string
}

/** Горячие клавиши приложения: по ним строится меню, и они же перечислены в настройках. */
export const SHORTCUTS = {
  newChat: { label: 'New chat', accelerator: 'CmdOrCtrl+N' },
  closeChat: { label: 'Close chat', accelerator: 'CmdOrCtrl+W' },
  previousChat: { label: 'Previous chat', accelerator: 'CmdOrCtrl+Shift+[' },
  nextChat: { label: 'Next chat', accelerator: 'CmdOrCtrl+Shift+]' },
  chatByNumber: { label: 'Go to chat by number', keys: '⌘1 – ⌘9' },
  openProject: { label: 'Open project', accelerator: 'CmdOrCtrl+O' },
  find: { label: 'Find in terminal', accelerator: 'CmdOrCtrl+F' },
  newLine: { label: 'New line without sending', keys: '⇧↩' },
  zoomIn: { label: 'Increase font size', accelerator: 'CmdOrCtrl+Plus' },
  zoomOut: { label: 'Decrease font size', accelerator: 'CmdOrCtrl+-' },
  actualSize: { label: 'Default font size', accelerator: 'CmdOrCtrl+0' },
  toggleSidebar: { label: 'Show or hide sidebar', accelerator: 'CmdOrCtrl+B' },
  openSettings: { label: 'Settings', accelerator: 'CmdOrCtrl+,' }
} as const satisfies Record<string, Shortcut>

/** Разделы списка горячих клавиш в настройках. */
export const SHORTCUT_GROUPS: ReadonlyArray<{ title: string; shortcuts: readonly Shortcut[] }> = [
  {
    title: 'Chats',
    shortcuts: [
      SHORTCUTS.newChat,
      SHORTCUTS.closeChat,
      SHORTCUTS.previousChat,
      SHORTCUTS.nextChat,
      SHORTCUTS.chatByNumber,
      SHORTCUTS.openProject
    ]
  },
  {
    title: 'Terminal',
    shortcuts: [
      SHORTCUTS.find,
      SHORTCUTS.newLine,
      SHORTCUTS.zoomIn,
      SHORTCUTS.zoomOut,
      SHORTCUTS.actualSize
    ]
  },
  {
    title: 'Window',
    shortcuts: [SHORTCUTS.toggleSidebar, SHORTCUTS.openSettings]
  }
]

/** Символы клавиш-модификаторов macOS в привычном порядке: ⌃⌥⇧⌘. */
const MODIFIER_SYMBOLS: ReadonlyArray<readonly [name: string, symbol: string]> = [
  ['Ctrl', '⌃'],
  ['Alt', '⌥'],
  ['Shift', '⇧'],
  ['CmdOrCtrl', '⌘']
]

const KEY_SYMBOLS: Readonly<Record<string, string>> = { Plus: '+', '-': '−', Enter: '↩' }

/** Сочетание так, как его показывает macOS: `CmdOrCtrl+Shift+[` → `⇧⌘[`. */
export function formatShortcut({ accelerator, keys }: Shortcut): string {
  if (keys) {
    return keys
  }
  const parts = (accelerator ?? '').split('+').filter(Boolean)
  // «Plus» — отдельная клавиша, а не разделитель: CmdOrCtrl+Plus.
  const key = parts.pop() ?? ''
  const modifiers = MODIFIER_SYMBOLS.filter(([name]) => parts.includes(name)).map(
    ([, symbol]) => symbol
  )
  return [...modifiers, KEY_SYMBOLS[key] ?? key.toUpperCase()].join('')
}
