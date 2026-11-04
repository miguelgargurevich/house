// Volver a revisar un pago rechazado: POST /api/pagos/:id/reabrir { motivo } y GET /api/pagos/:id/reapertura. Todo el grupo vuelve a `por_validar` (se limpia el
// rechazo y la conformidad del tesorero), el cargo queda «en revisión» y la auditoría guarda el rechazo anterior. Sólo la administración (la junta no); otra empresa → 404;
// no deja dos pagos vigentes del mismo cargo; el aviso de rechazo que seguía en la cola se omite y, si se rechaza otra vez, el aviso nuevo SÍ sale.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, beforeEach, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { darCortesia, esperar, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { pagarComoResidente } from './helpers/pagoResidente';
import { hoyLima } from '../src/server/lib/fechas';
import { reabrirPago } from '../src/server/services/anulacionPago';
import { MENSAJE_FALTA_CONFORMIDAD } from '../src/server/services/validacionPago';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let C: { id: number };
let B1: { id: number };
let U1: { id: number };
let vecino: { id: number };
let R: { id: number; mes: number; anio: number };
let c1: { id: number }; // Administración 100
let c2: { id: number }; // Seguridad 40
let P1: { id: number }; // principal del grupo
let P2: { id: number };
let T: Record<'adminA' | 'adminB' | 'superadmin' | 'tesorero' | 'presidente' | 'vecino', string>;
let K1: { id: number };
let K2: { id: number };

const GRUPO = 'grupo-reabrir-1';
const llama = (t: string | null, metodo: string, ruta: string, cuerpo?: unknown) => llamar(base, metodo, ruta, t, cuerpo);
const reabrir = (t: string | null, id: number, cuerpo: unknown = { motivo: 'Lo rechacé por error, el abono sí llegó' }) => llama(t, 'POST', `/api/pagos/${id}/reabrir`, cuerpo);

