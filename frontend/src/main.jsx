import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/fira-code/400.css'
import '@fontsource/fira-code/500.css'
import './index.css'
import App from './App.jsx'
import ArcadeSandbox from './arcade/ArcadeSandbox.jsx'

const isArcade = window.location.pathname === '/arcade'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isArcade ? <ArcadeSandbox /> : <App />}
  </StrictMode>,
)
