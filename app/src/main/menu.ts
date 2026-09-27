import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { IpcChannel } from '../shared/api'
import type { AppCommand } from '../shared/commands'
import { TERMINAL_FONT_SIZE } from '../shared/settings'
import type { SettingsStore } from './settings'

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
export function installAppMenu(settings: SettingsStore): void {
  const changeFontSize = (resolve: (current: number) => number) => () =>
    settings.update({ terminalFontSize: resolve(settings.get().terminalFontSize) })

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
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        commandItem('Find…', 'CmdOrCtrl+F', { type: 'find' })
      ]
    },
    {
      label: 'View',
      submenu: [
        commandItem('Toggle Sidebar', 'CmdOrCtrl+B', { type: 'toggle-sidebar' }),
        { type: 'separator' },
        commandItem('Previous Chat', 'CmdOrCtrl+Shift+[', { type: 'previous-chat' }),
        commandItem('Next Chat', 'CmdOrCtrl+Shift+]', { type: 'next-chat' }),
        { type: 'separator' },
        {
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click: changeFontSize(() => TERMINAL_FONT_SIZE.default)
        },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: changeFontSize((size) => size + 1)
        },
        // На раскладках без отдельной «+» увеличение срабатывает и по ⌘=, как в браузерах.
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: changeFontSize((size) => size + 1),
          visible: false,
          acceleratorWorksWhenHidden: true
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: changeFontSize((size) => size - 1)
        },
        ...developmentItems
      ]
    },
    { role: 'windowMenu' }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
