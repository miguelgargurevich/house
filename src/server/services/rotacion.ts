import { prisma } from '../db';
import { claveCooldown, cooldownDeps, estaEnfriando } from '../lib/cooldown';
import { PROVEEDORES_IA, proveedorPorId, type ProveedorIA } from '../lib/proveedoresIA';
import { aadClave, descifrar, llaveroConfigurado } from '../lib/secretBox';

/** Un intento posible: una clave concreta de un proveedor. La clave va descifrada sólo en memoria; jamás se loguea. */
export interface Eslabon {
  cooldownKey: string;
  claveId: number | null; // null = respaldo del entorno
  proveedor: ProveedorIA;
  clave: string;
  /** Modelo efectivo: el fijado en la clave o, si no, el del catálogo. */
  modelo: string;
  /** Modelo que fijó el admin en la clave (null = elección automática). */
  fijado: string | null;
  /** Proveedor «de reserva»: sólo se usa cuando las rutas normales están agotadas. */
  reserva: boolean;
}

export const ESTADO_RECHAZADA = 'rechazada';

/**
 * Cadena de rotación: todas las claves habilitadas y no rechazadas, por prioridad del proveedor y, dentro de uno,
 * la menos usada primero (nulos primero). Las enfriadas van al final pero NUNCA se descartan; las marcadas como reserva van después de todas las normales. Si el llavero no tiene
 * ninguna usable, el último (único) eslabón es GEMINI_API_KEY del entorno.
 */
export async function construirCadena(ahora = cooldownDeps.ahora()): Promise<Eslabon[]> {
  const eslabones: Eslabon[] = [];
  if (llaveroConfigurado()) {
    const filas = await prisma.claveIntegracion.findMany({ where: { habilitada: true, estado: { not: ESTADO_RECHAZADA } } });
    const conProveedor = filas.flatMap((f) => { const p = proveedorPorId(f.proveedor); return p ? [{ f, p }] : []; });
    conProveedor.sort((a, b) =>
      Number(a.f.reserva) - Number(b.f.reserva) // las de reserva, al final
      || a.p.prioridad - b.p.prioridad
      || (a.f.ultimo_uso_at?.getTime() ?? -Infinity) - (b.f.ultimo_uso_at?.getTime() ?? -Infinity)
      || a.f.id - b.f.id);
    for (const { f, p } of conProveedor) {
      let clave: string;
      try {
        clave = descifrar(f.api_key_enc, aadClave(f.proveedor, f.etiqueta));
      } catch {
        console.error(`[llavero] no se pudo descifrar la clave ${p.id}#${f.id}`);
        continue;
      }
      eslabones.push({ cooldownKey: claveCooldown(p.id, f.id), claveId: f.id, proveedor: p, clave, modelo: f.modelo || p.modeloPorDefecto, fijado: f.modelo, reserva: f.reserva });
    }
  }
  if (eslabones.length === 0 && process.env.GEMINI_API_KEY) {
    const gemini = PROVEEDORES_IA.find((p) => p.id === 'gemini')!;
    eslabones.push({ cooldownKey: claveCooldown('env', 'gemini'), claveId: null, proveedor: gemini, clave: process.env.GEMINI_API_KEY, modelo: gemini.modeloPorDefecto, fijado: null, reserva: false });
  }
  // Normales primero (libres y luego enfriadas); la reserva siempre al final, pero también «libres» antes que «enfriadas».
  const orden = (lista: Eslabon[]) => [...lista.filter((e) => !estaEnfriando(e.cooldownKey, ahora)), ...lista.filter((e) => estaEnfriando(e.cooldownKey, ahora))];
  return [...orden(eslabones.filter((e) => !e.reserva)), ...orden(eslabones.filter((e) => e.reserva))];
}

/** Eslabón de una fila del llavero (con la clave descifrada sólo en memoria); null si no se puede descifrar. */
export function eslabonDeFila(f: { id: number; proveedor: string; etiqueta: string; api_key_enc: string; modelo: string | null; reserva: boolean }): Eslabon | null {
  const p = proveedorPorId(f.proveedor);
  if (!p) return null;
  try {
    const clave = descifrar(f.api_key_enc, aadClave(f.proveedor, f.etiqueta));
    return { cooldownKey: claveCooldown(p.id, f.id), claveId: f.id, proveedor: p, clave, modelo: f.modelo || p.modeloPorDefecto, fijado: f.modelo, reserva: f.reserva };
  } catch {
    console.error(`[llavero] no se pudo descifrar la clave ${p.id}#${f.id}`);
    return null;
  }
}

export const marcarUso = (claveId: number) =>
  prisma.claveIntegracion.update({ where: { id: claveId }, data: { ultimo_uso_at: new Date() }, select: { id: true } }).catch(() => undefined);

/** La clave dejó de servir (401/402/403): se persiste y no vuelve a usarse hasta que se pruebe bien o se reemplace. */
export async function rechazarClave(e: Eslabon, status: number): Promise<void> {
  console.warn(`[llavero] clave ${e.proveedor.id}#${e.claveId ?? 'env'} rechazada`);
  if (e.claveId === null) return;
  const detalle = status === 402 ? 'La cuenta no tiene saldo' : 'La clave fue rechazada';
  await prisma.claveIntegracion.update({ where: { id: e.claveId }, data: { estado: ESTADO_RECHAZADA, estado_detalle: detalle, probada_at: new Date() }, select: { id: true } }).catch(() => undefined);
}

// Contadores de uso por clave: en memoria, desde el arranque.
export interface UsoClave { ok: number; limite: number; error: number }
const usos = new Map<number, UsoClave>();

export function contarUso(claveId: number | null, tipo: keyof UsoClave): void {
  if (claveId === null) return;
  const u = usos.get(claveId) ?? { ok: 0, limite: 0, error: 0 };
  u[tipo]++;
  usos.set(claveId, u);
}
export const usoDe = (claveId: number): UsoClave => ({ ...(usos.get(claveId) ?? { ok: 0, limite: 0, error: 0 }) });
export const olvidarUso = (claveId: number) => { usos.delete(claveId); };
export const olvidarTodoUso = () => usos.clear();

export const ordenProveedores = () => [...PROVEEDORES_IA].sort((a, b) => a.prioridad - b.prioridad).map((p) => p.id);
