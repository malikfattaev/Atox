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

/**
 * Предупреждение о запущенных программах, например:
 * «“claude” is still running in this chat. Deleting the chat will stop it.»
 */
export function describeRunningPrograms(
  programs: string[],
  location: string,
  consequence: string
): string {
  const verb = new Set(programs).size > 1 ? 'are' : 'is'
  const pronoun = programs.length > 1 ? 'them' : 'it'
  return `${formatProgramList(programs)} ${verb} still running ${location}. ${consequence} will stop ${pronoun}.`
}

/** «claude», «claude and npm», «claude, npm and node» — без повторов. */
function formatProgramList(programs: string[]): string {
  const unique = [...new Set(programs)].map((program) => `“${program}”`)
  return unique.length <= 1
    ? (unique[0] ?? '')
    : `${unique.slice(0, -1).join(', ')} and ${unique.at(-1)}`
}
