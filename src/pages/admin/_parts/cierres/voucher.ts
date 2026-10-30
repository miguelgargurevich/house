import { csrfHeader } from '../../../../api';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

/**
 * Abre un voucher del cierre en otra pestaña: el de un pago de un block (`/api/cierres/lineas/:id/voucher`) o el de un movimiento de la Junta central
 * (`/api/cierres/central/movimientos/:id/voucher`). Se baja con la sesión (un enlace directo no puede mandar la cabecera CSRF ni mostrar un error) y se abre desde una
 * URL local. La pestaña se abre antes de bajar el archivo para que el navegador no la bloquee.
 */
export async function abrirVoucher(id: number, origen: 'linea' | 'central' = 'linea'): Promise<void> {
  const ventana = window.open('', '_blank');
  try {
    const ruta = origen === 'central' ? `/api/cierres/central/movimientos/${id}/voucher` : `/api/cierres/lineas/${id}/voucher`;
    const res = await fetch(`${BASE}${ruta}`, { headers: { ...csrfHeader() }, credentials: 'same-origin' });
    if (!res.ok) throw new Error('No se pudo abrir el voucher');
    const url = URL.createObjectURL(await res.blob());
    if (ventana) ventana.location.href = url; else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    ventana?.close();
    throw e;
  }
}
