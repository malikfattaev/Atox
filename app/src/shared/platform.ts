/**
 * Запущено ли приложение на macOS. От этого зависят горячие клавиши, их подписи и оформление
 * окна. Main и preload знают платформу из `process`, окно с изоляцией контекста — из userAgent.
 */
const nodePlatform = (globalThis as { process?: { platform?: string } }).process?.platform

export const IS_MAC = nodePlatform
  ? nodePlatform === 'darwin'
  : globalThis.navigator.userAgent.includes('Macintosh')
