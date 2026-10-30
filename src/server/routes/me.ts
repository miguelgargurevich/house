import bcrypt from 'bcrypt';
import { Router, type RequestHandler } from 'express';
import { BCRYPT_COST } from '../config';
import { prisma } from '../db';
import { HttpError, conflict, forbidden, invalid, notFound } from '../errors';
import { filtroEstadoCargo, formatearCargo, formatearPago, includeCargo, includePago, type EstadoCargo } from '../lib/cargos';
import { relojDeCondominios } from '../lib/zonas';
import { ipDe, registrarAuditoria } from '../middleware/audit';
import { currentUser, requireRole, type AuthUser } from '../middleware/auth';
import { camposDeFormulario, recibirVoucher, ubicado, voucherVerificado } from '../lib/voucherSubida';
import { avisarVoucherEnSegundoPlano } from '../services/avisos/voucherBlock';
import { iniciarEvaluacion } from '../services/evaluacion';
import { contrasenaIgualACorreo, listQuerySchema, MENSAJE_PASSWORD_CORREO, parse, parseBody, parseId, parseOrden, passwordSchema, telefonoSchema, texto, z } from '../validation';
import { enviarImagen } from '../services/imagenes';
import { revocarDeUsuario } from '../services/sesiones';
import { ORDEN_MANTENIMIENTOS, estadosQuery, listarMantenimientos, type OrdenMantenimientos } from '../lib/mantenimientos';
import { historialXlsx } from '../lib/historialExcel';
import { historialResidente } from '../services/historial';
import { conResumenDeGrupo, detalleMantenimiento, pagarMantenimiento, soloPrincipales } from '../services/mantenimiento';
import { idSchema } from '../validation';
import { METODOS_PAGO } from './pagos';
import { comunicadoDeUnidades, origenDe } from '../services/comunicados';
import { juntasDelResidente } from '../services/juntas';

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
    if (contrasenaIgualACorreo(nueva, usuario.email)) throw invalid(`Datos inválidos: nueva: ${MENSAJE_PASSWORD_CORREO.toLowerCase()}`, { nueva: MENSAJE_PASSWORD_CORREO });
    if (actual === nueva) throw invalid('Datos inválidos: nueva: debe ser distinta de la actual', { nueva: 'Debe ser distinta de la actual' });
    await prisma.usuario.update({ where: { id: u.id }, data: { password_hash: await bcrypt.hash(nueva, BCRYPT_COST) } });
    await revocarDeUsuario(u.id, req.sesion!.id); // quien robó la contraseña vieja pierde su sesión
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
        include: { complejo: { select: { id: true, nombre: true, direccion: true } }, estructura: { select: { id: true, nombre: true } }, propietario: { select: { id: true, nombre: true } }, inquilino: { select: { id: true, nombre: true } } },
      }),
    ]);
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  });

  /**
   * @openapi
   * /api/me/comunicados:
   *   get:
   *     summary: Comunicados de la administración y la junta que alcanzan al residente
   *     tags: [Comunicados]
   *     description: Los no archivados de los condominios de SUS unidades (como propietario o inquilino), de todo el condominio o del block de alguna de sus unidades. Fijados primero, luego los más nuevos.
   *     responses:
   *       200: { description: "`{ items, total, page, pageSize }`" }
   */
  router.get('/comunicados', residente, async (req, res) => {
    const u = currentUser(req);
    const q = parse(listQuerySchema, req.query);
    const unidades = await prisma.unidad.findMany({ where: unidadesPropias(u), select: { complejo_id: true, estructura_id: true } });
    const where = {
      AND: [
        { archivado_at: null },
        comunicadoDeUnidades(unidades),
        q.q ? { OR: [{ titulo: { contains: q.q, mode: 'insensitive' as const } }, { cuerpo: { contains: q.q, mode: 'insensitive' as const } }] } : {},
      ],
    };
    const [total, rows] = await Promise.all([
      prisma.comunicado.count({ where }),
      prisma.comunicado.findMany({
        where,
        orderBy: [{ fijado: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
        ...page(q),
        select: { id: true, titulo: true, cuerpo: true, fijado: true, created_at: true, complejo: { select: { id: true, nombre: true } }, estructura: { select: { id: true, nombre: true } }, autor: { select: { rol: true } } },
      }),
    ]);
    res.json({ items: rows.map(({ autor, ...c }) => ({ ...c, origen: origenDe(autor) })), total, page: q.page, pageSize: q.pageSize });
  });

  /**
   * @openapi
   * /api/me/juntas:
   *   get:
   *     summary: La junta de mi block y la Junta central (sólo lectura)
   *     tags: [Juntas]
   *     description: Las juntas VIGENTES de los blocks donde el residente tiene unidades (propietario o inquilino) y la Junta central de esos condominios, si existe. Por junta, el cargo, el nombre y los departamentos de cada miembro, el correo de la junta y sus cuentas activas. Nunca el correo ni el celular de los miembros. Un block sin junta vigente sale con `junta` null.
   *     responses:
   *       200: { description: "`{ items: [{ ambito: { complejo, estructura|null }, junta: { desde, correo, miembros, cuentas }|null }] }`" }
   *       403: { description: Rol distinto de propietario o inquilino }
   */
  router.get('/juntas', residente, async (req, res) => {
    const u = currentUser(req);
    if (u.rol !== 'propietario' && u.rol !== 'inquilino') throw forbidden(); // `requireRole` deja pasar al superadmin: aquí no hay unidades propias
    const unidades = await prisma.unidad.findMany({ where: unidadesPropias(u), orderBy: [{ codigo: 'asc' }, { id: 'asc' }], select: { codigo: true, complejo_id: true, estructura_id: true } });
    res.json({ items: await juntasDelResidente(unidades) });
  });

  const cargosQuery = listQuerySchema.extend({ estado: z.enum(['pendiente', 'pagado', 'vencido', 'en_revision']).optional() });

  router.get('/cargos', residente, async (req, res) => {
    const u = currentUser(req);
    const q = parse(cargosQuery, req.query);
    const where = { AND: [{ unidad: unidadesPropias(u) }, q.estado ? filtroEstadoCargo(q.estado as EstadoCargo, await relojDeCondominios()) : {}, q.q ? { unidad: { codigo: { contains: q.q, mode: 'insensitive' as const } } } : {}] };
    let orderBy: object = { reciboConcepto: { recibo: { fecha_vencimiento: 'desc' } } };
    if (q.orden) {
      const o = parseOrden(q.orden, ['id', 'monto', 'fecha_vencimiento'], {});
      orderBy = 'fecha_vencimiento' in o ? { reciboConcepto: { recibo: { fecha_vencimiento: o.fecha_vencimiento } } } : o;
    }
    const [total, rows] = await Promise.all([
      prisma.reciboConceptoUnidad.count({ where }),
      prisma.reciboConceptoUnidad.findMany({ where, orderBy: [orderBy, { id: 'asc' }], ...page(q), include: includeCargo }),
    ]);
    res.json({ items: rows.map((c) => formatearCargo(c)), total, page: q.page, pageSize: q.pageSize });
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
    // Una fila por pago del mantenimiento (el principal de cada grupo) y los pagos sueltos antiguos.
    const where = { AND: [{ reciboConceptoUnidad: { unidad: unidadesPropias(u) } }, soloPrincipales] };
    const orderBy = parseOrden(q.orden, ['id', 'monto', 'fecha_pago'], { fecha_pago: 'desc' });
    const [total, rows] = await Promise.all([
      prisma.pago.count({ where }),
      prisma.pago.findMany({ where, orderBy: [orderBy, { id: 'asc' }], ...page(q), include: includePago }),
    ]);
    res.json({ items: await conResumenDeGrupo(rows.map((p) => formatearPago(p))), total, page: q.page, pageSize: q.pageSize });
  });

  // ---------- Historial (cifras y gráficos de sus mantenimientos) ----------
  const historialQuery = z.object({ unidad_id: idSchema.optional(), anio: z.coerce.number({ error: 'Debe ser un número' }).int('Debe ser un entero').min(2000, 'Año fuera de rango').max(2100, 'Año fuera de rango').optional() });

  router.get('/historial', residente, async (req, res) => {
    const q = parse(historialQuery, req.query);
    res.json(await historialResidente(unidadesPropias(currentUser(req)), { unidadId: q.unidad_id, anio: q.anio }));
  });

  router.get('/historial.xlsx', residente, async (req, res) => {
    const q = parse(historialQuery, req.query);
    const h = await historialResidente(unidadesPropias(currentUser(req)), { unidadId: q.unidad_id, anio: q.anio });
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="mi-historial${q.anio ? `-${q.anio}` : ''}.xlsx"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(historialXlsx(h, q.unidad_id));
  });

  const pagoCargo = z.object({
    metodo_pago: z.enum(METODOS_PAGO, { error: `metodo_pago debe ser: ${METODOS_PAGO.join(', ')}` }),
    referencia: texto(120).nullish(),
    observaciones: texto(500).nullish(),
  });
  /** El cargo se ubica ANTES de recibir el archivo: uno ajeno recibe 404 sin que se lea el cuerpo. */
  const ubicarCargoPropio = async (req: Parameters<typeof currentUser>[0]) => {
    const cargo = await prisma.reciboConceptoUnidad.findFirst({ where: { id: parseId(req), unidad: unidadesPropias(currentUser(req)) }, select: { id: true } });
    if (!cargo) throw notFound('Cargo');
    return cargo;
  };

  /**
   * Pago suelto de un cargo: igual que el del mantenimiento, `multipart/form-data` con los campos y el voucher OBLIGATORIO en `voucher`
   * (sin voucher, o con uno que no sirve, no se crea nada: quien valida lo comprueba contra ese archivo). Pago y comprobante van en la misma transacción.
   */
  router.post('/cargos/:id/pagos', residente, recibirVoucher('cargoPropio', ubicarCargoPropio), async (req, res) => {
    const u = currentUser(req);
    const id = parseId(req);
    if (!ubicado(res, 'cargoPropio')) await ubicarCargoPropio(req);
    const body = req.is('multipart/form-data') ? parse(pagoCargo, camposDeFormulario(req.body)) : parseBody(pagoCargo, req);
    if (!req.file) throw invalid('Adjunta la foto o el PDF de tu voucher', { voucher: 'Obligatorio' });
    const voucher = voucherVerificado(req.file, u.id);
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
      const creado = await tx.pago.create({
        data: { recibo_concepto_unidad_id: id, monto: cargo.monto, usuario_id: u.id, metodo_pago: body.metodo_pago, referencia: body.referencia, observaciones: body.observaciones, estado_validacion: 'por_validar' },
      });
      const { subidoPorId, ...archivo } = voucher;
      await tx.archivoComprobante.create({ data: { pago_id: creado.id, ...archivo, subido_por_id: subidoPorId }, select: { id: true } });
      return creado;
    });
    const cargo = await prisma.reciboConceptoUnidad.findUniqueOrThrow({ where: { id }, include: includeCargo });
    res.locals.entidad = 'pago';
    res.locals.entidadId = pago.id;
    res.locals.auditDetalle = { cargo_id: id, con_voucher: true };
    // Mismo registro que al subir un comprobante (sólo metadatos), y la IA y el correo a la junta corren en segundo plano: no frenan la respuesta ni, si fallan, el pago.
    await registrarAuditoria({ usuario_id: u.id, accion: 'subir_comprobante', entidad: 'pago', entidad_id: pago.id, detalle: { nombre: voucher.nombre, tipo_mime: voucher.tipo_mime, tamano: voucher.tamano, sha256: voucher.sha256 }, ip: ipDe(req) });
    await iniciarEvaluacion(pago.id, 'subida').catch((err) => console.error('[evaluacion] no se pudo iniciar', err instanceof Error ? err.name : 'error'));
    avisarVoucherEnSegundoPlano(pago.id);
    res.status(201).json({ ...pago, cargo: formatearCargo(cargo) });
  });

  // ---------- Mantenimientos (un recibo por departamento y mes) ----------
  const ids2 = z.object({ reciboId: idSchema, unidadId: idSchema });
  const mantQuery = listQuerySchema.extend({ estado: estadosQuery, unidad_id: idSchema.optional() });
  const idsDeUnidades = async (u: AuthUser) => (await prisma.unidad.findMany({ where: unidadesPropias(u), select: { id: true } })).map((x) => x.id);

  router.get('/mantenimientos', residente, async (req, res) => {
    const u = currentUser(req);
    const q = parse(mantQuery, req.query);
    const propias = await idsDeUnidades(u);
    const unidadIds = q.unidad_id !== undefined ? propias.filter((id) => id === q.unidad_id) : propias; // una unidad ajena no devuelve nada
    const orden = parseOrden(q.orden, [...ORDEN_MANTENIMIENTOS], {});
    const campo = Object.keys(orden)[0] as OrdenMantenimientos | undefined;
    const r = await listarMantenimientos(
      { unidadIds, estado: q.estado, q: q.q },
      { page: q.page, pageSize: q.pageSize, orden: campo ? { campo, dir: (orden as Record<string, 'asc' | 'desc'>)[campo] } : undefined },
    );
    // Motivo del último pago si fue rechazado y el mantenimiento volvió a quedar por pagar (misma regla que `motivoRechazoMant` del detalle):
    // la tarjeta de «Mis recibos» lo muestra con «Pagar de nuevo».
    const abiertos = r.items.filter((m) => m.estado !== 'pagado' && m.estado !== 'en_revision');
    const pagos = abiertos.length
      ? await prisma.pago.findMany({
          where: { OR: abiertos.map((m) => ({ reciboConceptoUnidad: { unidad_id: m.unidad_id, reciboConcepto: { recibo_id: m.recibo_id } } })) },
          orderBy: [{ fecha_pago: 'desc' }, { id: 'asc' }],
          select: { estado_validacion: true, motivo_rechazo: true, reciboConceptoUnidad: { select: { unidad_id: true, reciboConcepto: { select: { recibo_id: true } } } } },
        })
      : [];
    const ultimo = new Map<string, (typeof pagos)[number]>();
    for (const p of pagos) {
      const k = `${p.reciboConceptoUnidad?.reciboConcepto?.recibo_id}-${p.reciboConceptoUnidad?.unidad_id}`;
      if (!ultimo.has(k)) ultimo.set(k, p);
    }
    const items = r.items.map((m) => {
      const p = abiertos.includes(m) ? ultimo.get(`${m.recibo_id}-${m.unidad_id}`) : undefined;
      return { ...m, motivo_rechazo: p?.estado_validacion === 'rechazado' ? p.motivo_rechazo ?? 'Sin motivo indicado' : null };
    });
    res.json({ items, total: r.total, page: q.page, pageSize: q.pageSize });
  });

  router.get('/mantenimientos/:reciboId/:unidadId', residente, async (req, res) => {
    const u = currentUser(req);
    const { reciboId, unidadId } = parse(ids2, req.params);
    res.json(await detalleMantenimiento(reciboId, unidadId, { unidadWhere: unidadesPropias(u), vista: 'residente' }));
  });

  /** Foto del contómetro de SU departamento en ese recibo (la de otra unidad → 404). */
  router.get('/mantenimientos/:reciboId/:unidadId/agua/foto', residente, async (req, res) => {
    const u = currentUser(req);
    const { reciboId, unidadId } = parse(ids2, req.params);
    const unidad = await prisma.unidad.findFirst({ where: { AND: [{ id: unidadId }, unidadesPropias(u)] }, select: { id: true } });
    const l = unidad ? await prisma.lecturaAgua.findUnique({ where: { unidad_id_recibo_id: { unidad_id: unidadId, recibo_id: reciboId } }, select: { foto_datos: true, foto_tipo_mime: true, foto_nombre: true } }) : null;
    if (!l?.foto_datos || !l.foto_tipo_mime) throw notFound('Foto');
    enviarImagen(res, { datos: l.foto_datos, tipo_mime: l.foto_tipo_mime, nombre: l.foto_nombre });
  });

  const pagoMantenimiento = z.strictObject({
    metodo_pago: z.enum(METODOS_PAGO, { error: `metodo_pago debe ser: ${METODOS_PAGO.join(', ')}` }),
    referencia: texto(120).nullish(),
    observaciones: texto(500).nullish(),
  });

  /** El departamento del pago, sólo si es de quien paga (404 si no). */
  async function ubicarPropio(req: Parameters<typeof currentUser>[0], unidadId: number) {
    const unidad = await prisma.unidad.findFirst({ where: { AND: [{ id: unidadId }, unidadesPropias(currentUser(req))] }, select: { id: true } });
    if (!unidad) throw notFound('Mantenimiento');
    return unidad;
  }
  /** El departamento se ubica ANTES de recibir el archivo: uno ajeno recibe 404 sin que se lea el cuerpo. */
  const voucherDelPago = recibirVoucher('unidadPropia', (req) => ubicarPropio(req, parse(ids2, req.params).unidadId));

  /**
   * Paga el mantenimiento completo en UN solo pedido: `multipart/form-data` con los campos (`metodo_pago`, `referencia` opcional) y el voucher en `voucher`,
   * que es obligatorio. Pago y comprobante se guardan en la MISMA transacción (el pago nace `por_validar`) y la IA lee el voucher en segundo plano.
   * Sin voucher, o con uno que no sirve, no se crea nada. El servidor calcula los montos.
   */
  router.post('/mantenimientos/:reciboId/:unidadId/pagos', residente, voucherDelPago, async (req, res) => {
    const u = currentUser(req);
    const { reciboId, unidadId } = parse(ids2, req.params);
    if (!ubicado(res, 'unidadPropia')) await ubicarPropio(req, unidadId);
    const body = req.is('multipart/form-data') ? parse(pagoMantenimiento, camposDeFormulario(req.body)) : parseBody(pagoMantenimiento, req);
    if (!req.file) throw invalid('Adjunta la foto o el PDF de tu voucher', { voucher: 'Obligatorio' });
    const voucher = voucherVerificado(req.file, u.id);
    const r = await pagarMantenimiento({ reciboId, unidadId, usuarioId: u.id, modo: 'residente', comprobante: voucher, ...body });
    res.locals.entidad = 'pago';
    res.locals.entidadId = r.pago_id;
    res.locals.auditDetalle = { grupo: r.grupo, total: r.total, cargos: r.cargos, recibo_id: reciboId, unidad_id: unidadId, con_voucher: true };
    // Mismo registro que al subir un comprobante (sólo metadatos, nunca el contenido), y la IA lo lee en segundo plano: no frena la respuesta ni, si falla, el pago.
    await registrarAuditoria({ usuario_id: u.id, accion: 'subir_comprobante', entidad: 'pago', entidad_id: r.pago_id, detalle: { nombre: voucher.nombre, tipo_mime: voucher.tipo_mime, tamano: voucher.tamano, sha256: voucher.sha256 }, ip: ipDe(req) });
    await iniciarEvaluacion(r.pago_id, 'subida').catch((err) => console.error('[evaluacion] no se pudo iniciar', err instanceof Error ? err.name : 'error'));
    // El voucher también va por correo a la junta del block, en segundo plano: no frena la respuesta ni, si falla, el pago.
    avisarVoucherEnSegundoPlano(r.pago_id);
    res.status(201).json({ ...r, mantenimiento: await detalleMantenimiento(reciboId, unidadId, { unidadWhere: unidadesPropias(u), vista: 'residente' }) });
  });

  return router;
}
