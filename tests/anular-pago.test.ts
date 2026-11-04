// Anular un pago ya validado: POST /api/pagos/:id/anular { motivo }. No borra nada: el grupo entero queda `anulado` (quién, cuándo, por qué), el recibo vuelve a
// quedar por pagar y el pago deja de contar en el cobrado del tablero, la rendición, el cierre del mes y el estado de cuenta. Sólo la administración (la junta
// no); otra empresa → 404; el aviso al vecino sale por correo y se puede apagar; un mes con el cierre registrado por completo se reabre primero.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, beforeEach, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { darCortesia, esperar, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { pagarComoResidente } from './helpers/pagoResidente';
import { hoyLima } from '../src/server/lib/fechas';
import { calcularBlocks } from '../src/server/services/cierres/calculo';
import { sanearCuenta } from '../src/server/services/conciliacion/cruce';
import { evaluarMora } from '../src/server/services/mora';
import { quitarMulta } from '../src/server/services/revisionMora';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let C: { id: number };
let B1: { id: number };
let U1: { id: number };
let U2: { id: number };
let vecino: { id: number };
let R: { id: number; mes: number; anio: number };
let c1: { id: number }; // Administración 100
let c2: { id: number }; // Seguridad 40
let P1: { id: number }; // principal del grupo
let P2: { id: number };
let T: Record<'adminA' | 'adminB' | 'superadmin' | 'tesorero' | 'presidente' | 'vecino', string>;
let K1: { id: number };
let K2: { id: number };

const llama = (t: string | null, metodo: string, ruta: string, cuerpo?: unknown) => llamar(base, metodo, ruta, t, cuerpo);
const anular = (t: string | null, id: number, cuerpo: unknown = { motivo: 'Pago duplicado' }) => llama(t, 'POST', `/api/pagos/${id}/anular`, cuerpo);
const num = (v: unknown) => Number(v);

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
  const un = (codigo: string, propietario_id: number) => prisma.unidad.create({ data: { codigo, tipo: 'Departamento', complejo_id: C.id, empresa_id: d.empresaA.id, estructura_id: B1.id, propietario_id, estado: 'activa' } });
  U1 = await un('B01-101', vecino.id);
  U2 = await un('B01-102', d.propietario2.id);
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

// Cada prueba parte de un recibo del mes con un pago validado de dos conceptos (un grupo) de B01-101; lo de la prueba anterior se borra.
beforeEach(async () => {
  await prisma.movimientoBancario.deleteMany();
  await prisma.extractoBancario.deleteMany();
  await prisma.medioPago.deleteMany();
  await prisma.notificacion.deleteMany();
  await prisma.auditoria.deleteMany();
  await prisma.egresoBlock.deleteMany();
  await prisma.archivoComprobante.deleteMany();
  await prisma.evaluacionComprobante.deleteMany();
  await prisma.pago.deleteMany();
  await prisma.reciboConceptoUnidad.deleteMany({ where: { unidad_id: { in: [U1.id, U2.id] } } });
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
  const cargo = (rc: number, unidad: number, monto: number) => prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc, unidad_id: unidad, monto, estado_pago: 'pagado', fecha_pago: new Date() } });
  c1 = await cargo(rc1.id, U1.id, 100);
  c2 = await cargo(rc2.id, U1.id, 40);
  // Un pago del mantenimiento: una fila por concepto con el mismo grupo; el principal lleva el voucher.
  const pago = (cargoId: number, monto: number, principal: boolean) =>
    prisma.pago.create({ data: { recibo_concepto_unidad_id: cargoId, monto, usuario_id: vecino.id, metodo_pago: 'yape', estado_validacion: 'validado', validado_por_id: d.adminA.id, validado_at: new Date(), grupo: 'grupo-anular-1', grupo_principal: principal } });
  P1 = await pago(c1.id, 100, true);
  P2 = await pago(c2.id, 40, false);
});

