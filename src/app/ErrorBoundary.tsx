import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Alert, Button } from '../ui';

const CLAVE = 'house-recarga';
const ERROR_DE_ARCHIVO = /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk|reading 'default'/i;

/** Intentos de recarga permitidos dentro de la ventana, y la espera antes de cada uno. */
const INTENTOS = 3;
const VENTANA_MS = 120_000;
const ESPERA_MS = 3_000;

/**
 * Recarga la página tras un archivo que ya no existe. Durante un redespliegue el proxy reparte entre el contenedor viejo y el nuevo
 * un rato, así que una sola recarga inmediata a veces vuelve a fallar: se reintenta hasta 3 veces en 2 minutos, esperando 3 s antes
 * de cada una. Pasado eso, se rinde y deja el aviso (sin bucles).
 */
export function recargarUnaVez(): boolean {
  try {
    const ahora = Date.now();
    let guardado: unknown = [];
    try { guardado = JSON.parse(sessionStorage.getItem(CLAVE) ?? '[]'); } catch { /* valor viejo (un número suelto): se descarta */ }
    const previas = (Array.isArray(guardado) ? guardado : []).filter((t): t is number => typeof t === 'number' && ahora - t < VENTANA_MS);
    if (previas.length >= INTENTOS) return false;
    sessionStorage.setItem(CLAVE, JSON.stringify([...previas, ahora]));
  } catch { /* sin almacenamiento (o un valor viejo que no es JSON): se recarga igual */ }
  setTimeout(() => location.reload(), ESPERA_MS);
  return true;
}

interface Estado { error: Error | null }

/** Evita la pantalla en blanco: un archivo que ya no existe (nueva versión) recarga solo; el resto muestra un aviso. */
export class ErrorBoundary extends Component<{ children: ReactNode }, Estado> {
  state: Estado = { error: null };

  static getDerivedStateFromError(error: Error): Estado { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (ERROR_DE_ARCHIVO.test(error.message) && recargarUnaVez()) return;
    console.error('[ui] error de render', error.message, info.componentStack?.split('\n')[1]?.trim());
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-md space-y-4 px-6 py-16 text-center">
        <h1 className="text-xl font-semibold">Algo salió mal</h1>
        <Alert tone="warn">Puede que haya una versión nueva de Torre. Recarga la página para continuar.</Alert>
        <Button onClick={() => location.reload()}>Recargar la página</Button>
      </div>
    );
  }
}
