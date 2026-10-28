// Motor de respuesta del asistente: recorre RUTAS (clave + modelo) hasta que una conteste. La unidad de rotación no es la clave:
// un 404 de modelo vale para todo el proveedor (cuenta de modelos compartida), no se repite entre consultas, y los intentos
// cuentan por ruta distinta (proveedor + modelo), con un tope de tiempo total. Las claves marcadas como reserva van al final.
import { registrarEstado, limpiar, cooldownDeps } from '../../lib/cooldown';
import type { Esfuerzo, ParametrosGeneracion } from '../../lib/modelosIA';
import { marcarLento, modeloMalo } from '../../lib/modelosMalos';
import { prisma } from '../../db';
import { retirarModelo } from '../modelos/retiro';
import { candidatosDeClave } from '../modelos/seleccion';
import { construirCadena, contarUso, marcarUso, rechazarClave, type Eslabon } from '../rotacion';
import { anotarCausa, notificarResultado, olvidarCausa } from './salud';
import { llamarConHerramientas, type SesionHerramientas } from './herramientas';
import { llamarProveedor, type Fallo, type Salida, type Turno } from './proveedor';
import { sinHerramientas } from '../../lib/modelosSinHerramientas';

/** Rutas distintas (proveedor + modelo) que se prueban como máximo por consulta; `LLAVERO_MAX_INTENTOS` (1–8) lo cambia. */
export const MAX_INTENTOS = 6;
export function maxIntentos(): number {
  const n = Number(process.env.LLAVERO_MAX_INTENTOS);
  return Number.isInteger(n) && n >= 1 && n <= 8 ? n : MAX_INTENTOS;
}
/** Tope de tiempo total por consulta; `LLAVERO_TOPE_MS` (2 000–120 000) lo cambia. */
export const TOPE_TIEMPO_MS = 45_000;
export function topeTiempoMs(): number {
  const n = Number(process.env.LLAVERO_TOPE_MS);
  return Number.isInteger(n) && n >= 2_000 && n <= 120_000 ? n : TOPE_TIEMPO_MS;
}
/**
 * Lo máximo que se espera la PRIMERA respuesta de una ruta antes de pasar a la siguiente; `LLAVERO_ESPERA_MS` (2 000–60 000) lo cambia.
 * Corto a propósito (24-oct, Miguel: «no se debe caer por IA, tengo varias keys»): en producción `gemini-flash-latest` se colgó más de
 * 40 s sin responder y, con una espera de 30 s, se comía todo el tope del turno sin probar las demás claves.
 */
export const ESPERA_LLAMADA_MS = 12_000;
export function esperaLlamadaMs(): number {
  const n = Number(process.env.LLAVERO_ESPERA_MS);
  return Number.isInteger(n) && n >= 2_000 && n <= 60_000 ? n : ESPERA_LLAMADA_MS;
}

/** La reserva tiene su propio margen: si las normales gastaron el tiempo, igual se le da una oportunidad. */
const TIEMPO_RESERVA_MS = 12_000;
const MAX_RUTAS_RESERVA = 2;

export interface Peticion {
  turno: Turno;
  parametros: ParametrosGeneracion;
  esfuerzo: Esfuerzo;
  /** Sólo admin/superadmin: usar ESTE modelo y ningún otro. */
  modeloFijo?: string;
  stream: boolean;
  /** Mensajes cortos prefieren un modelo rápido en Auto. */
  mensajeCorto: boolean;
  signal?: AbortSignal;
  /** Herramientas de consulta de este turno (null/ausente = sin herramientas). El motor sólo las pasa a la ruta; el bucle vive en `herramientas.ts`. */
  herramientas?: SesionHerramientas | null;
}

export interface ExitoMotor {
  tipo: 'ok';
  texto: string;
  proveedor: string;
  modelo: string;
  latencia_ms: number;
  tokens_entrada: number | null;
  tokens_salida: number | null;
  reserva: boolean;
}
export type CausaFallo = 'sin_configurar' | 'saturada' | 'fallo' | 'modelo_fijo' | 'cancelado';
export interface FalloMotor {
  tipo: 'fallo';
  causa: CausaFallo;
  /** Lo que alcanzó a enviarse antes de fallar a mitad del stream. */
  parcial: string;
  proveedor: string | null;
  modelo: string | null;
  latencia_ms: number;
}
export type ResultadoMotor = ExitoMotor | FalloMotor;

type Accion = 'exito' | 'siguiente_modelo' | 'siguiente_clave' | 'probar_gratis' | 'sin_texto' | 'agotado' | 'cancelado' | 'lento';

const esGratisOR = (m: string) => /:free$/i.test(m);

/** Modelo `:free` de la clave (OpenRouter) para cuando uno de pago responde 402. */
async function primerGratis(e: Eslabon, probados: Set<string>): Promise<string | null> {
  const filas = e.claveId === null ? [] : await prisma.modeloIA.findMany({ where: { clave_id: e.claveId, gratis: true, estado: { not: 'deprecado' }, categoria: { not: 'otro' } }, select: { modelo_id: true }, orderBy: { modelo_id: 'asc' } });
  const lista = [...filas.map((f) => f.modelo_id), e.proveedor.modeloPorDefecto].filter(esGratisOR);
  return lista.find((m) => !probados.has(m) && !modeloMalo(e.proveedor.id, m)) ?? null;
}