const cargosDe = () => prisma.reciboConceptoUnidad.findMany({ where: { id: { in: [c1.id, c2.id] } }, orderBy: { id: 'asc' }, select: { estado_pago: true, fecha_pago: true } });
const estadosDe = () => prisma.pago.findMany({ where: { grupo: 'grupo-anular-1' }, orderBy: { id: 'asc' }, select: { estado_validacion: true, motivo_anulacion: true, anulado_por_id: true, anulado_at: true } });

describe('anular un pago validado', () => {
  it('la administración anula: todo el grupo queda anulado con motivo, quién y cuándo, y el recibo vuelve a pendiente', async () => {
    const r = await anular(T.adminA, P1.id, { motivo: '  Pago duplicado  ' });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.estado_validacion, 'anulado');
    assert.equal(r.body.motivo_anulacion, 'Pago duplicado', 'el motivo va sin espacios sobrantes');
    assert.equal(r.body.anulado_por.nombre, 'Admin A');
    const filas = await estadosDe();
    assert.equal(filas.length, 2, 'no se borra nada');
    for (const f of filas) {
      assert.equal(f.estado_validacion, 'anulado');
      assert.equal(f.motivo_anulacion, 'Pago duplicado');
      assert.equal(f.anulado_por_id, d.adminA.id);
      assert.ok(f.anulado_at instanceof Date);
    }
    // El recibo vuelve a quedar por pagar, en los dos cargos.
    assert.deepEqual(await cargosDe(), [{ estado_pago: 'pendiente', fecha_pago: null }, { estado_pago: 'pendiente', fecha_pago: null }]);
  });

  it('anular desde una fila que NO es la principal del grupo anula igual todo el grupo', async () => {
    assert.equal((await anular(T.adminA, P2.id)).status, 200);
    assert.deepEqual((await estadosDe()).map((f) => f.estado_validacion), ['anulado', 'anulado']);
  });

  it('un pago suelto (sin grupo) también se anula, y su cargo se reabre', async () => {
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: R.id, concepto_id: K1.id, monto: 100, orden: 3 } });
    const cu = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: U2.id, monto: 100, estado_pago: 'pagado', fecha_pago: new Date() } });
    const suelto = await prisma.pago.create({ data: { recibo_concepto_unidad_id: cu.id, monto: 100, metodo_pago: 'efectivo', estado_validacion: 'validado' } });
    assert.equal((await anular(T.adminA, suelto.id)).status, 200);
    assert.equal((await prisma.pago.findUniqueOrThrow({ where: { id: suelto.id } })).estado_validacion, 'anulado');
    assert.equal((await prisma.reciboConceptoUnidad.findUniqueOrThrow({ where: { id: cu.id } })).estado_pago, 'pendiente');
    assert.equal((await estadosDe())[0]!.estado_validacion, 'validado', 'el grupo de otra unidad no se toca');
  });

  it('el superadmin también puede anular', async () => {
    assert.equal((await anular(T.superadmin, P1.id)).status, 200);
  });
});

describe('quién puede', () => {
  it('el tesorero, el presidente y el propietario no anulan (403) y nada cambia', async () => {
    for (const t of [T.tesorero, T.presidente, T.vecino]) assert.equal((await anular(t, P1.id)).status, 403);
    assert.deepEqual((await estadosDe()).map((f) => f.estado_validacion), ['validado', 'validado']);
    assert.equal((await anular(null, P1.id)).status, 401);
  });

  it('el admin de otra empresa recibe 404 y el pago no se toca; un id que no existe también', async () => {
    assert.equal((await anular(T.adminB, P1.id)).status, 404);
    assert.equal((await anular(T.adminA, 999_999)).status, 404);
    assert.deepEqual((await estadosDe()).map((f) => f.estado_validacion), ['validado', 'validado']);
  });
});

