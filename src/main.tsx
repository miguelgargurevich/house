import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary, recargarUnaVez } from './app/ErrorBoundary'

// Vite avisa cuando falla la precarga de un archivo (nueva versión publicada con la pestaña abierta).
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  recargarUnaVez();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