/**
 * Genera la respuesta. Es un generador: emite los fragmentos de texto (`yield`) y RETORNA el resultado. Si falla antes del primer
 * texto rota sin que el cliente lo note; si falla a mitad devuelve el parcial. Cancelar (`signal`) corta la llamada al proveedor.
 */
export async function* ejecutar(p: Peticion): AsyncGenerator<string, ResultadoMotor, void> {
  const t0 = cooldownDeps.ahora();
  const lat = () => cooldownDeps.ahora() - t0;
  const falla = (causa: CausaFallo, extra: Partial<FalloMotor> = {}): FalloMotor => ({ tipo: 'fallo', causa, parcial: '', proveedor: null, modelo: null, latencia_ms: lat(), ...extra });

  const cadena = await construirCadena();
  if (cadena.length === 0) return falla('sin_configurar');

  let todos429 = true;
  let llamadasTotal = 0;
  const maxR = maxIntentos();
  const ctx = { esfuerzo: p.esfuerzo, mensajeCorto: p.mensajeCorto, modeloFijo: p.modeloFijo };
  /** Rutas (proveedor|modelo) que el PEDIDO rechazó (400 o 413): ninguna otra clave del proveedor las vuelve a probar en esta consulta. */
  const pedidoRechazado = new Set<string>();

  // Dos tandas: las claves normales y, sólo si éstas se agotan, las de reserva (con su propio margen de rutas y de tiempo).
  const tandas = [
    { lista: cadena.filter((e) => !e.reserva), tope: maxR, hasta: t0 + topeTiempoMs() },
    { lista: cadena.filter((e) => e.reserva), tope: MAX_RUTAS_RESERVA, hasta: 0 },
  ];
  for (const tanda of tandas) {
    if (tanda.lista.length === 0) continue;
    if (tanda.hasta === 0) tanda.hasta = Math.max(t0 + topeTiempoMs(), cooldownDeps.ahora() + TIEMPO_RESERVA_MS);
    const rutas = new Set<string>();
    let llamadas = 0;
    const maxL = tanda.tope * 2;
    let agotado = false;

    for (const e of tanda.lista) {
      if (agotado) break;
      if (p.signal?.aborted) return falla('cancelado');
      const { modelos } = await candidatosDeClave({ claveId: e.claveId, proveedor: e.proveedor, modelo: e.fijado }, ctx);
      // Con herramientas, las rutas que ya se supo que no las admiten pasan al final (siguen sirviendo, con el respaldo).
      if (p.herramientas && !p.modeloFijo) modelos.splice(0, modelos.length, ...modelos.filter((m) => !sinHerramientas(e.proveedor.id, m)), ...modelos.filter((m) => sinHerramientas(e.proveedor.id, m)));
      const probados = new Set<string>();
      const id = `${e.proveedor.id}#${e.claveId ?? 'env'}`;

      for (let i = 0; i < modelos.length && !agotado; i++) {
        const modelo = modelos[i];
        const ruta = `${e.proveedor.id}|${modelo}`;
        if (probados.has(modelo) || modeloMalo(e.proveedor.id, modelo) || pedidoRechazado.has(ruta)) continue; // otra clave del proveedor ya la vio caída o rechazó el pedido
        if (!rutas.has(ruta)) {
          if (rutas.size >= tanda.tope) continue;
          rutas.add(ruta);
        }
        probados.add(modelo);
        let opcionales = true;
        let accion: Accion = 'siguiente_clave';

        for (;;) {
          if (llamadas >= maxL || cooldownDeps.ahora() >= tanda.hasta) { accion = 'agotado'; break; }
          llamadas++;
          llamadasTotal++;
          const opciones = {
            parametros: p.parametros, esfuerzo: p.esfuerzo, opcionales, stream: p.stream, signal: p.signal,
            esperaMs: Math.min(esperaLlamadaMs(), tanda.hasta - cooldownDeps.ahora()),
          };
          const s: Salida = p.herramientas ? await llamarConHerramientas(e, modelo, p.turno, opciones, p.herramientas) : await llamarProveedor(e, modelo, p.turno, opciones);

          if (s.tipo !== 'fallo') {
            // ---- Éxito: la clave se limpia y se emite el texto ----
            limpiar(e.cooldownKey);
            olvidarCausa(e.cooldownKey);
            contarUso(e.claveId, 'ok');
            if (e.claveId !== null) await marcarUso(e.claveId);
            const base = { proveedor: e.proveedor.id, modelo, reserva: e.reserva };
            if (s.tipo === 'completa') {
              yield s.texto;
              await notificarResultado(true);
              return { tipo: 'ok', texto: s.texto, ...base, latencia_ms: lat(), tokens_entrada: s.uso.entrada, tokens_salida: s.uso.salida };
            }
            let texto = s.primero;
            try {
              yield s.primero;
              for await (const t of s.resto) { texto += t; yield t; }
            } catch (err) {
              // A mitad del stream ya no se rota: el cliente recibió texto. Se devuelve lo parcial.
              if (p.signal?.aborted) return falla('cancelado', { parcial: texto, ...base });
              registrarEstado(e.cooldownKey, 0);
              contarUso(e.claveId, 'error');
              console.warn(`[ai-chat] ${id} se cortó a mitad de la respuesta (${err instanceof Error ? err.name : 'error'})`);
              return falla('fallo', { parcial: texto, ...base });
            } finally {
              s.cerrar();
            }
            await notificarResultado(true);
            const u = s.uso();
            return { tipo: 'ok', texto, ...base, latencia_ms: lat(), tokens_entrada: u.entrada, tokens_salida: u.salida };
          }

          // ---- Fallo ----
          console.warn(`[ai-chat] ${id} respondió ${s.status}${s.sinTexto ? ' sin texto' : ''}`);
          if (s.cancelado || p.signal?.aborted) return falla('cancelado');
          // 400 por un parámetro que el modelo no admite: UNA vez más, sin los opcionales.
          if (s.status === 400 && !s.claveInvalida && !s.modeloNoDisponible && opcionales) { opcionales = false; continue; }
          // 400 (ya sin opcionales) o 413: el pedido no le sirve a esta ruta, así que otra clave del proveedor no lo aceptaría.
          if (!s.claveInvalida && (s.status === 400 || s.status === 413)) pedidoRechazado.add(ruta);
          accion = await clasificar(e, modelo, s, () => { todos429 = false; });
          break;
        }

        if (accion === 'agotado') { agotado = true; break; }
        if (accion === 'probar_gratis') {
          const gratis = await primerGratis(e, probados);
          if (gratis) { modelos.splice(i + 1, 0, gratis); continue; }
          await rechazarClave(e, 402);
          break;
        }
        if (accion === 'siguiente_modelo') continue;
        if (accion === 'lento') {
          if (i < modelos.length - 1) continue;
          registrarEstado(e.cooldownKey, 0);
          break;
        }
        if (accion === 'sin_texto') { if (i === modelos.length - 1) registrarEstado(e.cooldownKey, 500); continue; }
        break; // siguiente_clave
      }
    }
  }

  if (p.modeloFijo) return falla('modelo_fijo', { modelo: p.modeloFijo });
  const causa: CausaFallo = todos429 && llamadasTotal > 0 ? 'saturada' : 'fallo';
  await notificarResultado(false);
  return falla(causa);
}

