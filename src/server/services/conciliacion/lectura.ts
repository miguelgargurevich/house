// Lectura de extractos bancarios (.xlsx, .xls, .csv): detecta la fila de encabezados y las columnas por sinónimos, lee fechas y montos como los exportan
// BCP, Interbank, BBVA, Scotiabank y BanBif y se queda sólo con los ABONOS. Todo es puro (sin base de datos): el servicio de importación lo usa y las pruebas lo
// ejercitan con extractos sintéticos. Nunca se guarda el archivo.
import { Prisma } from '@prisma/client';
import XLSX from 'xlsx';
import { invalid } from '../../errors';

export const MAX_BYTES_EXTRACTO = 5 * 1024 * 1024;
export const MAX_FILAS_EXTRACTO = 5000;
/** Filas que se miran buscando el encabezado y filas que se muestran cuando no se reconocen las columnas. */
const FILAS_BUSQUEDA_ENCABEZADO = 60;
export const FILAS_VISTA = 15;

export const CAMPOS = ['fecha', 'descripcion', 'abono', 'cargo', 'operacion'] as const;
export type Campo = (typeof CAMPOS)[number];
/** Índice de columna (0 = primera) de cada dato; null = el extracto no lo trae. `fila_inicio`: índice de la primera fila de datos. */
export interface Mapeo { fecha: number | null; descripcion: number | null; abono: number | null; cargo: number | null; operacion: number | null; fila_inicio: number }

export interface AbonoLeido { fila: number; fecha: Date; descripcion: string; monto: Prisma.Decimal; operacion: string | null }
export interface Descartes { cargos: number; sin_fecha: number; sin_monto: number }
export interface LecturaExtracto {
  /** true = se reconocieron (o se recibieron) las columnas mínimas: fecha y un monto. */
  reconocido: boolean;
  mapeo: Mapeo | null;
  /** Encabezados de la fila detectada (vacío si no se detectó). */
  encabezados: string[];
  /** Primeras filas del archivo como texto, para elegir columnas a mano. */
  vista: string[][];
  abonos: AbonoLeido[];
  descartes: Descartes;
}

type Celda = string | number | boolean | Date | null | undefined;

// ---------- Texto ----------
export const normalizar = (v: unknown): string =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ---------- Encabezados ----------
// Por prioridad: se toma la columna del PRIMER sinónimo que exista (p. ej. «fecha operación» antes que «fecha valor»).
const SINONIMOS: Record<Exclude<Campo, 'abono'> | 'abono_dedicado' | 'monto_con_signo', string[]> = {
  fecha: ['fecha operacion', 'fecha de operacion', 'f operacion', 'fec operacion', 'fecha', 'fecha movimiento', 'fecha de movimiento', 'fecha de proceso', 'fecha proceso', 'fecha valor', 'fecha valuta', 'f valor', 'fec valor'],
  descripcion: ['descripcion operacion', 'descripcion de la operacion', 'descripcion', 'descripcion del movimiento', 'glosa', 'concepto', 'detalle del movimiento', 'detalle', 'movimiento', 'observaciones'],
  abono_dedicado: ['abono', 'abonos', 'monto abono', 'importe abono', 'ingreso', 'ingresos', 'credito', 'creditos', 'haber', 'deposito', 'depositos'],
  monto_con_signo: ['monto', 'importe', 'monto operacion', 'importe operacion', 'monto s', 'importe s', 'valor'],
  cargo: ['cargo', 'cargos', 'monto cargo', 'importe cargo', 'egreso', 'egresos', 'debito', 'debitos', 'debe', 'retiro', 'retiros'],
  operacion: ['numero operacion', 'numero de operacion', 'nro operacion', 'nro de operacion', 'n operacion', 'n de operacion', 'no operacion', 'num operacion', 'operacion numero', 'operacion nro', 'nro op', 'n op', 'num op', 'nro documento', 'numero documento', 'n documento', 'nro doc', 'n doc', 'documento', 'referencia', 'ref', 'operacion'],
};
// Segunda pasada (el encabezado trae más texto que el sinónimo: «Fecha de la operación», «Monto en soles»…).
const CONTIENE: Record<keyof typeof SINONIMOS, RegExp> = {
  fecha: /\bfecha\b|\bfec\b/,
  descripcion: /descripcion|glosa|concepto|detalle/,
  abono_dedicado: /\babonos?\b|\bingresos?\b|\bcreditos?\b|\bhaber\b|\bdepositos?\b/,
  monto_con_signo: /\bmonto\b|\bimporte\b/,
  cargo: /\bcargos?\b|\begresos?\b|\bdebitos?\b|\bdebe\b|\bretiros?\b/,
  operacion: /\boperacion\b|\breferencia\b|\bdocumento\b|\bnro op\b|\bn op\b/,
};

