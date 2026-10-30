/**
 * Mide cuánto del trabajo de la IA habría podido hacer el OCR solo. SÓLO LECTURA: no escribe nada en la base.
 *
 * Recorre las evaluaciones `completada` que leyó una IA (proveedor distinto de `ocr`) y su archivo, pasa por cada una el OCR configurado en la base
 * (Llavero › «OCR de comprobantes»; sin configurar no hay nada que medir), y reporta:
 *   - cuántas habría aceptado el OCR solo (`ocrAlcanza`: monto, destino, fecha y operación calzan y no hay alertas), y
 *   - de ésas, en cuántas el monto, la fecha y el número de operación del OCR coinciden con lo que guardó la IA (discrepancias por `pago_id`, sólo el
 *     nombre del campo: nunca valores, datos personales ni el texto del voucher).
 * El contraste usa el estado de HOY de la base (medios de pago activos, duplicados), no el de la fecha de la evaluación.
 *
 * Uso (lo corre el orquestador contra la base que corresponda; sin DATABASE_URL usa la del .env):
 *   npm run medir:ocr                       # las 50 evaluaciones más recientes
 *   npm run medir:ocr -- --limite 200
 *   npm run medir:ocr -- --solo-lectura-remota   # permite una base que NO es localhost (decide Miguel; sigue siendo sólo lectura)
 * Llama al OCR configurado (un servicio externo) con hasta 4 archivos a la vez.
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import type { Lectura } from '../src/server/lib/lecturaComprobante';

export const LIMITE_POR_DEFECTO = 50;
export const MAX_LIMITE = 5_000;
/** Cuántos archivos se pasan por el OCR a la vez. */
export const CONCURRENCIA = 4;

export interface Opciones { limite: number; soloLecturaRemota: boolean }

/** `--limite N` (entero 1–5000, por defecto 50) y `--solo-lectura-remota`; cualquier otra cosa es un error. */
export function leerOpciones(argv: string[]): Opciones {
  let limite = LIMITE_POR_DEFECTO;
  let soloLecturaRemota = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--solo-lectura-remota') soloLecturaRemota = true;
    else if (a === '--limite' || a.startsWith('--limite=')) {
      const v = a === '--limite' ? argv[++i] : a.slice('--limite='.length);
      const n = Number(v);
      if (v === undefined || !/^\d+$/.test(v) || n < 1 || n > MAX_LIMITE) throw new Error(`--limite debe ser un entero entre 1 y ${MAX_LIMITE}`);
      limite = n;
    } else throw new Error(`Opción desconocida: ${a}`);
  }
  return { limite, soloLecturaRemota };
}

/** ¿La base es de esta máquina? Sin URL, o una que no se entiende, NO lo es. */
export function baseEsLocal(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  } catch {
    return false;
  }
}

export type CampoMedido = 'monto' | 'fecha' | 'operacion';

const igualOperacion = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase();

/** Campos en los que la lectura del OCR NO coincide con la que guardó la IA. */
export function discrepancias(ocr: Pick<Lectura, 'monto' | 'fecha' | 'numero_operacion'>, ia: Partial<Pick<Lectura, 'monto' | 'fecha' | 'numero_operacion'>> | null): CampoMedido[] {
  const d: CampoMedido[] = [];
  if (ocr.monto == null || ia?.monto == null || Math.abs(ocr.monto - ia.monto) > 0.01 + 1e-9) d.push('monto');
  if (!ocr.fecha || ocr.fecha !== ia?.fecha) d.push('fecha');
  if (!igualOperacion(ocr.numero_operacion, ia?.numero_operacion)) d.push('operacion');
  return d;
}

export interface Informe {
  evaluadas: number;
  ocrSinLectura: number;
  ocrNoAlcanza: number;
  ocrAlcanza: number;
  /** De las que el OCR habría aceptado: cuántas coinciden con la IA en cada campo. */
  coinciden: Record<CampoMedido, number>;
  /** pago_id → campos que difieren (sólo las aceptadas por el OCR). */
  discrepancias: { pago_id: number; campos: CampoMedido[] }[];
  /** Evaluaciones que no se pudieron medir (archivo o pago ya no están). */
  omitidas: number;
}

/** Ejecuta `tarea` sobre cada elemento con a lo sumo `tope` a la vez, conservando el orden de los resultados. */
async function conTope<T, R>(items: T[], tope: number, tarea: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let siguiente = 0;
  const obreros = Array.from({ length: Math.min(tope, items.length) }, async () => {
    while (siguiente < items.length) {
      const i = siguiente++;
      out[i] = await tarea(items[i]!);
    }
  });
  await Promise.all(obreros);
  return out;
}

type Medida = { tipo: 'omitida' } | { tipo: 'sin_lectura' } | { tipo: 'no_alcanza' } | { tipo: 'alcanza'; pago_id: number; campos: CampoMedido[] };