before(async () => {
  ({ base, cerrar } = await iniciar());
  d = await sembrar();
  const hash = await bcrypt.hash(PASSWORD, 4);
  C = await prisma.complejoHabitacional.create({ data: { nombre: 'Los Pinos', tipo: 'Condominio', empresa_id: d.empresaA.id } });
  await darCortesia(C.id);
  B1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: C.id } });
  const usuario = (nombre: string, email: string, extra: Record<string, unknown> = {}) =>
    prisma.usuario.create({ data: { nombre, email, rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: C.id, ...extra } });
  vecino = await usuario('Vecina Uno', 'vecina1@test.pe');
  await usuario('Tesorero Pinos', 'tesorero@test.pe', { cargo_junta: 'tesorero' });
  await usuario('Presidente Pinos', 'presidente@test.pe', { cargo_junta: 'presidente' });
  U1 = await prisma.unidad.create({ data: { codigo: 'B01-101', tipo: 'Departamento', complejo_id: C.id, empresa_id: d.empresaA.id, estructura_id: B1.id, propietario_id: vecino.id, estado: 'activa' } });
  K1 = await prisma.concepto.create({ data: { nombre: 'Administración', empresa_id: d.empresaA.id, tipo_monto: 'fijo', destino: 'administradora' } });
  K2 = await prisma.concepto.create({ data: { nombre: 'Seguridad', empresa_id: d.empresaA.id, tipo_monto: 'fijo', destino: 'administradora' } });
  // El limitador de login es por minuto: se entra una sola vez y las sesiones sirven para todas las pruebas.
  const token = (email: string) => login(base, email);
  T = {
    adminA: await token('admin.a@test.pe'), adminB: await token('admin.b@test.pe'), superadmin: await token('super@test.pe'),
    tesorero: await token('tesorero@test.pe'), presidente: await token('presidente@test.pe'), vecino: await token('vecina1@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

// Cada prueba parte de un recibo del mes con un pago RECHAZADO de dos conceptos (un grupo) de B01-101, con voucher, la conformidad del tesorero que ya tenía y su aviso de rechazo
// pendiente en la cola; lo de la prueba anterior se borra.
beforeEach(async () => {
  await prisma.notificacion.deleteMany();
  await prisma.auditoria.deleteMany();
  await prisma.egresoBlock.deleteMany();
  await prisma.archivoComprobante.deleteMany();
  await prisma.evaluacionComprobante.deleteMany();
  await prisma.pago.deleteMany();
  await prisma.reciboConceptoUnidad.deleteMany({ where: { unidad_id: U1.id } });
  await prisma.reciboConcepto.deleteMany({ where: { recibo: { complejo_id: C.id } } });
  await prisma.recibo.deleteMany({ where: { complejo_id: C.id } });
  await prisma.concepto.deleteMany({ where: { id: { notIn: [K1.id, K2.id, d.conceptoA.id, d.conceptoB.id] } } });
  await prisma.usuario.update({ where: { id: vecino.id }, data: { aviso_email: true, aviso_whatsapp: true, telefono: null } });
  const hoy = hoyLima();
  const mes = hoy.getUTCMonth() + 1;
  const anio = hoy.getUTCFullYear();
  R = { ...(await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: C.id, estructura_id: B1.id, mes, anio, fecha_emision: new Date(hoy.getTime() - 20 * 86_400_000), fecha_vencimiento: new Date(hoy.getTime() + 10 * 86_400_000), estado: 'emitido', descripcion: 'Recibo' } })), mes, anio };
  const rc1 = await prisma.reciboConcepto.create({ data: { recibo_id: R.id, concepto_id: K1.id, monto: 100, orden: 1 } });
  const rc2 = await prisma.reciboConcepto.create({ data: { recibo_id: R.id, concepto_id: K2.id, monto: 40, orden: 2 } });
  const cargo = (rc: number, monto: number) => prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc, unidad_id: U1.id, monto, estado_pago: 'pendiente' } });
  c1 = await cargo(rc1.id, 100);
  c2 = await cargo(rc2.id, 40);
  const rechazado = { estado_validacion: 'rechazado', motivo_rechazo: 'El voucher no se lee', validado_por_id: d.adminA.id, validado_at: new Date(Date.now() - 3_600_000), grupo: GRUPO, conformidad_at: new Date(Date.now() - 7_200_000), conformidad_por_id: null as number | null };
  const tesorero = await prisma.usuario.findFirstOrThrow({ where: { email: 'tesorero@test.pe' } });
  rechazado.conformidad_por_id = tesorero.id;
  const pago = (cargoId: number, monto: number, principal: boolean) => prisma.pago.create({ data: { recibo_concepto_unidad_id: cargoId, monto, usuario_id: vecino.id, metodo_pago: 'yape', grupo_principal: principal, ...rechazado } });
  P1 = await pago(c1.id, 100, true);
  P2 = await pago(c2.id, 40, false);
  await prisma.archivoComprobante.create({ data: { pago_id: P1.id, nombre: 'voucher.png', tipo_mime: 'image/png', tamano: 4, sha256: 'a'.repeat(64), datos: Buffer.from('png!'), subido_por_id: vecino.id } });
  // El aviso «rechazamos tu pago» que todavía no salió.
  await prisma.notificacion.create({ data: { usuario_id: vecino.id, canal: 'email', tipo: 'pago_rechazado', asunto: 'Rechazamos tu pago', cuerpo: 'Motivo: El voucher no se lee\n\nRevisa el detalle', estado: 'pendiente', ref_entidad: 'pago', ref_id: P1.id } });
});

const cargosDe = () => prisma.reciboConceptoUnidad.findMany({ where: { id: { in: [c1.id, c2.id] } }, orderBy: { id: 'asc' }, select: { estado_pago: true, fecha_pago: true } });
const filasDe = () => prisma.pago.findMany({ where: { grupo: GRUPO }, orderBy: { id: 'asc' } });
const estadosDe = async () => (await filasDe()).map((f) => f.estado_validacion);

