import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Apply the saved theme before first paint to avoid a flash of the wrong mode.
try {
  const saved = localStorage.getItem('tradio.theme')
  document.documentElement.setAttribute('data-theme', saved === 'light' ? 'light' : 'dark')
} catch {}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
