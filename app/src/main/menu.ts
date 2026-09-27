import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { IpcChannel } from '../shared/api'
import type { AppCommand } from '../shared/commands'

function sendCommand(command: AppCommand): void {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  window?.webContents.send(IpcChannel.AppCommand, command)
}

function commandItem(
  label: string,
  accelerator: string,
  command: AppCommand
): MenuItemConstructorOptions {
  return { label, accelerator, click: () => sendCommand(command) }
}

/** Меню приложения macOS: через него работают горячие клавиши, в том числе копирование и вставка. */
export function installAppMenu(): void {
  const developmentItems: MenuItemConstructorOptions[] = app.isPackaged
    ? []
    : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }]

  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        commandItem('New Chat', 'CmdOrCtrl+N', { type: 'new-chat' }),
        commandItem('Open Project…', 'CmdOrCtrl+O', { type: 'open-project' }),
        { type: 'separator' },
        commandItem('Close Chat', 'CmdOrCtrl+W', { type: 'close-chat' })
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        commandItem('Toggle Sidebar', 'CmdOrCtrl+B', { type: 'toggle-sidebar' }),
        { type: 'separator' },
        commandItem('Previous Chat', 'CmdOrCtrl+Shift+[', { type: 'previous-chat' }),
        commandItem('Next Chat', 'CmdOrCtrl+Shift+]', { type: 'next-chat' }),
        ...developmentItems
      ]
    },
    { role: 'windowMenu' }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
