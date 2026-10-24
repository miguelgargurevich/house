// Elección del modelo de una clave. Los candidatos salen del catálogo vivo (`ModeloIA`); sin lista viva se usa el `modeloPorDefecto`.
import { prisma } from '../../db';
import { modeloMalo } from '../../lib/modelosMalos';
import { esInestable, indicePreferencia, type Categoria, type Esfuerzo } from '../../lib/modelosIA';
import type { ProveedorIA } from '../../lib/proveedoresIA';

/** Modelos que se prueban como máximo por clave en una consulta. */
export const MAX_MODELOS_POR_CLAVE = 2;
/** Mensajes más cortos que esto se consideran «cortos»: en Auto prefieren un modelo rápido. */
export const MENSAJE_CORTO = 60;

export interface ClaveParaModelo {
  claveId: number | null; // null = respaldo del entorno (sin lista viva)
  proveedor: ProveedorIA;
  /** Modelo que fijó el admin en la clave. */
  modelo: string | null;
}

export interface ContextoModelo {
  esfuerzo?: Esfuerzo;
  mensajeCorto?: boolean;
  /** Modelo pedido por el usuario (admin/superadmin): si la clave no lo tiene activo, no aporta candidatos. */
  modeloFijo?: string;
}

interface Fila { modelo_id: string; categoria: string; estado: string; gratis: boolean; nombre: string | null }

/** Categorías preferidas según la petición; `null` = sin preferencia (manda la lista de preferencia del proveedor). */
function categoriasPreferidas(ctx: ContextoModelo): Categoria[] | null {
  if (ctx.esfuerzo === 'high') return ['razonamiento', 'avanzado'];
  if (ctx.esfuerzo === 'low' || ctx.mensajeCorto) return ['rapido', 'equilibrado'];
  return null;
}

/** Ordena los modelos activos: categoría pedida primero (si existe alguno), luego preferencia del proveedor, estables antes que preview. */
export function ordenarActivos(proveedor: string, activos: Fila[], ctx: ContextoModelo): string[] {
  let pool = activos;
  const cats = categoriasPreferidas(ctx);
  if (cats) {
    const delasCats = activos.filter((m) => cats.includes(m.categoria as Categoria));
    if (delasCats.length) pool = delasCats;
  }
  const rango = (m: Fila) => (cats ? Math.max(0, cats.indexOf(m.categoria as Categoria)) : 0);
  return [...pool]
    .sort((a, b) =>
      rango(a) - rango(b)
      || Number(esInestable(a.modelo_id)) - Number(esInestable(b.modelo_id))
      || indicePreferencia(proveedor, a.modelo_id) - indicePreferencia(proveedor, b.modelo_id)
      || a.modelo_id.localeCompare(b.modelo_id))
    .map((m) => m.modelo_id);
}

export interface Candidatos { modelos: string[]; viva: boolean }

/**
 * Modelos a probar con esta clave, en orden (máx. `MAX_MODELOS_POR_CLAVE`). Se saltan los marcados como malos para el proveedor.
 * `viva` indica si hay catálogo sincronizado. El `modelo` fijado por el admin manda mientras siga activo; si está deprecado se ignora.
 */
export async function candidatosDeClave(clave: ClaveParaModelo, ctx: ContextoModelo = {}): Promise<Candidatos> {
  const p = clave.proveedor;
  const filas: Fila[] = clave.claveId === null ? [] : await prisma.modeloIA.findMany({ where: { clave_id: clave.claveId }, select: { modelo_id: true, categoria: true, estado: true, gratis: true, nombre: true } });
  const elegibles = filas.filter((f) => f.estado !== 'deprecado' && f.categoria !== 'otro');
  const buenos = (ids: string[]) => ids.filter((id) => !modeloMalo(p.id, id));

  if (ctx.modeloFijo) {
    const f = elegibles.find((m) => m.modelo_id === ctx.modeloFijo);
    return { modelos: f ? buenos([f.modelo_id]) : [], viva: filas.length > 0 };
  }

  const pinFila = clave.modelo ? filas.find((m) => m.modelo_id === clave.modelo) : undefined;
  const pinVigente = clave.modelo && pinFila?.estado !== 'deprecado' ? clave.modelo : null;

  if (filas.length === 0) {
    // Sin lista viva: el fijado o, si no, el del catálogo.
    return { modelos: buenos([pinVigente ?? p.modeloPorDefecto]), viva: false };
  }

  // OpenRouter: sólo gratuitos salvo que el admin haya fijado otro modelo.
  const activos = elegibles.filter((m) => !modeloMalo(p.id, m.modelo_id) && (p.id !== 'openrouter' || m.gratis));
  const auto = ordenarActivos(p.id, activos, ctx);
  const lista: string[] = [];
  if (pinVigente && !modeloMalo(p.id, pinVigente)) lista.push(pinVigente);
  for (const id of auto) if (!lista.includes(id)) lista.push(id);
  return { modelos: lista.slice(0, MAX_MODELOS_POR_CLAVE), viva: true };
}

/** El modelo que usaría el modo Auto con esta clave (o el `modeloPorDefecto` si no hay lista viva ni candidatos). */
export async function elegirModeloAuto(clave: ClaveParaModelo, ctx: ContextoModelo = {}): Promise<string> {
  const c = await candidatosDeClave(clave, ctx);
  return c.modelos[0] ?? clave.proveedor.modeloPorDefecto;
}

/** Modelos elegibles (activos y de chat) de una clave, para el selector. */
export function modelosElegibles(claveId: number) {
  return prisma.modeloIA.findMany({ where: { clave_id: claveId, estado: { not: 'deprecado' }, categoria: { not: 'otro' } }, orderBy: [{ categoria: 'asc' }, { modelo_id: 'asc' }] });
}
