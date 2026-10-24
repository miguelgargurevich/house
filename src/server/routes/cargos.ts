import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { invalid } from '../errors';
import { filtroEstadoCargo, formatearCargo, includeCargo, type EstadoCargo } from '../lib/cargos';
import { scopeCargos, scopeCargosEscritura, scopeReciboConceptosEscritura, scopeUnidades } from '../lib/scope';
import type { AuthUser } from '../middleware/auth';
import { fechaSchema, idSchema, montoSchema, textoOpcional, z } from '../validation';

const base = z.object({
  recibo_concepto_id: idSchema,
  unidad_id: idSchema,
  monto: montoSchema,
  estado_pago: z.enum(['pendiente', 'pagado'], { error: 'estado_pago debe ser pendiente o pagado' }).optional(),
  fecha_pago: fechaSchema.nullish(),
  url_voucher: textoOpcional(500),
  observaciones: textoOpcional(500),
});

async function validarRefs(d: Record<string, unknown>, user: AuthUser, existing?: Record<string, unknown>) {
  const rcId = (d.recibo_concepto_id ?? existing?.recibo_concepto_id) as number | undefined;
  const rc = rcId != null ? await assertRef(prisma.reciboConcepto, rcId, scopeReciboConceptosEscritura(user), 'recibo_concepto_id', {}) : null;
  const unidadId = (d.unidad_id ?? existing?.unidad_id) as number | undefined;
  if (unidadId != null) {
    const unidad = await assertRef(prisma.unidad, unidadId, scopeUnidades(user), 'unidad_id');
    if (rc) {
      const recibo = await prisma.recibo.findUnique({ where: { id: rc.recibo_id as number }, select: { empresa_id: true, complejo: { select: { empresa_id: true } } } });
      // La unidad debe ser del condominio que hoy administra la empresa (el recibo pudo emitirlo la anterior).
      if (recibo && unidad!.empresa_id !== (recibo.complejo?.empresa_id ?? recibo.empresa_id)) {
        throw invalid('Datos inválidos: unidad_id: la unidad es de otra empresa', { unidad_id: 'Es de otra empresa' });
      }
    }
  }
  if (d.estado_pago === 'pagado' && d.fecha_pago === undefined && existing?.fecha_pago == null) return { ...d, fecha_pago: new Date() };
  if (d.estado_pago === 'pendiente') return { ...d, fecha_pago: null };
  return d;
}

export const cargosRouter = crudRouter({
  entidad: 'cargo',
  delegate: prisma.reciboConceptoUnidad,
  readRoles: ['admin'],
  writeRoles: ['admin'],
  scope: scopeCargos,
  writeScope: scopeCargosEscritura,
  search: ['unidad.codigo'],
  orderable: ['id', 'monto', 'estado_pago', 'fecha_pago', 'created_at'],
  defaultOrder: { id: 'desc' },
  include: includeCargo,
  filtros: {
    schema: z.object({
      estado: z.enum(['pendiente', 'pagado', 'vencido', 'en_revision']).optional(),
      unidad_id: idSchema.optional(),
      recibo_id: idSchema.optional(),
    }),
    where: (f) => ({
      ...(f.estado ? filtroEstadoCargo(f.estado as EstadoCargo) : {}),
      ...(f.unidad_id !== undefined ? { unidad_id: f.unidad_id } : {}),
      ...(f.recibo_id !== undefined ? { reciboConcepto: { recibo_id: f.recibo_id } } : {}),
    }),
  },
  createSchema: base,
  updateSchema: base.partial(),
  prepareCreate: (d, u) => validarRefs(d, u),
  prepareUpdate: (d, u, e) => validarRefs(d, u, e),
  format: (items) => items.map(formatearCargo),
});

