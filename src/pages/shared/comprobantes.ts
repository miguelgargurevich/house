import { useEffect, useState } from 'react';
import { tokenStore } from '../../api';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export const MAX_COMPROBANTE = 2 * 1024 * 1024;
export const TIPOS_COMPROBANTE = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const ACCEPT_COMPROBANTE = 'image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf';

export interface ComprobanteMeta { id: number; nombre: string; tipo_mime: string; tamano: number; created_at: string }

export function tamanoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Mensaje de error si el archivo no sirve como comprobante; `null` si está bien (el servidor vuelve a validarlo). */
export function errorDeArchivo(f: File): string | null {
  if (!TIPOS_COMPROBANTE.includes(f.type)) return 'Sube una imagen JPG, PNG o WebP, o un PDF.';
  if (f.size === 0) return 'El archivo está vacío.';
  if (f.size > MAX_COMPROBANTE) return `El archivo pesa ${tamanoLegible(f.size)}; el máximo es 2 MB.`;
  return null;
}

const autorizacion = (): Record<string, string> => {
  const t = tokenStore.get();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

async function mensajeDe(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (res.status === 413) return 'El archivo supera los 2 MB.';
  return typeof data.error === 'string' ? data.error : 'No se pudo completar la operación';
}

/** Sube el archivo como cuerpo crudo (el resto de la app habla JSON, por eso no pasa por `api()`). */
export async function subirComprobante(pagoId: number, archivo: File): Promise<ComprobanteMeta> {
  const res = await fetch(`${BASE}/api/pagos/${pagoId}/comprobante`, {
    method: 'POST',
    headers: { ...autorizacion(), Accept: 'application/json', 'Content-Type': archivo.type, 'X-Nombre-Archivo': encodeURIComponent(archivo.name) },
    body: archivo,
  });
  if (!res.ok) throw new Error(await mensajeDe(res));
  return (await res.json()) as ComprobanteMeta;
}

/** Descarga el archivo con la sesión y lo expone como URL local (un <img src> no puede mandar el token). */
export async function descargarComprobante(pagoId: number, señal?: AbortSignal): Promise<{ url: string; tipo: string }> {
  const res = await fetch(`${BASE}/api/pagos/${pagoId}/comprobante`, { headers: autorizacion(), signal: señal });
  if (!res.ok) throw new Error(res.status === 404 ? 'Este pago no tiene comprobante adjunto.' : await mensajeDe(res));
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), tipo: blob.type };
}

/** Carga el comprobante de un pago y libera la URL al cambiar o desmontar. */
export function useComprobante(pagoId: number | null) {
  const [estado, setEstado] = useState<{ url: string; tipo: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(pagoId !== null);

  useEffect(() => {
    if (pagoId === null) return;
    const ctl = new AbortController();
    let url: string | null = null;
    setLoading(true); setError(null); setEstado(null);
    descargarComprobante(pagoId, ctl.signal)
      .then(r => { url = r.url; setEstado(r); })
      .catch((e: unknown) => { if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : 'No se pudo cargar el comprobante'); })
      .finally(() => { if (!ctl.signal.aborted) setLoading(false); });
    return () => { ctl.abort(); if (url) URL.revokeObjectURL(url); };
  }, [pagoId]);

  return { data: estado, error, loading };
}
