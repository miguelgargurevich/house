import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Alert, Button } from '../ui';

const CLAVE = 'house-recarga';
const ERROR_DE_ARCHIVO = /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i;

/** Recarga la página una sola vez (si hubo otra hace menos de 15 s, no insiste para no entrar en bucle). */
export function recargarUnaVez(): boolean {
  try {
    const ultima = Number(sessionStorage.getItem(CLAVE) ?? 0);
    if (Date.now() - ultima < 15_000) return false;
    sessionStorage.setItem(CLAVE, String(Date.now()));
  } catch { /* sin almacenamiento: se recarga igual una vez */ }
  location.reload();
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
        <Alert tone="warn">Puede que haya una versión nueva de House. Recarga la página para continuar.</Alert>
        <Button onClick={() => location.reload()}>Recargar la página</Button>
      </div>
    );
  }
}
