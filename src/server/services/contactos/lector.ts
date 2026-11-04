/**
 * Lectura del Excel de contactos de los vecinos (`POST /api/contactos/excel`). Funciones puras: reciben el archivo y devuelven las filas ya
 * limpias; no tocan la base. Las columnas se reconocen por su encabezado (sin mayúsculas ni tildes), así sirve la plantilla de Torre o un
 * Excel parecido: `Block | Dpto | Propietario | Correo propietario | Celular propietario | Inquilino | Correo inquilino | Celular inquilino`.
 */
import XLSX from 'xlsx';
import { invalid } from '../../errors';
import { normalizarTexto } from '../../lib/excelRecibos';
import { emailSchema } from '../../validation';
import { formatearCelular, normalizarCelular } from '../avisos/celular';

/** Tope de filas por archivo (el condominio más grande que se carga hoy tiene 448 departamentos). */
export const MAX_FILAS = 3000;

export type Persona = 'propietario' | 'inquilino';
/** Relación de una fila en el Excel «una fila por persona» (columna opcional `Relación`). */
export type RelacionFila = Persona | 'copropietario' | 'conyuge' | 'familiar' | 'otro';
export type Dato = 'nombre' | 'correo' | 'celular';

/** Lo que trae el Excel de una persona, ya validado: texto vacío = la celda venía vacía. `errores` son los motivos por los que la fila no se puede usar. */
export interface DatosPersona {
  nombre: string;
  /** En minúsculas. Vacío si la celda venía vacía o era un correo de relleno (`…@sin-correo.invalid`). */
  correo: string;
  /** Con formato internacional («+51 987 654 321»). Vacío si la celda venía vacía. */
  celular: string;
  errores: string[];
}

export interface FilaContacto {
  /** Número de fila en el Excel (1 = la primera), para que el mensaje apunte a la fila de verdad. */
  fila: number;
  block: string;
  dpto: string;
  propietario: DatosPersona;
  inquilino: DatosPersona;
  /** Con la columna `Relación` cada persona viene en su propia fila: el número de la fila de cada una (para que el mensaje apunte a la fila de verdad). */
  filas?: Partial<Record<Persona, number>>;
}

/** Una persona que NO es el propietario ni el inquilino principal (copropietario, cónyuge, familiar u otro), o una fila con la relación mal escrita. */
export interface FilaExtra {
  fila: number;
  block: string;
  dpto: string;
  /** null = la relación no se entendió (`error` lo dice). */
  relacion: Exclude<RelacionFila, Persona> | null;
  datos: DatosPersona;
  error?: string;
}

export interface LecturaContactos {
  filas: FilaContacto[];
  /** Sólo con la columna `Relación`: las personas que no son propietario ni inquilino. Sin ella, siempre vacío (el archivo se lee como siempre). */
  extras: FilaExtra[];
  /** El archivo traía la columna `Relación` (una fila por persona). */
  por_persona: boolean;
  /** Filas que traían block y departamento (o texto en cualquier celda) pero no se pudieron entender; se cuentan, no se pierden en silencio. */
  vacias: number;
}