describe('qué se puede anular', () => {
  it('el motivo es obligatorio: sin motivo, corto, sólo espacios o de más de 200 caracteres → 422', async () => {
    for (const cuerpo of [{}, { motivo: '' }, { motivo: 'abc' }, { motivo: '       ' }, { motivo: 'x'.repeat(201) }, { motivo: 123 }]) {
      const r = await anular(T.adminA, P1.id, cuerpo);
      assert.equal(r.status, 422, JSON.stringify(cuerpo));
      assert.ok(r.body.campos?.motivo, JSON.stringify(cuerpo));
    }
    assert.equal((await anular(T.adminA, P1.id, { motivo: 'x'.repeat(200) })).status, 200, '200 caracteres es el tope');
  });

  it('un pago por validar o rechazado no se anula (409): se valida o se rechaza como siempre', async () => {
    for (const estado of ['por_validar', 'rechazado']) {
      await prisma.pago.updateMany({ where: { grupo: 'grupo-anular-1' }, data: { estado_validacion: estado } });
      const r = await anular(T.adminA, P1.id);
      assert.equal(r.status, 409, estado);
      assert.deepEqual((await estadosDe()).map((f) => f.estado_validacion), [estado, estado]);
    }
  });

  it('anular dos veces → 409 y no cambia quién ni cuándo anuló', async () => {
    assert.equal((await anular(T.adminA, P1.id, { motivo: 'Primer motivo' })).status, 200);
    const antes = await estadosDe();
    const otra = await anular(T.superadmin, P1.id, { motivo: 'Segundo motivo' });
    assert.equal(otra.status, 409);
    assert.match(otra.body.error, /ya fue anulado/);
    assert.deepEqual(await estadosDe(), antes);
  });
});

