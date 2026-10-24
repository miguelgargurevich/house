// Bucle de herramientas del asistente. Se interpone entre el motor y el proveedor: ofrece al modelo SÓLO las herramientas del rol,
// ejecuta lo que pida en el servidor (revalidando el rol en cada ejecución), le devuelve los resultados y repite hasta que conteste con
// texto. Topes: 4 rondas, 6 consultas distintas por turno y un tiempo total. Las rondas con herramientas no se transmiten; el texto final
// sale por el mismo `Flujo`/`Completa` que usa el motor. Si la ruta no admite herramientas se usa el respaldo determinista (DATOS VERIFICADOS).
import { cooldownDeps } from '../../lib/cooldown';
import { admiteHerramientas, marcarSinHerramientas, sinHerramientas } from '../../lib/modelosSinHerramientas';
import type { AuthUser } from '../../middleware/auth';
import { descriptorDe, ejecutarHerramienta, esquemaParaGemini, herramientasDe } from '../../tools';
import type { Eslabon } from '../rotacion';
import { consultarRespaldo } from './respaldo';
import {
  llamarProveedor, type DefHerramienta, type Flujo, type LlamadaHerramienta, type Llamadas, type OpcionesLlamada, type Salida, type Turno, type Uso,
} from './proveedor';

export const MAX_RONDAS = 4;
export const MAX_CONSULTAS = 6;
/** Tiempo total que puede gastar un turno en rondas de herramientas; `ASISTENTE_HERRAMIENTAS_MS` (3 000–60 000) lo cambia. */
export const TOPE_HERRAMIENTAS_MS = 20_000;
export function topeHerramientasMs(): number {
  const n = Number(process.env.ASISTENTE_HERRAMIENTAS_MS);
  return Number.isInteger(n) && n >= 3_000 && n <= 60_000 ? n : TOPE_HERRAMIENTAS_MS;
}
/** `ASISTENTE_HERRAMIENTAS=off` apaga las herramientas (el asistente vuelve a responder sólo con el contexto fijo). */
export const herramientasActivas = () => process.env.ASISTENTE_HERRAMIENTAS !== 'off';

export type EstadoEvento = 'ejecutando' | 'listo' | 'error';
export interface UsoHerramienta { nombre: string; ms: number; estado: 'ok' | 'error' }

/** Estado de UN turno: quién es, qué herramientas puede usar, lo ya ejecutado y adónde avisar. */
export interface SesionHerramientas {
  usuario: AuthUser;
  defs: DefHerramienta[];
  mensaje: string;
  hasta: number;
  usadas: UsoHerramienta[];
  /** Resultados ya calculados en este turno (por nombre+argumentos): una ruta nueva no repite la consulta ni la cuenta dos veces. */
  cache: Map<string, string>;
  respaldo?: { bloque: string } | null;
  emitir?: (ev: { nombre: string; estado: EstadoEvento }) => void;
}

export function crearSesion(usuario: AuthUser, mensaje: string, emitir?: SesionHerramientas['emitir']): SesionHerramientas | null {
  if (!herramientasActivas()) return null;
  const defs = herramientasDe(usuario).map((h) => {
    const d = descriptorDe(h);
    return { nombre: d.name, descripcion: d.description, esquema: d.inputSchema };
  });
  if (defs.length === 0) return null;
  return { usuario, defs, mensaje, hasta: cooldownDeps.ahora() + topeHerramientasMs(), usadas: [], cache: new Map(), emitir };
}

const sumar = (a: Uso, b: Uso): Uso => ({ entrada: a.entrada === null && b.entrada === null ? null : (a.entrada ?? 0) + (b.entrada ?? 0), salida: a.salida === null && b.salida === null ? null : (a.salida ?? 0) + (b.salida ?? 0) });
const nombreSeguro = (n: string) => (/^[a-z][a-z0-9_]{2,40}$/.test(n) ? n : 'desconocida');

