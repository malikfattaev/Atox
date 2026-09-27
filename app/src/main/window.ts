import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'

const WINDOW_SIZE = {
  width: 1200,
  height: 780,
  minWidth: 720,
  minHeight: 480
} as const

/** Адрес dev-сервера renderer'а; electron-vite задаёт его только в режиме разработки. */
const devServerUrl = process.env['ELECTRON_RENDERER_URL']

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...WINDOW_SIZE,
    show: false,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())

  // Ссылки из приложения открываются в системном браузере, а не в новых окнах Electron.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}
