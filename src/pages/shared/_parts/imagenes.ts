import { csrfHeader } from '../../../api';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export const MAX_IMAGEN = 2 * 1024 * 1024;
export const TIPOS_IMAGEN = ['image/png', 'image/jpeg', 'image/webp'];
export const ACCEPT_IMAGEN = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';

/** Mensaje de error si el archivo no sirve como imagen del recibo; `null` si está bien (el servidor lo vuelve a validar). */
export function errorDeImagen(f: File): string | null {
  if (!TIPOS_IMAGEN.includes(f.type)) return 'Sube una imagen JPG, PNG o WebP.';
  if (f.size === 0) return 'El archivo está vacío.';
  if (f.size > MAX_IMAGEN) return `La imagen pesa ${(f.size / 1024 / 1024).toFixed(1)} MB; el máximo es 2 MB.`;
  return null;
}

/** Sube la imagen como cuerpo crudo (el resto de la app habla JSON, por eso no pasa por `api()`). */
export async function subirImagen(ruta: string, archivo: File): Promise<void> {
  const res = await fetch(`${BASE}${ruta}`, {
    method: 'PUT',
    headers: { ...csrfHeader(), Accept: 'application/json', 'Content-Type': archivo.type, 'X-Nombre-Archivo': encodeURIComponent(archivo.name) },
    body: archivo,
    credentials: 'same-origin',
  });
  if (res.ok) return;
  const data = (await res.json().catch(() => ({}))) as { error?: unknown };
  throw new Error(res.status === 413 ? 'La imagen supera los 2 MB.' : typeof data.error === 'string' ? data.error : 'No se pudo subir la imagen');
}
