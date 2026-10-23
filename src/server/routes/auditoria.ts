import { crudRouter } from '../crud';
import { prisma } from '../db';
import { idSchema, z } from '../validation';

// Sólo lectura y sólo superadmin (readRoles vacío: únicamente pasa el superadmin).
const router = crudRouter({
  entidad: 'auditoria',
  delegate: prisma.auditoria,
  readRoles: [],
  writeRoles: [],
  readOnly: true,
  scope: () => ({}),
  search: ['entidad', 'accion', 'ip'],
  orderable: ['id', 'created_at', 'accion', 'entidad'],
  defaultOrder: { created_at: 'desc' },
  include: { usuario: { select: { id: true, nombre: true, email: true } } },
  filtros: {
    schema: z.object({ entidad: z.string().max(60).optional(), accion: z.string().max(30).optional(), usuario_id: idSchema.optional() }),
    where: (f) => ({
      ...(f.entidad ? { entidad: f.entidad } : {}),
      ...(f.accion ? { accion: f.accion } : {}),
      ...(f.usuario_id !== undefined ? { usuario_id: f.usuario_id } : {}),
    }),
  },
});

export { router as auditoriaRouter };