/** Ejecuta las llamadas de una ronda y devuelve los mensajes NATIVOS que el proveedor espera (la llamada del modelo + sus resultados). */
async function ejecutarRonda(gemini: boolean, s: Llamadas, ses: SesionHerramientas): Promise<unknown[]> {
  const resultados: { l: LlamadaHerramienta; contenido: Record<string, unknown> }[] = [];
  for (const l of s.llamadas) {
    const clave = `${l.nombre}|${JSON.stringify(l.args)}`;
    let payload = ses.cache.get(clave);
    if (payload === undefined) {
      if (ses.cache.size >= MAX_CONSULTAS) {
        payload = JSON.stringify({ ok: false, error: `Ya hiciste ${MAX_CONSULTAS} consultas en este turno; responde con lo que tienes y ofrece acotar la pregunta.` });
        ses.usadas.push({ nombre: nombreSeguro(l.nombre), ms: 0, estado: 'error' });
        ses.emitir?.({ nombre: nombreSeguro(l.nombre), estado: 'error' });
      } else {
        ses.emitir?.({ nombre: nombreSeguro(l.nombre), estado: 'ejecutando' });
        // `ejecutarHerramienta` revalida el rol y rechaza lo inventado o de otro rol; aquí no se decide nada.
        const r = await ejecutarHerramienta(ses.usuario, l.nombre, l.args, { origen: 'asistente' });
        ses.usadas.push({ nombre: nombreSeguro(l.nombre), ms: r.ms, estado: r.ok ? 'ok' : 'error' });
        ses.emitir?.({ nombre: nombreSeguro(l.nombre), estado: r.ok ? 'listo' : 'error' });
        payload = JSON.stringify(r.ok ? { ok: true, datos: r.datos } : { ok: false, error: r.mensaje });
        ses.cache.set(clave, payload);
      }
    }
    resultados.push({ l, contenido: JSON.parse(payload) as Record<string, unknown> });
  }
  if (gemini) {
    return [
      s.nativo,
      { role: 'user', parts: resultados.map(({ l, contenido }) => ({ functionResponse: { name: l.nombre, ...(l.id.startsWith('g') ? {} : { id: l.id }), response: contenido } })) },
    ];
  }
  return [s.nativo, ...resultados.map(({ l, contenido }) => ({ role: 'tool', tool_call_id: l.id, content: JSON.stringify(contenido) }))];
}

/** La ruta no admite herramientas: se consulta con el enrutador determinista y se le da el resultado al modelo como datos verificados. */
async function conRespaldo(e: Eslabon, modelo: string, turno: Turno, o: OpcionesLlamada, ses: SesionHerramientas): Promise<Salida> {
  if (ses.respaldo === undefined) {
    const r = await consultarRespaldo(ses.usuario, ses.mensaje);
    ses.respaldo = r ? { bloque: r.bloque } : null;
    for (const u of r?.usadas ?? []) { ses.usadas.push(u); ses.emitir?.({ nombre: u.nombre, estado: u.estado === 'ok' ? 'listo' : 'error' }); }
  }
  const t: Turno = ses.respaldo ? { ...turno, sistema: `${turno.sistema}\n\n${ses.respaldo.bloque}` } : turno;
  return llamarProveedor(e, modelo, t, { ...o, herramientas: undefined });
}

/**
 * Llama a la ruta con el bucle de herramientas. Devuelve lo mismo que `llamarProveedor` (el motor no sabe de herramientas):
 * `Completa`, `Flujo` o `Fallo`. Una ruta que rechaza las herramientas queda marcada (memoria negativa) y ESTA misma llamada se
 * resuelve con el respaldo, para que la persona reciba respuesta; las siguientes consultas ya ni lo intentan.
 */
