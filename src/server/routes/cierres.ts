// Cierre del mes de cada block: lo facturado al block, lo cobrado a los vecinos y lo que la junta del block paga (aporte a la Junta central, agua y luz, proveedores).
// La Junta central tiene su propio cierre (aportes de los blocks, alquiler de estacionamientos y otros ingresos, egresos; Fondo de ahorros de la Junta central).
// El tesorero del block registra sus pagos con voucher; el tesorero central confirma lo que llegó a la Junta central; la administración lo ve todo. Ver docs/API-CONTRATO.md.
import { Prisma } from '@prisma/client';
import { Router, type Request } from 'express';
import { prisma } from '../db';
import { conflict, forbidden, invalid, notFound } from '../errors';
import { hoyEn } from '../lib/fechas';
import { ambitoJunta } from '../lib/junta';
import { empresaDe, scopeBlocksCierre, scopeComplejos, scopeEgresos, scopeMovimientosCentral } from '../lib/scope';
import { camposDeFormulario, recibirVoucher, ubicado, voucherVerificado } from '../lib/voucherSubida';
import { zonaDeComplejo } from '../lib/zonas';
import { currentUser, type AuthUser } from '../middleware/auth';
import { dispositionInline } from '../services/comprobantes';
import { calcularBlocks, cuentaDe, dinero, fondoAl, incluirEgresoCierre, mesDeBlock, registroDeEgreso, type CierreMes, type LineaCierre } from '../services/cierres/calculo';
import { recibirVoucherCentral } from '../services/cierres/subida';
import { CATEGORIAS, CATEGORIAS_EGRESO, CATEGORIAS_INGRESO, CATEGORIA_ETIQUETA, calcularCentral, esIngreso, incluirMovimiento, movimientoDe } from '../services/cierres/central';
import { DESTINO_AYUDA, DESTINO_ETIQUETA, lineaSchemaRegex, llevaConformidad } from '../services/cierres/destinos';
import { esAdministracion, esJuntaCentral, esTesoreroCentral, puedeDarConformidad, puedeRegistrar, puedeRegistrarCentral, puedeVerCentral } from '../services/cierres/permisos';
import { idSchema, montoSchema, parse, parseBody, parseId, parseQuery, textoOpcional, z } from '../validation';
import { exigirOperativo } from '../services/comercial/operativo';

export const cierresRouter = Router();
cierresRouter.use((req, res, next) => {
  res.locals.entidad = 'cierre_block';
  scopeEgresos(currentUser(req)); // 403 si no es administración ni junta (presidente/tesorero)
  next();
});

const mesSchema = z.coerce.number({ error: 'Debe ser un número' }).int().min(1, 'Mes de 1 a 12').max(12, 'Mes de 1 a 12');
const anioSchema = z.coerce.number({ error: 'Debe ser un número' }).int().min(2000, 'Año inválido').max(2100, 'Año inválido');
const periodoQuery = z.object({ mes: mesSchema.optional(), anio: anioSchema.optional(), complejo_id: idSchema.optional(), destino: z.enum(['central', 'administradora']).optional() });

/** El mes que se está cerrando: por defecto el anterior al actual, contado en la zona del condominio (el cierre se hace ~el día 5 del mes siguiente). */
async function periodo(q: { mes?: number; anio?: number }, complejoId: number): Promise<{ mes: number; anio: number }> {
  if (q.mes !== undefined && q.anio !== undefined) return { mes: q.mes, anio: q.anio };
  const hoy = hoyEn(await zonaDeComplejo(complejoId));
  const previo = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1));
  return { mes: q.mes ?? previo.getUTCMonth() + 1, anio: q.anio ?? previo.getUTCFullYear() };
}

/** Condominio del que se habla: la junta, el suyo; la administración lo elige con `complejo_id` (de otra empresa → 404). */
async function condominioDe(u: AuthUser, pedido: number | undefined): Promise<number> {
  const a = ambitoJunta(u);
  if (a) {
    if (pedido !== undefined && pedido !== a.complejo_id) throw notFound('Condominio');
    return a.complejo_id;
  }
  if (pedido === undefined) throw invalid('Datos inválidos: complejo_id: es obligatorio', { complejo_id: 'Obligatorio' });
  if (!(await prisma.complejoHabitacional.findFirst({ where: { AND: [{ id: pedido }, scopeComplejos(u)] }, select: { id: true } }))) throw notFound('Condominio');
  return pedido;
}

