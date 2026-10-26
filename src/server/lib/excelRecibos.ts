import { Prisma } from '@prisma/client';

/**
 * Lectura del Excel de cargos por departamento (POST /api/recibos/excel). Funciones puras: reciben las filas
 * (`sheet_to_json` con `header: 1, blankrows: false, defval: ''`) y no tocan la base ni el archivo.
 * El formato aceptado está en docs/EXCEL-RECIBOS.md.
 */

export type Fila = unknown[];

const MESES: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const NOMBRES_MES = Object.keys(MESES).join('|');

/** Columnas que no son conceptos de cobro (comparación normalizada, sin mayúsculas). */
export const NO_CONCEPTOS = ['TOTAL MANT', 'DEUDA ACUMULADA', 'TOTAL'];
/** Diferencia máxima admitida (S/) entre la suma de los conceptos redondeados y `TOTAL MANT`. */
export const TOLERANCIA_TOTAL = 0.05;

/** Recorta y colapsa espacios y saltos de línea en un solo espacio. Una fecha de Excel se devuelve como ISO. */
export function normalizarTexto(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
  return String(v).replace(/\s+/g, ' ').trim();
}

export function mesNumero(nombre: unknown): number | null {
  return MESES[normalizarTexto(nombre).toLowerCase()] ?? null;
}

/** «02 DE NOVIEMBRE DE 2026» → 2026-11-02 (UTC, medianoche). */
export function fechaDeTexto(texto: string): Date | null {
  const m = normalizarTexto(texto).match(/(\d{1,2})\s*DE\s*([A-ZÁÉÍÓÚÜÑ]+)\s*DE\s*(\d{4})/i);
  if (!m) return null;
  const mes = mesNumero(m[2]);
  return mes ? new Date(Date.UTC(parseInt(m[3], 10), mes - 1, parseInt(m[1], 10))) : null;
}

/** Fecha de una celda: Date de Excel (se toma su día calendario, sin corrimiento de zona) o texto «02 DE NOVIEMBRE DE 2026». */
function fechaDeCelda(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  return fechaDeTexto(normalizarTexto(v));
}

/** Identificador de torre → su número: «B.1», «B1», «B-1», «BLOCK 1», «Block 1», «TORRE 1», «T1», «1» → 1. Otro texto → null. */
export function numeroDeTorre(v: unknown): number | null {
  const m = normalizarTexto(v).match(/^(?:(?:block|bloque|torre|b|t)[\s.\-]*)?(\d{1,3})$/i);
  return m ? parseInt(m[1], 10) : null;
}

/** Busca la estructura cuyo nombre normalizado tiene ese número de torre: sólo si hay UNA. */
export function buscarEstructura<T extends { nombre: string | null }>(estructuras: T[], numero: number): { estructura?: T; motivo?: 'ninguna' | 'varias' } {
  const coinciden = estructuras.filter((e) => numeroDeTorre(e.nombre) === numero);
  if (coinciden.length === 1) return { estructura: coinciden[0] };
  return { motivo: coinciden.length ? 'varias' : 'ninguna' };
}

/** ¿El código de la unidad termina en ese número de departamento? («B.1-101», «B01-101» y «101» encajan con 101; «B.1-1101» no.) */
export function codigoEncajaConDpto(codigo: string | null, dpto: string): boolean {
  const ultimo = normalizarTexto(codigo).split(/[^A-Za-z0-9]+/).filter(Boolean).pop() ?? '';
  const d = normalizarTexto(dpto);
  if (!ultimo || !d) return false;
  return ultimo.toLowerCase() === d.toLowerCase() || (/^\d+$/.test(ultimo) && /^\d+$/.test(d) && Number(ultimo) === Number(d));
}

/** Monto de una celda: número, o texto con espacios y coma decimal. Vacío → 0 (como siempre); texto no numérico → null. */
export function limpiarMonto(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).trim().replace(/,/g, '.'));
  return Number.isFinite(n) ? n : null;
}

