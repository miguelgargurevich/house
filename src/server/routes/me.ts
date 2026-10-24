import bcrypt from 'bcrypt';
import { Router, type RequestHandler } from 'express';
import { BCRYPT_COST } from '../config';
import { prisma } from '../db';
import { HttpError, conflict, invalid, notFound } from '../errors';
import { filtroEstadoCargo, formatearCargo, formatearPago, includeCargo, includePago, type EstadoCargo } from '../lib/cargos';
import { currentUser, requireRole, type AuthUser } from '../middleware/auth';
import { listQuerySchema, parse, parseBody, parseId, parseOrden, passwordSchema, telefonoSchema, texto, z } from '../validation';
import { METODOS_PAGO } from './pagos';

/** Unidades del residente: las suyas si es propietario, la que habita si es inquilino. */
function unidadesPropias(u: AuthUser) {
  if (u.rol === 'propietario') return { propietario_id: u.id };
  if (u.rol === 'inquilino') return { inquilino_id: u.id };
  return { id: -1 }; // otros roles (p. ej. superadmin) no tienen unidades propias
}

const page = (q: z.infer<typeof listQuerySchema>) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });

export function meRouter(limitePassword: RequestHandler) {
  const router = Router();
  router.use((_req, res, next) => {
    res.locals.entidad = 'usuario';
    next();
  });

  // ---------- Perfil ----------
  router.put('/', async (req, res) => {
    const u = currentUser(req);
    const data = parseBody(z.object({ nombre: texto(120), telefono: telefonoSchema }), req);
    const usuario = await prisma.usuario.update({
      where: { id: u.id },
      data,
      select: { id: true, nombre: true, email: true, telefono: true, rol: true, empresa_id: true, complejo_id: true },
    });
    res.locals.entidadId = u.id;
    res.json(usuario);
  });

  router.put('/password', limitePassword, async (req, res) => {
    const u = currentUser(req);
    const { actual, nueva } = parseBody(z.object({ actual: z.string().min(1, 'Es obligatoria').max(200), nueva: passwordSchema }), req);
    const usuario = await prisma.usuario.findUnique({ where: { id: u.id }, omit: { password_hash: false } });
    if (!usuario?.password_hash || !(await bcrypt.compare(actual, usuario.password_hash))) {
      throw new HttpError(400, 'La contraseña actual no es correcta');
    }
    if (actual === nueva) throw invalid('Datos inválidos: nueva: debe ser distinta de la actual', { nueva: 'Debe ser distinta de la actual' });
    await prisma.usuario.update({ where: { id: u.id }, data: { password_hash: await bcrypt.hash(nueva, BCRYPT_COST) } });
    res.locals.entidadId = u.id;
    res.locals.auditDetalle = { campo: 'password' };
    res.json({ ok: true });
  });

  // ---------- Residentes ----------
  const residente = requireRole('propietario', 'inquilino');

  router.get('/unidades', residente, async (req, res) => {
    const u = currentUser(req);
    const q = parse(listQuerySchema, req.query);
    const where = {
      AND: [unidadesPropias(u), q.q ? { OR: [{ codigo: { contains: q.q, mode: 'insensitive' as const } }, { descripcion: { contains: q.q, mode: 'insensitive' as const } }] } : {}],
    };
    const orderBy = parseOrden(q.orden, ['id', 'codigo', 'tipo'], { codigo: 'asc' });
    const [total, items] = await Promise.all([
      prisma.unidad.count({ where }),
      prisma.unidad.findMany({
        where,
        orderBy: [orderBy, { id: 'asc' }],
        ...page(q),
        include: { complejo: { select: { id: true, nombre: true, direccion: true } }, propietario: { select: { id: true, nombre: true } }, inquilino: { select: { id: true, nombre: true } } },
      }),
    ]);
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  });

  const cargosQuery = listQuerySchema.extend({ estado: z.enum(['pendiente', 'pagado', 'vencido', 'en_revision']).optional() });

  router.get('/cargos', residente, async (req, res) => {
    const u = currentUser(req);
    const q = parse(cargosQuery, req.query);
    const where = { AND: [{ unidad: unidadesPropias(u) }, q.estado ? filtroEstadoCargo(q.estado as EstadoCargo) : {}, q.q ? { unidad: { codigo: { contains: q.q, mode: 'insensitive' as const } } } : {}] };
    let orderBy: object = { reciboConcepto: { recibo: { fecha_vencimiento: 'desc' } } };
    if (q.orden) {
      const o = parseOrden(q.orden, ['id', 'monto', 'fecha_vencimiento'], {});
      orderBy = 'fecha_vencimiento' in o ? { reciboConcepto: { recibo: { fecha_vencimiento: o.fecha_vencimiento } } } : o;
    }
    const [total, rows] = await Promise.all([
      prisma.reciboConceptoUnidad.count({ where }),
      prisma.reciboConceptoUnidad.findMany({ where, orderBy: [orderBy, { id: 'asc' }], ...page(q), include: includeCargo }),
    ]);
    res.json({ items: rows.map(formatearCargo), total, page: q.page, pageSize: q.pageSize });
  });

  router.get('/cargos/:id', residente, async (req, res) => {
    const u = currentUser(req);
    const cargo = await prisma.reciboConceptoUnidad.findFirst({ where: { id: parseId(req), unidad: unidadesPropias(u) }, include: includeCargo });
    if (!cargo) throw notFound('Cargo');
    res.json(formatearCargo(cargo));
  });

  router.get('/pagos', residente, async (req, res) => {
    const u = currentUser(req);
    const q = parse(listQuerySchema, req.query);
    const where = { reciboConceptoUnidad: { unidad: unidadesPropias(u) } };
    const orderBy = parseOrden(q.orden, ['id', 'monto', 'fecha_pago'], { fecha_pago: 'desc' });
    const [total, rows] = await Promise.all([
      prisma.pago.count({ where }),
      prisma.pago.findMany({ where, orderBy: [orderBy, { id: 'asc' }], ...page(q), include: includePago }),
    ]);
    res.json({ items: rows.map(formatearPago), total, page: q.page, pageSize: q.pageSize });
  });

  router.post('/cargos/:id/pagos', residente, async (req, res) => {
    const u = currentUser(req);
    const id = parseId(req);
    const body = parseBody(
      z.object({
        metodo_pago: z.enum(METODOS_PAGO, { error: `metodo_pago debe ser: ${METODOS_PAGO.join(', ')}` }),
        referencia: texto(120).nullish(),
        observaciones: texto(500).nullish(),
      }),
      req,
    );
    const pago = await prisma.$transaction(async (tx) => {
      const cargo = await tx.reciboConceptoUnidad.findFirst({ where: { id, unidad: unidadesPropias(u) } });
      if (!cargo) throw notFound('Cargo');
      // Cierre atómico: sólo uno de dos pagos simultáneos del mismo cargo logra pasar de abierto a en revisión.
      const cerrado = await tx.reciboConceptoUnidad.updateMany({
        where: { id, OR: [{ estado_pago: null }, { estado_pago: { notIn: ['pagado', 'en_revision'] } }] },
        data: { estado_pago: 'en_revision', fecha_pago: null },
      });
      if (cerrado.count === 0) throw conflict(cargo.estado_pago === 'en_revision' ? 'Este cargo ya tiene un pago en revisión' : 'Este cargo ya fue pagado');
      // El administrador valida el pago; hasta entonces no cuenta como cobrado.
      return tx.pago.create({
        data: { recibo_concepto_unidad_id: id, monto: cargo.monto, usuario_id: u.id, metodo_pago: body.metodo_pago, referencia: body.referencia, observaciones: body.observaciones, estado_validacion: 'por_validar' },
      });
    });
    const cargo = await prisma.reciboConceptoUnidad.findUniqueOrThrow({ where: { id }, include: includeCargo });
    res.locals.entidad = 'pago';
    res.locals.entidadId = pago.id;
    res.status(201).json({ ...pago, cargo: formatearCargo(cargo) });
  });

  return router;
}