type Block = { id: number; nombre: string | null; complejo_id: number | null };
/** Un block del alcance de quien llama; de otro block, otro condominio u otra empresa → 404 (no se revela que existe). */
async function cargarBlock(u: AuthUser, id: number): Promise<Block> {
  const b = await prisma.estructura.findFirst({ where: { AND: [{ id }, scopeBlocksCierre(u)] }, select: { id: true, nombre: true, complejo_id: true } });
  if (!b || b.complejo_id == null) throw notFound('Block');
  return b;
}

/** Cuenta (medios de pago activos) de la junta central vigente: adónde se transfiere el aporte. Sin QR ni datos de contacto. */
async function cuentasCentral(complejoId: number) {
  const junta = await prisma.juntaDirectiva.findFirst({ where: { complejo_id: complejoId, estructura_id: null, hasta: null }, select: { id: true } });
  if (!junta) return [];
  return prisma.medioPago.findMany({
    where: { junta_id: junta.id, activo: true },
    orderBy: [{ orden: 'asc' }, { id: 'asc' }],
    select: { id: true, tipo: true, banco: true, banco_otro: true, tipo_cuenta: true, numero_cuenta: true, cci: true, moneda: true, titular: true },
  });
}

/** Moneda del condominio (todo monto del cierre va en ella). */
async function monedaDe(complejoId: number): Promise<string> {
  return (await prisma.complejoHabitacional.findUnique({ where: { id: complejoId }, select: { moneda: true } }))?.moneda ?? 'PEN';
}

/** Cuenta de la empresa administradora del condominio: adónde se paga el concepto de administración. */
async function cuentaAdministradora(complejoId: number) {
  const c = await prisma.complejoHabitacional.findUnique({ where: { id: complejoId }, select: { empresa: { select: { nombre: true, cuenta_banco: true, cuenta_tipo: true, cuenta_numero: true, cuenta_cci: true, cuenta_titular: true } } } });
  return c?.empresa ? { empresa: c.empresa.nombre, ...cuentaDe(c.empresa) } : null;
}

const resumenMes = (c: CierreMes, fondo: string) => ({
  estado: c.estado,
  lineas_total: c.lineas_total,
  lineas_pagadas: c.lineas_pagadas,
  por_clasificar: c.sin_clasificar.length,
  facturado_total: c.facturado_total,
  cobrado_total: c.cobrado_total,
  pagado_total: c.pagado_total,
  ahorro_mes: c.ahorro_mes,
  sobrante_mes: c.sobrante_mes,
  fondo_ahorros: fondo,
});

/** Si quien llama puede dar (o quitar) la conformidad de una línea: le toca por su cargo y no es su propio registro. */
function permisosDeLinea(u: AuthUser, l: LineaCierre, complejoId: number) {
  const r = l.registro;
  return {
    lleva_conformidad: llevaConformidad(l.destino),
    puede_conformidad: !!r && llevaConformidad(l.destino) && puedeDarConformidad(u, String(l.destino), complejoId) && r.registrado_por?.id !== u.id,
  };
}

// ---------- Tabla block × estado del mes ----------
cierresRouter.get('/', async (req, res) => {
  const u = currentUser(req);
  const q = parseQuery(periodoQuery, req);
  const complejoId = await condominioDe(u, q.complejo_id);
  const { mes, anio } = await periodo(q, complejoId);
  const blocks = await prisma.estructura.findMany({
    where: { AND: [scopeBlocksCierre(u), { complejo_id: complejoId }, { OR: [{ recibos: { some: {} } }, { egresosBlock: { some: {} } }] }] },
    select: { id: true, nombre: true },
    orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
  });
  const calculo = await calcularBlocks(blocks.map((b) => b.id));
  const filas = blocks.map((b) => {
    const meses = calculo.get(b.id)!;
    return { estructura: b, ...resumenMes(mesDeBlock(meses, b.id, complejoId, anio, mes), fondoAl(meses, anio, mes)) };
  });
  const por_estado: Record<string, number> = {};
  for (const f of filas) por_estado[f.estado] = (por_estado[f.estado] ?? 0) + 1;
  res.json({ complejo_id: complejoId, moneda: await monedaDe(complejoId), mes, anio, blocks: filas, por_estado });
});

