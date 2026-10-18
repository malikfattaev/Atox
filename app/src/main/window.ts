import { join } from 'node:path'
import { BrowserWindow, nativeTheme, shell, type BrowserWindowConstructorOptions } from 'electron'
import { IS_MAC } from '../shared/platform'

const WINDOW_SIZE = {
  width: 1200,
  height: 780,
  minWidth: 720,
  minHeight: 480
} as const

const EXTERNAL_URL_PROTOCOLS = new Set(['http:', 'https:'])

/** Фон окна на Linux до первой отрисовки — цвет сайдбара (`--color-window` в стилях). */
const LINUX_BACKGROUND = { light: '#f2f2f4', dark: '#28282a' } as const

/**
 * На macOS кнопки окна встроены в сайдбар, а под ним виден системный vibrancy. На Linux окно
 * обычное: рамку рисует оконный менеджер (в Hyprland её нет вовсе), строка меню скрыта.
 */
function platformWindowOptions(): BrowserWindowConstructorOptions {
  if (IS_MAC) {
    return {
      titleBarStyle: 'hiddenInset',
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
      backgroundColor: '#00000000'
    }
  }
  return {
    backgroundColor: LINUX_BACKGROUND[nativeTheme.shouldUseDarkColors ? 'dark' : 'light']
  }
}

/** Адрес dev-сервера renderer'а; electron-vite задаёт его только в режиме разработки. */
const devServerUrl = process.env['ELECTRON_RENDERER_URL']

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...WINDOW_SIZE,
    show: false,
    ...platformWindowOptions(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  if (!IS_MAC) {
    // Меню остаётся ради горячих клавиш, но строку меню над терминалом не показываем.
    window.setMenuBarVisibility(false)
  }
  window.once('ready-to-show', () => window.show())

  // Ссылки из приложения (в том числе из терминала) открываются в системном браузере,
  // а не в новых окнах Electron. Другие схемы не открываем: их мог подставить вывод программы.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (EXTERNAL_URL_PROTOCOLS.has(new URL(url).protocol)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // Файл, брошенный мимо терминала, иначе открылся бы в окне вместо приложения.
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}