describe('volver a revisar un pago rechazado', () => {
  it('la administración reabre: todo el grupo queda por validar con el rechazo y la conformidad limpios, y el recibo en revisión', async () => {
    const r = await reabrir(T.adminA, P1.id, { motivo: '  Lo rechacé por error, el abono sí llegó  ' });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.estado_validacion, 'por_validar');
    assert.equal(r.body.motivo_rechazo, null);
    const filas = await filasDe();
    assert.equal(filas.length, 2, 'no se borra nada');
    for (const f of filas) {
      assert.equal(f.estado_validacion, 'por_validar');
      assert.equal(f.motivo_rechazo, null);
      assert.equal(f.validado_at, null);
      assert.equal(f.validado_por_id, null);
      assert.equal(f.validado_por_ia, false);
      assert.equal(f.conformidad_at, null, 'la conformidad previa se limpia: el tesorero la da otra vez');
      assert.equal(f.conformidad_por_id, null);
    }
    assert.deepEqual(await cargosDe(), [{ estado_pago: 'en_revision', fecha_pago: null }, { estado_pago: 'en_revision', fecha_pago: null }]);
  });

  it('reabrir desde una fila que NO es la principal reabre todo el grupo', async () => {
    assert.equal((await reabrir(T.adminA, P2.id)).status, 200);
    assert.deepEqual(await estadosDe(), ['por_validar', 'por_validar']);
  });

  it('un pago suelto (sin grupo) también se reabre', async () => {
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: R.id, concepto_id: K1.id, monto: 50, orden: 3 } });
    const cu = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: U1.id, monto: 50, estado_pago: 'pendiente' } });
    const suelto = await prisma.pago.create({ data: { recibo_concepto_unidad_id: cu.id, monto: 50, metodo_pago: 'efectivo', estado_validacion: 'rechazado', motivo_rechazo: 'Monto distinto' } });
    assert.equal((await reabrir(T.adminA, suelto.id)).status, 200);
    assert.equal((await prisma.pago.findUniqueOrThrow({ where: { id: suelto.id } })).estado_validacion, 'por_validar');
    assert.equal((await prisma.reciboConceptoUnidad.findUniqueOrThrow({ where: { id: cu.id } })).estado_pago, 'en_revision');
    assert.deepEqual(await estadosDe(), ['rechazado', 'rechazado'], 'el grupo de otro pago no se toca');
  });

  it('el superadmin también puede reabrir', async () => {
    assert.equal((await reabrir(T.superadmin, P1.id)).status, 200);
  });

  it('después se valida con el flujo normal: faltaba la conformidad del tesorero, se da, el admin valida y el recibo queda pagado', async () => {
    assert.equal((await reabrir(T.adminA, P1.id)).status, 200);
    const sinCheck = await llama(T.adminA, 'PATCH', `/api/pagos/${P1.id}/validacion`, { estado: 'validado' });
    assert.equal(sinCheck.status, 409);
    assert.equal(sinCheck.body.error, MENSAJE_FALTA_CONFORMIDAD);
    const check = await llama(T.tesorero, 'PUT', `/api/pagos/${P1.id}/conformidad`);
    assert.equal(check.status, 200, check.texto);
    const ok = await llama(T.adminA, 'PATCH', `/api/pagos/${P1.id}/validacion`, { estado: 'validado' });
    assert.equal(ok.status, 200, ok.texto);
    assert.deepEqual(await estadosDe(), ['validado', 'validado']);
    const cargos = await cargosDe();
    assert.deepEqual(cargos.map((c) => c.estado_pago), ['pagado', 'pagado']);
  });

  it('reabrir y volver a rechazar se puede, y el vecino recibe el aviso de ese segundo rechazo', async () => {
    assert.equal((await reabrir(T.adminA, P1.id)).status, 200);
    const r = await llama(T.adminA, 'PATCH', `/api/pagos/${P1.id}/validacion`, { estado: 'rechazado', motivo: 'Sigue sin leerse' });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(await estadosDe(), ['rechazado', 'rechazado']);
    const avisos = await prisma.notificacion.findMany({ where: { tipo: 'pago_rechazado', estado: 'pendiente' } });
    assert.equal(avisos.length, 1, 'el segundo rechazo sí se encola (la fila única por referencia no se lo come)');
    assert.equal(avisos[0]!.ref_entidad, 'pago');
    assert.equal(avisos[0]!.ref_id, P1.id);
    assert.match(avisos[0]!.cuerpo, /Sigue sin leerse/);
  });
});

describe('quién puede', () => {
  it('el tesorero, el presidente y el propietario no reabren (403) y nada cambia; sin sesión, 401', async () => {
    for (const t of [T.tesorero, T.presidente, T.vecino]) assert.equal((await reabrir(t, P1.id)).status, 403);
    assert.deepEqual(await estadosDe(), ['rechazado', 'rechazado']);
    assert.equal((await reabrir(null, P1.id)).status, 401);
  });

  it('el admin de otra empresa recibe 404 y el pago no se toca; un id que no existe también', async () => {
    assert.equal((await reabrir(T.adminB, P1.id)).status, 404);
    assert.equal((await reabrir(T.adminA, 999_999)).status, 404);
    assert.deepEqual(await estadosDe(), ['rechazado', 'rechazado']);
    assert.equal((await llama(T.adminB, 'GET', `/api/pagos/${P1.id}/reapertura`)).status, 404);
    assert.equal((await llama(T.tesorero, 'GET', `/api/pagos/${P1.id}/reapertura`)).status, 403);
  });
});

