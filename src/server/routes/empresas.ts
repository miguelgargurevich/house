import { Router } from 'express';
import { crudRouter } from '../crud';
import { prisma } from '../db';
import { notFound } from '../errors';
import { paisSchema } from '../lib/paisMoneda';
import { scopeEmpresas } from '../lib/scope';
import { currentUser, requireRole } from '../middleware/auth';
import { enviarImagen, guardarImagenRecibo, imagenCruda, verificarImagen, versionImagen } from '../services/imagenes';
import { emailSchema, fechaSchema, parseId, telefonoSchema, texto, textoOpcional, z } from '../validation';

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
  /** País por defecto de sus condominios nuevos (catálogo `src/lib/paises.ts`). */
  pais: paisSchema.optional(),
});

// El admin sólo lee y edita SU empresa (el scope lo limita); crear y borrar empresas es del superadmin.
const crud = crudRouter({
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
  // El token de la instancia de WhatsApp es una credencial: sólo la usa el servidor (`routes/whatsapp.ts`, `services/avisos`).
  omit: { whatsapp_token: true },
  createSchema: base,
  updateSchema: base.partial(),
  // `logo_url`: el logo del recibo impreso (los bytes viven en `ImagenRecibo`; aquí sólo si existe).
  format: async (items) => {
    const imagenes = await prisma.imagenRecibo.findMany({ where: { empresa_id: { in: items.map((e) => e.id as number) } }, select: { empresa_id: true, updated_at: true } });
    const img = new Map(imagenes.map((x) => [x.empresa_id, x.updated_at]));
    return items.map((e) => ({ ...e, logo_url: img.has(e.id as number) ? `/api/empresas/${e.id}/logo?v=${versionImagen(img.get(e.id as number))}` : null }));
  },
});

// ---------- Logo de la empresa (sale al pie del recibo impreso; ≤ 2 MB) ----------
const router = Router();

/** La empresa, sólo si es la de quien llama (otro tenant → 404; el superadmin alcanza todas). */
async function empresaDeAdmin(req: Parameters<typeof currentUser>[0]) {
  const id = parseId(req);
  if (!(await prisma.empresaAdministradora.findFirst({ where: { AND: [{ id }, scopeEmpresas(currentUser(req))] }, select: { id: true } }))) throw notFound();
  return id;
}

/** La ven la administración y los residentes cuyo condominio (o cuyo recibo) es de esa empresa: el logo sale en su recibo. */
router.get('/:id/logo', requireRole('admin', 'propietario', 'inquilino'), async (req, res) => {
  const u = currentUser(req);
  const id = parseId(req);
  const acceso = u.rol === 'propietario' || u.rol === 'inquilino'
    ? await prisma.unidad.findFirst({
        where: {
          AND: [
            { OR: [{ propietario_id: u.id }, { inquilino_id: u.id }] },
            { OR: [{ complejo: { empresa_id: id } }, { reciboConceptoUnidades: { some: { reciboConcepto: { recibo: { empresa_id: id } } } } }] },
          ],
        },
        select: { id: true },
      })
    : await prisma.empresaAdministradora.findFirst({ where: { AND: [{ id }, scopeEmpresas(u)] }, select: { id: true } });
  const img = acceso ? await prisma.imagenRecibo.findUnique({ where: { empresa_id: id } }) : null;
  if (!img) throw notFound('Imagen');
  enviarImagen(res, img);
});

router.put('/:id/logo', requireRole('admin'), async (req, res, next) => {
  try { res.locals.empresaId = await empresaDeAdmin(req); next(); } catch (e) { next(e); }
}, imagenCruda, async (req, res) => {
  const img = verificarImagen(req);
  const id = res.locals.empresaId as number;
  const r = await guardarImagenRecibo({ empresa_id: id }, img, currentUser(req).id);
  res.locals.entidad = 'empresa';
  res.locals.entidadId = id;
  res.locals.accion = 'subir_logo';
  res.locals.auditDetalle = { tipo_mime: img.tipo_mime, tamano: img.tamano }; // nunca el contenido
  res.json({ logo_url: `/api/empresas/${id}/logo?v=${versionImagen(r.updated_at)}` });
});

router.delete('/:id/logo', requireRole('admin'), async (req, res) => {
  const id = await empresaDeAdmin(req);
  await prisma.imagenRecibo.deleteMany({ where: { empresa_id: id } });
  res.locals.entidad = 'empresa';
  res.locals.entidadId = id;
  res.locals.accion = 'quitar_logo';
  res.status(204).end();
});

router.use(crud);

export { router as empresasRouter };
