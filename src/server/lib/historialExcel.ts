/** Excel de «Mi historial»: una hoja «Resumen» (las cifras del periodo) y una hoja «Meses» (una fila por mantenimiento). Sólo arma el archivo; no toca la base. */
import XLSX from 'xlsx';
import type { Historial } from '../services/historial';
import { hoyLima } from './fechas';
import { periodoTexto } from './periodo';

const dma = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** Un instante (la fecha de pago) como día de Lima. */
const diaLima = (instante: string) => dma(hoyLima(new Date(instante)).toISOString());
const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ESTADOS: Record<string, string> = { pagado: 'Pagado', en_revision: 'En revisión', parcial: 'Pago parcial', vencido: 'Vencido', pendiente: 'Por pagar' };

/** Los montos van como número de Excel (con 2 decimales) para que se puedan sumar; el servidor no hace cuentas con ellos. */
const soles = (v: string) => Number(v);

export const HOJAS_HISTORIAL = { resumen: 'Resumen', meses: 'Meses' } as const;

export function historialXlsx(h: Historial, unidadId?: number, generado = new Date()): Buffer {
  const unidades = (unidadId !== undefined ? h.unidades.filter((u) => u.id === unidadId) : h.unidades).map((u) => u.codigo).join(', ');
  const periodo = h.anio !== null ? String(h.anio) : h.meses.length ? `${mayuscula(periodoTexto(h.meses[0]!.mes, h.meses[0]!.anio))} a ${periodoTexto(h.meses.at(-1)!.mes, h.meses.at(-1)!.anio)}` : 'Sin meses';
  const r = h.resumen;
  const resumen = XLSX.utils.aoa_to_sheet([
    ['Mi historial de pagos', ''],
    ['Periodo', periodo],
    ['Unidades', unidades],
    ['Pagado en el periodo (S/)', soles(r.pagado)],
    ['Promedio por mes pagado (S/)', soles(r.promedio_mes)],
    ['Deuda de hoy (S/)', soles(r.deuda_actual)],
    ['En revisión (S/)', soles(r.en_revision)],
    ['Meses pagados a tiempo', r.meses_a_tiempo],
    ['Meses evaluados', r.meses_evaluados],
    ['Consumo de agua promedio (m³)', r.agua_promedio_m3 === null ? '' : Number(r.agua_promedio_m3)],
    ['Generado el', dma(hoyLima(generado).toISOString())],
  ]);
  resumen['!cols'] = [{ wch: 32 }, { wch: 28 }];

  const meses = XLSX.utils.aoa_to_sheet([
    ['Mes', 'Unidad', 'Conceptos', 'Total (S/)', 'Pagado (S/)', 'Estado', 'Vence', 'Fecha de pago', 'Días vs vencimiento', 'Agua (m³)'],
    ...h.meses.map((m) => [
      mayuscula(periodoTexto(m.mes, m.anio)),
      m.unidad.codigo,
      m.por_concepto.map((c) => `${c.concepto}: S/ ${c.monto}`).join('; '),
      soles(m.total),
      soles(m.pagado),
      ESTADOS[m.estado] ?? m.estado,
      dma(m.fecha_vencimiento),
      m.fecha_pago ? diaLima(m.fecha_pago) : '',
      m.dias_vs_vencimiento ?? '',
      m.agua_m3 === null ? '' : Number(m.agua_m3),
    ]),
  ]);
  meses['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 56 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 20 }, { wch: 11 }];

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, resumen, HOJAS_HISTORIAL.resumen);
  XLSX.utils.book_append_sheet(libro, meses, HOJAS_HISTORIAL.meses);
  return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