describe('qué se puede reabrir', () => {
  it('el motivo es obligatorio: sin motivo, corto, sólo espacios o de más de 200 caracteres → 422', async () => {
    for (const cuerpo of [{}, { motivo: '' }, { motivo: 'abc' }, { motivo: '       ' }, { motivo: 'x'.repeat(201) }, { motivo: 123 }]) {
      const r = await reabrir(T.adminA, P1.id, cuerpo);
      assert.equal(r.status, 422, JSON.stringify(cuerpo));
      assert.ok(r.body.campos?.motivo, JSON.stringify(cuerpo));
    }
    assert.deepEqual(await estadosDe(), ['rechazado', 'rechazado']);
    assert.equal((await reabrir(T.adminA, P1.id, { motivo: 'x'.repeat(200) })).status, 200, '200 caracteres es el tope');
  });

  it('un pago validado, por validar o anulado no se reabre (409) y no cambia', async () => {
    for (const estado of ['validado', 'por_validar', 'anulado']) {
      await prisma.pago.updateMany({ where: { grupo: GRUPO }, data: { estado_validacion: estado } });
      const r = await reabrir(T.adminA, P1.id);
      assert.equal(r.status, 409, estado);
      assert.match(r.body.error, { validado: /ya está validado/, por_validar: /ya está por validar/, anulado: /anulado no se vuelve a revisar/ }[estado]!, estado);
      assert.deepEqual(await estadosDe(), [estado, estado]);
    }
  });

  it('reabrir dos veces → 409 la segunda', async () => {
    assert.equal((await reabrir(T.adminA, P1.id)).status, 200);
    assert.equal((await reabrir(T.adminA, P1.id)).status, 409);
  });

  it('GET /reapertura: puede en un rechazado; si no, el motivo con el texto del 409', async () => {
    const ok = await llama(T.adminA, 'GET', `/api/pagos/${P1.id}/reapertura`);
    assert.deepEqual(ok.body, { puede: true, motivo: null });
    await prisma.pago.updateMany({ where: { grupo: GRUPO }, data: { estado_validacion: 'validado' } });
    const no = await llama(T.adminA, 'GET', `/api/pagos/${P1.id}/reapertura`);
    assert.equal(no.status, 200);
    assert.equal(no.body.puede, false);
    assert.match(no.body.motivo, /ya está validado/);
  });
});

