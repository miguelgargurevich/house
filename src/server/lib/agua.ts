/**
 * Lecturas de agua por departamento (el «detalle del consumo de agua» del recibo impreso). Funciones puras: cuentas, validaciones, el cruce con el
 * concepto de agua del recibo y la lectura del Excel/CSV de lecturas. No tocan la base. El formato del archivo está en docs/EXCEL-RECIBOS.md.
 *
 *   consumo (m³) = lectura actual − lectura anterior            (3 decimales)
 *   monto (S/)   = consumo × factor (S/ por m³), half-up        (2 decimales)
 */
import { Prisma } from '@prisma/client';
import XLSX from 'xlsx';
import { invalid } from '../errors';
import { fechaDeTexto, normalizarTexto, type Fila } from './excelRecibos';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

/** Diferencia máxima (S/) entre el agua del recibo y la que sale con la lectura antes de avisar. Sólo avisa: nunca cambia un monto. */
export const TOLERANCIA_AGUA = new D('0.05');
/** Tope de filas por carga (un block grande tiene unos 100 departamentos). */
export const MAX_FILAS_LECTURAS = 1000;

const DECIMALES_LECTURA = 3;
const DECIMALES_FACTOR = 4;

export interface DatosLectura {
  fecha_anterior: Date;
  lectura_anterior: Dec;
  fecha_actual: Date;
  lectura_actual: Dec;
  factor: Dec;
}

/** Consumo en m³ con 3 decimales. */
export const consumoM3 = (anterior: Prisma.Decimal.Value, actual: Prisma.Decimal.Value): Dec => new D(actual).minus(anterior).toDecimalPlaces(DECIMALES_LECTURA, D.ROUND_HALF_UP);

/** Monto en S/ del consumo: m³ × factor, 2 decimales, half-up. */
export const montoAgua = (m3: Prisma.Decimal.Value, factor: Prisma.Decimal.Value): Dec => new D(m3).mul(factor).toDecimalPlaces(2, D.ROUND_HALF_UP);

export interface CuentaLectura { consumo_m3: string; monto: string }

export function cuentaLectura(l: Pick<DatosLectura, 'lectura_anterior' | 'lectura_actual' | 'factor'>): CuentaLectura {
  const m3 = consumoM3(l.lectura_anterior, l.lectura_actual);
  return { consumo_m3: m3.toFixed(DECIMALES_LECTURA), monto: montoAgua(m3, l.factor).toFixed(2) };
}

/** Lo que devuelve `leerDecimal` cuando la celda no es un número (texto, negativo, demasiado largo). */
export const INVALIDO = 'invalido' as const;

/** Número de una celda o de un campo JSON: número o texto («1416,574», «1 416.574», «1,416.574»). Vacío → null; no numérico o negativo → `INVALIDO`. */
export function leerDecimal(v: unknown, decimales: number): Dec | null | typeof INVALIDO {
  if (v == null) return null;
  let t = typeof v === 'number' ? String(v) : String(v).replace(/\s/g, '');
  if (t === '') return null;
  if (t.includes(',') && t.includes('.')) t = t.replace(/,/g, '');
  else t = t.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t) || t.length > 20) return INVALIDO;
  return new D(t).toDecimalPlaces(decimales, D.ROUND_HALF_UP);
}

export const leerLectura = (v: unknown) => leerDecimal(v, DECIMALES_LECTURA);
export const leerFactor = (v: unknown) => leerDecimal(v, DECIMALES_FACTOR);

const MAX_LECTURA = new D('999999999.999');
const MAX_FACTOR = new D('99999.9999');

