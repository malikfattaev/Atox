/** Команды из меню приложения и горячих клавиш, которые выполняет интерфейс. */
export type AppCommand =
  | { type: 'new-chat' }
  | { type: 'open-project' }
  | { type: 'close-chat' }
  | { type: 'toggle-sidebar' }
  | { type: 'toggle-terminal' }
  | { type: 'toggle-changes' }
  | { type: 'previous-chat' }
  | { type: 'next-chat' }
  | { type: 'find' }
  | { type: 'open-settings' }
  | { type: 'toggle-repository' }
  | { type: 'toggle-agents' }
