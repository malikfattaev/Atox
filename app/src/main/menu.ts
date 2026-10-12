import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { IpcChannel } from '../shared/api'
import type { AppCommand } from '../shared/commands'
import { TERMINAL_FONT_SIZE } from '../shared/settings'
import {
  findShortcutConflict,
  resolveAccelerator,
  type ShortcutId,
  type ShortcutOverrides
} from '../shared/shortcuts'
import type { SettingsStore } from './settings'

/** Дополнительное сочетание увеличения шрифта для раскладок, где «+» набирается с Shift. */
const ZOOM_IN_ALIAS = 'CmdOrCtrl+='

function sendCommand(command: AppCommand): void {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  window?.webContents.send(IpcChannel.AppCommand, command)
}

/**
 * Меню приложения macOS: через него работают горячие клавиши, в том числе копирование и вставка.
 * Свои сочетания из настроек применяются сразу, без перезапуска.
 */
export class AppMenu {
  /** Пока в настройках записывают сочетание, оно не должно срабатывать как команда. */
  private recordingShortcut = false
  private installedShortcuts = ''

  constructor(private readonly settings: SettingsStore) {
    settings.onChange(({ shortcuts }) => {
      if (JSON.stringify(shortcuts) !== this.installedShortcuts) {
        this.install()
      }
    })
  }

  setRecordingShortcut(recording: boolean): void {
    if (this.recordingShortcut !== recording) {
      this.recordingShortcut = recording
      this.install()
    }
  }

  install(): void {
    const { shortcuts } = this.settings.get()
    this.installedShortcuts = JSON.stringify(shortcuts)
    Menu.setApplicationMenu(Menu.buildFromTemplate(this.buildTemplate(shortcuts)))
  }

  private buildTemplate(shortcuts: ShortcutOverrides): MenuItemConstructorOptions[] {
    const settings = this.settings
    const accelerator = (id: ShortcutId) =>
      this.recordingShortcut ? undefined : resolveAccelerator(id, shortcuts)
    const commandItem = (
      label: string,
      id: ShortcutId,
      command: AppCommand
    ): MenuItemConstructorOptions => ({
      label,
      accelerator: accelerator(id),
      click: () => sendCommand(command)
    })
    const changeFontSize = (resolve: (current: number) => number) => () =>
      settings.update({ terminalFontSize: resolve(settings.get().terminalFontSize) })
    // На раскладках без отдельной «+» увеличение срабатывает и по ⌘=, как в браузерах, —
    // если это сочетание не отдано другому действию.
    const zoomInAlias =
      !this.recordingShortcut && !findShortcutConflict('zoomIn', ZOOM_IN_ALIAS, shortcuts)
        ? ZOOM_IN_ALIAS
        : undefined

    const developmentItems: MenuItemConstructorOptions[] = app.isPackaged
      ? []
      : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }]

    return [
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          commandItem('Settings…', 'openSettings', { type: 'open-settings' }),
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
          commandItem('New Chat', 'newChat', { type: 'new-chat' }),
          commandItem('Open Project…', 'openProject', { type: 'open-project' }),
          { type: 'separator' },
          commandItem('Close Chat', 'closeChat', { type: 'close-chat' })
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
          commandItem('Find…', 'find', { type: 'find' })
        ]
      },
      {
        label: 'View',
        submenu: [
          commandItem('Toggle Sidebar', 'toggleSidebar', { type: 'toggle-sidebar' }),
          { type: 'separator' },
          commandItem('Previous Chat', 'previousChat', { type: 'previous-chat' }),
          commandItem('Next Chat', 'nextChat', { type: 'next-chat' }),
          { type: 'separator' },
          {
            label: 'Actual Size',
            accelerator: accelerator('actualSize'),
            click: changeFontSize(() => TERMINAL_FONT_SIZE.default)
          },
          {
            label: 'Zoom In',
            accelerator: accelerator('zoomIn'),
            click: changeFontSize((size) => size + 1)
          },
          {
            label: 'Zoom In',
            accelerator: zoomInAlias,
            click: changeFontSize((size) => size + 1),
            visible: false,
            acceleratorWorksWhenHidden: true
          },
          {
            label: 'Zoom Out',
            accelerator: accelerator('zoomOut'),
            click: changeFontSize((size) => size - 1)
          },
          ...developmentItems
        ]
      },
      { role: 'windowMenu' }
    ]
  }
}
