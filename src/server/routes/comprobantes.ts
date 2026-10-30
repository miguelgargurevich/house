import { createHash } from 'node:crypto';
import express, { Router, type RequestHandler } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { HttpError, conflict, forbidden, invalid, notFound } from '../errors';
import { formatearPago, includePago } from '../lib/cargos';
import { conTesoreroRegistrado, exencionDelPago } from '../lib/conformidad';
import { esJunta, esTesorero } from '../lib/junta';
import { scopePagos, scopePagosEscritura, scopePagosJunta } from '../lib/scope';
import { registrarAuditoria, ipDe } from '../middleware/audit';
import { currentUser, requireRole, type AuthUser } from '../middleware/auth';
import { estadoParaResidente, selectEvaluacion } from '../lib/evaluacionVista';
import { avisarVoucherEnSegundoPlano } from '../services/avisos/voucherBlock';
import { iniciarEvaluacion } from '../services/evaluacion';
import { validarSiCumple } from '../services/validacionAutomatica';
import { avisarResultado, cerrarPago, MENSAJE_FALTA_CONFORMIDAD } from '../services/validacionPago';
import { conAvisoMulta } from '../services/revisionMora';
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
/** Subir o reemplazar: el residente con su alcance de siempre; la administración sólo si administra el condominio HOY (la anterior consulta, no escribe). */
const cargarPagoASubir = cargador((u) => (esResidente(u) ? alcance(u) : scopePagosEscritura(u)));
/** Revisar el voucher y pedir la evaluación de la IA: el admin de la empresa o la junta del ámbito de la unidad (no basta ser dueño de la unidad). */
const cargarPagoAValidar = cargador((u) => (u.rol === 'propietario' ? scopePagosJunta(u) : scopePagosEscritura(u)));
/** Validar o rechazar: sólo la administración de la empresa. La junta revisa el voucher y el tesorero da la conformidad, pero no cierra el pago. */
const cargarPagoDeLaEmpresa = cargador(scopePagosEscritura);
/** Conformidad: pagos del ámbito de la junta del usuario (otro block u otro condominio → 404; sin cargo de gestión → 403). */
const cargarPagoDeLaJunta = cargador(scopePagosJunta);

type PagoCargado = { id: number; usuario_id: number | null; estado_validacion: string; recibo_concepto_unidad_id: number | null; fecha_pago: Date };

const crudo = express.raw({ type: [...TIPOS_COMPROBANTE], limit: MAX_COMPROBANTE });

const motivoSchema = z.string({ error: 'El motivo es obligatorio' }).trim().min(3, 'Escribe un motivo de al menos 3 caracteres').max(300, 'Máximo 300 caracteres');
const validacionSchema = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('validado') }),
  z.object({ estado: z.literal('rechazado'), motivo: motivoSchema }),
], { error: 'estado debe ser validado o rechazado' });

export const comprobantesRouter = Router();

