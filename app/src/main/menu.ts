import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { IpcChannel } from '../shared/api'
import type { AppCommand } from '../shared/commands'
import { IS_MAC } from '../shared/platform'
import {
  findShortcutConflict,
  LINUX_QUIT_ACCELERATOR,
  resolveAccelerator,
  type ShortcutId,
  type ShortcutOverrides
} from '../shared/shortcuts'
import type { SettingsStore } from './settings'

/** Шаг и пределы масштаба окна в уровнях Electron: каждый уровень — 20% размера. */
const ZOOM_LEVEL = { step: 0.5, min: -3, max: 5 } as const

/** Дополнительное сочетание увеличения масштаба для раскладок, где «+» набирается с Shift. */
const ZOOM_IN_ALIAS = IS_MAC ? 'CmdOrCtrl+=' : 'Ctrl+='

function sendCommand(command: AppCommand): void {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  window?.webContents.send(IpcChannel.AppCommand, command)
}

/**
 * Меню приложения: через него работают горячие клавиши, в том числе копирование и вставка.
 * На Linux строка меню скрыта, а сочетания те же, что в терминалах Linux. Свои сочетания
 * из настроек применяются сразу, без перезапуска.
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
    // Масштаб всего окна, как в браузере: крупнее становятся и лента, и сайдбар.
    const zoom = (resolve: (level: number) => number) => () => {
      const contents = BrowserWindow.getFocusedWindow()?.webContents
      if (contents) {
        const level = resolve(contents.getZoomLevel())
        contents.setZoomLevel(Math.min(ZOOM_LEVEL.max, Math.max(ZOOM_LEVEL.min, level)))
      }
    }
    // На раскладках без отдельной «+» увеличение срабатывает и по ⌘= (Ctrl+=), как в браузерах, —
    // если это сочетание не отдано другому действию.
    const zoomInAlias =
      !this.recordingShortcut && !findShortcutConflict('zoomIn', ZOOM_IN_ALIAS, shortcuts)
        ? ZOOM_IN_ALIAS
        : undefined

    const developmentItems: MenuItemConstructorOptions[] = app.isPackaged
      ? []
      : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }]

    const viewMenu: MenuItemConstructorOptions = {
      label: 'View',
      submenu: [
        commandItem('Toggle Sidebar', 'toggleSidebar', { type: 'toggle-sidebar' }),
        commandItem('Toggle Terminal', 'toggleTerminal', { type: 'toggle-terminal' }),
        commandItem('Repository', 'toggleRepository', { type: 'toggle-repository' }),
        { type: 'separator' },
        commandItem('Previous Chat', 'previousChat', { type: 'previous-chat' }),
        commandItem('Next Chat', 'nextChat', { type: 'next-chat' }),
        { type: 'separator' },
        {
          label: 'Actual Size',
          accelerator: accelerator('actualSize'),
          click: zoom(() => 0)
        },
        {
          label: 'Zoom In',
          accelerator: accelerator('zoomIn'),
          click: zoom((level) => level + ZOOM_LEVEL.step)
        },
        {
          label: 'Zoom In',
          accelerator: zoomInAlias,
          click: zoom((level) => level + ZOOM_LEVEL.step),
          visible: false,
          acceleratorWorksWhenHidden: true
        },
        {
          label: 'Zoom Out',
          accelerator: accelerator('zoomOut'),
          click: zoom((level) => level - ZOOM_LEVEL.step)
        },
        ...developmentItems
      ]
    }
    const chatItems: MenuItemConstructorOptions[] = [
      commandItem('New Chat', 'newChat', { type: 'new-chat' }),
      commandItem('Open Project…', 'openProject', { type: 'open-project' }),
      { type: 'separator' },
      commandItem('Close Chat', 'closeChat', { type: 'close-chat' })
    ]

    if (!IS_MAC) {
      // Стандартные пункты Linux заняли бы Ctrl+C, Ctrl+V и Ctrl+W, нужные терминалу, а в полях
      // ввода копирование и отмена и так работают без меню.
      return [
        {
          label: 'File',
          submenu: [
            ...chatItems,
            { type: 'separator' },
            commandItem('Settings…', 'openSettings', { type: 'open-settings' }),
            { type: 'separator' },
            {
              role: 'quit',
              accelerator: this.recordingShortcut ? undefined : LINUX_QUIT_ACCELERATOR
            }
          ]
        },
        // Копирование и вставку в терминале (Ctrl+Shift+C, Ctrl+Shift+V) обрабатывает окно, а в
        // полях ввода они работают сами.
        { label: 'Edit', submenu: [commandItem('Find…', 'find', { type: 'find' })] },
        viewMenu
      ]
    }

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
      { label: 'File', submenu: chatItems },
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
      viewMenu,
      { role: 'windowMenu' }
    ]
  }
}