export async function llamarConHerramientas(e: Eslabon, modelo: string, turno: Turno, o: OpcionesLlamada, ses: SesionHerramientas): Promise<Salida> {
  const gemini = e.proveedor.tipo === 'gemini';
  if (!admiteHerramientas(modelo) || sinHerramientas(e.proveedor.id, modelo)) return conRespaldo(e, modelo, turno, o, ses);

  let continuacion: unknown[] = [];
  let uso: Uso = { entrada: null, salida: null };
  const defs = gemini ? ses.defs.map((d) => ({ ...d, esquema: esquemaParaGemini(d.esquema) as Record<string, unknown> })) : ses.defs;

  for (let ronda = 0; ; ronda++) {
    // Última oportunidad: tope de rondas, de tiempo o de consultas → el modelo debe contestar con lo que ya tiene.
    const forzarTexto = ronda >= MAX_RONDAS || cooldownDeps.ahora() >= ses.hasta;
    // Las rondas siguientes no pueden esperar más allá del tope del turno (más un margen para contestar).
    const esperaMs = ronda === 0 ? o.esperaMs : Math.min(o.esperaMs, Math.max(3_000, ses.hasta - cooldownDeps.ahora() + 5_000));
    const s = await llamarProveedor(e, modelo, turno, { ...o, esperaMs, herramientas: { defs, continuacion, forzarTexto } });

    if (s.tipo === 'fallo') {
      if (s.sinHerramientas) {
        marcarSinHerramientas(e.proveedor.id, modelo);
        console.warn(`[ai-chat] ${e.proveedor.id}|${modelo} no admite herramientas: se usa el respaldo`);
        return conRespaldo(e, modelo, turno, o, ses);
      }
      return s;
    }
    if (s.tipo === 'completa') return { ...s, uso: sumar(uso, s.uso) };
    if (s.tipo === 'flujo') return flujoConHerramientas(s, uso, { e, modelo, turno, o, ses, gemini, defs, continuacion, ronda });
    // El modelo pide herramientas.
    uso = sumar(uso, s.uso);
    if (forzarTexto) {
      // Pidió herramientas aunque se le dijo que no: se usa el texto que haya traído, si lo hay.
      return s.texto.trim() ? { tipo: 'completa', texto: s.texto, uso } : { tipo: 'fallo', status: 200, retryAfterMs: null, claveInvalida: false, modeloNoDisponible: false, sinTexto: true, cancelado: false, tiempoAgotado: false, sinHerramientas: false };
    }
    continuacion = [...continuacion, ...(await ejecutarRonda(gemini, s, ses))];
  }
}

interface EstadoBucle { e: Eslabon; modelo: string; turno: Turno; o: OpcionesLlamada; ses: SesionHerramientas; gemini: boolean; defs: DefHerramienta[]; continuacion: unknown[]; ronda: number }

/**
 * El modelo empezó a contestar con texto (se transmite tal cual). Si al terminar resulta que además pidió herramientas, el resto de la
 * respuesta se completa aquí mismo con más rondas (sin transmitir) y su texto sigue saliendo por el mismo flujo.
 */
function flujoConHerramientas(s: Flujo, usoPrevio: Uso, b: EstadoBucle): Flujo {
  let usoTotal = usoPrevio;
  let cerrado = false;
  const resto = (async function* () {
    yield* s.resto;
    usoTotal = sumar(usoPrevio, s.uso());
    let pedido = s.llamadas?.();
    let continuacion = b.continuacion;
    for (let ronda = b.ronda; pedido && pedido.llamadas.length > 0 && ronda < MAX_RONDAS && !cerrado; ronda++) {
      continuacion = [...continuacion, ...(await ejecutarRonda(b.gemini, { tipo: 'llamadas', llamadas: pedido.llamadas, nativo: pedido.nativo, texto: '', uso: { entrada: null, salida: null } }, b.ses))];
      const forzarTexto = ronda + 1 >= MAX_RONDAS || cooldownDeps.ahora() >= b.ses.hasta;
      const n = await llamarProveedor(b.e, b.modelo, b.turno, { ...b.o, stream: false, herramientas: { defs: b.defs, continuacion, forzarTexto } });
      if (n.tipo === 'fallo') return; // lo ya dicho queda como respuesta
      if (n.tipo === 'flujo') { n.cerrar(); return; } // no se pidió stream: no ocurre
      usoTotal = sumar(usoTotal, n.uso);
      if (n.tipo === 'completa') { yield `\n\n${n.texto}`; return; }
      if (n.texto.trim()) yield `\n\n${n.texto}`;
      pedido = { llamadas: n.llamadas, nativo: n.nativo };
    }
  })();
  return { tipo: 'flujo', primero: s.primero, resto, uso: () => usoTotal, cerrar: () => { cerrado = true; s.cerrar(); } };
}
