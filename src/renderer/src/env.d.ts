import type { AtoxApi } from '../../shared/api'

declare global {
  interface Window {
    atox: AtoxApi
  }
}
