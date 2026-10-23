import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary, recargarUnaVez } from './app/ErrorBoundary'

// Vite avisa cuando falla la precarga de un archivo (nueva versión publicada con la pestaña abierta).
// No se llama a preventDefault(): con eso la importación devolvería `undefined` y React.lazy fallaría con un
// error que no se reconoce. Así el error llega al ErrorBoundary, que también recarga (una sola vez).
window.addEventListener('vite:preloadError', () => {
  recargarUnaVez();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
