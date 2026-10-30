import XLSX from 'xlsx';
import { MESES } from './periodo';
import { numeroDeTorre } from './excelRecibos';
import type { Consolidado } from '../services/consolidado';

/**
 * El consolidado del block como Excel, con el MISMO formato del que sube la administradora (docs/EXCEL-RECIBOS.md): título y «MES / VENCIMIENTO:» arriba,
 * encabezado en dos filas (BLOCK | Dpto. | Apellidos y Nombres | «Conceptos por cobrar»), un concepto por columna, TOTAL MANT, DEUDA ACUMULADA, TOTAL, una fila por
 * departamento y TOTALES. Lo que se descarga se puede volver a subir (`lib/excelRecibos.ts` lo lee). Sólo funciones puras.
 */

const COLUMNAS_FIJAS = 3;
const NOMBRES_TOTALES = ['TOTAL MANT', 'DEUDA ACUMULADA', 'TOTAL'] as const;

/** «02 DE NOVIEMBRE DE 2026» (el día calendario de la fecha, sin corrimiento de zona). */
export function vencimientoTexto(f: Date): string {
  return `${String(f.getUTCDate()).padStart(2, '0')} DE ${(MESES[f.getUTCMonth()] ?? '').toUpperCase()} DE ${f.getUTCFullYear()}`;
}

/** El block como lo escribe la administradora: «Block 1» → «B.1» (el importador reconoce la torre por su número); un nombre sin número, tal cual. */
export function blockParaExcel(nombre: string | null): string {
  if (!nombre) return '';
  const n = numeroDeTorre(nombre);
  return n != null ? `B.${n}` : nombre;
}

/** Departamentos «101» como número (como en el Excel original); «A-1» o «0101» se dejan como texto. */
const dptoParaExcel = (d: string): string | number => (/^[1-9]\d*$/.test(d) ? Number(d) : d);

/** Texto de la hoja: sin mayúsculas ni saltos raros; el nombre de cada concepto se escribe como está en el recibo. */
const mayus = (s: string) => s.toUpperCase();

/** Nombre del archivo: `consolidado-block-1-octubre-2026.xlsx` (sin tildes ni caracteres raros). */
export function nombreArchivoConsolidado(c: Pick<Consolidado, 'block' | 'mes' | 'anio'>): string {
  const limpio = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${['consolidado', limpio(c.block ?? 'condominio'), limpio(MESES[c.mes - 1] ?? String(c.mes)), String(c.anio)].filter(Boolean).join('-')}.xlsx`;
}

export function libroConsolidado(c: Consolidado): Buffer {
  const n = c.conceptos.length;
  const ultima = COLUMNAS_FIJAS + n + NOMBRES_TOTALES.length - 1; // índice de la última columna (TOTAL)
  const mes = MESES[c.mes - 1] ?? String(c.mes);
  const fila = (...celdas: (string | number | null)[]): (string | number | null)[] => {
    const f: (string | number | null)[] = Array.from({ length: ultima + 1 }, () => null);
    celdas.forEach((v, i) => { f[i] = v; });
    return f;
  };
  const fijas = (valores: Record<number, string | number>) => {
    const f = fila();
    for (const [i, v] of Object.entries(valores)) f[Number(i)] = v;
    return f;
  };

  const aoa: (string | number | null)[][] = [
    fijas({ 0: [c.condominio, c.block].filter(Boolean).join(' · ') }),
    fijas({ 1: mayus(c.empresa ?? c.condominio), 3: `MANTENIMIENTO DE ${mayus(mes)} ${c.anio}` }),
    fila(),
    fijas({ 3: 'MES', 4: mes.charAt(0).toUpperCase() + mes.slice(1), 6: 'VENCIMIENTO:', 8: vencimientoTexto(c.fecha_vencimiento) }),
    fila(),
    fijas({ 0: 'BLOCK', 1: 'Dpto.', 2: 'Apellidos y Nombres', 3: 'Conceptos por cobrar' }),
    fila(null, null, null, ...c.conceptos.map((x) => x.nombre), ...NOMBRES_TOTALES),
  ];
  const primeraDatos = aoa.length;
  for (const f of c.filas) {
    aoa.push(fila(blockParaExcel(f.block), dptoParaExcel(f.dpto), f.propietario, ...f.montos.map(Number), Number(f.total_mant), Number(f.deuda_acumulada), Number(f.total)));
  }
  const filaTotales = aoa.length;
  aoa.push(fila('TOTALES', null, null, ...c.totales.montos.map(Number), Number(c.totales.total_mant), Number(c.totales.deuda_acumulada), Number(c.totales.total)));

  const hoja = XLSX.utils.aoa_to_sheet(aoa);
  hoja['!merges'] = [
    { s: { r: 1, c: 1 }, e: { r: 1, c: 2 } },
    { s: { r: 1, c: 3 }, e: { r: 1, c: ultima } },
    { s: { r: 3, c: 4 }, e: { r: 3, c: 5 } },
    { s: { r: 3, c: 6 }, e: { r: 3, c: 7 } },
    { s: { r: 5, c: 0 }, e: { r: 6, c: 0 } },
    { s: { r: 5, c: 1 }, e: { r: 6, c: 1 } },
    { s: { r: 5, c: 2 }, e: { r: 6, c: 2 } },
    { s: { r: 5, c: 3 }, e: { r: 5, c: ultima } },
    { s: { r: filaTotales, c: 0 }, e: { r: filaTotales, c: 2 } },
  ];
  hoja['!cols'] = [{ wch: 8 }, { wch: 7 }, { wch: 42 }, ...Array.from({ length: n + NOMBRES_TOTALES.length }, () => ({ wch: 13 }))];
  // Márgenes estrechos, como el original (el formato de impresión lo da la pantalla «Imprimir»; SheetJS no escribe la orientación de la hoja).
  hoja['!margins'] = { left: 0.2, right: 0.2, top: 0.3, bottom: 0.3, header: 0.2, footer: 0.2 };
  for (let r = primeraDatos; r <= filaTotales; r++) {
    for (let col = COLUMNAS_FIJAS; col <= ultima; col++) {
      const celda = hoja[XLSX.utils.encode_cell({ r, c: col })];
      if (celda) celda.z = '0.00';
    }
    const dpto = hoja[XLSX.utils.encode_cell({ r, c: 1 })];
    if (dpto && dpto.t === 'n') dpto.z = '0';
  }

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Consolidado');
  return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
