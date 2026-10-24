import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { invalid } from '../errors';
import { scopeConceptos, scopeRecibosEscritura, scopeReciboConceptos, scopeReciboConceptosEscritura } from '../lib/scope';
import type { AuthUser } from '../middleware/auth';
import { idSchema, montoSchema, z } from '../validation';

const base = z.object({
  recibo_id: idSchema,
  concepto_id: idSchema,
  monto: montoSchema,
  es_recargo: z.boolean().optional(),
  orden: z.number().int().min(0).max(1000).nullish(),
});

async function validarRefs(d: Record<string, unknown>, user: AuthUser, existing?: Record<string, unknown>) {
  const reciboId = (d.recibo_id ?? existing?.recibo_id) as number | undefined;
  const recibo = reciboId != null ? await assertRef(prisma.recibo, reciboId, scopeRecibosEscritura(user), 'recibo_id') : null;
  if (d.concepto_id != null) {
    const concepto = await assertRef(prisma.concepto, d.concepto_id as number, scopeConceptos(user), 'concepto_id');
    if (recibo && concepto!.empresa_id !== recibo.empresa_id) {
      throw invalid('Datos inválidos: concepto_id: el concepto pertenece a otra empresa', { concepto_id: 'Pertenece a otra empresa' });
    }
  }
  return d;
}

// CRUD "crudo": no genera cargos; para emitir recibos completos usa POST /api/recibos.
export const reciboConceptosRouter = crudRouter({
  entidad: 'recibo_concepto',
  delegate: prisma.reciboConcepto,
  readRoles: ['admin'],
  writeRoles: ['admin'],
  scope: scopeReciboConceptos,
  writeScope: scopeReciboConceptosEscritura,
  orderable: ['id', 'orden', 'monto'],
  defaultOrder: { id: 'asc' },
  include: { concepto: { select: { id: true, nombre: true } } },
  filtros: {
    schema: z.object({ recibo_id: idSchema.optional() }),
    where: (f) => (f.recibo_id !== undefined ? { recibo_id: f.recibo_id } : {}),
  },
  createSchema: base,
  updateSchema: base.partial(),
  prepareCreate: (d, u) => validarRefs(d, u),
  prepareUpdate: (d, u, e) => validarRefs(d, u, e),
});
