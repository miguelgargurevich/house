import { Router } from 'express';
import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { ROLES_OPERATIVOS } from '../config';
import { invalid, notFound } from '../errors';
import { scopeProveedores, scopeTareas, scopeUnidades, scopeUsuarios } from '../lib/scope';
import { currentUser, requireRole, type AuthUser } from '../middleware/auth';
import { idSchema, parseBody, parseId, texto, textoOpcional, z } from '../validation';

export const ESTADOS_TAREA = ['pendiente', 'en_progreso', 'completada'] as const;
const estadoSchema = z.enum(ESTADOS_TAREA, { error: `estado debe ser: ${ESTADOS_TAREA.join(', ')}` });

const base = z.object({
  titulo: texto(160),
  descripcion: textoOpcional(1000),
  estado: estadoSchema.optional(),
  unidad_id: idSchema.nullish(),
  asignado_id: idSchema.nullish(),
  /** Una tarea la hace una persona del personal o un proveedor, no ambos. */
  proveedor_id: idSchema.nullish(),
});

const cierre = (estado: unknown) => (estado === 'completada' ? { fecha_cierre: new Date() } : estado ? { fecha_cierre: null } : {});

async function validarRefs(d: Record<string, unknown>, user: AuthUser) {
  if (d.unidad_id != null) await assertRef(prisma.unidad, d.unidad_id as number, scopeUnidades(user), 'unidad_id');
  if (d.asignado_id != null) await assertRef(prisma.usuario, d.asignado_id as number, scopeUsuarios(user), 'asignado_id', { rol: { in: [...ROLES_OPERATIVOS] } });
  if (d.proveedor_id != null) await assertRef(prisma.proveedor, d.proveedor_id as number, scopeProveedores(user), 'proveedor_id', { activo: true });
  // Asignar a uno suelta al otro; mandar los dos a la vez es un error.
  if (d.asignado_id != null && d.proveedor_id != null) throw invalid('Datos inválidos: asignado_id: asigna la tarea a una persona del personal o a un proveedor, no a ambos', { asignado_id: 'No a ambos', proveedor_id: 'No a ambos' });
  const suelta = d.asignado_id != null ? { proveedor_id: null } : d.proveedor_id != null ? { asignado_id: null } : {};
  return { ...d, ...suelta, ...cierre(d.estado) };
}

/**
 * Tareas de un condominio: las de una unidad suya y, si no son de una unidad, las de su personal o sus proveedores. Es un filtro MÁS: la
 * lista sigue acotada por `scopeTareas` (un `complejo_id` ajeno no devuelve nada).
 */
const deCondominio = (complejoId: number) => ({
  OR: [
    { unidad: { complejo_id: complejoId } },
    { unidad_id: null, asignado: { complejo_id: complejoId } },
    { unidad_id: null, proveedor: { complejos: { some: { complejo_id: complejoId } } } },
  ],
});

const include = {
  unidad: { select: { id: true, codigo: true } },
  asignado: { select: { id: true, nombre: true, rol: true } },
  proveedor: { select: { id: true, razon_social: true, rubro: true } },
};

const router = Router();

// Mantenimiento sólo cambia el estado de SUS tareas (el scope lo restringe); admin y superadmin cualquiera de su alcance.
router.patch('/:id/estado', requireRole('admin', ...ROLES_OPERATIVOS), async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req);
  const { estado } = parseBody(z.object({ estado: estadoSchema }), req);
  const existe = await prisma.tareaMantenimiento.findFirst({ where: { AND: [{ id }, scopeTareas(user)] }, select: { id: true } });
  if (!existe) throw notFound('Tarea');
  const tarea = await prisma.tareaMantenimiento.update({ where: { id }, data: { estado, ...cierre(estado) }, include });
  res.locals.entidadId = id;
  res.json(tarea);
});

router.use(
  crudRouter({
    entidad: 'tarea',
    delegate: prisma.tareaMantenimiento,
    readRoles: ['admin', ...ROLES_OPERATIVOS],
    writeRoles: ['admin'],
    scope: scopeTareas,
    search: ['titulo', 'descripcion'],
    orderable: ['id', 'titulo', 'estado', 'fecha_creacion', 'fecha_cierre'],
    defaultOrder: { fecha_creacion: 'desc' },
    include,
    filtros: {
      schema: z.object({ estado: estadoSchema.optional(), asignado_id: idSchema.optional(), proveedor_id: idSchema.optional(), unidad_id: idSchema.optional(), complejo_id: idSchema.optional() }),
      where: (f) => ({
        ...(f.estado ? { estado: f.estado } : {}),
        ...(f.asignado_id !== undefined ? { asignado_id: f.asignado_id } : {}),
        ...(f.proveedor_id !== undefined ? { proveedor_id: f.proveedor_id } : {}),
        ...(f.unidad_id !== undefined ? { unidad_id: f.unidad_id } : {}),
        ...(f.complejo_id !== undefined ? { AND: [deCondominio(f.complejo_id as number)] } : {}),
      }),
    },
    createSchema: base,
    updateSchema: base.partial(),
    prepareCreate: async (d, u) => ({ ...(await validarRefs(d, u)), creado_por_id: u.id }),
    prepareUpdate: (d, u) => validarRefs(d, u),
  }),
);

export { router as tareasRouter };
