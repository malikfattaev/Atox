import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { IS_MAC } from '../../shared/platform'
import { App } from './App'
import { trackWindowFocus } from './lib/windowFocus'
import './styles/global.css'

const container = document.getElementById('root')

if (!container) {
  throw new Error('Root element #root not found')
}

// Оформление окна различается: на macOS — прозрачный сайдбар и кнопки окна в нём.
document.documentElement.dataset['platform'] = IS_MAC ? 'mac' : 'linux'
// Акцентный цвет задаётся до первой отрисовки, чтобы не мигать синим.
const applyAccent = ({ accent }: { accent: string }) => {
  document.documentElement.dataset['accent'] = accent
}
applyAccent(window.atox.settings.get())
window.atox.settings.subscribe(applyAccent)
trackWindowFocus()

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
