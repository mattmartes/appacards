import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyFont, applyTextWeight, applyTheme, readFont, readTheme } from './lib/theme'

applyTheme(readTheme())
applyFont(readFont())
applyTextWeight()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