describe('no cuenta dos veces', () => {
  it('con otro pago vigente (por validar o validado) en el mismo cargo → 409 «Ya hay otro pago»: nada cambia', async () => {
    for (const estado of ['por_validar', 'validado']) {
      const otro = await prisma.pago.create({ data: { recibo_concepto_unidad_id: c1.id, monto: 100, usuario_id: vecino.id, metodo_pago: 'yape', estado_validacion: estado, grupo: `grupo-otro-${estado}`, grupo_principal: true } });
      const r = await reabrir(T.adminA, P1.id);
      assert.equal(r.status, 409, estado);
      assert.match(r.body.error, /Ya hay otro pago de este mantenimiento: revisa ese/);
      assert.deepEqual(await estadosDe(), ['rechazado', 'rechazado']);
      const consulta = await llama(T.adminA, 'GET', `/api/pagos/${P1.id}/reapertura`);
      assert.equal(consulta.body.puede, false, 'el botón se apaga');
      assert.match(consulta.body.motivo, /Ya hay otro pago/);
      await prisma.pago.delete({ where: { id: otro.id } });
    }
  });

  it('el vecino vuelve a subir el voucher (por validar): el rechazado viejo ya no se puede reabrir; si ese nuevo se rechaza o se anula, sí', async () => {
    const nuevo = await pagarComoResidente(base, T.vecino, R.id, U1.id);
    assert.equal(nuevo.status, 201, nuevo.texto);
    assert.equal((await reabrir(T.adminA, P1.id)).status, 409);
    await prisma.pago.updateMany({ where: { grupo: { not: GRUPO }, recibo_concepto_unidad_id: { in: [c1.id, c2.id] } }, data: { estado_validacion: 'rechazado', motivo_rechazo: 'Otro' } });
    assert.equal((await reabrir(T.adminA, P1.id)).status, 200);
  });

  it('un pago rechazado o anulado en el mismo cargo NO lo impide', async () => {
    await prisma.pago.create({ data: { recibo_concepto_unidad_id: c1.id, monto: 100, estado_validacion: 'anulado', anulado_at: new Date(), motivo_anulacion: 'Duplicado' } });
    await prisma.pago.create({ data: { recibo_concepto_unidad_id: c1.id, monto: 100, estado_validacion: 'rechazado', motivo_rechazo: 'Otro rechazo' } });
    assert.equal((await reabrir(T.adminA, P1.id)).status, 200);
  });

  it('un cargo que ya figura pagado (dato antiguo, sin pago vigente) tampoco se reabre', async () => {
    await prisma.reciboConceptoUnidad.update({ where: { id: c1.id }, data: { estado_pago: 'pagado', fecha_pago: new Date() } });
    const r = await reabrir(T.adminA, P1.id);
    assert.equal(r.status, 409);
    assert.match(r.body.error, /ya figura pagado/);
    assert.deepEqual(await estadosDe(), ['rechazado', 'rechazado']);
  });

  it('el recibo del pago ya no existe (el cargo quedó sin recibo o el pago sin cargo) → 409 claro, nada cambia', async () => {
    await prisma.reciboConceptoUnidad.update({ where: { id: c2.id }, data: { recibo_concepto_id: null } });
    const r = await reabrir(T.adminA, P1.id);
    assert.equal(r.status, 409);
    assert.match(r.body.error, /El recibo de este pago ya no existe/);
    assert.deepEqual(await estadosDe(), ['rechazado', 'rechazado']);
    await prisma.pago.updateMany({ where: { grupo: GRUPO }, data: { recibo_concepto_unidad_id: null } });
    // Un pago sin cargo queda fuera del alcance de toda empresa (404 en la ruta); el servicio igual se niega con el 409 claro.
    assert.equal((await reabrir(T.adminA, P1.id)).status, 404);
    await assert.rejects(() => reabrirPago(P1.id), /El recibo de este pago ya no existe/);
    assert.deepEqual(await estadosDe(), ['rechazado', 'rechazado']);
  });
});

describe('el cierre del mes', () => {
  const registrarCierre = () => prisma.egresoBlock.create({ data: { complejo_id: C.id, estructura_id: B1.id, mes: R.mes, anio: R.anio, linea: 'administradora', destino: 'administradora', facturado: 140, monto_pagado: 140, fecha_pago: new Date(Date.UTC(R.anio, R.mes - 1, 5)), conformidad_at: new Date() } });

  it('con el cierre del mes registrado por completo no se reabre (409, reábrelo): igual que anular; al quitar el registro, sí', async () => {
    const egreso = await registrarCierre();
    const r = await reabrir(T.adminA, P1.id);
    assert.equal(r.status, 409);
    assert.match(r.body.error, /El mes ya está cerrado.*reábrelo antes de volver a revisar/);
    assert.deepEqual(await estadosDe(), ['rechazado', 'rechazado']);
    assert.equal((await llama(T.adminA, 'GET', `/api/pagos/${P1.id}/reapertura`)).body.puede, false);
    await prisma.egresoBlock.delete({ where: { id: egreso.id } });
    assert.equal((await reabrir(T.adminA, P1.id)).status, 200);
  });
});