// ---------- Aportes a la Junta central (lo que llega de cada block) ----------
cierresRouter.get('/aportes', async (req, res) => {
  const u = currentUser(req);
  const q = parseQuery(periodoQuery, req);
  const complejoId = await condominioDe(u, q.complejo_id);
  if (!esAdministracion(u) && !esJuntaCentral(u, complejoId)) throw forbidden('Los aportes a la Junta central los ve la Junta central o la administración');
  // Por defecto, lo que llega a la Junta central; la administración también puede ver lo que llega a la empresa administradora.
  const destino = q.destino ?? 'central';
  if (destino === 'administradora' && !esAdministracion(u)) throw forbidden('Los pagos a la empresa administradora los ve la administración');
  const { mes, anio } = await periodo(q, complejoId);
  const blocks = await prisma.estructura.findMany({
    where: { AND: [scopeBlocksCierre(u), { complejo_id: complejoId }, { OR: [{ recibos: { some: {} } }, { egresosBlock: { some: {} } }] }] },
    select: { id: true, nombre: true },
    orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
  });
  const calculo = await calcularBlocks(blocks.map((b) => b.id));
  const aportes = blocks.flatMap((b) => {
    const m = mesDeBlock(calculo.get(b.id)!, b.id, complejoId, anio, mes);
    return m.lineas.filter((l) => l.destino === destino && !l.obsoleta).map((l) => ({
      estructura: b,
      linea: l.linea,
      nombre: l.nombre,
      facturado: l.facturado,
      registro: l.registro,
      estado: !l.registro ? 'sin_registrar' : l.registro.conformidad ? 'conforme' : 'sin_conformidad',
      puede_conformidad: !!l.registro && puedeDarConformidad(u, l.destino, complejoId) && l.registro.registrado_por?.id !== u.id,
    }));
  });
  const suma = (xs: string[]) => dinero(xs.reduce((s, x) => s.plus(x), new Prisma.Decimal(0)));
  const recibido = await prisma.egresoBlock.aggregate({ where: { complejo_id: complejoId, destino, conformidad_at: { not: null } }, _sum: { monto_pagado: true } });
  const porConfirmar = await prisma.egresoBlock.aggregate({ where: { complejo_id: complejoId, destino, conformidad_at: null }, _sum: { monto_pagado: true } });
  res.json({
    complejo_id: complejoId, moneda: await monedaDe(complejoId), mes, anio, destino, aportes,
    totales: {
      facturado: suma(aportes.map((a) => a.facturado)),
      registrado: suma(aportes.filter((a) => a.registro).map((a) => a.registro!.monto_pagado)),
      conforme: suma(aportes.filter((a) => a.estado === 'conforme').map((a) => a.registro!.monto_pagado)),
      sin_registrar: aportes.filter((a) => a.estado === 'sin_registrar').length,
      sin_conformidad: aportes.filter((a) => a.estado === 'sin_conformidad').length,
    },
    // Caja de la Junta central: lo que ya confirmó haber recibido de los blocks (de todos los meses). Sus propios egresos aún no se registran.
    caja_central: { recibido: dinero(recibido._sum.monto_pagado ?? 0), por_confirmar: dinero(porConfirmar._sum.monto_pagado ?? 0) },
    puede: { conformidad: destino === 'administradora' ? esAdministracion(u) : esTesoreroCentral(u, complejoId) },
  });
});

