import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { IpcChannel } from '../shared/api'
import type { AppCommand } from '../shared/commands'
import { TERMINAL_FONT_SIZE } from '../shared/settings'
import { SHORTCUTS } from '../shared/shortcuts'
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
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        commandItem('Settings…', SHORTCUTS.openSettings.accelerator, { type: 'open-settings' }),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        commandItem('New Chat', SHORTCUTS.newChat.accelerator, { type: 'new-chat' }),
        commandItem('Open Project…', SHORTCUTS.openProject.accelerator, { type: 'open-project' }),
        { type: 'separator' },
        commandItem('Close Chat', SHORTCUTS.closeChat.accelerator, { type: 'close-chat' })
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
        commandItem('Find…', SHORTCUTS.find.accelerator, { type: 'find' })
      ]
    },
    {
      label: 'View',
      submenu: [
        commandItem('Toggle Sidebar', SHORTCUTS.toggleSidebar.accelerator, {
          type: 'toggle-sidebar'
        }),
        { type: 'separator' },
        commandItem('Previous Chat', SHORTCUTS.previousChat.accelerator, {
          type: 'previous-chat'
        }),
        commandItem('Next Chat', SHORTCUTS.nextChat.accelerator, { type: 'next-chat' }),
        { type: 'separator' },
        {
          label: 'Actual Size',
          accelerator: SHORTCUTS.actualSize.accelerator,
          click: changeFontSize(() => TERMINAL_FONT_SIZE.default)
        },
        {
          label: 'Zoom In',
          accelerator: SHORTCUTS.zoomIn.accelerator,
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
          accelerator: SHORTCUTS.zoomOut.accelerator,
          click: changeFontSize((size) => size - 1)
        },
        ...developmentItems
      ]
    },
    { role: 'windowMenu' }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