/** Minúsculas, sin tildes ni signos y con un solo espacio: «Teléfono del Propietario» → «telefono del propietario». */
export function normalizarEncabezado(v: unknown): string {
  return normalizarTexto(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export type Columna = { tipo: 'block' } | { tipo: 'dpto' } | { tipo: 'relacion' } | { tipo: 'persona'; persona: Persona; dato: Dato };

/** Qué es una columna según su encabezado; null = no es de las que se leen (se ignora). */
export function clasificarEncabezado(h: string): Columna | null {
  if (!h) return null;
  if (/^(block|bloque|blk|torre|edificio)$/.test(h)) return { tipo: 'block' };
  if (/^(relacion|parentesco|vinculo|relacion con el (dpto|depto|departamento|propietario))$/.test(h)) return { tipo: 'relacion' };
  const inq = /\b(inquilino|inquilina|arrendatario|arrendataria)\b/.test(h);
  const prop = /\b(propietario|propietaria|propietarios|dueno|duena|titular)\b/.test(h);
  const correo = /\b(correo|correos|email|mail|e mail)\b/.test(h);
  const celular = /\b(celular|celulares|telefono|telefonos|movil|whatsapp|cel|fono)\b/.test(h);
  const nombre = /\b(nombre|nombres|apellido|apellidos)\b/.test(h);
  if (!inq && !prop && !correo && !celular && !nombre) {
    return /\b(dpto|depto|dptos|departamento|departamentos|dep|unidad|nro dpto|numero dpto)\b/.test(h) ? { tipo: 'dpto' } : null;
  }
  // Sin «inquilino» ni «propietario» en el encabezado, la columna es del propietario (como «Apellidos y Nombres» del Excel de recibos).
  const persona: Persona = inq ? 'inquilino' : 'propietario';
  const dato: Dato = correo ? 'correo' : celular ? 'celular' : 'nombre';
  return { tipo: 'persona', persona, dato };
}

export interface Cabecera {
  fila: number;
  block: number | null;
  dpto: number;
  /** Columna `Relación` (opcional): con ella el archivo trae una fila por persona. */
  relacion: number | null;
  persona: Record<Persona, Partial<Record<Dato, number>>>;
}

/** Busca (en las primeras 20 filas) la fila de encabezados: la primera con una columna de departamento y al menos una de propietario o inquilino. */
export function buscarCabecera(datos: unknown[][]): Cabecera | null {
  for (let i = 0; i < Math.min(datos.length, 20); i++) {
    const fila = datos[i] ?? [];
    const cab: Cabecera = { fila: i, block: null, dpto: -1, relacion: null, persona: { propietario: {}, inquilino: {} } };
    fila.forEach((celda, j) => {
      const c = clasificarEncabezado(normalizarEncabezado(celda));
      if (!c) return;
      if (c.tipo === 'block') { if (cab.block == null) cab.block = j; }
      else if (c.tipo === 'dpto') { if (cab.dpto < 0) cab.dpto = j; }
      else if (c.tipo === 'relacion') { if (cab.relacion == null) cab.relacion = j; }
      else if (cab.persona[c.persona][c.dato] == null) cab.persona[c.persona][c.dato] = j;
    });
    const hayPersona = Object.values(cab.persona).some((p) => Object.keys(p).length > 0);
    if (cab.dpto >= 0 && hayPersona) return cab;
  }
  return null;
}

const MENSAJE_CORREO = 'El correo no es válido';
const MENSAJE_CELULAR = 'El celular no es válido (con 9 dígitos, o con el código de país: +51 987 654 321)';

/** Valida y limpia una persona de una fila. Un correo de relleno (`.invalid`) cuenta como celda vacía: nunca se carga ni se invita. */
export function leerPersona(nombre: unknown, correo: unknown, celular: unknown): DatosPersona {
  const errores: string[] = [];
  const n = normalizarTexto(nombre).slice(0, 120);
  let c = normalizarTexto(correo).toLowerCase();
  if (/\.invalid$/.test(c)) c = '';
  if (c) {
    const r = emailSchema.safeParse(c);
    if (r.success) c = r.data;
    else { errores.push(MENSAJE_CORREO); c = ''; }
  }
  let t = '';
  const crudo = normalizarTexto(celular);
  if (crudo) {
    const e164 = normalizarCelular(crudo);
    if (e164) t = formatearCelular(e164);
    else errores.push(MENSAJE_CELULAR);
  }
  return { nombre: n, correo: c, celular: t, errores };
}

const RELACIONES_TEXTO: Record<string, RelacionFila> = {
  propietario: 'propietario', propietaria: 'propietario', dueno: 'propietario', duena: 'propietario', titular: 'propietario',
  inquilino: 'inquilino', inquilina: 'inquilino', arrendatario: 'inquilino', arrendataria: 'inquilino',
  copropietario: 'copropietario', copropietaria: 'copropietario', 'co propietario': 'copropietario', 'co propietaria': 'copropietario',
  conyuge: 'conyuge', esposo: 'conyuge', esposa: 'conyuge', pareja: 'conyuge', marido: 'conyuge', mujer: 'conyuge',
  familiar: 'familiar', hijo: 'familiar', hija: 'familiar', padre: 'familiar', madre: 'familiar', hermano: 'familiar', hermana: 'familiar', pariente: 'familiar',
  otro: 'otro', otra: 'otro',
};

/** La relación escrita en la celda; `undefined` = no se entiende; `null` = la celda venía vacía. */
export function leerRelacion(v: unknown): RelacionFila | null | undefined {
  const t = normalizarEncabezado(v);
  if (!t) return null;
  return RELACIONES_TEXTO[t];
}

const vacia = (d: DatosPersona) => !d.nombre && !d.correo && !d.celular && !d.errores.length;
const sinDatos = (): DatosPersona => ({ nombre: '', correo: '', celular: '', errores: [] });

/** Abre el Excel y lee sus filas; 422 en español si el archivo no sirve. */
export function leerContactos(buffer: Buffer): LecturaContactos {
  let libro: XLSX.WorkBook;
  try {
    libro = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch {
    throw invalid('El archivo no es un Excel válido (.xlsx o .xls)', { archivo: 'Archivo inválido' });
  }
  if (!libro.SheetNames.length) throw invalid('El archivo no tiene hojas', { archivo: 'Sin hojas' });
  for (const nombre of libro.SheetNames) {
    const hoja = libro.Sheets[nombre];
    if (!hoja) continue;
    const datos = XLSX.utils.sheet_to_json(hoja, { header: 1, blankrows: true, defval: '' }) as unknown[][];
    const cab = buscarCabecera(datos);
    if (!cab) continue;
    const filas: FilaContacto[] = [];
    const extras: FilaExtra[] = [];
    const porPersona = cab.relacion != null;
    // Una fila por unidad en la lectura de siempre; con `Relación`, las personas de una misma unidad se juntan en SU fila de unidad.
    const porUnidad = new Map<string, FilaContacto>();
    let vacias = 0;
    // Con `Relación`, Nombre / Correo / Celular son de la persona de esa fila (sirven las columnas «propietario» o «inquilino» si el archivo las trae así).
    const columna = (persona: Persona, dato: Dato) => cab.persona[persona][dato] ?? (porPersona ? cab.persona[persona === 'propietario' ? 'inquilino' : 'propietario'][dato] : undefined) ?? -1;
    // Con `blankrows: true` el índice del arreglo sigue a las filas de la hoja: la fila del Excel es la primera del rango + el índice + 1.
    const primera = hoja['!ref'] ? XLSX.utils.decode_range(hoja['!ref']).s.r : 0;
    for (let i = cab.fila + 1; i < datos.length; i++) {
      const f = datos[i] ?? [];
      const block = cab.block == null ? '' : normalizarTexto(f[cab.block]);
      const dpto = normalizarTexto(f[cab.dpto]);
      if (block.toUpperCase() === 'TOTALES' || dpto.toUpperCase() === 'TOTALES') continue;
      if (!dpto && !block) { if (f.some((x) => normalizarTexto(x))) vacias++; continue; }
      const nFila = primera + i + 1;
      const p = (persona: Persona) => leerPersona(f[columna(persona, 'nombre')], f[columna(persona, 'correo')], f[columna(persona, 'celular')]);
      if (!porPersona) {
        filas.push({ fila: nFila, block, dpto, propietario: p('propietario'), inquilino: p('inquilino') });
      } else {
        const claveUnidad = `${normalizarEncabezado(block)}|${normalizarEncabezado(dpto)}`;
        let unidad = porUnidad.get(claveUnidad);
        if (!unidad) {
          unidad = { fila: nFila, block, dpto, propietario: sinDatos(), inquilino: sinDatos(), filas: {} };
          porUnidad.set(claveUnidad, unidad);
          filas.push(unidad);
        }
        const datosFila = p('propietario'); // las columnas de la persona de esta fila
        const relacion = leerRelacion(f[cab.relacion!]);
        if (relacion === null && vacia(datosFila)) continue; // la fila vacía de una unidad sin personas: sólo la nombra
        if (relacion === undefined) { extras.push({ fila: nFila, block, dpto, relacion: null, datos: datosFila, error: `La relación «${normalizarTexto(f[cab.relacion!])}» no es válida (propietario, copropietario, cónyuge, familiar, inquilino u otro)` }); }
        else if (relacion === null) { extras.push({ fila: nFila, block, dpto, relacion: null, datos: datosFila, error: 'Falta la relación (propietario, copropietario, cónyuge, familiar, inquilino u otro)' }); }
        else if (relacion === 'propietario' || relacion === 'inquilino') {
          if (unidad.filas![relacion] != null) extras.push({ fila: nFila, block, dpto, relacion: null, datos: datosFila, error: `Hay más de un ${relacion} en este departamento (también en la fila ${unidad.filas![relacion]}); un departamento tiene uno solo. Usa Copropietario, Cónyuge, Familiar u Otro` });
          else { unidad[relacion] = datosFila; unidad.filas![relacion] = nFila; }
        } else extras.push({ fila: nFila, block, dpto, relacion, datos: datosFila });
      }
      if (filas.length + extras.length > MAX_FILAS) throw invalid(`El archivo trae más de ${MAX_FILAS} filas; sube un block a la vez`, { archivo: 'Demasiadas filas' });
    }
    return { filas, extras, por_persona: porPersona, vacias };
  }
  throw invalid('No se encontró la fila de encabezados (Block, Dpto, Propietario, Correo propietario, Celular propietario, Inquilino…). Descarga la plantilla y úsala', { archivo: 'Formato inválido' });
}
