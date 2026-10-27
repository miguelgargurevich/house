// Catálogo único de herramientas de SOLO LECTURA y su ejecutor. Lo consumen el asistente (tool-calling) y el endpoint MCP:
// el mismo catálogo, la misma revalidación de rol en CADA ejecución, la misma auditoría y el mismo filtro de campos prohibidos.
import type { Prisma } from '@prisma/client';
import { HttpError } from '../errors';
import { cooldownDeps } from '../lib/cooldown';
import { registrarAuditoria } from '../middleware/audit';
import type { AuthUser } from '../middleware/auth';
import { z } from '../validation';
import { ContactoInstitucional, HERRAMIENTAS_CON_CONTACTO_INSTITUCIONAL, MAX_FILAS, puedeUsar, type Herramienta } from './base';
import { HERRAMIENTAS_GESTION } from './gestion';
import { HERRAMIENTAS_INSTITUCIONAL } from './institucional';
import { HERRAMIENTAS_PERSONAS } from './personas';
import { HERRAMIENTAS_PAGO } from './estadoPago';
import { HERRAMIENTAS_RESIDENTE } from './residente';
import { HERRAMIENTAS_SUPERADMIN } from './superadmin';

export { MAX_FILAS };
export type Origen = 'asistente' | 'mcp';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- el catálogo mezcla esquemas distintos; cada una se valida con el suyo
export type HerramientaAny = Herramienta<any>;
export const CATALOGO: readonly HerramientaAny[] = [...HERRAMIENTAS_GESTION, ...HERRAMIENTAS_RESIDENTE, ...HERRAMIENTAS_PERSONAS, ...HERRAMIENTAS_PAGO, ...HERRAMIENTAS_INSTITUCIONAL, ...HERRAMIENTAS_SUPERADMIN];
const porNombre = new Map(CATALOGO.map((h) => [h.nombre, h]));
if (porNombre.size !== CATALOGO.length) throw new Error('Hay herramientas con el mismo nombre');

/** Sólo las herramientas que el rol (o el cargo de junta) de esta persona puede usar. */
export const herramientasDe = (u: AuthUser): HerramientaAny[] => CATALOGO.filter((h) => puedeUsar(h, u));
export const buscarHerramienta = (nombre: string): HerramientaAny | undefined => porNombre.get(nombre);

// ---------- Descripción para los clientes (JSON Schema) ----------
export interface DescriptorHerramienta { name: string; description: string; inputSchema: Record<string, unknown> }
type Json = Record<string, unknown>;

/** JSON Schema de la entrada, sin `$schema` (lo piden así tanto MCP como los proveedores). */
function esquemaDe(h: HerramientaAny): Json {
  const esquema = z.toJSONSchema(h.entrada, { io: 'input', target: 'draft-7' }) as Json;
  delete esquema.$schema;
  return esquema;
}
export const descriptorDe = (h: HerramientaAny): DescriptorHerramienta => ({ name: h.nombre, description: h.descripcion, inputSchema: esquemaDe(h) });

const SOPORTADO_GEMINI = new Set(['type', 'description', 'enum', 'properties', 'required', 'items', 'minimum', 'maximum']);
/** Gemini sólo entiende un subconjunto de OpenAPI: se descartan `additionalProperties`, `pattern`, `default`, etc. y las uniones pasan a texto. */
export function esquemaParaGemini(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(esquemaParaGemini);
  if (!s || typeof s !== 'object') return s;
  const o = s as Json;
  if (Array.isArray(o.anyOf) || Array.isArray(o.oneOf)) return { type: 'string', ...(typeof o.description === 'string' ? { description: o.description } : {}) };
  const out: Json = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === 'properties' && v && typeof v === 'object') out[k] = Object.fromEntries(Object.entries(v as Json).map(([n, p]) => [n, esquemaParaGemini(p)]));
    else if (SOPORTADO_GEMINI.has(k)) out[k] = k === 'items' ? esquemaParaGemini(v) : v;
  }
  return out;
}

// ---------- Salida segura ----------
/** Campos que NUNCA salen, venga lo que venga del esquema o de una herramienta futura. `celular`, `numero_cuenta` y `cci` sólo viajan en los medios de pago. */
const CLAVE_PROHIBIDA = /^(e?mail|correo|telefono|tel|whatsapp|dni|documento|doc_numero|password|contrasena|hash|token|api_?key|clave|secret|secreto|bytes|datos_qr|qr_datos|comprobante_datos|ip)(_.*)?$/i;
const CORREO = /[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/gi;

/**
 * Quita campos prohibidos y correos escritos dentro de un texto. Devuelve cuántas cosas quitó (los tests exigen 0 en el catálogo actual).
 * Única excepción: un `ContactoInstitucional` (correo/teléfono de una empresa) sale sólo si `herramienta` está en la lista blanca; si no, se quita.
 * Un campo `correo`/`telefono` suelto sigue quitándose siempre, también en esas herramientas.
 */
export function depurar(valor: unknown, cuenta = { n: 0 }, herramienta?: string): { valor: unknown; quitados: number } {
  const contactoPermitido = herramienta !== undefined && HERRAMIENTAS_CON_CONTACTO_INSTITUCIONAL.has(herramienta);
  const ir = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const t = v.replace(CORREO, () => { cuenta.n++; return '[correo omitido]'; });
      return t;
    }
    if (v instanceof ContactoInstitucional) {
      if (!contactoPermitido) { cuenta.n++; return '[contacto omitido]'; }
      return Object.fromEntries(Object.entries(v.salida()).map(([k, x]) => [k, k === 'correo' || k === 'telefono' ? x : ir(x)]));
    }
    if (Array.isArray(v)) return v.map(ir);
    if (v && typeof v === 'object') {
      const out: Json = {};
      for (const [k, x] of Object.entries(v)) {
        if (CLAVE_PROHIBIDA.test(k)) { cuenta.n++; continue; }
        out[k] = ir(x);
      }
      return out;
    }
    return v;
  };
  return { valor: ir(valor), quitados: cuenta.n };
}