describe('un pago anulado no cuenta en nada', () => {
  it('el cobrado del tablero, la rendición, el cierre del mes y el estado de cuenta dejan de contarlo', async () => {
    const tablero = async () => num((await llama(T.adminA, 'GET', '/api/dashboard/resumen')).body.cobrado_mes);
    const rendicion = async () => (await llama(T.adminA, 'GET', `/api/reportes/rendicion?complejo_id=${C.id}&mes=${R.mes}&anio=${R.anio}`)).body.ingresos.cobrado.total;
    const cierre = async () => (await calcularBlocks([B1.id])).get(B1.id)!.meses.find((m) => m.mes === R.mes && m.anio === R.anio)!.cobrado_total;
    const eecc = async () => (await llama(T.adminA, 'GET', `/api/estado-cuenta/unidades/${U1.id}`)).body;
    assert.equal(await tablero(), 140);
    assert.equal(num(await rendicion()), 140);
    assert.equal(num(await cierre()), 140);
    assert.equal(num((await eecc()).totales.pagado), 140);

    assert.equal((await anular(T.adminA, P1.id)).status, 200);

    assert.equal(await tablero(), 0, 'tablero');
    assert.equal(num(await rendicion()), 0, 'rendición');
    assert.equal(num(await cierre()), 0, 'cierre del mes');
    const e = await eecc();
    assert.equal(num(e.totales.pagado), 0, 'estado de cuenta: pagado');
    assert.equal(num(e.totales.saldo_deudor), 140, 'estado de cuenta: vuelve a deberse');
    assert.equal(e.totales.pagos_anulados, 1, 'el grupo se muestra una sola vez');
    assert.deepEqual(e.filas[0].pagos.map((p: { estado: string; monto: string }) => [p.estado, p.monto]), [['anulado', '140.00']]);
  });

  it('las listas lo muestran como anulado (nunca como validado): la administración, la junta y el vecino', async () => {
    await anular(T.adminA, P1.id, { motivo: 'Pago duplicado' });
    const validados = await llama(T.adminA, 'GET', '/api/pagos?estado_validacion=validado');
    assert.equal(validados.body.items.length, 0);
    const anulados = await llama(T.adminA, 'GET', '/api/pagos?estado_validacion=anulado');
    assert.equal(anulados.body.total, 1, 'una fila por grupo');
    assert.equal(anulados.body.items[0].id, P1.id);
    assert.equal(anulados.body.items[0].motivo_anulacion, 'Pago duplicado');
    assert.equal(anulados.body.items[0].anulado_por.nombre, 'Admin A');
    assert.equal(anulados.body.items[0].mantenimiento.total, '140.00');
    // La junta lo ve como anulado.
    const junta = await llama(T.tesorero, 'GET', '/api/pagos');
    assert.deepEqual(junta.body.items.map((p: { estado_validacion: string }) => p.estado_validacion), ['anulado']);
    // El vecino ve el estado, el motivo y la fecha; no quién lo anuló.
    const mio = await llama(T.vecino, 'GET', '/api/me/pagos');
    assert.equal(mio.body.items[0].estado_validacion, 'anulado');
    assert.equal(mio.body.items[0].motivo_anulacion, 'Pago duplicado');
    assert.equal('anulado_por' in mio.body.items[0], false);
    // El detalle del mantenimiento (admin y vecino) también.
    const detalle = await llama(T.vecino, 'GET', `/api/me/mantenimientos/${R.id}/${U1.id}`);
    assert.equal(detalle.body.pagos[0].estado_validacion, 'anulado');
    assert.equal(detalle.body.pagos[0].motivo_anulacion, 'Pago duplicado');
    assert.equal(detalle.body.pagos[0].anulado_por, undefined);
  });

  it('el vecino puede volver a registrar el pago de ese recibo: el anulado no bloquea un pago nuevo', async () => {
    assert.equal((await anular(T.adminA, P1.id)).status, 200);
    const r = await pagarComoResidente(base, T.vecino, R.id, U1.id);
    assert.equal(r.status, 201, r.texto);
    const nuevos = await prisma.pago.findMany({ where: { grupo: { not: 'grupo-anular-1' }, recibo_concepto_unidad_id: { in: [c1.id, c2.id] } }, select: { estado_validacion: true } });
    assert.deepEqual(nuevos.map((p) => p.estado_validacion), ['por_validar', 'por_validar']);
    assert.deepEqual((await cargosDe()).map((c) => c.estado_pago), ['en_revision', 'en_revision']);
  });

  it('la administración también puede registrar un pago nuevo del cargo (el anulado no reclama el monto), y uno validado sí lo bloquea', async () => {
    const nuevo = { recibo_concepto_unidad_id: c1.id, monto: '100.00', metodo_pago: 'efectivo' };
    assert.equal((await llama(T.adminA, 'POST', '/api/pagos', nuevo)).status, 409, 'con el pago validado, el cargo ya está pagado');
    assert.equal((await anular(T.adminA, P1.id)).status, 200);
    assert.equal((await llama(T.adminA, 'POST', '/api/pagos', nuevo)).status, 201);
  });

  it('una multa con sólo pagos anulados se puede quitar: el anulado no cuenta como pago registrado', async () => {
    const mora = await prisma.concepto.create({ data: { nombre: 'Multa por mora', empresa_id: d.empresaA.id, tipo_monto: 'fijo' } });
    const rcM = await prisma.reciboConcepto.create({ data: { recibo_id: R.id, concepto_id: mora.id, monto: 20, orden: 5 } });
    const multa = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rcM.id, unidad_id: U2.id, monto: 20, estado_pago: 'pendiente' } });
    await prisma.pago.create({ data: { recibo_concepto_unidad_id: multa.id, monto: 20, estado_validacion: 'anulado', anulado_at: new Date(), motivo_anulacion: 'Pago duplicado' } });
    const r = await quitarMulta({ reciboId: R.id, unidadId: U2.id, motivo: 'Pagó a tiempo' });
    assert.equal(r.monto, '20.00');
    // Con un pago VIGENTE sí se sigue bloqueando.
    const multa2 = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rcM.id, unidad_id: U1.id, monto: 20, estado_pago: 'pendiente' } });
    await prisma.pago.create({ data: { recibo_concepto_unidad_id: multa2.id, monto: 20, estado_validacion: 'validado' } });
    await assert.rejects(() => quitarMulta({ reciboId: R.id, unidadId: U1.id, motivo: 'x' }), /ya tiene pagos registrados|ya está pagada/);
  });

  it('la mora: un pago anulado hecho a tiempo no libra de la multa (cuenta como no pagado)', async () => {
    const hoy = hoyLima().getTime();
    const previo = { mes: R.mes === 1 ? 12 : R.mes - 1, anio: R.mes === 1 ? R.anio - 1 : R.anio };
    const anterior = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: C.id, estructura_id: B1.id, ...previo, fecha_emision: new Date(hoy - 40 * 86_400_000), fecha_vencimiento: new Date(hoy - 10 * 86_400_000), estado: 'emitido', descripcion: 'Anterior' } });
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: anterior.id, concepto_id: K1.id, monto: 100, orden: 1 } });
    const cu = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: U2.id, monto: 100, estado_pago: 'pendiente' } });
    const consulta = () => prisma.$transaction((tx) => evaluarMora(tx, { complejoId: C.id, estructuraId: B1.id, mes: R.mes, anio: R.anio, unidadIds: [U2.id] }));
    const pago = await prisma.pago.create({ data: { recibo_concepto_unidad_id: cu.id, monto: 100, fecha_pago: new Date(hoy - 15 * 86_400_000), estado_validacion: 'validado', fecha_origen: 'voucher' } });
    assert.equal((await consulta()).tarde.has(U2.id), false, 'validado y a tiempo: no hay multa');
    await prisma.pago.update({ where: { id: pago.id }, data: { estado_validacion: 'anulado', anulado_at: new Date(), motivo_anulacion: 'Pago duplicado' } });
    const e = await consulta();
    assert.equal(e.tarde.has(U2.id), true, 'anulado: el recibo quedó sin pagar a tiempo');
    assert.deepEqual(e.detalle.get(U2.id)!.pagos, [], 'el anulado no aparece entre los pagos que cuentan');
  });

  it('un abono del banco conciliado solo con un pago que luego se anuló se suelta', async () => {
    const medio = await prisma.medioPago.create({ data: { tipo: 'cuenta_bancaria', banco: 'BCP', numero_cuenta: '1930000000', titular: 'Condominio Los Pinos', complejo_id: C.id } });
    const extracto = await prisma.extractoBancario.create({ data: { complejo_id: C.id, medio_pago_id: medio.id, archivo_nombre: 'extracto.xlsx' } });
    const mov = await prisma.movimientoBancario.create({ data: { extracto_id: extracto.id, complejo_id: C.id, medio_pago_id: medio.id, fecha: new Date(), descripcion: 'Abono', monto: 140, estado: 'conciliado', pago_id: P1.id, vinculo: 'automatico', huella: 'h-anular-1' } });
    await prisma.$transaction((tx) => sanearCuenta(tx, medio.id));
    assert.equal((await prisma.movimientoBancario.findUniqueOrThrow({ where: { id: mov.id } })).estado, 'conciliado', 'con el pago validado sigue conciliado');
    await anular(T.adminA, P1.id);
    await prisma.$transaction((tx) => sanearCuenta(tx, medio.id));
    const despues = await prisma.movimientoBancario.findUniqueOrThrow({ where: { id: mov.id } });
    assert.equal(despues.estado, 'sin_pago');
    assert.equal(despues.pago_id, null);
  });
});

