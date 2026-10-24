// Lo que el Llavero muestra por clave más allá de la clave misma: modelo en uso, conteo de modelos, última sincronización,
// cambios recientes (nuevos, retirados, reactivados), consultas recientes del asistente (sin contenido) y la salud de la IA.
import { prisma } from '../../db';
import { proveedorPorId } from '../../lib/proveedoresIA';
import { elegirModeloAuto } from '../modelos/seleccion';
import { listar } from '../llavero';
import { saludActual } from './salud';

export const CONSULTAS_RECIENTES = 20;
const CAMBIOS_RECIENTES = 15;

interface DetalleSync { nuevos?: string[]; deprecados?: string[]; revividos?: string[]; origen?: string }

export async function datosExtraLlavero(claves: Awaited<ReturnType<typeof listar>>) {
  const ids = claves.map((c) => c.id);
  const [conteos, ultimas, historial, consultas, salud] = await Promise.all([
    prisma.modeloIA.groupBy({ by: ['clave_id', 'estado'], where: { clave_id: { in: ids }, categoria: { not: 'otro' } }, _count: { _all: true } }),
    prisma.syncModelosIA.findMany({ where: { clave_id: { in: ids } }, orderBy: { id: 'desc' }, take: Math.max(20, ids.length * 3) }),
    prisma.syncModelosIA.findMany({ where: { clave_id: { in: ids }, ok: true, OR: [{ nuevos: { gt: 0 } }, { deprecados: { gt: 0 } }, { revividos: { gt: 0 } }] }, orderBy: { id: 'desc' }, take: 12, include: { clave: { select: { proveedor: true, etiqueta: true } } } }),
    // Sólo metadatos de las respuestas del asistente: jamás el contenido de la conversación.
    prisma.mensajeIA.findMany({ where: { rol: 'assistant' }, orderBy: { id: 'desc' }, take: CONSULTAS_RECIENTES, select: { id: true, proveedor: true, modelo: true, estado: true, latencia_ms: true, modo: true, error_codigo: true, tokens_entrada: true, tokens_salida: true, created_at: true } }),
    saludActual(),
  ]);

  // `activo` y `nuevo` cuentan como activos (los de categoría «otro» no son de chat y no se cuentan).
  const sumaActivos = new Map<number, number>();
  const deprecados = new Map<number, number>();
  for (const c of conteos) {
    const mapa = c.estado === 'deprecado' ? deprecados : sumaActivos;
    mapa.set(c.clave_id, (mapa.get(c.clave_id) ?? 0) + c._count._all);
  }

  const porClave = await Promise.all(claves.map(async (c) => {
    const p = proveedorPorId(c.proveedor);
    const ultima = ultimas.find((u) => u.clave_id === c.id) ?? null;
    return [c.id, {
      modelo_en_uso: p ? await elegirModeloAuto({ claveId: c.id, proveedor: p, modelo: c.modelo }, { esfuerzo: 'medium' }) : c.modelo,
      modelos_activos: sumaActivos.get(c.id) ?? 0,
      modelos_deprecados: deprecados.get(c.id) ?? 0,
      ultima_sync: ultima ? { at: ultima.created_at.toISOString(), ok: ultima.ok, nuevos: ultima.nuevos, deprecados: ultima.deprecados, revividos: ultima.revividos, error: ultima.error } : null,
    }] as const;
  }));

  const cambios = historial.flatMap((h) => {
    const d = (h.detalle ?? {}) as DetalleSync;
    const base = { fecha: h.created_at.toISOString(), proveedor: h.clave.proveedor, etiqueta: h.clave.etiqueta, origen: d.origen === 'chat' ? 'chat' : 'sincronización' };
    return [
      ...(d.nuevos ?? []).map((modelo) => ({ ...base, tipo: 'nuevo' as const, modelo })),
      ...(d.deprecados ?? []).map((modelo) => ({ ...base, tipo: 'retirado' as const, modelo })),
      ...(d.revividos ?? []).map((modelo) => ({ ...base, tipo: 'reactivado' as const, modelo })),
    ];
  }).slice(0, CAMBIOS_RECIENTES);

  return {
    porClave: new Map(porClave),
    cambios_recientes: cambios,
    consultas_recientes: consultas.map((m) => ({ id: m.id, proveedor: m.proveedor, modelo: m.modelo, estado: m.estado, modo: m.modo, error_codigo: m.error_codigo, latencia_ms: m.latencia_ms, tokens_entrada: m.tokens_entrada, tokens_salida: m.tokens_salida, at: m.created_at.toISOString() })),
    salud,
  };
}