/** Sólo consultas de lectura sobre la base; lo único que sale de aquí es la llamada al OCR configurado. */
export async function medir(limite: number): Promise<Informe> {
  const { prisma } = await import('../src/server/db');
  const { leerConOcr, lecturaOcrEnMoneda, ocrAlcanza } = await import('../src/server/services/ocrVoucher');
  const { pagoParaEvaluar, prepararContraste } = await import('../src/server/services/evaluacion');
  const { MONEDA_POR_DEFECTO, ZONA_POR_DEFECTO } = await import('../src/lib/paises');

  const filas = await prisma.evaluacionComprobante.findMany({
    where: { estado: 'completada', AND: [{ proveedor: { not: null } }, { proveedor: { not: 'ocr' } }] },
    orderBy: { id: 'desc' },
    take: limite,
    select: { pago_id: true, extraido: true },
  });

  const medidas = await conTope(filas, CONCURRENCIA, async (f): Promise<Medida> => {
    const pago = await prisma.pago.findUnique({ where: { id: f.pago_id }, include: pagoParaEvaluar });
    const archivo = pago?.comprobante;
    if (!pago || !archivo) return { tipo: 'omitida' };
    const cargo = pago.reciboConceptoUnidad;
    const moneda = cargo?.reciboConcepto?.recibo?.complejo?.moneda ?? MONEDA_POR_DEFECTO;
    const zona = cargo?.reciboConcepto?.recibo?.complejo?.zona_horaria ?? ZONA_POR_DEFECTO;
    const ocr = await leerConOcr({ mime: archivo.tipo_mime, bytes: archivo.datos });
    if (!ocr) return { tipo: 'sin_lectura' };
    const leido = { ...ocr, lectura: lecturaOcrEnMoneda(ocr.lectura, moneda) };
    const cx = await prepararContraste(pago, archivo.sha256, moneda, zona);
    const c = await cx.contrastarLectura(leido.lectura);
    if (!ocrAlcanza(c, leido, cx.periodo)) return { tipo: 'no_alcanza' };
    return { tipo: 'alcanza', pago_id: f.pago_id, campos: discrepancias(leido.lectura, f.extraido as Partial<Lectura> | null) };
  });

  const informe: Informe = { evaluadas: filas.length, ocrSinLectura: 0, ocrNoAlcanza: 0, ocrAlcanza: 0, coinciden: { monto: 0, fecha: 0, operacion: 0 }, discrepancias: [], omitidas: 0 };
  for (const m of medidas) {
    if (m.tipo === 'omitida') informe.omitidas++;
    else if (m.tipo === 'sin_lectura') informe.ocrSinLectura++;
    else if (m.tipo === 'no_alcanza') informe.ocrNoAlcanza++;
    else {
      informe.ocrAlcanza++;
      for (const campo of ['monto', 'fecha', 'operacion'] as const) if (!m.campos.includes(campo)) informe.coinciden[campo]++;
      if (m.campos.length) informe.discrepancias.push({ pago_id: m.pago_id, campos: m.campos });
    }
  }
  return informe;
}

const pct = (a: number, b: number) => (b === 0 ? '—' : `${((a / b) * 100).toFixed(1)} %`);

export function formatearInforme(i: Informe): string {
  const medidas = i.evaluadas - i.omitidas;
  const l = [
    `Evaluaciones de IA revisadas: ${i.evaluadas}${i.omitidas ? ` (${i.omitidas} omitidas: ya no tienen pago o archivo)` : ''}`,
    `  El OCR no leyó nada útil (o no hay OCR configurado): ${i.ocrSinLectura}`,
    `  El OCR leyó pero NO alcanza (habría escalado a la IA): ${i.ocrNoAlcanza}`,
    `  El OCR habría aceptado solo: ${i.ocrAlcanza} de ${medidas} (${pct(i.ocrAlcanza, medidas)})`,
    `  De esas ${i.ocrAlcanza}, coinciden con lo que guardó la IA:`,
    `    monto: ${i.coinciden.monto} (${pct(i.coinciden.monto, i.ocrAlcanza)})`,
    `    fecha: ${i.coinciden.fecha} (${pct(i.coinciden.fecha, i.ocrAlcanza)})`,
    `    número de operación: ${i.coinciden.operacion} (${pct(i.coinciden.operacion, i.ocrAlcanza)})`,
  ];
  if (i.discrepancias.length) {
    l.push('  Discrepancias (pago_id: campos que difieren):');
    for (const d of i.discrepancias) l.push(`    #${d.pago_id}: ${d.campos.join(', ')}`);
  } else if (i.ocrAlcanza) l.push('  Sin discrepancias.');
  return l.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let opciones: Opciones;
  try {
    opciones = leerOpciones(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : 'Argumentos inválidos');
    process.exit(2);
  }
  if (!baseEsLocal(process.env.DATABASE_URL) && !opciones.soloLecturaRemota) {
    console.error('DATABASE_URL no es localhost: no se mide. Si de verdad quieres leer esa base (sólo lectura), pasa --solo-lectura-remota.');
    process.exit(2);
  }
  const { prisma } = await import('../src/server/db');
  try {
    console.log(formatearInforme(await medir(opciones.limite)));
  } finally {
    await prisma.$disconnect();
  }
}
