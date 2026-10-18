import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { app } from 'electron'

/** Значок, который кладётся в тему значков пользователя; AppImage содержит его в этом размере. */
const ICON_SIZE = '512x512'

/**
 * Имя ярлыка совпадает с app_id окна на Wayland и с WM_CLASS на X11 — по нему оконный
 * менеджер и панель находят значок окна.
 */
const DESKTOP_ID = 'atox'

/**
 * AppImage не устанавливается: это один файл, который запускают откуда угодно. Чтобы Atox был
 * в меню приложений (в Omarchy — в лаунчере), при запуске из AppImage он сам кладёт ярлык
 * и значок в каталоги пользователя по стандарту XDG. Путь в ярлыке обновляется при каждом
 * запуске: файл могли перенести.
 */
export async function installDesktopEntry(appImagePath: string): Promise<void> {
  const dataHome = process.env['XDG_DATA_HOME'] || join(homedir(), '.local', 'share')
  const iconDirectory = join(dataHome, 'icons', 'hicolor', ICON_SIZE, 'apps')
  // Бинарник приложения лежит в корне смонтированного образа, значки — в его usr/share.
  const appDir = dirname(process.execPath)
  const iconSource = join(appDir, 'usr', 'share', 'icons', 'hicolor', ICON_SIZE, 'apps')
  await mkdir(iconDirectory, { recursive: true })
  await copyFile(join(iconSource, `${DESKTOP_ID}.png`), join(iconDirectory, `${DESKTOP_ID}.png`))

  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${app.getName()}`,
    'Comment=Projects, chats and real terminals for CLI coding agents',
    `Exec=${quoteExecArgument(appImagePath)} %U`,
    `Icon=${DESKTOP_ID}`,
    'Terminal=false',
    'Categories=Development;',
    `StartupWMClass=${DESKTOP_ID}`,
    ''
  ].join('\n')
  const applications = join(dataHome, 'applications')
  const file = join(applications, `${DESKTOP_ID}.desktop`)
  if ((await readFile(file, 'utf8').catch(() => null)) !== entry) {
    await mkdir(applications, { recursive: true })
    await writeFile(file, entry)
  }
}

/**
 * Аргумент строки Exec по спецификации Desktop Entry: в кавычках, спецсимволы через «\»,
 * а «%» удвоен — иначе он читается как подстановка вроде %U.
 */
function quoteExecArgument(value: string): string {
  return `"${value.replace(/["`$\\]/g, '\\$&').replaceAll('%', '%%')}"`
}
