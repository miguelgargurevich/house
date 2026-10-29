import { decimalesDe } from '../../../lib/paises';
import { nombreDelMes } from '../../../ui';

/** Las fechas sin hora llegan como medianoche UTC («2026-10-10T00:00:00.000Z»): se leen con los componentes UTC para no correrse un día. */
function partes(v: string | Date | null | undefined): { d: number; m: number; y: number } | null {
  if (!v) return null;
  const f = typeof v === 'string' ? new Date(v) : v;
  return Number.isNaN(f.getTime()) ? null : { d: f.getUTCDate(), m: f.getUTCMonth() + 1, y: f.getUTCFullYear() };
}

/** «10/10/2026», como en el recibo impreso. */
export function fechaNumerica(v: string | Date | null | undefined): string {
  const p = partes(v);
  return p ? `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}` : '—';
}

/** «02 DE NOVIEMBRE DE 2026». */
export function fechaLarga(v: string | Date | null | undefined): string {
  const p = partes(v);
  return p ? `${String(p.d).padStart(2, '0')} DE ${nombreDelMes(p.m).toUpperCase()} DE ${p.y}` : '—';
}

/** Monto sin símbolo, con los decimales de la moneda («272.15» en soles): la columna ya dice el símbolo. */
export const monto2 = (v: string | number | null | undefined, moneda?: string | null): string => {
  const n = Number(v ?? 0);
  const d = decimalesDe(moneda);
  return Number.isFinite(n) ? n.toFixed(d) : (0).toFixed(d);
};

/** Las notas de pago son texto libre: una nota por renglón; los renglones vacíos se descartan. */
export const lineasDeNotas = (texto: string | null | undefined): string[] => (texto ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);

/** Lectura del contómetro con sus 3 decimales («1430.897»); el consumo y el factor llegan ya redondeados. */
export const lecturaTexto = (v: string | null | undefined): string => v ?? '—';
