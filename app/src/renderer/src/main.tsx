import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { trackWindowFocus } from './lib/windowFocus'
import './styles/global.css'

const container = document.getElementById('root')

if (!container) {
  throw new Error('Root element #root not found')
}

trackWindowFocus()

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