describe('auditoría y aviso al vecino', () => {
  it('la auditoría guarda quién anuló, el motivo y el monto del grupo', async () => {
    await anular(T.adminA, P1.id, { motivo: 'Pago duplicado' });
    const fila = await esperar(() => prisma.auditoria.findFirst({ where: { accion: 'anular', entidad: 'pago' } }));
    assert.equal(fila.usuario_id, d.adminA.id);
    assert.equal(fila.entidad_id, P1.id);
    const det = fila.detalle as Record<string, unknown>;
    assert.equal(det.motivo, 'Pago duplicado');
    assert.equal(det.monto, '140.00');
    assert.equal(det.pagos, 2);
    assert.equal(fila.impersonador_id, null);
  });

  it('una anulación rechazada no deja fila de auditoría', async () => {
    await anular(T.tesorero, P1.id);
    await anular(T.adminA, P1.id, {});
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(await prisma.auditoria.count({ where: { accion: 'anular' } }), 0);
  });

  it('el aviso pago_anulado se encola por correo para quien pagó, con el motivo y el monto del grupo; nunca por WhatsApp', async () => {
    await prisma.usuario.update({ where: { id: vecino.id }, data: { telefono: '987654321', aviso_whatsapp: true, aviso_email: true } });
    await anular(T.adminA, P1.id, { motivo: 'Pago duplicado' });
    const filas = await prisma.notificacion.findMany({ where: { tipo: 'pago_anulado' } });
    assert.equal(filas.length, 1);
    assert.equal(filas[0]!.usuario_id, vecino.id);
    assert.equal(filas[0]!.canal, 'email');
    assert.equal(filas[0]!.ref_entidad, 'pago');
    assert.equal(filas[0]!.ref_id, P1.id);
    assert.match(filas[0]!.cuerpo, /Motivo: Pago duplicado/);
    assert.match(filas[0]!.cuerpo, /140\.00/);
    assert.match(filas[0]!.asunto, /Anulamos tu pago/);
  });

  it('el vecino que apagó los avisos por correo no recibe nada, y la anulación se hace igual', async () => {
    await prisma.usuario.update({ where: { id: vecino.id }, data: { aviso_email: false } });
    assert.equal((await anular(T.adminA, P1.id)).status, 200);
    assert.equal(await prisma.notificacion.count({ where: { tipo: 'pago_anulado' } }), 0);
  });
});

