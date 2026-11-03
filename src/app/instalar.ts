// Instalar Torre en el celular (ícono en la pantalla de inicio, se abre como app sin la barra del navegador).
// Android/Chrome avisa con `beforeinstallprompt`, que puede llegar antes de iniciar sesión: se guarda aquí, al cargar la página.
// iPhone no tiene ese aviso: se explica el paso a mano (Compartir → «Agregar a inicio»).

export interface AvisoInstalar extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type ModoInstalar = 'boton' | 'iphone' | null;

const CLAVE = 'torre-instalar-descartado';

let aviso: AvisoInstalar | null = null;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach(f => f());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); aviso = e as AvisoInstalar; avisar(); });
  window.addEventListener('appinstalled', () => { aviso = null; descartar(); });
}

export const avisoGuardado = () => aviso;
export const alCambiar = (f: () => void) => { oyentes.add(f); return () => { oyentes.delete(f); }; };

/** Qué mostrar: el botón (Android con aviso), la explicación (Safari de iPhone) o nada (ya instalada, descartado o un navegador que no instala). */
export function modoInstalar(d: { instalada: boolean; descartado: boolean; hayAviso: boolean; userAgent: string }): ModoInstalar {
  if (d.instalada || d.descartado) return null;
  if (d.hayAviso) return 'boton';
  const iphone = /iPhone|iPad|iPod/.test(d.userAgent);
  const safari = /Safari/.test(d.userAgent) && !/CriOS|FxiOS|EdgiOS|GSA/.test(d.userAgent);
  return iphone && safari ? 'iphone' : null;
}

export const estaInstalada = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export const fueDescartado = () => { try { return localStorage.getItem(CLAVE) === '1'; } catch { return false; } };
export function descartar() { try { localStorage.setItem(CLAVE, '1'); } catch { /* sin almacenamiento */ } avisar(); }

export async function instalar(): Promise<void> {
  if (!aviso) return;
  const a = aviso;
  aviso = null;
  await a.prompt();
  await a.userChoice;
  avisar();
}
