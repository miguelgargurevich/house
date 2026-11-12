import { csrfHeader } from '../../../../api';
import { LADO_VOUCHER, comprimirImagen } from '../../../shared/comprimirImagen';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export const MAX_QR = 500 * 1024;
export const TIPOS_QR = ['image/png', 'image/jpeg', 'image/webp'];
export const ACCEPT_QR = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';

/**
 * Achica el QR que pasa de 500 KB sin bajar de 1000 px (si baja más, deja de leerse). Un PNG sigue PNG: el QR se ve mejor sin pérdida.
 */
export function prepararQr(f: File): Promise<File> {
  return comprimirImagen(f, { tope: MAX_QR, ladoMax: LADO_VOUCHER, ladoMin: 1000, formato: f.type === 'image/png' ? 'image/png' : 'image/jpeg' });
}

/** Mensaje de error si el archivo no sirve como QR; `null` si está bien (el servidor lo vuelve a validar). */
export function errorDeQr(f: File): string | null {
  if (!TIPOS_QR.includes(f.type)) return 'Sube una imagen PNG, JPG o WebP.';
  if (f.size === 0) return 'El archivo está vacío.';
  if (f.size > MAX_QR) return `La imagen pesa ${Math.ceil(f.size / 1024)} KB y no se pudo achicar; el máximo es 500 KB.`;
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