describe('el cierre del mes', () => {
  const registrarCierre = () => prisma.egresoBlock.create({ data: { complejo_id: C.id, estructura_id: B1.id, mes: R.mes, anio: R.anio, linea: 'administradora', destino: 'administradora', facturado: 140, monto_pagado: 140, fecha_pago: new Date(Date.UTC(R.anio, R.mes - 1, 5)), conformidad_at: new Date() } });

  it('con el cierre del mes registrado por completo no se anula (409, reábrelo): el pago queda validado y el recibo pagado', async () => {
    const egreso = await registrarCierre();
    const r = await anular(T.adminA, P1.id);
    assert.equal(r.status, 409);
    assert.match(r.body.error, /El mes ya está cerrado.*reábrelo antes de anular/);
    assert.deepEqual((await estadosDe()).map((f) => f.estado_validacion), ['validado', 'validado']);
    assert.deepEqual((await cargosDe()).map((c) => c.estado_pago), ['pagado', 'pagado']);
    // Reabrir = quitar el registro de la línea (DELETE /api/cierres/lineas/:id): ahora sí.
    await prisma.egresoBlock.delete({ where: { id: egreso.id } });
    assert.equal((await anular(T.adminA, P1.id)).status, 200);
  });

  it('un cierre sin todas sus líneas registradas no bloquea (nada se ha cerrado todavía)', async () => {
    const servicio = await prisma.concepto.create({ data: { nombre: 'Agua', empresa_id: d.empresaA.id, tipo_monto: 'fijo', destino: 'servicio' } });
    const rcS = await prisma.reciboConcepto.create({ data: { recibo_id: R.id, concepto_id: servicio.id, monto: 30, orden: 9 } });
    await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rcS.id, unidad_id: U2.id, monto: 30, estado_pago: 'pendiente' } });
    await registrarCierre(); // falta la línea del agua
    assert.equal((await anular(T.adminA, P1.id)).status, 200);
  });
});
