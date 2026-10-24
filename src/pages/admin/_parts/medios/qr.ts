import { csrfHeader } from '../../../../api';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export const MAX_QR = 500 * 1024;
export const TIPOS_QR = ['image/png', 'image/jpeg', 'image/webp'];
export const ACCEPT_QR = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';

/** Mensaje de error si el archivo no sirve como QR; `null` si está bien (el servidor lo vuelve a validar). */
export function errorDeQr(f: File): string | null {
  if (!TIPOS_QR.includes(f.type)) return 'Sube una imagen PNG, JPG o WebP.';
  if (f.size === 0) return 'El archivo está vacío.';
  if (f.size > MAX_QR) return `La imagen pesa ${Math.ceil(f.size / 1024)} KB; el máximo es 500 KB.`;
  return null;
}

/** Sube la imagen como cuerpo crudo (el resto de la app habla JSON, por eso no pasa por `api()`). */
export async function subirQr(id: number, archivo: File): Promise<void> {
  const res = await fetch(`${BASE}/api/medios-pago/${id}/qr`, {
    method: 'PUT',
    headers: { ...csrfHeader(), Accept: 'application/json', 'Content-Type': archivo.type, 'X-Nombre-Archivo': encodeURIComponent(archivo.name) },
    body: archivo,
    credentials: 'same-origin',
  });
  if (res.ok) return;
  const data = (await res.json().catch(() => ({}))) as { error?: unknown };
  throw new Error(res.status === 413 ? 'La imagen supera los 500 KB.' : typeof data.error === 'string' ? data.error : 'No se pudo subir el QR');
}