/** Recorta las listas (la más larga primero; `filas` marca `hay_mas`) hasta que el JSON quepa en `maxCaracteres`; marca `truncado`. Los totales y demás campos sueltos se conservan. */
export function acotar(datos: Json, maxCaracteres: number, desde = 0): Json {
  if (JSON.stringify(datos).length <= maxCaracteres) return datos;
  const copia: Json = { ...datos, truncado: true };
  for (;;) {
    const s = JSON.stringify(copia);
    if (s.length <= maxCaracteres) return copia;
    const mayor = Object.entries(copia).filter((e): e is [string, unknown[]] => Array.isArray(e[1]) && e[1].length > 1).sort((x, y) => JSON.stringify(y[1]).length - JSON.stringify(x[1]).length)[0];
    if (!mayor) return { moneda: datos.moneda, aviso: datos.aviso, truncado: true, nota: 'El resultado era demasiado grande; acota la consulta con filtros o un `limite` menor.' };
    copia[mayor[0]] = mayor[1].slice(0, Math.max(1, Math.floor(mayor[1].length / 2)));
    if (mayor[0] === 'filas') {
      copia.hay_mas = true;
      // El cursor apunta a lo que SÍ se entregó, no a las filas recortadas: seguir paginando no pierde ninguna.
      if ('siguiente_cursor' in datos) copia.siguiente_cursor = `o${desde + (copia.filas as unknown[]).length}`;
    }
  }
}

// ---------- Ejecución ----------
export type ResultadoHerramienta =
  | { ok: true; datos: Json; filas: number | null; ms: number }
  | { ok: false; codigo: 'desconocida' | 'sin_permiso' | 'entrada_invalida' | 'error'; mensaje: string; ms: number };

const SENSIBLE = /pass|token|secret|clave|key|hash|authorization/i;
/** Argumentos para la auditoría: sin campos sensibles y con los textos acotados. */
function argumentosAuditables(e: unknown): Prisma.InputJsonValue {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(e).slice(0, 12)) {
    if (SENSIBLE.test(k)) out[k] = '[omitido]';
    else if (typeof v === 'string') out[k] = v.slice(0, 40);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

export interface OpcionesEjecucion { origen: Origen; maxCaracteres?: number }
const MAX_CARACTERES = { asistente: 12_000, mcp: 60_000 } as const;

/**
 * Ejecuta una herramienta POR NOMBRE para este usuario. Aquí, y no antes, se decide si puede: el rol se revalida en cada llamada, una
 * herramienta inventada o de otro rol no existe, la entrada pasa por zod estricto y la salida por `depurar` y `acotar`. Nunca lanza.
 * Cada llamada queda en la auditoría (herramienta, origen, argumentos sin datos sensibles, filas, tiempo).
 */
export async function ejecutarHerramienta(u: AuthUser, nombre: string, entradaCruda: unknown, opts: OpcionesEjecucion): Promise<ResultadoHerramienta> {
  const t0 = cooldownDeps.ahora();
  const ms = () => cooldownDeps.ahora() - t0;
  const auditar = (estado: string, filas: number | null) =>
    registrarAuditoria({
      usuario_id: u.id, accion: 'consultar', entidad: 'herramienta',
      detalle: { herramienta: nombre.slice(0, 40), origen: opts.origen, estado, filas, ms: ms(), argumentos: argumentosAuditables(entradaCruda) },
    });
  const h = porNombre.get(nombre);
  if (!h || !puedeUsar(h, u)) {
    // Mismo mensaje para «no existe» y «no es de tu rol»: no se revela el catálogo de otros roles.
    await auditar(h ? 'sin_permiso' : 'desconocida', null);
    return { ok: false, codigo: h ? 'sin_permiso' : 'desconocida', mensaje: `No existe la herramienta «${nombre.slice(0, 40)}» para tu perfil.`, ms: ms() };
  }
  const entrada = h.entrada.safeParse(entradaCruda ?? {});
  if (!entrada.success) {
    await auditar('entrada_invalida', null);
    const detalle = entrada.error.issues.slice(0, 5).map((i: { path: PropertyKey[]; message: string }) => `${i.path.map(String).join('.') || 'entrada'}: ${i.message}`).join('; ');
    return { ok: false, codigo: 'entrada_invalida', mensaje: `Argumentos inválidos: ${detalle}`, ms: ms() };
  }
  try {
    const bruto = await h.ejecutar(u, entrada.data);
    const { valor } = depurar(bruto, undefined, nombre);
    const desde = typeof (entrada.data as { cursor?: unknown }).cursor === 'string' ? Number(/^o(\d+)$/.exec((entrada.data as { cursor: string }).cursor)?.[1] ?? 0) : 0;
    const datos = acotar(valor as Json, opts.maxCaracteres ?? MAX_CARACTERES[opts.origen], desde);
    const filas = Array.isArray(datos.filas) ? datos.filas.length : null;
    await auditar('ok', filas);
    return { ok: true, datos, filas, ms: ms() };
  } catch (err) {
    await auditar('error', null);
    if (err instanceof HttpError && err.status < 500) return { ok: false, codigo: err.status === 403 ? 'sin_permiso' : 'error', mensaje: err.message, ms: ms() };
    console.error(`[herramientas] ${nombre} falló (${err instanceof Error ? err.name : 'error'})`);
    return { ok: false, codigo: 'error', mensaje: 'No se pudo consultar ese dato ahora. Inténtalo de nuevo.', ms: ms() };
  }
}
