// Salud de la IA del asistente: ¿queda alguna ruta (clave + modelo) sana? Se calcula con lo que ya sabe el servidor
// (claves, enfriamientos, modelos marcados) y se persiste sólo la transición (desde cuándo está caída) para avisar una vez.
import { prisma } from '../../db';
import { claveCooldown, cooldownDeps, enfriandoHasta } from '../../lib/cooldown';
import { modelosMalosVigentes } from '../../lib/modelosMalos';
import { proveedorDeFila } from '../../lib/gateways';
import { proveedorPorId } from '../../lib/proveedoresIA';
import { llaveroConfigurado } from '../../lib/secretBox';
import { encolarAviso, procesarPronto } from '../avisos';
import { candidatosDeClave } from '../modelos/seleccion';
import { ESTADO_RECHAZADA } from '../rotacion';

/** Por qué una clave quedó fuera por ahora. Se anota al fallar para poder explicarlo en la pantalla y en el aviso. */
export type CausaRuta = 'limite' | 'caido' | 'modelo';
const causas = new Map<string, { causa: CausaRuta; status: number | null }>();
export const anotarCausa = (cooldownKey: string, causa: CausaRuta, status: number | null = null) => { causas.set(cooldownKey, { causa, status }); };
export const olvidarCausa = (cooldownKey: string) => { causas.delete(cooldownKey); };
export const olvidarCausas = () => causas.clear();

export type EstadoRuta = 'ok' | 'enfriando' | 'modelo_no_disponible' | 'rechazada' | 'sin_saldo';
export interface RutaSalud {
  proveedor: string;
  modelo: string | null;
  estado: EstadoRuta;
  /** Hasta cuándo (ISO) dura el estado, si se sabe. */
  hasta: string | null;
  reserva: boolean;
  /** Clave a la que pertenece (null = respaldo del entorno). */
  clave_id: number | null;
}
export interface SaludVista {
  /** Hay al menos una clave habilitada (o el respaldo del entorno). Sin eso no hay nada que vigilar. */
  configurada: boolean;
  ok: boolean;
  /** Desde cuándo está caída (ISO), o null si está sana. */
  desde: string | null;
  rutas: RutaSalud[];
  /** «Gemini 404, Groq sin saldo…»; null si está sana. */
  motivo: string | null;
}

const iso = (ms: number) => new Date(ms).toISOString();

async function calcularRutas(): Promise<RutaSalud[]> {
  const rutas: RutaSalud[] = [];
  const ahora = cooldownDeps.ahora();
  const claves = llaveroConfigurado() ? await prisma.claveIntegracion.findMany({ where: { habilitada: true }, orderBy: [{ proveedor: 'asc' }, { id: 'asc' }], include: { gateway: true } }) : [];
  for (const f of claves) {
    const p = proveedorDeFila(f);
    if (!p || (f.gateway && !f.gateway.habilitado)) continue;
    const base = { proveedor: p.id, reserva: f.reserva, clave_id: f.id };
    if (f.estado === ESTADO_RECHAZADA) {
      rutas.push({ ...base, modelo: f.modelo ?? p.modeloPorDefecto, estado: /saldo/i.test(f.estado_detalle ?? '') ? 'sin_saldo' : 'rechazada', hasta: null });
      continue;
    }
    const h = enfriandoHasta(claveCooldown(p.id, f.id), ahora);
    const { modelos } = await candidatosDeClave({ claveId: f.id, proveedor: p, modelo: f.modelo });
    if (h !== null) { rutas.push({ ...base, modelo: modelos[0] ?? p.modeloPorDefecto, estado: 'enfriando', hasta: iso(h) }); continue; }
    if (modelos.length === 0) {
      const malos = modelosMalosVigentes(ahora).filter((m) => m.proveedor === p.id);
      const hasta = malos.length ? Math.min(...malos.map((m) => m.hasta)) : null;
      rutas.push({ ...base, modelo: f.modelo ?? p.modeloPorDefecto, estado: 'modelo_no_disponible', hasta: hasta === null ? null : iso(hasta) });
      continue;
    }
    rutas.push({ ...base, modelo: modelos[0], estado: 'ok', hasta: null });
  }
  if (claves.length === 0 && process.env.GEMINI_API_KEY) {
    const p = proveedorPorId('gemini')!;
    const h = enfriandoHasta(claveCooldown('env', 'gemini'), ahora);
    rutas.push({ proveedor: p.id, modelo: p.modeloPorDefecto, estado: h === null ? 'ok' : 'enfriando', hasta: h === null ? null : iso(h), reserva: false, clave_id: null });
  }
  return rutas;
}

function etiquetaRuta(r: RutaSalud): string {
  const nombre = proveedorPorId(r.proveedor)?.nombre.replace(/^Google /, '') ?? r.proveedor;
  switch (r.estado) {
    case 'modelo_no_disponible': return `${nombre} 404`;
    case 'sin_saldo': return `${nombre} sin saldo`;
    case 'rechazada': return `${nombre} con la clave rechazada`;
    case 'enfriando': return `${nombre} ${causas.get(r.clave_id === null ? claveCooldown('env', 'gemini') : claveCooldown(r.proveedor, r.clave_id))?.causa === 'limite' ? 'en límite de uso' : 'no responde'}`;
    default: return nombre;
  }
}

