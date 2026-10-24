import { createHash } from 'node:crypto';
import express, { Router, type RequestHandler } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { HttpError, conflict, forbidden, invalid, notFound } from '../errors';
import { formatearPago, includePago } from '../lib/cargos';
import { esJunta } from '../lib/junta';
import { scopePagos, scopePagosJunta } from '../lib/scope';
import { registrarAuditoria, ipDe } from '../middleware/audit';
import { currentUser, requireRole, type AuthUser } from '../middleware/auth';
import { estadoParaResidente, selectEvaluacion } from '../lib/evaluacionVista';
import { iniciarEvaluacion } from '../services/evaluacion';
import { avisarResultado, cerrarPago } from '../services/validacionPago';
import { dispositionInline, detectarTipo, MAX_COMPROBANTE, sanearNombre, TIPOS_COMPROBANTE, type TipoComprobante } from '../services/comprobantes';
import { parseBody, parseId, z } from '../validation';

/** Pagos que ve cada rol: el admin, los de su empresa; el residente, los de las unidades que tiene. */
function alcance(u: AuthUser): Prisma.PagoWhereInput {
  if (u.rol === 'propietario') {
    const suyos: Prisma.PagoWhereInput = { reciboConceptoUnidad: { unidad: { propietario_id: u.id } } };
    return esJunta(u) ? { OR: [suyos, scopePagosJunta(u)] } : suyos; // la junta ve además los pagos de su ámbito
  }
  if (u.rol === 'inquilino') return { reciboConceptoUnidad: { unidad: { inquilino_id: u.id } } };
  return scopePagos(u);
}

const esResidente = (u: AuthUser) => u.rol === 'propietario' || u.rol === 'inquilino';

// Se ubica el pago ANTES de leer el cuerpo: quien no tiene acceso recibe 404 sin que se descargue el archivo.
const cargador = (alcanceDe: (u: AuthUser) => Prisma.PagoWhereInput): RequestHandler => async (req, res, next) => {
  const u = currentUser(req);
  const campos = { id: true, usuario_id: true, estado_validacion: true, recibo_concepto_unidad_id: true, fecha_pago: true, grupo: true, grupo_principal: true } as const;
  let pago = await prisma.pago.findFirst({ where: { AND: [{ id: parseId(req) }, alcanceDe(u)] }, select: campos });
  if (!pago) throw notFound('Pago');
  // Pago de un mantenimiento: el comprobante, la evaluación y la validación son del GRUPO y viven en su pago principal.
  if (pago.grupo != null && !pago.grupo_principal) pago = (await prisma.pago.findFirst({ where: { grupo: pago.grupo, grupo_principal: true }, select: campos })) ?? pago;
  res.locals.pago = pago;
  res.locals.entidad = 'pago';
  res.locals.entidadId = pago.id;
  next();
};

const cargarPago = cargador(alcance);
/** Validar: el admin de la empresa o la junta del ámbito de la unidad (no basta ser dueño de la unidad). */
const cargarPagoAValidar = cargador((u) => (u.rol === 'propietario' ? scopePagosJunta(u) : scopePagos(u)));

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
  // La IA lee el comprobante en segundo plano: no frena la respuesta ni, si falla, la subida. Un archivo nuevo invalida la evaluación anterior.
  await iniciarEvaluacion(pago.id, 'subida').catch((err) => console.error('[evaluacion] no se pudo iniciar', err instanceof Error ? err.name : 'error'));
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
comprobantesRouter.patch('/:id/validacion', requireRole('admin', 'propietario'), cargarPagoAValidar, async (req, res) => {
  const u = currentUser(req);
  if (u.rol !== 'admin' && u.rol !== 'superadmin' && !esJunta(u)) throw forbidden(); // propietario sin cargo de gestión
  const pago = res.locals.pago as PagoCargado;
  if (u.rol === 'propietario' && pago.usuario_id === u.id) throw forbidden('No puedes validar tu propio pago: pídeselo a la administración u otro miembro de la junta');
  const v = parseBody(validacionSchema, req);
  await cerrarPago({ pagoId: pago.id, cargoId: pago.recibo_concepto_unidad_id, fechaPago: pago.fecha_pago, estado: v.estado, motivo: v.estado === 'rechazado' ? v.motivo : undefined, validadorId: u.id });
  await avisarResultado(pago.id, v.estado, v.estado === 'rechazado' ? v.motivo : null);
  res.locals.accion = v.estado === 'validado' ? 'validar' : 'rechazar';
  res.locals.auditDetalle = v.estado === 'validado' ? { estado: v.estado } : { estado: v.estado, motivo: v.motivo };
  const actualizado = await prisma.pago.findUniqueOrThrow({ where: { id: pago.id }, include: includePago });
  res.json(formatearPago(actualizado, 'completa'));
});

// ---------- Evaluación automática (IA) ----------
/** Admin/superadmin de la empresa o junta en su ámbito: ven la evaluación completa; el residente, sólo un estado simple. */
async function veCompleta(u: AuthUser, pagoId: number): Promise<boolean> {
  if (u.rol === 'admin' || u.rol === 'superadmin') return true;
  return esJunta(u) && (await prisma.pago.count({ where: { AND: [{ id: pagoId }, scopePagosJunta(u)] } })) > 0;
}

comprobantesRouter.get('/:id/evaluacion', requireRole('admin', 'propietario', 'inquilino'), cargarPago, async (req, res) => {
  const u = currentUser(req);
  const pago = res.locals.pago as PagoCargado;
  const [ev, p] = await Promise.all([
    prisma.evaluacionComprobante.findUnique({ where: { pago_id: pago.id }, select: selectEvaluacion }),
    prisma.pago.findUniqueOrThrow({ where: { id: pago.id }, select: { validado_por_ia: true } }),
  ]);
  const evaluacion = ev && (await veCompleta(u, pago.id)) ? ev : ev ? { estado: estadoParaResidente(ev) } : null;
  res.json({ evaluacion, validado_por_ia: p.validado_por_ia });
});

// Pedir (o repetir) la evaluación: admin/superadmin de la empresa y junta en su ámbito. El trabajo corre en segundo plano.
comprobantesRouter.post('/:id/evaluacion', requireRole('admin', 'propietario'), cargarPagoAValidar, async (req, res) => {
  const u = currentUser(req);
  if (u.rol !== 'admin' && u.rol !== 'superadmin' && !esJunta(u)) throw forbidden();
  const pago = res.locals.pago as PagoCargado;
  if (!(await prisma.archivoComprobante.findUnique({ where: { pago_id: pago.id }, select: { id: true } }))) throw conflict('Este pago no tiene comprobante que evaluar');
  if (!(await iniciarEvaluacion(pago.id, 'manual'))) throw conflict('Este comprobante ya se está evaluando');
  res.locals.accion = 'reevaluar_comprobante';
  res.locals.auditDetalle = { origen: 'manual' };
  const ev = await prisma.evaluacionComprobante.findUnique({ where: { pago_id: pago.id }, select: selectEvaluacion });
  res.status(202).json({ evaluacion: ev });
});
