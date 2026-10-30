import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { invalid } from '../errors';
import { empresaDe, scopeConceptos } from '../lib/scope';
import { DESTINOS, sugerirDestino } from '../services/cierres/destinos';
import { boolQuery, idSchema, texto, textoOpcional, z } from '../validation';

const base = z.object({
  nombre: texto(120),
  descripcion: textoOpcional(500),
  tipo_monto: z.enum(['fijo', 'variable'], { error: 'tipo_monto debe ser fijo o variable' }).optional(),
  activo: z.boolean().optional(),
  empresa_id: idSchema.nullish(),
  /** Adónde va lo que se cobra con este concepto al cerrar el mes; null = sin clasificar. */
  destino: z.enum(DESTINOS, { error: `destino inválido (${DESTINOS.join(', ')})` }).nullish(),
  /** Sólo con destino `proveedor`: quién presta el servicio contratado. */
  proveedor_id: idSchema.nullish(),
});

async function empresa(d: Record<string, unknown>, u: Parameters<typeof empresaDe>[0], crear: boolean, existente?: Record<string, unknown>) {
  let r: Record<string, unknown> = d;
  if (u.rol === 'admin') r = { ...d, empresa_id: empresaDe(u) };
  else if (d.empresa_id != null) await assertRef(prisma.empresaAdministradora, d.empresa_id as number, {}, 'empresa_id');
  else if (crear) throw invalid('Datos inválidos: empresa_id: es obligatorio', { empresa_id: 'Obligatorio' });
  // El proveedor sólo va con el destino «proveedor» y debe ser de la misma empresa; con otro destino se limpia.
  const destino = 'destino' in r ? r.destino : existente?.destino;
  if (destino !== 'proveedor' && (r.proveedor_id != null || 'destino' in r)) r = { ...r, proveedor_id: null };
  else if (r.proveedor_id != null) await assertRef(prisma.proveedor, r.proveedor_id as number, { empresa_id: (r.empresa_id ?? existente?.empresa_id) as number }, 'proveedor_id');
  return r;
}

export const conceptosRouter = crudRouter({
  entidad: 'concepto',
  delegate: prisma.concepto,
  readRoles: ['admin'],
  writeRoles: ['admin'],
  scope: scopeConceptos,
  search: ['nombre', 'descripcion'],
  orderable: ['id', 'nombre', 'tipo_monto'],
  defaultOrder: { nombre: 'asc' },
  filtros: {
    schema: z.object({ activo: boolQuery.optional() }),
    where: (f) => (f.activo !== undefined ? { activo: f.activo } : {}),
  },
  createSchema: base,
  updateSchema: base.partial(),
  include: { proveedor: { select: { id: true, razon_social: true } } },
  prepareCreate: (d, u) => empresa(d, u, true),
  prepareUpdate: (d, u, existing) => empresa(d, u, false, existing),
  // Sin destino, la administración ve una SUGERENCIA por el nombre (nunca se guarda sola).
  format: (items) => items.map((c) => ({ ...c, destino_sugerido: c.destino == null ? sugerirDestino(c.nombre) : null })),
});