function buscarColumna(norm: string[], clave: keyof typeof SINONIMOS, usadas: Set<number>): number | null {
  for (const s of SINONIMOS[clave]) {
    const i = norm.findIndex((h, k) => h === s && !usadas.has(k));
    if (i >= 0) return i;
  }
  const i = norm.findIndex((h, k) => h !== '' && CONTIENE[clave].test(h) && !usadas.has(k));
  return i >= 0 ? i : null;
}

/** Columnas que se reconocen en una fila de encabezados; `null` si la fila no sirve (no trae fecha y un monto). */
export function reconocerEncabezados(fila: Celda[]): Omit<Mapeo, 'fila_inicio'> | null {
  const norm = fila.map(normalizar);
  const usadas = new Set<number>();
  const tomar = (clave: keyof typeof SINONIMOS) => { const i = buscarColumna(norm, clave, usadas); if (i != null) usadas.add(i); return i; };
  const fecha = tomar('fecha');
  const abonoDedicado = tomar('abono_dedicado');
  const cargo = tomar('cargo');
  // Sin columna de abonos propia, el monto trae signo (negativo = cargo): los positivos son los abonos.
  const abono = abonoDedicado ?? tomar('monto_con_signo');
  if (fecha == null || abono == null) return null;
  const descripcion = tomar('descripcion');
  const operacion = tomar('operacion');
  return { fecha, descripcion, abono, cargo: abonoDedicado != null ? cargo : null, operacion };
}

function detectarEncabezado(filas: Celda[][]): { indice: number; mapeo: Mapeo } | null {
  const tope = Math.min(filas.length, FILAS_BUSQUEDA_ENCABEZADO);
  for (let i = 0; i < tope; i++) {
    const m = reconocerEncabezados(filas[i]!);
    if (m) return { indice: i, mapeo: { ...m, fila_inicio: i + 1 } };
  }
  return null;
}

// ---------- Fechas ----------
const DIA_MS = 86_400_000;
const EPOCA_EXCEL = Date.UTC(1899, 11, 30);

