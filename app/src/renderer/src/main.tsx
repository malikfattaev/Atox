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
trackWindowFocus()

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
