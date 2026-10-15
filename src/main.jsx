import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { reloadForUpdate } from './lib/staleBuild.js'

// A file of the build this page came from is gone: a deploy happened since
// it was opened. Reload onto the new build (src/lib/staleBuild.js). The
// error still goes on to the boundary, which says the portal is updating.
window.addEventListener('vite:preloadError', () => { reloadForUpdate(); });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