function fechaValida(anio: number, mes: number, dia: number): Date | null {
  if (anio < 1990 || anio > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia ? d : null;
}
const anioDe = (a: string): number => (a.length === 2 ? (Number(a) < 70 ? 2000 + Number(a) : 1900 + Number(a)) : Number(a));

/** Día de calendario (00:00 UTC) de una celda: «dd/mm/aaaa», «dd-mm-aa», «aaaa-mm-dd» o un serial de Excel. `null` si no es una fecha. */
export function parsearFecha(v: Celda): Date | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : fechaValida(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === 'number') return v >= 20_000 && v < 80_000 ? new Date(EPOCA_EXCEL + Math.floor(v) * DIA_MS) : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (/^\d{5}(\.\d+)?$/.test(t)) return parsearFecha(Number(t));
  let m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?m\.?)?)?$/i.exec(t);
  if (m) return fechaValida(anioDe(m[3]!), Number(m[2]), Number(m[1]));
  m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(t);
  if (m) return fechaValida(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

// ---------- Montos ----------
/** «1,234.56», «1.234,56», «S/ 1,234.56», «-50.00», «(50.00)», «50.00-», «1234,5»: el monto con signo, o `null` si no es un monto (o trae más de 2 decimales). */
export function parsearMonto(v: Celda): Prisma.Decimal | null {
  if (v == null || v === '' || typeof v === 'boolean' || v instanceof Date) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? new Prisma.Decimal(v.toFixed(2)) : null;
  // La moneda primero («S/ -1,234.50», «(S/ 50.00)»); después el signo.
  let t = v.replace(/ /g, ' ').replace(/(?:s\/\.?|us\$|\$|pen|usd|soles?|d[oó]lares?)/gi, '').trim();
  if (!t || /^[-–—]+$/.test(t)) return null;
  let negativo = false;
  if (/^\(.*\)$/.test(t)) { negativo = true; t = t.slice(1, -1).trim(); }
  t = t.replace(/[−–—]/g, '-');
  if (/-\s*$/.test(t)) { negativo = !negativo; t = t.replace(/-\s*$/, ''); }
  if (/^\s*-/.test(t)) { negativo = !negativo; t = t.replace(/^\s*-/, ''); }
  t = t.replace(/\s+/g, '');
  if (!/^[\d.,]+$/.test(t) || !/\d/.test(t)) return null;
  const coma = t.lastIndexOf(',');
  const punto = t.lastIndexOf('.');
  let decimal: ',' | '.' | null = null;
  if (coma >= 0 && punto >= 0) decimal = coma > punto ? ',' : '.';
  else if (coma >= 0) decimal = (t.match(/,/g)!.length === 1 && /,\d{1,2}$/.test(t)) ? ',' : null;
  else if (punto >= 0) decimal = (t.match(/\./g)!.length === 1 && /\.\d{1,2}$/.test(t)) ? '.' : null;
  const sep = decimal === ',' ? '.' : decimal === '.' ? ',' : null;
  let limpio = t;
  if (sep) limpio = limpio.split(sep).join('');
  if (decimal === ',') limpio = limpio.replace(',', '.');
  // Sin separador decimal, lo que quede con comas o puntos son miles («1,234», «1.234.567»).
  if (decimal == null) limpio = limpio.replace(/[.,]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  const d = new Prisma.Decimal(limpio);
  return negativo ? d.neg() : d;
}

// ---------- Operación ----------
/** Número de operación como se muestra (sin espacios en los extremos; vacío o sólo ceros = no trae). */
export function textoOperacion(v: Celda): string | null {
  if (v == null || v === '' || typeof v === 'boolean' || v instanceof Date) return null;
  const t = typeof v === 'number' ? (Number.isFinite(v) ? String(Math.round(v)) : '') : v.trim();
  if (!t || /^0+$/.test(t)) return null;
  return t.slice(0, 60);
}
/**
 * Para comparar: mayúsculas, sin símbolos y sin ceros a la izquierda; si trae 4 o más dígitos, sólo los dígitos (el voucher dice «OP-100234» y el banco
 * «100234»; «000123» y «123» también coinciden).
 */
export const normalizarOperacion = (v: string | null | undefined): string | null => {
  const alfanumerico = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const digitos = alfanumerico.replace(/\D/g, '');
  const t = (digitos.length >= MIN_OPERACION ? digitos : alfanumerico).replace(/^0+/, '');
  return t || null;
};
/** Una operación de menos de 4 caracteres no identifica nada (podría ser «1» o «12»): no cuenta como señal. */
export const MIN_OPERACION = 4;

// ---------- Archivo → tabla ----------
const textoDe = (c: Celda): string => (c == null ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c).trim());

/** Decodifica un CSV: UTF-8 si es válido; si no (los de varios bancos salen en ANSI), Latin-1. */
function decodificarCsv(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  const texto = utf8.includes('�') ? buffer.toString('latin1') : utf8;
  return texto.replace(/^\ufeff/, '');
}

/** Lector de CSV con comillas; separador detectado entre «,», «;», tabulador y «|» según la primera línea con datos. */
export function leerCsv(texto: string, maxFilas: number): string[][] {
  const lineas = texto.split(/\r\n|\n|\r/);
  const muestra = lineas.filter((l) => l.trim()).slice(0, 10).join('\n').replace(/"[^"]*"/g, '');
  const cuenta = (c: string) => muestra.split(c).length - 1;
  const sep = ([';', '\t', '|', ','] as const).reduce((mejor, c) => (cuenta(c) > cuenta(mejor) ? c : mejor), ',');
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let comillas = false;
  const cerrarFila = () => { fila.push(campo); campo = ''; if (fila.some((c) => c.trim() !== '')) filas.push(fila); fila = []; };
  for (let i = 0; i < texto.length && filas.length < maxFilas; i++) {
    const c = texto[i]!;
    if (comillas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false; } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; cerrarFila(); } else campo += c;
  }
  if (filas.length < maxFilas && (campo !== '' || fila.length)) cerrarFila();
  return filas;
}