// ---------- El cierre de un block ----------
cierresRouter.get('/block/:id', async (req, res) => {
  const u = currentUser(req);
  const block = await cargarBlock(u, parseId(req));
  const q = parseQuery(periodoQuery, req);
  const { mes, anio } = await periodo(q, block.complejo_id!);
  const meses = (await calcularBlocks([block.id])).get(block.id)!;
  const cierre = mesDeBlock(meses, block.id, block.complejo_id, anio, mes);
  const { lineas, ...resto } = cierre;
  res.json({
    ...resto,
    estructura: { id: block.id, nombre: block.nombre },
    complejo_id: block.complejo_id,
    moneda: await monedaDe(block.complejo_id!),
    lineas: lineas.map((l) => ({ ...l, ...permisosDeLinea(u, l, block.complejo_id!) })),
    fondo_ahorros: fondoAl(meses, anio, mes),
    cuentas: { central: await cuentasCentral(block.complejo_id!), administradora: await cuentaAdministradora(block.complejo_id!) },
    etiquetas: DESTINO_ETIQUETA,
    ayudas: DESTINO_AYUDA,
    puede: { registrar: puedeRegistrar(u, block) },
  });
});

// ---------- Registrar el pago de una línea (con voucher) ----------
const pagoSchema = z.object({
  mes: mesSchema,
  anio: anioSchema,
  linea: z.string({ error: 'Debe ser un texto' }).regex(lineaSchemaRegex, 'Línea inválida'),
  monto_pagado: montoSchema.optional(),
  fecha_pago: z.string({ error: 'Fecha inválida' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (usa AAAA-MM-DD)').refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), 'Fecha inválida'),
  referencia: textoOpcional(80),
  observaciones: textoOpcional(300),
});

/** Quien llega a registrar: 404 si el block no es de su alcance (antes de recibir el archivo) y 403 si no es de quienes registran. */
async function ubicarRegistro(req: Request): Promise<Block> {
  const u = currentUser(req);
  const block = await cargarBlock(u, parseId(req));
  if (!puedeRegistrar(u, block)) throw forbidden('Sólo el tesorero del block o la administración registran los pagos del cierre');
  await exigirOperativo(block.complejo_id, u);
  return block;
}

cierresRouter.post('/block/:id/lineas', recibirVoucher('block', ubicarRegistro), async (req, res) => {
  const u = currentUser(req);
  const block = ubicado<Block>(res, 'block') ?? (await ubicarRegistro(req));
  const body = req.is('multipart/form-data') ? parse(pagoSchema, camposDeFormulario(req.body)) : parseBody(pagoSchema, req);
  if (!req.file) throw invalid('Datos inválidos: voucher: adjunta el voucher del pago', { voucher: 'Obligatorio' });
  const voucher = voucherVerificado(req.file, u.id);

  const complejoId = block.complejo_id!;
  const cierre = mesDeBlock((await calcularBlocks([block.id])).get(block.id)!, block.id, complejoId, body.anio, body.mes);
  if (!cierre.hay_recibo) throw conflict('Ese mes no tiene recibo en este block');
  const linea = cierre.lineas.find((l) => l.linea === body.linea && !l.obsoleta);
  if (!linea) throw invalid('Datos inválidos: linea: no existe en el cierre de ese mes', { linea: 'No existe en el cierre de ese mes' });
  if (linea.registro) throw conflict('Esa línea ya tiene su pago registrado');

  // Pago a la empresa administradora y aporte a la Junta central: se transfiere lo facturado (si no dices otro monto). Agua, luz y proveedores: el monto de la boleta o la factura.
  const monto = body.monto_pagado ?? (llevaConformidad(linea.destino) && new Prisma.Decimal(linea.facturado).gt(0) ? linea.facturado : undefined);
  if (monto === undefined) throw invalid('Datos inválidos: monto_pagado: escribe el monto de la boleta o la factura', { monto_pagado: 'Obligatorio' });
  const fecha = new Date(`${body.fecha_pago}T00:00:00Z`);
  if (fecha.getTime() > hoyEn(await zonaDeComplejo(complejoId)).getTime()) throw invalid('Datos inválidos: fecha_pago: no puede ser futura', { fecha_pago: 'No puede ser futura' });

  let creado;
  try {
    creado = await prisma.$transaction(async (tx) => {
      const e = await tx.egresoBlock.create({
        data: {
          complejo_id: complejoId, estructura_id: block.id, mes: body.mes, anio: body.anio, linea: linea.linea, destino: String(linea.destino), concepto_id: linea.concepto_id, proveedor_id: linea.proveedor?.id ?? null,
          facturado: linea.facturado, monto_pagado: monto, fecha_pago: fecha, referencia: body.referencia ?? null, observaciones: body.observaciones ?? null, registrado_por_id: u.id,
        },
      });
      const { subidoPorId, ...archivo } = voucher;
      await tx.archivoEgresoBlock.create({ data: { egreso_id: e.id, nombre: archivo.nombre, tipo_mime: archivo.tipo_mime, tamano: archivo.tamano, sha256: archivo.sha256, datos: archivo.datos, subido_por_id: subidoPorId } });
      return tx.egresoBlock.findUniqueOrThrow({ where: { id: e.id }, include: incluirEgresoCierre });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw conflict('Esa línea ya tiene su pago registrado'); // dos registros a la vez: gana uno
    throw err;
  }
  res.locals.entidadId = creado.id;
  res.locals.accion = 'registrar_pago';
  res.locals.auditDetalle = { estructura_id: block.id, mes: body.mes, anio: body.anio, linea: linea.linea, facturado: linea.facturado, monto_pagado: dinero(monto), sha256: voucher.sha256 }; // nunca el archivo
  res.status(201).json({ linea: linea.linea, registro: registroDeEgreso(creado) });
});

// ---------- Una línea ya registrada ----------
async function cargarEgreso(u: AuthUser, id: number) {
  const e = await prisma.egresoBlock.findFirst({ where: { AND: [{ id }, scopeEgresos(u)] }, include: { ...incluirEgresoCierre, estructura: { select: { id: true, nombre: true, complejo_id: true } } } });
  if (!e) throw notFound('Pago del cierre');
  return e;
}

cierresRouter.get('/lineas/:id/voucher', async (req, res) => {
  const u = currentUser(req);
  const e = await cargarEgreso(u, parseId(req));
  const a = await prisma.archivoEgresoBlock.findUnique({ where: { egreso_id: e.id } });
  if (!a) throw notFound('Voucher');
  res.locals.accion = 'ver_voucher';
  res.locals.entidadId = e.id;
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

cierresRouter.delete('/lineas/:id', async (req, res) => {
  const u = currentUser(req);
  const e = await cargarEgreso(u, parseId(req));
  if (!puedeRegistrar(u, e.estructura)) throw forbidden('Sólo el tesorero del block o la administración corrigen los pagos del cierre');
  await exigirOperativo(e.complejo_id, u);
  if (e.conformidad_at) throw conflict('Ese pago ya tiene conformidad: no se puede quitar');
  await prisma.egresoBlock.delete({ where: { id: e.id } });
  res.locals.entidadId = e.id;
  res.locals.accion = 'quitar_pago';
  res.locals.auditDetalle = { estructura_id: e.estructura_id, mes: e.mes, anio: e.anio, linea: e.linea, monto_pagado: dinero(e.monto_pagado) };
  res.status(204).end();
});

// ---------- Conformidad: «llegó a la cuenta» (la administración, en el pago a la empresa administradora; el tesorero central, en el aporte a la Junta central) ----------
async function cargarParaConformidad(u: AuthUser, id: number) {
  const e = await cargarEgreso(u, id);
  if (!llevaConformidad(e.destino)) throw conflict('Sólo el pago a la empresa administradora y el aporte a la Junta central llevan conformidad');
  if (!puedeDarConformidad(u, e.destino, e.complejo_id)) throw forbidden(e.destino === 'administradora' ? 'Sólo la administración da la conformidad del pago a la empresa administradora' : 'Sólo el tesorero de la Junta central da la conformidad');
  if (e.registrado_por_id === u.id) throw forbidden('No puedes dar la conformidad a un pago que registraste tú');
  await exigirOperativo(e.complejo_id, u);
  return e;
}

cierresRouter.put('/lineas/:id/conformidad', async (req, res) => {
  const u = currentUser(req);
  const e = await cargarParaConformidad(u, parseId(req));
  res.locals.entidadId = e.id;
  res.locals.accion = 'dar_conformidad';
  if (e.conformidad_at) return void res.json({ registro: registroDeEgreso(e) }); // idempotente
  const actual = await prisma.egresoBlock.update({ where: { id: e.id }, data: { conformidad_at: new Date(), conformidad_por_id: u.id }, include: incluirEgresoCierre });
  res.json({ registro: registroDeEgreso(actual) });
});

cierresRouter.delete('/lineas/:id/conformidad', async (req, res) => {
  const u = currentUser(req);
  const e = await cargarParaConformidad(u, parseId(req));
  res.locals.entidadId = e.id;
  res.locals.accion = 'quitar_conformidad';
  if (!e.conformidad_at) return void res.json({ registro: registroDeEgreso(e) }); // idempotente
  const actual = await prisma.egresoBlock.update({ where: { id: e.id }, data: { conformidad_at: null, conformidad_por_id: null }, include: incluirEgresoCierre });
  res.json({ registro: registroDeEgreso(actual) });
});

// ---------- Cierre de la Junta central (ingresos y egresos de su cuenta, con voucher) ----------
const NO_VE_CENTRAL = 'El cierre de la Junta central lo ven la Junta central y la administración';

cierresRouter.get('/central', async (req, res) => {
  const u = currentUser(req);
  const q = parseQuery(periodoQuery, req);
  const complejoId = await condominioDe(u, q.complejo_id);
  if (!puedeVerCentral(u, complejoId)) throw forbidden(NO_VE_CENTRAL); // la junta de un block ve sólo su aporte
  const { mes, anio } = await periodo(q, complejoId);
  const cierre = await calcularCentral(complejoId, anio, mes);
  res.json({
    ...cierre,
    moneda: await monedaDe(complejoId),
    categorias: { ingreso: CATEGORIAS_INGRESO.map((value) => ({ value, label: CATEGORIA_ETIQUETA[value] })), egreso: CATEGORIAS_EGRESO.map((value) => ({ value, label: CATEGORIA_ETIQUETA[value] })) },
    puede: { registrar: puedeRegistrarCentral(u, complejoId) },
  });
});

const movimientoSchema = z.object({
  categoria: z.enum(CATEGORIAS, { error: 'Categoría inválida' }),
  mes: mesSchema,
  anio: anioSchema,
  monto: montoSchema,
  fecha: z.string({ error: 'Fecha inválida' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (usa AAAA-MM-DD)').refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), 'Fecha inválida'),
  descripcion: textoOpcional(120),
  pagador: textoOpcional(120),
  estacionamiento: textoOpcional(60),
  proveedor_id: idSchema.optional(),
  documento: textoOpcional(40),
  referencia: textoOpcional(80),
  observaciones: textoOpcional(300),
}).superRefine((v, ctx) => {
  const falta = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (v.categoria === 'alquiler_estacionamiento') {
    if (!v.pagador) falta('pagador', 'Escribe quién paga el alquiler (vecino o externo)');
    if (!v.estacionamiento) falta('estacionamiento', 'Escribe qué estacionamiento se alquila');
  } else if (!v.descripcion) falta('descripcion', 'Escribe el detalle del movimiento');
  if (v.proveedor_id !== undefined && v.categoria !== 'proveedor') falta('proveedor_id', 'Sólo se indica en los pagos a proveedores');
});

/** Quien llega a registrar en la Junta central: 404 si el condominio no es suyo (antes de recibir el archivo) y 403 si no es de quienes registran. */
async function ubicarCentral(req: Request): Promise<{ complejoId: number }> {
  const u = currentUser(req);
  const q = parseQuery(z.object({ complejo_id: idSchema.optional() }), req);
  const complejoId = await condominioDe(u, q.complejo_id);
  if (!puedeRegistrarCentral(u, complejoId)) throw forbidden('Sólo el tesorero de la Junta central o la administración registran los movimientos de la Junta central');
  await exigirOperativo(complejoId, u);
  return { complejoId };
}

cierresRouter.post('/central/movimientos', recibirVoucherCentral('central', ubicarCentral), async (req, res) => {
  const u = currentUser(req);
  const { complejoId } = ubicado<{ complejoId: number }>(res, 'central') ?? (await ubicarCentral(req));
  const body = req.is('multipart/form-data') ? parse(movimientoSchema, camposDeFormulario(req.body)) : parseBody(movimientoSchema, req);
  if (!req.file) throw invalid('Datos inválidos: voucher: adjunta el voucher (la boleta, la factura o el comprobante del pago)', { voucher: 'Obligatorio' });
  const voucher = voucherVerificado(req.file, u.id);

  const complejo = await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: complejoId }, select: { empresa_id: true } });
  if (body.proveedor_id !== undefined && !(complejo.empresa_id != null && (await prisma.proveedor.findFirst({ where: { id: body.proveedor_id, empresa_id: complejo.empresa_id }, select: { id: true } })))) {
    throw invalid('Datos inválidos: proveedor_id: no existe', { proveedor_id: 'No existe' });
  }
  const fecha = new Date(`${body.fecha}T00:00:00Z`);
  if (fecha.getTime() > hoyEn(await zonaDeComplejo(complejoId)).getTime()) throw invalid('Datos inválidos: fecha: no puede ser futura', { fecha: 'No puede ser futura' });

  const ingreso = esIngreso(body.categoria);
  const creado = await prisma.$transaction(async (tx) => {
    const m = await tx.movimientoCentral.create({
      data: {
        complejo_id: complejoId, tipo: ingreso ? 'ingreso' : 'egreso', categoria: body.categoria, mes: body.mes, anio: body.anio,
        descripcion: body.descripcion ?? null, pagador: ingreso ? body.pagador ?? null : null, estacionamiento: body.categoria === 'alquiler_estacionamiento' ? body.estacionamiento ?? null : null,
        proveedor_id: body.proveedor_id ?? null, documento: body.documento ?? null, monto: body.monto, fecha, referencia: body.referencia ?? null, observaciones: body.observaciones ?? null, registrado_por_id: u.id,
      },
    });
    const { subidoPorId, ...archivo } = voucher;
    await tx.archivoMovimientoCentral.create({ data: { movimiento_id: m.id, nombre: archivo.nombre, tipo_mime: archivo.tipo_mime, tamano: archivo.tamano, sha256: archivo.sha256, datos: archivo.datos, subido_por_id: subidoPorId } });
    return tx.movimientoCentral.findUniqueOrThrow({ where: { id: m.id }, include: incluirMovimiento });
  });
  res.locals.entidad = 'cierre_central';
  res.locals.entidadId = creado.id;
  res.locals.accion = ingreso ? 'registrar_ingreso' : 'registrar_egreso';
  res.locals.auditDetalle = { complejo_id: complejoId, categoria: body.categoria, mes: body.mes, anio: body.anio, monto: dinero(body.monto), sha256: voucher.sha256 }; // nunca el archivo
  res.status(201).json({ movimiento: movimientoDe(creado) });
});

/** Un movimiento de la Junta central dentro del alcance de quien llama (la junta de un block → 403; de otro condominio u otra empresa → 404). */
async function cargarMovimiento(u: AuthUser, id: number) {
  const m = await prisma.movimientoCentral.findFirst({ where: { AND: [{ id }, scopeMovimientosCentral(u)] }, include: incluirMovimiento });
  if (!m) throw notFound('Movimiento');
  return m;
}

cierresRouter.get('/central/movimientos/:id/voucher', async (req, res) => {
  const m = await cargarMovimiento(currentUser(req), parseId(req));
  const a = await prisma.archivoMovimientoCentral.findUnique({ where: { movimiento_id: m.id } });
  if (!a) throw notFound('Voucher');
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

cierresRouter.delete('/central/movimientos/:id', async (req, res) => {
  const u = currentUser(req);
  const m = await cargarMovimiento(u, parseId(req));
  if (!puedeRegistrarCentral(u, m.complejo_id)) throw forbidden('Sólo el tesorero de la Junta central o la administración corrigen los movimientos de la Junta central');
  await exigirOperativo(m.complejo_id, u);
  await prisma.movimientoCentral.delete({ where: { id: m.id } });
  res.locals.entidad = 'cierre_central';
  res.locals.entidadId = m.id;
  res.locals.accion = m.tipo === 'ingreso' ? 'quitar_ingreso' : 'quitar_egreso';
  res.locals.auditDetalle = { complejo_id: m.complejo_id, categoria: m.categoria, mes: m.mes, anio: m.anio, monto: dinero(m.monto) };
  res.status(204).end();
});

// ---------- Cuentas de destino (de la empresa administradora y de los proveedores): se muestran al tesorero al registrar el pago ----------
const cuentaSchema = z.object({
  banco: textoOpcional(60),
  tipo: textoOpcional(40),
  numero: textoOpcional(40),
  cci: textoOpcional(40),
  titular: textoOpcional(120),
});
const cuentaData = (c: z.infer<typeof cuentaSchema>) => ({ cuenta_banco: c.banco ?? null, cuenta_tipo: c.tipo ?? null, cuenta_numero: c.numero ?? null, cuenta_cci: c.cci ?? null, cuenta_titular: c.titular ?? null });
const soloAdministracion = (u: AuthUser) => { if (!esAdministracion(u)) throw forbidden('Las cuentas de destino las edita la administración'); };

/** Empresa de la que se habla: la del admin; el superadmin elige el condominio (`complejo_id`) y se toma la de ese condominio. */
async function empresaDeCuentas(u: AuthUser, complejoId: number | undefined): Promise<number> {
  if (u.rol === 'admin') return empresaDe(u);
  if (complejoId === undefined) throw invalid('Datos inválidos: complejo_id: es obligatorio', { complejo_id: 'Obligatorio' });
  const c = await prisma.complejoHabitacional.findFirst({ where: { AND: [{ id: complejoId }, scopeComplejos(u)] }, select: { empresa_id: true } });
  if (!c?.empresa_id) throw notFound('Condominio');
  return c.empresa_id;
}

cierresRouter.get('/cuentas', async (req, res) => {
  const u = currentUser(req);
  soloAdministracion(u);
  const q = parseQuery(z.object({ complejo_id: idSchema.optional() }), req);
  const empresaId = await empresaDeCuentas(u, q.complejo_id);
  const e = await prisma.empresaAdministradora.findUniqueOrThrow({ where: { id: empresaId }, select: { nombre: true, cuenta_banco: true, cuenta_tipo: true, cuenta_numero: true, cuenta_cci: true, cuenta_titular: true } });
  const proveedores = await prisma.proveedor.findMany({ where: { empresa_id: empresaId, activo: true }, orderBy: { razon_social: 'asc' }, select: { id: true, razon_social: true, cuenta_banco: true, cuenta_tipo: true, cuenta_numero: true, cuenta_cci: true, cuenta_titular: true } });
  res.json({ administradora: { empresa: e.nombre, ...cuentaDe(e) }, proveedores: proveedores.map((p) => ({ id: p.id, razon_social: p.razon_social, ...cuentaDe(p) })) });
});

cierresRouter.put('/cuentas/administradora', async (req, res) => {
  const u = currentUser(req);
  soloAdministracion(u);
  const body = parseBody(cuentaSchema.extend({ complejo_id: idSchema.optional() }), req);
  const empresaId = await empresaDeCuentas(u, body.complejo_id);
  const e = await prisma.empresaAdministradora.update({ where: { id: empresaId }, data: cuentaData(body), select: { nombre: true, cuenta_banco: true, cuenta_tipo: true, cuenta_numero: true, cuenta_cci: true, cuenta_titular: true } });
  res.locals.entidadId = empresaId;
  res.locals.accion = 'cuenta_administradora';
  res.json({ empresa: e.nombre, ...cuentaDe(e) });
});

cierresRouter.put('/cuentas/proveedor/:id', async (req, res) => {
  const u = currentUser(req);
  soloAdministracion(u);
  const id = parseId(req);
  const body = parseBody(cuentaSchema, req);
  const p = await prisma.proveedor.findFirst({ where: { id, ...(u.rol === 'admin' ? { empresa_id: empresaDe(u) } : {}) }, select: { id: true } });
  if (!p) throw notFound('Proveedor');
  const a = await prisma.proveedor.update({ where: { id }, data: cuentaData(body), select: { id: true, razon_social: true, cuenta_banco: true, cuenta_tipo: true, cuenta_numero: true, cuenta_cci: true, cuenta_titular: true } });
  res.locals.entidadId = id;
  res.locals.accion = 'cuenta_proveedor';
  res.json({ id: a.id, razon_social: a.razon_social, ...cuentaDe(a) });
});