/** Decide qué hacer con un fallo y deja anotados el enfriamiento, el rechazo o el retiro del modelo. */
async function clasificar(e: Eslabon, modelo: string, s: Fallo, noTodos429: () => void): Promise<Accion> {
  if (s.modeloNoDisponible) {
    noTodos429();
    contarUso(e.claveId, 'error');
    await retirarModelo(e, modelo); // marca malo para TODO el proveedor y deprecia en la base
    return 'siguiente_modelo';
  }
  if (s.status === 429) {
    registrarEstado(e.cooldownKey, 429, s.retryAfterMs);
    anotarCausa(e.cooldownKey, 'limite', 429);
    contarUso(e.claveId, 'limite');
    return 'siguiente_clave';
  }
  noTodos429();
  contarUso(e.claveId, 'error');
  if (s.status === 402 && e.proveedor.id === 'openrouter' && !esGratisOR(modelo)) return 'probar_gratis'; // el modelo de pago no tiene saldo: antes de rechazar la clave, un :free
  if (s.status === 401 || s.status === 402 || s.status === 403 || s.claveInvalida) {
    await rechazarClave(e, s.claveInvalida ? 401 : s.status);
    if (e.claveId === null) registrarEstado(e.cooldownKey, 500); // el respaldo del entorno no se persiste: sólo se enfría
    return 'siguiente_clave';
  }
  if (s.sinTexto) return 'sin_texto';
  if (s.tiempoAgotado) {
    // No contestó a tiempo: el modelo pasa al final de la fila en todo el proveedor (no se veta) y se prueba el siguiente modelo de esta
    // misma clave; la clave sólo se enfría si ya no le queda otro (ver el bucle).
    marcarLento(e.proveedor.id, modelo);
    anotarCausa(e.cooldownKey, 'caido', null);
    return 'lento';
  }
  // La ruta no acepta la petición (400 aun sin opcionales, o 413 por tamaño): se prueba otra, sin enfriar la clave ni retirar el modelo.
  if (s.status === 400 || s.status === 413) return 'siguiente_modelo';
  registrarEstado(e.cooldownKey, s.status >= 500 ? s.status : s.status === 0 ? 0 : 500);
  anotarCausa(e.cooldownKey, 'caido', s.status || null);
  return 'siguiente_clave';
}
