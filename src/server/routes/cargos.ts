import { Router } from 'express';
import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { invalid, notFound } from '../errors';
import { filtroEstadoCargo, formatearCargo, includeCargo, type EstadoCargo } from '../lib/cargos';
import { relojDeCondominios } from '../lib/zonas';
import { scopeCargos, scopeCargosEscritura, scopeReciboConceptosEscritura, scopeUnidades } from '../lib/scope';
import { currentUser, requireRole, type AuthUser } from '../middleware/auth';
import { fechaSchema, idSchema, montoSchema, parseBody, parseId, textoOpcional, z } from '../validation';
import { complejoDeCargo, complejoDeUnidad, exigirOperativo } from '../services/comercial/operativo';
import { corregirCargo, quitarCargo } from '../services/correccionRecibos';

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
      const recibo = await prisma.recibo.findUnique({ where: { id: rc.recibo_id as number }, select: { empresa_id: true, estructura_id: true, complejo: { select: { empresa_id: true } } } });
      // La unidad debe ser del condominio que hoy administra la empresa (el recibo pudo emitirlo la anterior).
      if (recibo && unidad!.empresa_id !== (recibo.complejo?.empresa_id ?? recibo.empresa_id)) {
        throw invalid('Datos inválidos: unidad_id: la unidad es de otra empresa', { unidad_id: 'Es de otra empresa' });
      }
      // Cada torre tiene su propio recibo: un cargo de un recibo de torre sólo puede ser de una unidad de esa torre.
      if (recibo?.estructura_id != null && unidad!.estructura_id !== recibo.estructura_id) {
        throw invalid('Datos inválidos: unidad_id: la unidad no es del block de este recibo', { unidad_id: 'No es del block del recibo' });
      }
    }
  }
  if (d.estado_pago === 'pagado' && d.fecha_pago === undefined && existing?.fecha_pago == null) return { ...d, fecha_pago: new Date() };
  if (d.estado_pago === 'pendiente') return { ...d, fecha_pago: null };
  return d;
}

const router = Router();

const crud = crudRouter({
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
      estructura_id: idSchema.optional(),
      complejo_id: idSchema.optional(),
    }),
    where: async (f) => ({
      ...(f.estado ? filtroEstadoCargo(f.estado as EstadoCargo, await relojDeCondominios()) : {}),
      ...(f.unidad_id !== undefined ? { unidad_id: f.unidad_id } : {}),
      ...(f.recibo_id !== undefined ? { reciboConcepto: { recibo_id: f.recibo_id } } : {}),
      ...(f.estructura_id !== undefined || f.complejo_id !== undefined ? { unidad: { ...(f.estructura_id !== undefined ? { estructura_id: f.estructura_id } : {}), ...(f.complejo_id !== undefined ? { complejo_id: f.complejo_id } : {}) } } : {}),
    }),
  },
  createSchema: base,
  updateSchema: base.partial(),
  operativo: async (r, u) => exigirOperativo(await complejoDeUnidad(r.unidad_id as number | null), u),
  prepareCreate: (d, u) => validarRefs(d, u),
  prepareUpdate: (d, u, e) => validarRefs(d, u, e),
  format: (items) => items.map((c) => formatearCargo(c)),
});


// ---------- Corregir o quitar el cargo de UN departamento (sólo la administración; con motivo y auditado) ----------
// El PUT/DELETE genérico de arriba no pide motivo ni mira los pagos: la pantalla usa estas dos rutas.
const motivoSchema = z.string({ error: 'El motivo es obligatorio' }).trim().min(5, 'Escribe un motivo de al menos 5 caracteres').max(300, 'Máximo 300 caracteres');
const corregirSchema = z.strictObject({ monto: montoSchema, motivo: motivoSchema });
const quitarSchema = z.strictObject({ motivo: motivoSchema });

/** El cargo, sólo si lo alcanza quien administra el condominio hoy (otra empresa, o la administradora anterior: 404). */
async function cargoEscribible(req: Parameters<typeof currentUser>[0]) {
  const u = currentUser(req);
  const id = parseId(req);
  const c = await prisma.reciboConceptoUnidad.findFirst({ where: { AND: [{ id }, scopeCargosEscritura(u)] }, select: { id: true } });
  if (!c) throw notFound('Cargo');
  await exigirOperativo(await complejoDeCargo(id), u);
  return id;
}

/** Cambia el monto de un cargo. No puede quedar por debajo de lo ya pagado (validado o por validar): 409. El estado del cargo se recalcula con sus pagos. */
router.post('/:id/corregir', requireRole('admin'), async (req, res) => {
  const id = await cargoEscribible(req);
  const { monto, motivo } = parseBody(corregirSchema, req);
  const r = await corregirCargo({ cargoId: id, monto, motivo });
  res.locals.accion = 'corregir_cargo';
  res.locals.entidad = 'cargo';
  res.locals.entidadId = id;
  res.locals.auditDetalle = { recibo_id: r.recibo_id, mes: r.mes, anio: r.anio, codigo: r.codigo, concepto: r.concepto, monto_anterior: r.monto_anterior, monto_nuevo: r.monto_nuevo, estado: r.estado, motivo };
  res.json({ ...r, motivo });
});

/** Quita el cargo de un departamento: el vecino ya no lo debe. 409 si tiene pagos vigentes. Un pago rechazado se va con el cargo y queda en la auditoría. */
router.post('/:id/quitar', requireRole('admin'), async (req, res) => {
  const id = await cargoEscribible(req);
  const { motivo } = parseBody(quitarSchema, req);
  const r = await quitarCargo({ cargoId: id, motivo });
  res.locals.accion = 'quitar_cargo';
  res.locals.entidad = 'cargo';
  res.locals.entidadId = id;
  res.locals.auditDetalle = { recibo_id: r.recibo_id, mes: r.mes, anio: r.anio, codigo: r.codigo, concepto: r.concepto, monto_anterior: r.monto_anterior, monto_nuevo: null, pagos_retirados: r.pagos_retirados ?? [], motivo };
  res.json({ ...r, motivo });
});

router.use(crud);

export { router as cargosRouter };
