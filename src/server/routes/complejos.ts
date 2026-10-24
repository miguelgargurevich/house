import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { invalid } from '../errors';
import { empresaDe, scopeComplejos } from '../lib/scope';
import { idSchema, texto, textoOpcional, z } from '../validation';

const base = z.object({
  nombre: texto(160),
  tipo: texto(40),
  direccion: textoOpcional(255),
  descripcion: textoOpcional(1000),
  empresa_id: idSchema.nullish(),
  /** Valida solo los pagos que la IA lee como coincidencia exacta. Sólo admin/superadmin editan complejos (la junta no). */
  validacion_automatica_ia: z.boolean({ error: 'Debe ser verdadero o falso' }).optional(),
});

export const complejosRouter = crudRouter({
  entidad: 'complejo',
  delegate: prisma.complejoHabitacional,
  readRoles: ['admin'],
  writeRoles: ['admin'],
  scope: scopeComplejos,
  search: ['nombre', 'direccion', 'descripcion'],
  orderable: ['id', 'nombre', 'tipo'],
  defaultOrder: { nombre: 'asc' },
  include: { empresa: { select: { id: true, nombre: true } } },
  createSchema: base,
  updateSchema: base.partial(),
  prepareCreate: async (d, u) => {
    if (u.rol === 'admin') return { ...d, empresa_id: empresaDe(u) };
    if (d.empresa_id == null) throw invalid('Datos inválidos: empresa_id: es obligatorio', { empresa_id: 'Obligatorio' });
    await assertRef(prisma.empresaAdministradora, d.empresa_id as number, {}, 'empresa_id');
    return d;
  },
  prepareUpdate: async (d, u) => {
    if (u.rol === 'admin') return { ...d, empresa_id: empresaDe(u) };
    if (d.empresa_id != null) await assertRef(prisma.empresaAdministradora, d.empresa_id as number, {}, 'empresa_id');
    return d;
  },
});