/** Reglas de una lectura: actual ≥ anterior, factor > 0, fechas en orden y todo dentro del rango de la columna. `null` = válida; si no, `campo → mensaje`. */
export function errorLectura(d: DatosLectura): Record<string, string> | null {
  const campos: Record<string, string> = {};
  if (d.lectura_anterior.gt(MAX_LECTURA)) campos.lectura_anterior = 'Lectura demasiado grande';
  if (d.lectura_actual.gt(MAX_LECTURA)) campos.lectura_actual = 'Lectura demasiado grande';
  if (d.lectura_actual.lt(d.lectura_anterior)) campos.lectura_actual = 'La lectura actual no puede ser menor que la anterior';
  if (!d.factor.gt(0)) campos.factor = 'El factor debe ser mayor que cero';
  else if (d.factor.gt(MAX_FACTOR)) campos.factor = 'Factor demasiado grande';
  if (d.fecha_actual.getTime() < d.fecha_anterior.getTime()) campos.fecha_actual = 'La fecha actual no puede ser anterior a la fecha de la lectura anterior';
  return Object.keys(campos).length ? campos : null;
}

// ---------- Cruce con el concepto de agua del recibo ----------
const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** ¿Es el concepto de agua DEL DEPARTAMENTO («AGUA DPTO.», «Agua depto», «AGUA DEPARTAMENTO»)? «AGUA COMÚN DEL CONDOMINIO» no. */
export const esConceptoAgua = (nombre: string | null | undefined): boolean => /\bAGUA (DPTO|DEPTO|DEP|DEPARTAMENTO)\b/.test(sinAcentos(nombre ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' '));

const soles = (v: Dec) => v.toFixed(2);

/**
 * Mensaje si el agua del recibo (`recibo`) y la que sale con la lectura (`lectura`) difieren en más de S/ 0.05; si no hay concepto de agua en el
 * recibo (`null`) o cuadran, `null`. Es sólo un aviso para quien revisa: no cambia montos ni cargos.
 */
export function alertaAgua(lectura: Prisma.Decimal.Value, recibo: Prisma.Decimal.Value | null): string | null {
  if (recibo == null) return null;
  const l = new D(lectura);
  const r = new D(recibo);
  return l.minus(r).abs().gt(TOLERANCIA_AGUA) ? `El agua del recibo es S/ ${soles(r)}; con la lectura sale S/ ${soles(l)}` : null;
}

// ---------- Archivo de lecturas (Excel o CSV) ----------
export interface FilaArchivo {
  /** Número de fila en la hoja (1 = primera), para los mensajes. */
  fila: number;
  dpto: string;
  fecha_anterior: unknown;
  lectura_anterior: unknown;
  fecha_actual: unknown;
  lectura_actual: unknown;
  factor: unknown;
}

export const ENCABEZADOS_LECTURAS = ['Dpto', 'Fecha anterior', 'Lectura anterior', 'Fecha actual', 'Lectura actual', 'Factor'] as const;

const norm = (v: unknown) => sinAcentos(normalizarTexto(v)).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const ES_DPTO = /^(DPTO|DEPTO|DEP|DEPARTAMENTO|UNIDAD|CODIGO)$/;

type Columnas = { dpto: number; fecha_anterior: number; lectura_anterior: number; fecha_actual: number; lectura_actual: number; factor: number };

/** Posición de cada columna por el nombre de su encabezado (en cualquier orden). */
function columnasDe(encabezado: Fila): Partial<Columnas> {
  const c: Partial<Columnas> = {};
  encabezado.forEach((celda, i) => {
    const t = norm(celda);
    if (ES_DPTO.test(t)) c.dpto ??= i;
    else if (t.startsWith('FECHA')) { if (/\bANT/.test(t)) c.fecha_anterior ??= i; else if (/\bACT/.test(t)) c.fecha_actual ??= i; }
    else if (t.startsWith('LECT')) { if (/\bANT/.test(t)) c.lectura_anterior ??= i; else if (/\bACT/.test(t)) c.lectura_actual ??= i; }
    else if (t.startsWith('FACTOR')) c.factor ??= i;
  });
  return c;
}

/**
 * Filas del archivo: una por departamento, con el encabezado `Dpto | Fecha anterior | Lectura anterior | Fecha actual | Lectura actual | Factor`
 * (las columnas se reconocen por su nombre; el factor puede faltar si se da aparte). Un archivo ilegible o sin esas columnas → 422.
 */