// ---------- Subir (o reemplazar) ----------
comprobantesRouter.post('/:id/comprobante', requireRole('admin', 'propietario', 'inquilino'), cargarPagoASubir, crudo, async (req, res) => {
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
  // Si lo sube un vecino, el voucher nuevo también va por correo a la junta del block (en segundo plano). Lo que sube la administración no.
  if (esResidente(u)) avisarVoucherEnSegundoPlano(pago.id);
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
comprobantesRouter.patch('/:id/validacion', requireRole('admin'), cargarPagoDeLaEmpresa, async (req, res) => {
  const u = currentUser(req);
  const pago = res.locals.pago as PagoCargado;
  const v = parseBody(validacionSchema, req);
  // Sin voucher no se da por bueno un pago: quien valida lo comprueba contra el archivo. Rechazar sí se puede. Un pago ya revisado cae en el 409 de `cerrarPago`.
  // Validar exige el check del tesorero del block, salvo que nadie pueda darlo (el block no tiene tesorero o el pago lo registró él): ahí valida sola y queda en la auditoría.
  let sinConformidad: Awaited<ReturnType<typeof exencionDelPago>> = null;
  if (v.estado === 'validado' && pago.estado_validacion === 'por_validar') {
    if (!(await prisma.archivoComprobante.findUnique({ where: { pago_id: pago.id }, select: { id: true } }))) {
      throw conflict('Este pago no tiene voucher: pídele al vecino que lo suba o recházalo');
    }
    const conCheck = await prisma.pago.count({ where: { id: pago.id, conformidad_at: { not: null } } }) > 0;
    sinConformidad = conCheck ? null : await exencionDelPago(pago.id);
    if (!conCheck && sinConformidad === null) throw conflict(MENSAJE_FALTA_CONFORMIDAD);
  }
  await cerrarPago({
    pagoId: pago.id, cargoId: pago.recibo_concepto_unidad_id, fechaPago: pago.fecha_pago, estado: v.estado, motivo: v.estado === 'rechazado' ? v.motivo : undefined, validadorId: u.id,
    exigirConformidad: v.estado === 'validado' && sinConformidad === null && pago.estado_validacion === 'por_validar',
  });
  await avisarResultado(pago.id, v.estado, v.estado === 'rechazado' ? v.motivo : null);
  res.locals.accion = v.estado === 'validado' ? 'validar' : 'rechazar';
  res.locals.auditDetalle = v.estado === 'validado' ? { estado: v.estado, ...(sinConformidad ? { sin_conformidad: sinConformidad } : {}) } : { estado: v.estado, motivo: v.motivo };
  const actualizado = await prisma.pago.findUniqueOrThrow({ where: { id: pago.id }, include: includePago });
  res.json((await conAvisoMulta([formatearPago(actualizado, 'completa')]))[0]);
});

// ---------- Conformidad del tesorero («el dinero llegó a la cuenta») ----------
/**
 * Da o quita la conformidad del pago (en su principal, si es de un mantenimiento). Sólo mientras el pago siga por validar; idempotente:
 * darla dos veces deja la primera (quién y cuándo), quitarla sin tenerla no cambia nada. El cierre (`UPDATE … WHERE por_validar`) y la lectura
 * posterior evitan que una validación que llega a la vez deje una conformidad cambiada en un pago ya revisado.
 */
async function cambiarConformidad(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], dar: boolean) {
  const u = currentUser(req);
  if (!esTesorero(u)) throw forbidden('La conformidad la da el tesorero de la junta');
  const pago = res.locals.pago as PagoCargado;
  if (pago.usuario_id === u.id) throw forbidden('No puedes dar la conformidad de tu propio pago: lo hace otra persona de la junta o la administración lo valida');
  const cambio = await prisma.pago.updateMany({
    where: { id: pago.id, estado_validacion: 'por_validar', conformidad_at: dar ? null : { not: null } },
    data: dar ? { conformidad_at: new Date(), conformidad_por_id: u.id } : { conformidad_at: null, conformidad_por_id: null },
  });
  const actual = await prisma.pago.findUniqueOrThrow({ where: { id: pago.id }, include: includePago });
  if (cambio.count === 0 && actual.estado_validacion !== 'por_validar') throw conflict('Este pago ya fue revisado: la conformidad ya no se puede cambiar');
  res.locals.accion = dar ? 'dar_conformidad' : 'quitar_conformidad';
  res.locals.auditDetalle = { conformidad: dar, cambio: cambio.count > 0 };
  // Si la IA ya había leído un voucher que coincide, la conformidad es lo que faltaba: el pago se valida solo (si el condominio lo tiene encendido).
  // Un fallo aquí no deshace la conformidad ya dada: el pago queda por validar y la administradora lo cierra.
  const validado = dar && actual.estado_validacion === 'por_validar'
    ? await validarSiCumple(pago.id).catch((err) => { console.error('[conformidad] no se pudo validar solo', err instanceof Error ? err.name : 'error'); return false; })
    : false;
  const resultado = validado ? await prisma.pago.findUniqueOrThrow({ where: { id: pago.id }, include: includePago }) : actual;
  res.json((await conTesoreroRegistrado([formatearPago(resultado, 'completa')]))[0]);
}

comprobantesRouter.put('/:id/conformidad', requireRole('propietario'), cargarPagoDeLaJunta, (req, res) => cambiarConformidad(req, res, true));
comprobantesRouter.delete('/:id/conformidad', requireRole('propietario'), cargarPagoDeLaJunta, (req, res) => cambiarConformidad(req, res, false));

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