/** Primera hoja del archivo como tabla de celdas. 422 si no es un archivo que se pueda leer o pasa del tope de filas. */
export function leerTabla(buffer: Buffer, nombre: string): Celda[][] {
  if (buffer.length === 0) throw invalid('El archivo está vacío', { archivo: 'Vacío' });
  const esCsv = /\.(csv|txt)$/i.test(nombre);
  // Un Excel de verdad es un ZIP (.xlsx) o un OLE2 (.xls); algunos bancos «exportan a Excel» una tabla HTML o un CSV con extensión .xls: texto, sí; basura binaria, no.
  const binarioConocido = (buffer[0] === 0x50 && buffer[1] === 0x4b) || (buffer[0] === 0xd0 && buffer[1] === 0xcf);
  if (!binarioConocido && buffer.subarray(0, 1024).includes(0)) throw invalid('El archivo no es un Excel ni un CSV válido (.xlsx, .xls o .csv)', { archivo: 'Archivo inválido' });
  let filas: Celda[][];
  if (esCsv || (!binarioConocido && !/^\s*</.test(buffer.subarray(0, 256).toString('utf8')))) {
    filas = leerCsv(decodificarCsv(buffer), MAX_FILAS_EXTRACTO + FILAS_BUSQUEDA_ENCABEZADO + 1);
  } else {
    let libro: XLSX.WorkBook;
    try {
      // Sin `cellDates`: las fechas llegan como serial y se convierten aquí (SheetJS las corre según la zona horaria de la máquina).
      libro = XLSX.read(buffer, { type: 'buffer', cellDates: false, sheetRows: MAX_FILAS_EXTRACTO + FILAS_BUSQUEDA_ENCABEZADO + 1 });
    } catch {
      throw invalid('El archivo no es un Excel ni un CSV válido (.xlsx, .xls o .csv)', { archivo: 'Archivo inválido' });
    }
    const hoja = libro.Sheets[libro.SheetNames[0]!];
    if (!hoja) throw invalid('El archivo no tiene hojas', { archivo: 'Sin hojas' });
    filas = XLSX.utils.sheet_to_json<Celda[]>(hoja, { header: 1, raw: true, blankrows: false, defval: '' });
  }
  if (filas.length > MAX_FILAS_EXTRACTO + FILAS_BUSQUEDA_ENCABEZADO) throw invalid(`El extracto trae más de ${MAX_FILAS_EXTRACTO} filas: sube un periodo más corto`, { archivo: 'Demasiadas filas' });
  return filas;
}