export function leerArchivoLecturas(buffer: Buffer): FilaArchivo[] {
  let libro: XLSX.WorkBook;
  try {
    // `raw`: un CSV no se interpreta (si no, «10/09/2026» se leería como 9 de octubre, a la americana).
    libro = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: true });
  } catch {
    throw invalid('El archivo no es un Excel (.xlsx, .xls) ni un CSV válido', { archivo: 'Archivo inválido' });
  }
  const hoja = libro.Sheets[libro.SheetNames[0]];
  if (!hoja) throw invalid('El archivo no tiene hojas', { archivo: 'Sin hojas' });
  const datos = XLSX.utils.sheet_to_json(hoja, { header: 1, blankrows: false, defval: '', raw: true }) as Fila[];
  const iEnc = datos.findIndex((f) => columnasDe(f).dpto != null);
  const col = iEnc >= 0 ? columnasDe(datos[iEnc]) : {};
  const faltan = (['dpto', 'fecha_anterior', 'lectura_anterior', 'fecha_actual', 'lectura_actual'] as const).filter((k) => col[k] == null);
  if (iEnc < 0 || faltan.length) throw invalid(`No se encontró el encabezado «${ENCABEZADOS_LECTURAS.join(' | ')}»: descarga la plantilla`, { archivo: 'Formato inválido' });
  const filas: FilaArchivo[] = [];
  for (let i = iEnc + 1; i < datos.length; i++) {
    const f = datos[i];
    const dpto = normalizarTexto(f[col.dpto!]);
    if (!dpto) continue;
    filas.push({
      fila: i + 1, dpto,
      fecha_anterior: f[col.fecha_anterior!], lectura_anterior: f[col.lectura_anterior!],
      fecha_actual: f[col.fecha_actual!], lectura_actual: f[col.lectura_actual!],
      factor: col.factor != null ? f[col.factor] : '',
    });
  }
  if (filas.length > MAX_FILAS_LECTURAS) throw invalid(`El archivo tiene más de ${MAX_FILAS_LECTURAS} filas`, { archivo: 'Demasiadas filas' });
  return filas;
}

/** Fecha de una celda: fecha de Excel, número de serie, «10/09/2026» (día primero), «2026-09-10» o «10 DE SETIEMBRE DE 2026». Otra cosa → null. */
export function leerFecha(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  if (typeof v === 'number') {
    const f = v > 20000 && v < 80000 ? XLSX.SSF.parse_date_code(v) : null;
    return f ? new Date(Date.UTC(f.y, f.m - 1, f.d)) : null;
  }
  const t = normalizarTexto(v);
  const dma = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  const ymd = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  const [y, m, d] = dma ? [+dma[3], +dma[2], +dma[1]] : ymd ? [+ymd[1], +ymd[2], +ymd[3]] : [0, 0, 0];
  if (y) {
    const f = new Date(Date.UTC(y, m - 1, d));
    return f.getUTCFullYear() === y && f.getUTCMonth() === m - 1 && f.getUTCDate() === d ? f : null;
  }
  return fechaDeTexto(t);
}

/** Plantilla descargable: el encabezado y una fila por departamento, con la lectura y la fecha anteriores (y el factor) ya puestas si se conocen. */
export function plantillaLecturas(filas: { codigo: string; fecha_anterior?: Date | null; lectura_anterior?: string | null; factor?: string | null }[]): Buffer {
  const dma = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
  const hoja = XLSX.utils.aoa_to_sheet([
    [...ENCABEZADOS_LECTURAS],
    ...filas.map((f) => [f.codigo, f.fecha_anterior ? dma(f.fecha_anterior) : '', f.lectura_anterior != null ? Number(f.lectura_anterior) : '', '', '', f.factor != null ? Number(f.factor) : '']),
  ]);
  hoja['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 17 }, { wch: 14 }, { wch: 16 }, { wch: 10 }];
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Lecturas');
  return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
