import { RUBROS_PROVEEDOR } from '../config';
import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { invalid } from '../errors';
import { empresaDe, scopeComplejos, scopeProveedores } from '../lib/scope';
import type { AuthUser } from '../middleware/auth';
import { boolQuery, emailSchema, idSchema, telefonoSchema, texto, textoOpcional, z } from '../validation';

const base = z.object({
  razon_social: texto(160),
  ruc: z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{11}$/, 'El RUC debe tener 11 dígitos').nullish()),
  rubro: z.enum(RUBROS_PROVEEDOR, { error: `rubro debe ser: ${RUBROS_PROVEEDOR.join(', ')}` }),
  contacto_nombre: textoOpcional(120),
  telefono: telefonoSchema,
  email: z.preprocess((v) => (v === '' ? null : v), emailSchema.nullish()),
  notas: textoOpcional(1000),
  activo: z.boolean({ error: 'Debe ser verdadero o falso' }).optional(),
  /** Condominios que atiende (de la empresa del proveedor). */
  complejo_ids: z.array(idSchema, { error: 'complejo_ids debe ser una lista de ids' }).max(100).optional(),
  /** Sólo el superadmin elige la empresa; el admin registra para la suya. */
  empresa_id: idSchema.nullish(),
});

const include = { complejos: { select: { complejo: { select: { id: true, nombre: true } } } } };

/** Valida los condominios (de la empresa del proveedor y a la vista del usuario) y los deja como escritura anidada. */
async function complejosAnidados(ids: number[] | undefined, user: AuthUser, empresaId: number | null, reemplazar: boolean) {
  if (ids === undefined) return {};
  const unicos = [...new Set(ids)];
  for (const id of unicos) await assertRef(prisma.complejoHabitacional, id, scopeComplejos(user), 'complejo_ids', empresaId != null ? { empresa_id: empresaId } : {});
  const crear = unicos.map((complejo_id) => ({ complejo_id }));
  return { complejos: reemplazar ? { deleteMany: {}, create: crear } : { create: crear } };
}

export const proveedoresRouter = crudRouter({
  entidad: 'proveedor',
  delegate: prisma.proveedor,
  readRoles: ['admin'],
  writeRoles: ['admin'],
  scope: scopeProveedores,
  search: ['razon_social', 'ruc', 'contacto_nombre', 'email'],
  orderable: ['id', 'razon_social', 'rubro', 'activo', 'created_at'],
  defaultOrder: { razon_social: 'asc' },
  include,
  filtros: {
    schema: z.object({ rubro: z.enum(RUBROS_PROVEEDOR).optional(), activo: boolQuery.optional(), complejo_id: idSchema.optional() }),
    where: (f) => ({
      ...(f.rubro ? { rubro: f.rubro } : {}),
      ...(f.activo !== undefined ? { activo: f.activo } : {}),
      ...(f.complejo_id !== undefined ? { complejos: { some: { complejo_id: f.complejo_id } } } : {}),
    }),
  },
  // Aplana los condominios: [{ id, nombre }].
  format: (items) => items.map((p) => ({ ...p, complejos: (p.complejos as { complejo: { id: number; nombre: string } }[]).map((x) => x.complejo) })),
  createSchema: base,
  updateSchema: base.partial(),
  prepareCreate: async (d, u) => {
    const { complejo_ids, empresa_id, ...resto } = d as z.infer<typeof base>;
    let empresa: number;
    if (u.rol === 'admin') empresa = empresaDe(u);
    else if (empresa_id == null) throw invalid('Datos inválidos: empresa_id: es obligatorio', { empresa_id: 'Obligatorio' });
    else {
      await assertRef(prisma.empresaAdministradora, empresa_id, {}, 'empresa_id');
      empresa = empresa_id;
    }
    return { ...resto, empresa_id: empresa, ...(await complejosAnidados(complejo_ids, u, empresa, false)) };
  },
  // La empresa del proveedor no se cambia (es de quien lo registró).
  prepareUpdate: async (d, u, existing) => {
    const { complejo_ids, empresa_id: _ignorada, ...resto } = d as z.infer<typeof base>;
    void _ignorada;
    return { ...resto, ...(await complejosAnidados(complejo_ids, u, existing.empresa_id as number, true)) };
  },
});