/** Redondea a 2 decimales, half-up, y lo devuelve como string Decimal. Parte del texto más corto del número (1.005 → «1.01»). */
export function redondearMonto(n: number): string {
  return new Prisma.Decimal(String(n)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

export function indiceFilaBlock(datos: Fila[]): number {
  return datos.findIndex((f) => normalizarTexto(f?.[0]).toUpperCase() === 'BLOCK');
}

/** Texto que sigue a la etiqueta dentro de la celda, o —si no hay— el de la siguiente celda no vacía de la fila. */
function valorDeEtiqueta(fila: Fila, i: number, resto: string): unknown {
  if (resto) return resto;
  for (let j = i + 1; j < fila.length; j++) if (normalizarTexto(fila[j])) return fila[j];
  return '';
}

export type Cabecera = { mes: number | null; anio: number | null; vencimiento: Date | null };

/**
 * Mes, año y vencimiento de las filas anteriores a «BLOCK».
 * Mes: «MES: Octubre 2026», «MES;Octubre» o «MES» con el mes en la siguiente celda no vacía.
 * Año: el de la misma celda del mes; si no, «OCTUBRE 2026» en algún título; si no, el del vencimiento.
 * Vencimiento: «VENCIMIENTO:» con la fecha (texto o fecha de Excel) en la misma celda o en la siguiente no vacía.
 */
export function leerCabecera(filas: Fila[]): Cabecera {
  let mes: number | null = null;
  let anio: number | null = null;
  let vencimiento: Date | null = null;
  for (const fila of filas) {
    for (let i = 0; i < fila.length; i++) {
      const t = normalizarTexto(fila[i]);
      const m = t.match(/^MES\b\s*[:;]?\s*(.*)$/i);
      if (m && mes == null) {
        const valor = normalizarTexto(valorDeEtiqueta(fila, i, m[1]));
        const nombre = valor.match(new RegExp(`^(${NOMBRES_MES})\\b\\s*(?:DE\\s+)?(\\d{4})?`, 'i'));
        if (nombre) {
          mes = mesNumero(nombre[1]);
          if (nombre[2]) anio = parseInt(nombre[2], 10);
        }
      }
      const v = t.match(/^VENCIMIENTO\b\s*[:;]?\s*(.*)$/i);
      if (v && vencimiento == null) {
        const valor = valorDeEtiqueta(fila, i, v[1]);
        vencimiento = fechaDeCelda(valor) ?? fechaDeTexto(fila.map(normalizarTexto).join(' '));
      }
    }
  }
  if (mes && anio == null) {
    const titulo = new RegExp(`\\b${Object.keys(MESES).find((k) => MESES[k] === mes)}\\s+(?:DE\\s+)?(\\d{4})\\b`, 'i');
    for (const fila of filas) {
      for (const c of fila) {
        const m = normalizarTexto(c).match(titulo);
        if (m) { anio = parseInt(m[1], 10); break; }
      }
      if (anio) break;
    }
  }
  if (mes && anio == null && vencimiento) anio = vencimiento.getUTCFullYear();
  return { mes, anio, vencimiento };
}

export type ColumnasConcepto = {
  /** Índice de la fila con los datos del primer departamento (la siguiente a la de los nombres). */
  primeraFilaDatos: number;
  conceptos: { indice: number; nombre: string }[];
  /** Columna «TOTAL MANT», si existe (para validar la suma). */
  columnaTotalMant: number | null;
  duplicados: string[];
};

/**
 * Nombres de concepto: están en la fila siguiente a «BLOCK / Dpto.» cuando esa fila sólo trae «Conceptos por cobrar»
 * (encabezado en dos filas); si traen nombres en la misma fila, es esa. Cada nombre se normaliza y se descartan
 * TOTAL MANT, DEUDA ACUMULADA y TOTAL. Sólo cuentan las columnas desde la cuarta (BLOCK, Dpto., Apellidos y Nombres van antes).
 */
export function leerConceptos(datos: Fila[], filaBlock: number): ColumnasConcepto {
  const tieneNombres = (fila: Fila) => fila.some((c, i) => i >= 3 && normalizarTexto(c) && !/^conceptos por cobrar$/i.test(normalizarTexto(c)));
  const filaNombres = tieneNombres(datos[filaBlock]) || filaBlock + 1 >= datos.length ? filaBlock : filaBlock + 1;
  const fila = datos[filaNombres];
  const conceptos: { indice: number; nombre: string }[] = [];
  const vistos = new Set<string>();
  const duplicados: string[] = [];
  let columnaTotalMant: number | null = null;
  for (let i = 3; i < fila.length; i++) {
    const nombre = normalizarTexto(fila[i]);
    if (!nombre) continue;
    const clave = nombre.toUpperCase();
    if (NO_CONCEPTOS.includes(clave)) {
      if (clave === 'TOTAL MANT') columnaTotalMant = i;
      continue;
    }
    if (vistos.has(clave)) { duplicados.push(nombre); continue; }
    vistos.add(clave);
    conceptos.push({ indice: i, nombre });
  }
  return { primeraFilaDatos: filaNombres + 1, conceptos, columnaTotalMant, duplicados };
}
