// Qué se dice y cómo se arma cada consulta en la rendición del mes: lógica pura (se prueba en tests/rendicion-ui.test.ts), sin React.
import { nombreDelMes } from '../../../../ui/format';
import type { Tone } from '../../../../ui/Badge';
import type { LineaEgreso, Rendicion } from './tipos';

export interface ParametrosRendicion { complejoId: number | null; estructuraId: number | null; mes: number; anio: number }

/** La consulta: la administración manda `complejo_id`; la junta no (el servidor usa el suyo). Sin block = el condominio completo. */
export function consultaRendicion(p: ParametrosRendicion): string {
  const sp = new URLSearchParams({ mes: String(p.mes), anio: String(p.anio) });
  if (p.complejoId) sp.set('complejo_id', String(p.complejoId));
  if (p.estructuraId) sp.set('estructura_id', String(p.estructuraId));
  return sp.toString();
}
export const urlRendicion = (p: ParametrosRendicion): string => `/api/reportes/rendicion?${consultaRendicion(p)}`;
export const urlRendicionExcel = (p: ParametrosRendicion): string => `/api/reportes/rendicion.xlsx?${consultaRendicion(p)}`;

/** «Octubre de 2026 · Block 1» o «Octubre de 2026 · Condominio completo». */
export function tituloRendicion(r: Pick<Rendicion, 'periodo' | 'estructura'>): string {
  const mes = nombreDelMes(r.periodo.mes);
  return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} de ${r.periodo.anio} · ${r.estructura?.nombre ?? (r.estructura ? 'Block' : 'Condominio completo')}`;
}

export const ESTADO_CONFORMIDAD: Record<LineaEgreso['conformidad'], { tone: Tone; label: string } | null> = {
  conforme: { tone: 'ok', label: 'Con conformidad' },
  sin_conformidad: { tone: 'warn', label: 'Sin conformidad' },
  por_pagar: null,
  no_aplica: null,
};

/** Estado de UNA línea de egreso para su insignia: por pagar, pagada (sin conformidad que dar), o pagada con/sin conformidad. */
export function estadoLineaEgreso(l: Pick<LineaEgreso, 'estado' | 'conformidad'>): { tone: Tone; label: string } {
  if (l.estado === 'por_pagar') return { tone: 'warn', label: 'Por pagar' };
  return ESTADO_CONFORMIDAD[l.conformidad] ?? { tone: 'ok', label: 'Pagado' };
}

/** Qué se dice de la comparación con el banco: cuadra, o cuánto falta/sobra respecto del extracto. */
export function textoDiferencia(x: { diferencia: string; cuadra: boolean }, dinero: (v: string) => string): { tone: Tone; label: string } {
  if (x.cuadra) return { tone: 'ok', label: 'Cuadra con el banco' };
  const n = Number(x.diferencia);
  return { tone: 'warn', label: n > 0 ? `La rendición tiene ${dinero(x.diferencia)} más que el banco` : `La rendición tiene ${dinero(String(Math.abs(n)))} menos que el banco` };
}

export const textoPct = (p: number | null): string => (p === null ? '—' : `${p.toLocaleString('es-PE', { maximumFractionDigits: 1 })} %`);

/** Tono del % cobrado: bajo 70 es mala señal, hasta 90 vigilar. */
export const tonoPct = (p: number | null): 'ok' | 'warn' | 'bad' | undefined => (p === null ? undefined : p >= 90 ? 'ok' : p >= 70 ? 'warn' : 'bad');

/** Texto del saldo: en rojo si es negativo. */
export const tonoSaldo = (v: string): 'bad' | undefined => (Number(v) < 0 ? 'bad' : undefined);

/** ¿Tiene sentido el selector de block? Sólo en el condominio completo de la administración o de la Junta central, con más de un block. */
export const ofreceBlocks = (opciones: number, fijo: boolean): boolean => !fijo && opciones > 0;
