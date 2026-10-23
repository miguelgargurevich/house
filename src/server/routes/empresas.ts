import { crudRouter } from '../crud';
import { prisma } from '../db';
import { scopeEmpresas } from '../lib/scope';
import { emailSchema, fechaSchema, telefonoSchema, texto, textoOpcional, z } from '../validation';

const base = z.object({
  nombre: texto(160),
  ruc: z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{11}$/, 'El RUC debe tener 11 dígitos').nullish()),
  direccion: textoOpcional(255),
  telefono: telefonoSchema,
  email: z.preprocess((v) => (v === '' ? null : v), emailSchema.nullish()),
  representante_legal: textoOpcional(160),
  fecha_inicio: fechaSchema.nullish(),
  fecha_fin: fechaSchema.nullish(),
  estado: texto(30).optional(),
});

// El admin sólo lee y edita SU empresa (el scope lo limita); crear y borrar empresas es del superadmin.
export const empresasRouter = crudRouter({
  entidad: 'empresa',
  delegate: prisma.empresaAdministradora,
  readRoles: ['admin'],
  writeRoles: ['admin'],
  createRoles: [],
  deleteRoles: [],
  scope: scopeEmpresas,
  search: ['nombre', 'ruc', 'email'],
  orderable: ['id', 'nombre', 'estado'],
  defaultOrder: { nombre: 'asc' },
  createSchema: base,
  updateSchema: base.partial(),
});
