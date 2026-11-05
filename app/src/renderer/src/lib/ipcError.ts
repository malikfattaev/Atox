/** Ошибка из main-процесса приходит с префиксом Electron о вызове IPC — он пользователю не нужен. */
export function ipcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