/** Frase con las causas, sin repetir proveedores iguales. */
export function motivoDe(rutas: RutaSalud[]): string {
  const vistos = new Set<string>();
  for (const r of rutas) if (r.estado !== 'ok') vistos.add(etiquetaRuta(r));
  return [...vistos].join(', ');
}

// ---------- Estado persistido ----------
interface EstadoGuardado { ok: boolean; desde: string | null; motivo: string | null; aviso_at: string | null; aviso_motivo: string | null }
const CLAVE_ESTADO = 'salud';
const SIN_ALERTA = 6 * 3_600_000;
const SEPARACION_MIN = 3_600_000;

async function leerEstado(): Promise<EstadoGuardado> {
  const f = await prisma.estadoIA.findUnique({ where: { clave: CLAVE_ESTADO } });
  const v = (f?.valor ?? null) as Partial<EstadoGuardado> | null;
  return { ok: v?.ok ?? true, desde: v?.desde ?? null, motivo: v?.motivo ?? null, aviso_at: v?.aviso_at ?? null, aviso_motivo: v?.aviso_motivo ?? null };
}
const guardarEstado = (v: EstadoGuardado) => prisma.estadoIA.upsert({ where: { clave: CLAVE_ESTADO }, create: { clave: CLAVE_ESTADO, valor: { ...v } }, update: { valor: { ...v } } });

/** Estado para la pantalla: se calcula al momento; `desde` es el de la caída vigente (persistido). */
export async function saludActual(): Promise<SaludVista> {
  const rutas = await calcularRutas();
  const configurada = rutas.length > 0;
  const guardado = await leerEstado();
  // Vencido un enfriamiento una ruta vuelve a verse «ok», pero eso no prueba que el proveedor se recuperó: mientras haya una caída
  // registrada, la salud sigue en rojo hasta que una consulta (o el canary) lo confirme.
  const ok = rutas.some((r) => r.estado === 'ok') && (guardado.ok || !configurada);
  if (ok || !configurada) return { configurada, ok, desde: null, rutas, motivo: null };
  const motivo = rutas.some((r) => r.estado === 'ok') ? guardado.motivo : motivoDe(rutas);
  return { configurada, ok, desde: guardado.ok ? null : guardado.desde, rutas, motivo };
}

const horaLima = (ms: number) => new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima' }).format(new Date(ms));

async function avisar(tipo: 'ia_caida' | 'ia_restablecida', texto: string): Promise<void> {
  const ahora = cooldownDeps.ahora();
  const superadmins = await prisma.usuario.findMany({ where: { rol: 'superadmin' }, select: { id: true } });
  // El `id` de la referencia (minutos desde 1970) distingue cada aviso; la separación de 6 h la controla `actualizarSalud`.
  for (const u of superadmins) await encolarAviso(tipo, u.id, { entidad: 'ia', id: Math.floor(ahora / 60_000) }, { ahora: new Date(ahora), motivo: texto });
  procesarPronto();
}

/**
 * Recalcula la salud y persiste la transición. Caída → un aviso al superadmin (no más de 1 cada 6 h por el mismo estado);
 * recuperación → un aviso de «IA restablecida». Sin claves configuradas no hay nada que avisar.
 */
export async function actualizarSalud(): Promise<SaludVista> {
  const rutas = await calcularRutas();
  const configurada = rutas.length > 0;
  const ok = rutas.some((r) => r.estado === 'ok');
  const previo = await leerEstado();
  const ahora = cooldownDeps.ahora();
  if (!configurada) return { configurada, ok, desde: null, rutas, motivo: null };

  if (!ok) {
    const motivo = motivoDe(rutas);
    const desde = previo.ok ? iso(ahora) : previo.desde ?? iso(ahora);
    const ultimo = previo.aviso_at ? Date.parse(previo.aviso_at) : null;
    const mismoEstado = previo.aviso_motivo === motivo;
    const toca = ultimo === null || (mismoEstado ? ahora - ultimo >= SIN_ALERTA : ahora - ultimo >= SEPARACION_MIN);
    let avisoAt = previo.aviso_at;
    let avisoMotivo = previo.aviso_motivo;
    if (toca) {
      await avisar('ia_caida', `Sin IA disponible desde las ${horaLima(Date.parse(desde))}: ${motivo}.`);
      avisoAt = iso(ahora);
      avisoMotivo = motivo;
    }
    await guardarEstado({ ok: false, desde, motivo, aviso_at: avisoAt, aviso_motivo: avisoMotivo });
    return { configurada, ok, desde, rutas, motivo };
  }

  if (!previo.ok) {
    await guardarEstado({ ok: true, desde: null, motivo: null, aviso_at: null, aviso_motivo: null });
    if (previo.aviso_at) await avisar('ia_restablecida', `La IA del asistente se restableció. Estuvo sin servicio desde las ${horaLima(Date.parse(previo.desde ?? previo.aviso_at))}.`);
  }
  return { configurada, ok, desde: null, rutas, motivo: null };
}

let sanaEnMemoria: boolean | null = null;
export const olvidarSaludEnMemoria = () => { sanaEnMemoria = null; };

/** Lo llama el motor tras cada consulta. El camino feliz (ya sana) no toca la base. */
export async function notificarResultado(ok: boolean): Promise<void> {
  try {
    if (ok && sanaEnMemoria === true) return;
    const v = await actualizarSalud();
    sanaEnMemoria = v.ok;
  } catch (err) {
    console.error('[asistente] no se pudo actualizar la salud de la IA', err instanceof Error ? err.name : 'error');
  }
}
