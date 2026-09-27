import type { AtoxApi } from '../../shared/api'

declare global {
  /** Название и версия приложения из package.json — подставляются при сборке. */
  const __APP_NAME__: string
  const __APP_VERSION__: string

  interface Window {
    atox: AtoxApi
  }
}
