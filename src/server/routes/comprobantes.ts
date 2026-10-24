import { createHash } from 'node:crypto';
import express, { Router, type RequestHandler } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { HttpError, conflict, forbidden, invalid, notFound } from '../errors';
import { formatearPago, includePago } from '../lib/cargos';
import { scopePagos } from '../lib/scope';
import { registrarAuditoria, ipDe } from '../middleware/audit';
import { currentUser, requireRole, type AuthUser } from '../middleware/auth';
import { dispositionInline, detectarTipo, MAX_COMPROBANTE, sanearNombre, TIPOS_COMPROBANTE, type TipoComprobante } from '../services/comprobantes';
import { parseBody, parseId, z } from '../validation';

/** Pagos que ve cada rol: el admin, los de su empresa; el residente, los de las unidades que tiene. */
function alcance(u: AuthUser): Prisma.PagoWhereInput {
  if (u.rol === 'propietario') return { reciboConceptoUnidad: { unidad: { propietario_id: u.id } } };
  if (u.rol === 'inquilino') return { reciboConceptoUnidad: { unidad: { inquilino_id: u.id } } };
  return scopePagos(u);
}

const esResidente = (u: AuthUser) => u.rol === 'propietario' || u.rol === 'inquilino';

// Se ubica el pago ANTES de leer el cuerpo: quien no tiene acceso recibe 404 sin que se descargue el archivo.
const cargarPago: RequestHandler = async (req, res, next) => {
  const u = currentUser(req);
  const pago = await prisma.pago.findFirst({ where: { AND: [{ id: parseId(req) }, alcance(u)] }, select: { id: true, usuario_id: true, estado_validacion: true, recibo_concepto_unidad_id: true, fecha_pago: true } });
  if (!pago) throw notFound('Pago');
  res.locals.pago = pago;
  res.locals.entidad = 'pago';
  res.locals.entidadId = pago.id;
  next();
};

type PagoCargado = { id: number; usuario_id: number | null; estado_validacion: string; recibo_concepto_unidad_id: number | null; fecha_pago: Date };

const crudo = express.raw({ type: [...TIPOS_COMPROBANTE], limit: MAX_COMPROBANTE });

const motivoSchema = z.string({ error: 'El motivo es obligatorio' }).trim().min(3, 'Escribe un motivo de al menos 3 caracteres').max(300, 'Máximo 300 caracteres');
const validacionSchema = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('validado') }),
  z.object({ estado: z.literal('rechazado'), motivo: motivoSchema }),
], { error: 'estado debe ser validado o rechazado' });

export const comprobantesRouter = Router();

// ---------- Subir (o reemplazar) ----------
comprobantesRouter.post('/:id/comprobante', requireRole('admin', 'propietario', 'inquilino'), cargarPago, crudo, async (req, res) => {
  const u = currentUser(req);
  const pago = res.locals.pago as PagoCargado;
  if (esResidente(u)) {
    if (pago.usuario_id !== u.id) throw notFound('Pago'); // sólo quien lo registró adjunta el comprobante
    if (pago.estado_validacion !== 'por_validar') throw conflict('El pago ya fue revisado: no se puede cambiar el comprobante');
  }
  const cuerpo: unknown = req.body;
  const declarado = req.is([...TIPOS_COMPROBANTE]) as TipoComprobante | false | null;
  if (!declarado || !Buffer.isBuffer(cuerpo)) throw new HttpError(415, 'Tipo de archivo no permitido: sube una imagen JPG, PNG o WebP, o un PDF');
  if (cuerpo.length === 0) throw invalid('El archivo está vacío');
  if (detectarTipo(cuerpo) !== declarado) throw invalid('El contenido del archivo no corresponde a su tipo');

  const nombre = sanearNombre(req.header('x-nombre-archivo'), declarado);
  const sha256 = createHash('sha256').update(cuerpo).digest('hex');
  const datos = { nombre, tipo_mime: declarado, tamano: cuerpo.length, sha256, datos: cuerpo, subido_por_id: u.id };
  // Un comprobante por pago: reemplazar sobrescribe el anterior.
  const a = await prisma.archivoComprobante.upsert({
    where: { pago_id: pago.id },
    create: { pago_id: pago.id, ...datos },
    update: { ...datos, created_at: new Date() },
    select: { id: true, pago_id: true, nombre: true, tipo_mime: true, tamano: true, sha256: true, created_at: true },
  });
  res.locals.accion = 'subir_comprobante';
  res.locals.auditDetalle = { nombre, tipo_mime: declarado, tamano: cuerpo.length, sha256 }; // nunca el contenido
  res.status(201).json(a);
});

// ---------- Ver ----------
comprobantesRouter.get('/:id/comprobante', requireRole('admin', 'propietario', 'inquilino'), cargarPago, async (req, res) => {
  const u = currentUser(req);
  const pago = res.locals.pago as PagoCargado;
  const a = await prisma.archivoComprobante.findUnique({ where: { pago_id: pago.id } });
  if (!a) throw notFound('Comprobante');
  void registrarAuditoria({ usuario_id: u.id, accion: 'ver_comprobante', entidad: 'pago', entidad_id: pago.id, detalle: { archivo_id: a.id, nombre: a.nombre, tamano: a.tamano }, ip: ipDe(req) });
  res.set({
    'Content-Type': a.tipo_mime,
    'Content-Length': String(a.datos.length),
    'Content-Disposition': dispositionInline(a.nombre),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
    'Cache-Control': 'private, no-store',
  });
  res.status(200).end(Buffer.from(a.datos));
});

// ---------- Validar o rechazar ----------
comprobantesRouter.patch('/:id/validacion', requireRole('admin'), cargarPago, async (req, res) => {
  const u = currentUser(req);
  if (u.rol !== 'admin' && u.rol !== 'superadmin') throw forbidden();
  const pago = res.locals.pago as PagoCargado;
  const v = parseBody(validacionSchema, req);
  await prisma.$transaction(async (tx) => {
    // Cierre atómico: sólo una revisión de un pago por validar logra pasar.
    const r = await tx.pago.updateMany({
      where: { id: pago.id, estado_validacion: 'por_validar' },
      data: { estado_validacion: v.estado, validado_por_id: u.id, validado_at: new Date(), motivo_rechazo: v.estado === 'rechazado' ? v.motivo : null },
    });
    if (r.count === 0) throw conflict('Este pago ya fue revisado');
    const cargoId = pago.recibo_concepto_unidad_id;
    if (cargoId == null) return;
    if (v.estado === 'validado') {
      await tx.reciboConceptoUnidad.update({ where: { id: cargoId }, data: { estado_pago: 'pagado', fecha_pago: pago.fecha_pago } });
    } else {
      await tx.reciboConceptoUnidad.updateMany({ where: { id: cargoId, estado_pago: 'en_revision' }, data: { estado_pago: 'pendiente', fecha_pago: null } });
    }
  });
  res.locals.accion = v.estado === 'validado' ? 'validar' : 'rechazar';
  res.locals.auditDetalle = v.estado === 'validado' ? { estado: v.estado } : { estado: v.estado, motivo: v.motivo };
  const actualizado = await prisma.pago.findUniqueOrThrow({ where: { id: pago.id }, include: includePago });
  res.json(formatearPago(actualizado));
});