// ---------- Tabla → abonos ----------
function mapeoValido(m: Mapeo, anchoMax: number): boolean {
  const ok = (i: number | null) => i == null || (Number.isInteger(i) && i >= 0 && i < Math.max(anchoMax, 1));
  return m.fecha != null && m.abono != null && ok(m.fecha) && ok(m.abono) && ok(m.descripcion) && ok(m.cargo) && ok(m.operacion) && Number.isInteger(m.fila_inicio) && m.fila_inicio >= 0;
}

/**
 * Lee los abonos de la tabla. Con `mapeo` (el que eligió el administrador o el guardado de la cuenta) se usa ese; sin él, se detecta el encabezado. Un
 * mapeo guardado sólo se usa si la detección automática no reconoce nada.
 */
export function leerAbonos(filas: Celda[][], opts: { mapeo?: Mapeo | null; guardado?: Mapeo | null } = {}): LecturaExtracto {
  const ancho = filas.reduce((m, f) => Math.max(m, f.length), 0);
  const vista = filas.slice(0, FILAS_VISTA).map((f) => Array.from({ length: ancho }, (_, i) => textoDe(f[i])));
  const vacio = (reconocido: boolean, mapeo: Mapeo | null, encabezados: string[]): LecturaExtracto => ({ reconocido, mapeo, encabezados, vista, abonos: [], descartes: { cargos: 0, sin_fecha: 0, sin_monto: 0 } });

  let mapeo: Mapeo | null = null;
  let encabezados: string[] = [];
  if (opts.mapeo) {
    mapeo = mapeoValido(opts.mapeo, ancho) ? opts.mapeo : null;
  } else {
    const auto = detectarEncabezado(filas);
    if (auto) { mapeo = auto.mapeo; encabezados = (filas[auto.indice] ?? []).map(textoDe); }
    else if (opts.guardado && mapeoValido(opts.guardado, ancho)) mapeo = opts.guardado;
  }
  if (!mapeo) return vacio(false, null, []);
  if (!encabezados.length && mapeo.fila_inicio > 0) encabezados = (filas[mapeo.fila_inicio - 1] ?? []).map(textoDe);

  const abonos: AbonoLeido[] = [];
  const descartes: Descartes = { cargos: 0, sin_fecha: 0, sin_monto: 0 };
  for (let i = mapeo.fila_inicio; i < filas.length; i++) {
    const f = filas[i]!;
    const fecha = parsearFecha(f[mapeo.fecha!]);
    if (!fecha) { descartes.sin_fecha++; continue; }
    const valor = parsearMonto(f[mapeo.abono!]);
    if (valor == null) {
      // Con columnas de cargo y de abono separadas, una fila de cargo trae el abono vacío: es un cargo, no un error.
      const cargo = mapeo.cargo != null ? parsearMonto(f[mapeo.cargo]) : null;
      if (cargo != null && !cargo.isZero()) descartes.cargos++; else descartes.sin_monto++;
      continue;
    }
    if (valor.lte(0)) { if (valor.isNeg() && !valor.isZero()) descartes.cargos++; else descartes.sin_monto++; continue; }
    // Positivo = abono (en una columna de abonos o en un monto con signo); negativo o cero = no es un abono.
    abonos.push({
      fila: i + 1,
      fecha,
      descripcion: mapeo.descripcion != null ? textoDe(f[mapeo.descripcion]).replace(/\s+/g, ' ').slice(0, 300) : '',
      monto: valor,
      operacion: mapeo.operacion != null ? textoOperacion(f[mapeo.operacion]) : null,
    });
  }
  return { reconocido: true, mapeo, encabezados, vista, abonos, descartes };
}

/** Lee un archivo completo (el paso que usan las rutas). */
export function leerExtracto(buffer: Buffer, nombre: string, opts: { mapeo?: Mapeo | null; guardado?: Mapeo | null } = {}): LecturaExtracto {
  return leerAbonos(leerTabla(buffer, nombre), opts);
}
