import { dialog, type BrowserWindow } from 'electron'

interface ConfirmationOptions {
  message: string
  detail: string
  confirmLabel: string
}

/** Системный диалог подтверждения; на окне показывается как sheet. `true` — пользователь подтвердил. */
export async function confirm(
  window: BrowserWindow | null,
  { message, detail, confirmLabel }: ConfirmationOptions
): Promise<boolean> {
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    message,
    detail,
    buttons: [confirmLabel, 'Cancel'],
    defaultId: 0,
    cancelId: 1
  }
  const { response } = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  return response === 0
}

/** Системное сообщение с одной кнопкой «OK»; на окне показывается как sheet. */
export async function inform(
  window: BrowserWindow | null,
  { type, message, detail }: Pick<Electron.MessageBoxOptions, 'type' | 'message' | 'detail'>
): Promise<void> {
  const options: Electron.MessageBoxOptions = { type, message, detail, buttons: ['OK'] }
  await (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options))
}

/**
 * Предупреждение о работающих агентах, например:
 * «Claude is still working in this chat. Deleting the chat will stop it.»
 */
export function describeWorkingAgents(
  count: number,
  location: string,
  consequence: string,
  agentName?: string
): string {
  const subject =
    count === 1 ? `${agentName ?? 'An agent'} is` : `${count} agents are`
  const pronoun = count === 1 ? 'it' : 'them'
  return `${subject} still working ${location}. ${consequence} will stop ${pronoun}.`
}
