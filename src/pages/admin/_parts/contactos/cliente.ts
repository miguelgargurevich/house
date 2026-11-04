import { avisarSesionPerdida, csrfHeader } from '../../../../api';
import type { Guardado, VistaPrevia } from './vista';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export type RespuestaSubida = { tipo: 'vista'; vista: VistaPrevia } | { tipo: 'guardado'; guardado: Guardado };

/** Dirección de la plantilla (la descarga el navegador con la sesión: no pasa por `api()`). */
export const urlPlantilla = (complejoId: number) => `${BASE}/api/contactos/plantilla.xlsx?complejo_id=${complejoId}`;

/**
 * Sube el Excel. Sin `confirmar` el servidor responde 409 `REVISAR_CONTACTOS` con el resumen y los problemas por fila (y no escribe nada): `api()` sólo
 * conserva el texto de un 409, por eso esta llamada lee el cuerpo completo. Con `confirmar` guarda y responde 201.
 */
export async function subirContactos(p: { complejoId: number; archivo: File; confirmar: boolean; actualizar: boolean; invitar: boolean }): Promise<RespuestaSubida> {
  const fd = new FormData();
  fd.append('complejo_id', String(p.complejoId));
  fd.append('archivo', p.archivo);
  if (p.confirmar) fd.append('confirmar', 'true');
  if (p.actualizar) fd.append('actualizar', 'true');
  if (p.invitar) fd.append('invitar', 'true');
  const res = await fetch(`${BASE}/api/contactos/excel`, { method: 'POST', headers: { Accept: 'application/json', ...csrfHeader() }, body: fd, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 409 && data?.code === 'REVISAR_CONTACTOS') return { tipo: 'vista', vista: data as VistaPrevia };
  if (res.ok) return { tipo: 'guardado', guardado: data as Guardado };
  if (res.status === 401) avisarSesionPerdida();
  throw new Error(typeof data?.error === 'string' ? data.error : 'No se pudo cargar el archivo');
}