describe('auditoría y avisos', () => {
  it('la auditoría guarda quién reabrió, el motivo y el rechazo anterior (motivo, quién, cuándo y la conformidad)', async () => {
    const antes = await prisma.pago.findUniqueOrThrow({ where: { id: P1.id } });
    await reabrir(T.adminA, P1.id, { motivo: 'Lo rechacé por error, el abono sí llegó' });
    const fila = await esperar(() => prisma.auditoria.findFirst({ where: { accion: 'reabrir', entidad: 'pago' } }));
    assert.equal(fila.usuario_id, d.adminA.id);
    assert.equal(fila.entidad_id, P1.id);
    const det = fila.detalle as { motivo: string; monto: string; pagos: number; grupo: string; rechazo_anterior: Record<string, unknown> };
    assert.equal(det.motivo, 'Lo rechacé por error, el abono sí llegó');
    assert.equal(det.monto, '140.00');
    assert.equal(det.pagos, 2);
    assert.equal(det.grupo, GRUPO);
    assert.equal(det.rechazo_anterior.motivo, 'El voucher no se lee');
    assert.equal(det.rechazo_anterior.por_id, d.adminA.id);
    assert.equal(det.rechazo_anterior.por_nombre, 'Admin A');
    assert.equal(det.rechazo_anterior.por_ia, false);
    assert.equal(det.rechazo_anterior.at, antes.validado_at!.toISOString());
    assert.equal(det.rechazo_anterior.conformidad_at, antes.conformidad_at!.toISOString());
    assert.equal(det.rechazo_anterior.conformidad_por_id, antes.conformidad_por_id);
    assert.equal(fila.impersonador_id, null);
  });

  it('una reapertura rechazada (403, 409, 422) no deja fila de auditoría', async () => {
    await reabrir(T.tesorero, P1.id);
    await reabrir(T.adminA, P1.id, {});
    await prisma.pago.updateMany({ where: { grupo: GRUPO }, data: { estado_validacion: 'validado' } });
    await reabrir(T.adminA, P1.id);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(await prisma.auditoria.count({ where: { accion: 'reabrir' } }), 0);
  });

  it('el aviso de rechazo que seguía pendiente pasa a omitida («Pago reabierto») y no sale; reabrir no avisa nada nuevo', async () => {
    await reabrir(T.adminA, P1.id);
    assert.equal(await prisma.notificacion.count({ where: { estado: 'pendiente' } }), 0, 'nada queda en la cola');
    const filas = await prisma.notificacion.findMany({ where: { tipo: 'pago_rechazado' } });
    assert.equal(filas.length, 1);
    assert.equal(filas[0]!.estado, 'omitida');
    assert.equal(filas[0]!.error, 'Pago reabierto');
    assert.equal(await prisma.notificacion.count(), 1, 'ningún aviso nuevo al vecino');
  });

  it('un aviso de rechazo ya enviado se conserva como enviado (sólo libera su referencia para el próximo rechazo)', async () => {
    await prisma.notificacion.updateMany({ data: { estado: 'enviada', enviada_at: new Date() } });
    await reabrir(T.adminA, P1.id);
    const filas = await prisma.notificacion.findMany({ where: { tipo: 'pago_rechazado' } });
    assert.equal(filas.length, 1);
    assert.equal(filas[0]!.estado, 'enviada');
    assert.notEqual(filas[0]!.ref_entidad, 'pago');
    assert.match(filas[0]!.cuerpo, /El voucher no se lee/);
  });

  it('los avisos de otro pago no se tocan', async () => {
    const otro = await prisma.pago.create({ data: { recibo_concepto_unidad_id: c1.id, monto: 1, estado_validacion: 'rechazado', motivo_rechazo: 'x' } });
    await prisma.notificacion.create({ data: { usuario_id: vecino.id, canal: 'email', tipo: 'pago_rechazado', asunto: 'Otro', cuerpo: 'otro', estado: 'pendiente', ref_entidad: 'pago', ref_id: otro.id } });
    await reabrir(T.adminA, P1.id);
    const sigue = await prisma.notificacion.findMany({ where: { ref_id: otro.id } });
    assert.equal(sigue.length, 1);
    assert.equal(sigue[0]!.estado, 'pendiente');
    assert.equal(sigue[0]!.ref_entidad, 'pago');
  });
});

describe('las listas lo muestran', () => {
  it('sale de Rechazados y aparece en Por validar, ya sin motivo de rechazo', async () => {
    assert.equal((await llama(T.adminA, 'GET', '/api/pagos?estado_validacion=rechazado')).body.total, 1);
    await reabrir(T.adminA, P1.id);
    assert.equal((await llama(T.adminA, 'GET', '/api/pagos?estado_validacion=rechazado')).body.total, 0);
    const porValidar = await llama(T.adminA, 'GET', '/api/pagos?estado_validacion=por_validar');
    assert.equal(porValidar.body.total, 1, 'una fila por grupo');
    assert.equal(porValidar.body.items[0].id, P1.id);
    assert.equal(porValidar.body.items[0].motivo_rechazo, null);
  });
});
