// Conciliación v2 de punta a punta (API + base): n.º de operación con otra fecha → por revisar, hoja correcta, salidas (cargos), verificación del saldo,
// «fuera de período», pista por nombre, auditoría y permisos de lo nuevo. Extractos SINTÉTICOS (fixtures de `tests/fixtures/conciliacion/` y CSV armados aquí).
import './helpers/env';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { esperar, iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { crearCuenta, crearPago, csv, subirExtracto } from './helpers/conciliacion';
import { invalidarComercial } from '../src/server/services/comercial/modulos';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'conciliacion');
const fixture = (n: string) => fs.readFileSync(path.join(FIXTURES, n));

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1', string>;
let cuenta: { id: number };
let cuentaB: { id: number };

interface Mov { id: number; estado: string; monto: string; fecha: string; descripcion: string; motivo_revision: string | null; pago: { id: number } | null; sugerencias: { id: number; nombre_coincide: boolean }[]; vinculo: string | null }
const api = (t: string | null, m: string, ruta: string, cuerpo?: unknown) => llamar(base, m, ruta, t, cuerpo);
const base_ = (id = cuenta.id) => `/api/conciliacion/cuentas/${id}`;
const subir = (bytes: Buffer, nombre = 'extracto.csv', columnas?: unknown, token = T.adminA, id = cuenta.id) => subirExtracto(base, token, id, bytes, nombre, columnas);
const movimientos = async (estado?: string, id = cuenta.id) => (await api(T.adminA, 'GET', `${base_(id)}/movimientos?pageSize=100${estado ? `&estado=${estado}` : ''}`)).body.items as Mov[];
const resumen = async () => (await api(T.adminA, 'GET', `${base_()}/resumen`)).body;
const cruzar = () => api(T.adminA, 'POST', `${base_()}/cruzar`);

async function fijarPlan(plan: 'cortesia' | 'gratis' | 'pro') {
  await prisma.suscripcionCondominio.upsert({
    where: { complejo_id: d.complejoA.id },
    create: { complejo_id: d.complejoA.id, plan_clave: plan, modulos: [], estado: plan === 'gratis' ? 'gratis' : 'activa' },
    update: { plan_clave: plan, modulos: [], estado: plan === 'gratis' ? 'gratis' : 'activa', es_prueba: false, vigente_hasta: null, solicitud_plan: null, solicitud_modulos: [], gratis_hasta: null },
  });
  invalidarComercial();
}

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'), prop1: await login(base, 'prop1@test.pe') };
  cuenta = await crearCuenta(d.complejoA.id);
  cuentaB = await crearCuenta(d.complejoB.id, { titular: 'Condominio B' });
});
after(async () => { await cerrar(); await prisma.$disconnect(); });
beforeEach(async () => {
  await prisma.movimientoBancario.deleteMany();
  await prisma.extractoBancario.deleteMany();
  await prisma.configuracionConciliacion.deleteMany();
  await prisma.medioPago.deleteMany({ where: { id: { notIn: [cuenta.id, cuentaB.id] } } });
  await prisma.pago.deleteMany();
  await prisma.auditoria.deleteMany();
  await prisma.usuario.deleteMany({ where: { email: { endsWith: '@nombres.demo' } } });
  await fijarPlan('cortesia');
});

describe('n.º de operación con otra fecha → por revisar, nunca automático', () => {
  it('misma operación y monto DENTRO de la ventana → conciliado; FUERA → por revisar con el motivo y el pago como sugerencia', async () => {
    const dentro = await crearPago(d, { monto: 150, fecha: '2026-10-08', referencia: 'OP-100234' }); // 3 días: dentro
    const fuera = await crearPago(d, { monto: 150, fecha: '2026-10-12', referencia: 'OP-100777' }); // 7 días: otra fecha
    await subir(csv([{ fecha: '05/10/2026', monto: 150, op: '100234' }, { fecha: '05/10/2026', monto: 150, op: '100777', desc: 'OTRA TRANSFERENCIA' }]));
    const ok = (await movimientos('conciliado'))[0]!;
    assert.deepEqual([ok.pago!.id, ok.vinculo], [dentro.id, 'automatico']);
    const [rev] = await movimientos('por_revisar');
    assert.equal(rev!.estado, 'por_revisar');
    assert.equal(rev!.pago, null, 'no se vincula solo');
    assert.equal(rev!.motivo_revision, 'Mismo n.º de operación, otra fecha (05/10 vs 12/10)');
    assert.deepEqual(rev!.sugerencias.map((s) => s.id), [fuera.id]);
    assert.equal((await prisma.pago.findUniqueOrThrow({ where: { id: fuera.id }, include: { movimientoBancario: true } })).movimientoBancario, null);
    // Volver a cruzar (lo hace subir otro extracto, vincular…) no lo concilia.
    for (let i = 0; i < 2; i++) await cruzar();
    assert.equal((await movimientos('por_revisar')).length, 1);
    // La administración decide: vincular a mano lo concilia (a mano) y el motivo desaparece.
    assert.equal((await api(T.adminA, 'POST', `${base_()}/movimientos/${rev!.id}/vincular`, { pago_id: fuera.id })).status, 200);
    const conciliado = (await movimientos('conciliado')).find((m) => m.id === rev!.id)!;
    assert.deepEqual([conciliado.vinculo, conciliado.motivo_revision], ['manual', null]);
  });

  it('la operación que leyó la IA del voucher cuenta igual; más lejos del tope de 31 días no se sugiere ni se concilia', async () => {
    const p = await crearPago(d, { monto: 150, fecha: '2026-10-20' });
    await prisma.evaluacionComprobante.create({ data: { pago_id: p.id, estado: 'completada', extraido: { numero_operacion: '0100234', monto: 150 } } });
    await crearPago(d, { monto: 99, fecha: '2026-09-01', referencia: '555555' }); // sólo para que 05/10 no sea «fuera de período»
    await subir(csv([{ fecha: '05/10/2026', monto: 150, op: '100234' }, { fecha: '05/10/2026', monto: 99, op: '555555' }]));
    const [rev] = await movimientos('por_revisar');
    assert.deepEqual(rev!.sugerencias.map((s) => s.id), [p.id]);
    assert.equal(rev!.motivo_revision, 'Mismo n.º de operación, otra fecha (05/10 vs 20/10)');
    assert.equal((await movimientos('conciliado')).length, 0);
    const lejos = (await movimientos()).find((m) => m.monto === '99.00')!;
    assert.equal(lejos.estado, 'sin_pago', '35 días: ni siquiera se sugiere');
  });

  it('el número repetido entre fechas (el caso real del BCP): cada abono toma el pago de su día y el otro cliente no se cuela', async () => {
    const x = await crearPago(d, { monto: 150, fecha: '2026-10-05', referencia: '5044754' });
    const y = await crearPago(d, { monto: 150, fecha: '2026-10-12', referencia: '5044754' });
    await subir(csv([{ fecha: '05/10/2026', monto: 150, op: '5044754', desc: 'CLIENTE X DEMO' }, { fecha: '12/10/2026', monto: 150, op: '5044754', desc: 'CLIENTE Y DEMO' }]));
    const por = Object.fromEntries((await movimientos('conciliado')).map((m) => [m.fecha, m.pago!.id]));
    assert.deepEqual(por, { '2026-10-05': x.id, '2026-10-12': y.id });
    // Si el 05/10 no está en el extracto, el abono del 12/10 NO toma el pago del 05/10 con ese mismo número: queda por revisar o sin pago.
    await prisma.movimientoBancario.deleteMany();
    await prisma.pago.delete({ where: { id: y.id } });
    await subir(csv([{ fecha: '12/10/2026', monto: 150, op: '5044754', desc: 'CLIENTE Y DEMO' }]), 'otro.csv');
    const [m] = await movimientos();
    assert.notEqual(m!.estado, 'conciliado');
    assert.equal(m!.pago, null);
  });

  it('con una ventana mayor en la cuenta, la misma operación pasa a conciliarse sola', async () => {
    await crearPago(d, { monto: 150, fecha: '2026-10-12', referencia: '100234' });
    await subir(csv([{ fecha: '05/10/2026', monto: 150, op: '100234' }]));
    assert.equal((await movimientos())[0]!.estado, 'por_revisar');
    assert.equal((await api(T.adminA, 'PUT', `${base_()}/configuracion`, { ventana_dias: 7 })).status, 200);
    await cruzar();
    assert.equal((await movimientos())[0]!.estado, 'conciliado');
  });
});

describe('hoja correcta del libro', () => {
  it('el extracto del BCP viene en la segunda hoja («accountDetail»): se importa esa, con sus abonos y salidas', async () => {
    const r = await subir(fixture('bcp-detalle.xlsx'), 'bcp-detalle.xlsx');
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.extracto.hoja, 'accountDetail');
    assert.deepEqual([r.body.extracto.filas_leidas, r.body.extracto.salidas_leidas], [3, 2]);
    assert.equal(r.body.extracto.total_abonos, '1534.56');
    assert.equal(r.body.extracto.saldo, null, 'sin columna de saldo no se dice nada');
    assert.equal((await prisma.extractoBancario.findFirstOrThrow()).hoja, 'accountDetail');
    assert.equal((await resumen()).saldo, null);
  });
});

describe('salidas (cargos)', () => {
  it('se guardan en estado «salida», fuera de «Todos», con su pestaña, y nunca se cruzan con pagos de vecinos', async () => {
    const pagoDe80 = await crearPago(d, { monto: 80, fecha: '2026-10-06' }); // mismo monto que la salida
    const r = await subir(fixture('bcp-detalle.xlsx'), 'bcp-detalle.xlsx');
    assert.equal(r.status, 201, r.texto);
    const salidas = await movimientos('salida');
    assert.deepEqual(salidas.map((m) => [m.monto, m.fecha, m.descripcion, m.estado]).sort(), [['45.50', '2026-10-08', 'COMISION MANTENIMIENTO', 'salida'], ['80.00', '2026-10-06', 'PAGO LUZ DEMO', 'salida']]);
    assert.ok(salidas.every((m) => m.pago === null && m.sugerencias.length === 0));
    assert.equal((await movimientos()).length, 3, 'sin pedir un estado se ven sólo los abonos');
    assert.ok((await movimientos()).every((m) => m.estado !== 'salida'));
    assert.equal((await prisma.pago.findUniqueOrThrow({ where: { id: pagoDe80.id }, include: { movimientoBancario: true } })).movimientoBancario, null, 'la salida de 80 no se llevó el pago de 80');
    await cruzar();
    assert.equal((await movimientos('salida')).length, 2, 'el cruce no toca las salidas');
  });

  it('una sola columna «Importe/Monto» con signo: los negativos son salidas, los positivos abonos', async () => {
    const r = await subir(csv([{ fecha: '05/10/2026', monto: 150 }, { fecha: '06/10/2026', monto: -80, desc: 'SALE' }, { fecha: '07/10/2026', monto: '(20.50)', desc: 'SALE 2' }]));
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual([r.body.extracto.filas_leidas, r.body.extracto.salidas_leidas, r.body.extracto.total_salidas], [1, 2, '100.50']);
    assert.deepEqual((await movimientos('salida')).map((m) => m.monto).sort(), ['20.50', '80.00']);
    assert.deepEqual((await movimientos()).map((m) => m.monto), ['150.00']);
  });

  it('el resumen trae abonos, salidas y neto del periodo', async () => {
    await subir(fixture('bcp-detalle.xlsx'), 'bcp-detalle.xlsx');
    const r = await resumen();
    assert.deepEqual(r.abonos, { cantidad: 3, monto: '1534.56' });
    assert.deepEqual(r.salidas, { cantidad: 2, monto: '125.50' });
    assert.equal(r.neto, '1409.06');
    assert.deepEqual(r.total, r.abonos);
    assert.deepEqual([r.rango.desde, r.rango.hasta], ['2026-10-05', '2026-10-08'], 'el rango cubre también las salidas');
  });

  it('una salida no se vincula, no se ignora ni se desvincula', async () => {
    const p = await crearPago(d, { monto: 80, fecha: '2026-10-06' });
    await subir(csv([{ fecha: '06/10/2026', monto: -80 }]));
    const [s] = await movimientos('salida');
    assert.equal((await api(T.adminA, 'POST', `${base_()}/movimientos/${s!.id}/vincular`, { pago_id: p.id })).status, 409);
    assert.equal((await api(T.adminA, 'POST', `${base_()}/movimientos/${s!.id}/ignorar`, { motivo: 'x' })).status, 409);
    assert.equal((await api(T.adminA, 'POST', `${base_()}/movimientos/${s!.id}/desvincular`)).status, 409);
    assert.equal((await movimientos('salida')).length, 1);
  });

  it('un abono y una salida iguales (fecha, monto y glosa) no se confunden entre sí, y re-subir no duplica ninguno', async () => {
    const x = csv([{ fecha: '05/10/2026', monto: 80, desc: 'IGUAL' }, { fecha: '05/10/2026', monto: -80, desc: 'IGUAL' }]);
    const a = await subir(x);
    assert.deepEqual([a.body.extracto.filas_nuevas, a.body.extracto.salidas_nuevas], [1, 1]);
    const b = await subir(x);
    assert.deepEqual([b.body.extracto.filas_nuevas, b.body.extracto.filas_repetidas, b.body.extracto.salidas_nuevas], [0, 1, 0]);
    assert.equal(await prisma.movimientoBancario.count(), 2);
  });

  it('sólo salidas: el extracto entra igual (un mes sin ingresos); ni abonos ni salidas: 422', async () => {
    const r = await subir(csv([{ fecha: '05/10/2026', monto: -80 }]));
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual([r.body.extracto.filas_leidas, r.body.extracto.salidas_leidas], [0, 1]);
    assert.equal((await resumen()).abonos.cantidad, 0);
  });

  it('la pestaña «Salidas» es del alcance de la cuenta: otra empresa → 404; un residente → 403; un estado inventado → 422', async () => {
    await subir(csv([{ fecha: '05/10/2026', monto: -80 }]));
    assert.equal((await api(T.adminB, 'GET', `${base_()}/movimientos?estado=salida`)).status, 404);
    assert.equal((await api(T.prop1, 'GET', `${base_()}/movimientos?estado=salida`)).status, 403);
    assert.equal((await api(T.adminA, 'GET', `${base_()}/movimientos?estado=nada`)).status, 422);
    assert.equal((await api(T.adminA, 'GET', `${base_()}/movimientos?estado=salida&q=80`)).body.total, 1, 'se puede buscar por monto');
  });
});

describe('saldo del extracto', () => {
  it('del más viejo al más nuevo: cuadra, y se guardan el saldo inicial y el final', async () => {
    const r = await subir(fixture('saldo-asc.csv'), 'saldo-asc.csv');
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual(r.body.extracto.saldo, { inicial: '1000.00', final: '2262.06', cuadra: true, avisos: [] });
    const e = await prisma.extractoBancario.findFirstOrThrow();
    assert.deepEqual([e.saldo_inicial?.toFixed(2), e.saldo_final?.toFixed(2), e.saldo_cuadra, e.saldo_avisos], ['1000.00', '2262.06', true, []]);
    const s = (await resumen()).saldo;
    assert.deepEqual([s.inicial, s.final, s.cuadra, s.avisos], ['1000.00', '2262.06', true, []]);
  });

  it('del más nuevo al más viejo también cuadra', async () => {
    const r = await subir(fixture('saldo-desc.csv'), 'saldo-desc.csv');
    assert.deepEqual(r.body.extracto.saldo, { inicial: '1000.00', final: '2262.06', cuadra: true, avisos: [] });
  });

  it('si falta un movimiento: aviso en la subida y en el resumen, con el saldo inicial y final igual guardados', async () => {
    const r = await subir(fixture('saldo-roto.csv'), 'saldo-roto.csv');
    assert.equal(r.status, 201, r.texto);
    const aviso = 'Entre la fila 3 y la 4 el saldo no cuadra: puede faltar un movimiento o el archivo está cortado';
    assert.deepEqual(r.body.extracto.saldo, { inicial: '1000.00', final: '2262.06', cuadra: false, avisos: [aviso] });
    const s = (await resumen()).saldo;
    assert.deepEqual([s.cuadra, s.avisos, s.archivo_nombre], [false, [aviso], 'saldo-roto.csv']);
    assert.equal((await api(T.adminA, 'GET', `${base_()}/extractos`)).body.items[0].saldo.cuadra, false);
  });

  it('el resumen muestra la verificación de la última subida con saldo; sin columna de saldo no cambia ni dice nada', async () => {
    await subir(fixture('saldo-roto.csv'), 'saldo-roto.csv');
    await subir(csv([{ fecha: '20/10/2026', monto: 10 }]), 'sin-saldo.csv');
    assert.equal((await resumen()).saldo.cuadra, false, 'el extracto sin saldo no borra el aviso del anterior');
    await subir(fixture('saldo-asc.csv'), 'saldo-asc.csv');
    assert.equal((await resumen()).saldo.cuadra, true, 'la subida corregida lo reemplaza');
  });

  it('un mapeo elegido a mano puede incluir la columna de saldo, y se recuerda', async () => {
    const mapeo = { fecha: 0, descripcion: 1, abono: 3, cargo: 2, operacion: null, saldo: 4, fila_inicio: 1 };
    const r = await subir(fixture('saldo-asc.csv'), 'saldo-asc.csv', mapeo);
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.extracto.saldo.cuadra, true);
    assert.deepEqual((await prisma.configuracionConciliacion.findUniqueOrThrow({ where: { medio_pago_id: cuenta.id } })).columnas, mapeo);
    assert.equal((await subir(fixture('saldo-asc.csv'), 'saldo-asc.csv', { ...mapeo, saldo: 'x' })).status, 422);
  });
});

describe('fuera de período', () => {
  it('un abono sin voucher cuyo día queda fuera del rango de los pagos registrados va a «fuera de período» y no cuenta como «sin voucher»', async () => {
    await crearPago(d, { monto: 11, fecha: '2026-10-05' });
    await crearPago(d, { monto: 12, fecha: '2026-10-10' });
    await subir(csv([
      { fecha: '07/10/2026', monto: 77, desc: 'DENTRO' }, { fecha: '05/10/2026', monto: 78, desc: 'BORDE INICIO' }, { fecha: '10/10/2026', monto: 79, desc: 'BORDE FIN' },
      { fecha: '04/10/2026', monto: 80, desc: 'ANTES' }, { fecha: '11/10/2026', monto: 81, desc: 'DESPUES' }, { fecha: '01/09/2026', monto: 82, desc: 'MUY ANTES' },
    ]));
    assert.deepEqual((await movimientos('sin_pago')).map((m) => m.descripcion).sort(), ['BORDE FIN', 'BORDE INICIO', 'DENTRO']);
    assert.deepEqual((await movimientos('fuera_periodo')).map((m) => m.descripcion).sort(), ['ANTES', 'DESPUES', 'MUY ANTES']);
    const r = await resumen();
    assert.deepEqual([r.sin_pago.cantidad, r.fuera_periodo.cantidad, r.fuera_periodo.monto], [3, 3, '243.00'], 'no se cuentan como abonos sin voucher');
    assert.equal(r.abonos.cantidad, 6);
  });

  it('con un pago nuevo que amplía el periodo, el abono vuelve a «sin voucher» (lo fuera de período se reevalúa al cruzar)', async () => {
    await crearPago(d, { monto: 11, fecha: '2026-10-05' });
    await subir(csv([{ fecha: '20/10/2026', monto: 77 }]));
    assert.equal((await movimientos())[0]!.estado, 'fuera_periodo');
    await crearPago(d, { monto: 12, fecha: '2026-10-25' });
    await cruzar();
    assert.equal((await movimientos())[0]!.estado, 'sin_pago');
  });

  it('sin pagos registrados no hay periodo: nada es «fuera de período»; los rechazados y el efectivo no cuentan para el rango', async () => {
    await subir(csv([{ fecha: '20/10/2026', monto: 77 }]));
    assert.equal((await movimientos())[0]!.estado, 'sin_pago');
    await crearPago(d, { monto: 12, fecha: '2026-10-20', estado: 'rechazado' });
    await crearPago(d, { monto: 13, fecha: '2026-10-20', metodo: 'efectivo' });
    await cruzar();
    assert.equal((await movimientos())[0]!.estado, 'sin_pago', 'sin ningún pago que pudiera pasar por el banco, no hay rango');
    await crearPago(d, { monto: 14, fecha: '2026-10-01' });
    await cruzar();
    assert.equal((await movimientos())[0]!.estado, 'fuera_periodo');
  });

  it('se puede vincular a mano o ignorar un abono fuera de período', async () => {
    const p = await crearPago(d, { monto: 140, fecha: '2026-10-05' });
    await subir(csv([{ fecha: '20/10/2026', monto: 150 }, { fecha: '21/10/2026', monto: 3, desc: 'INTERESES' }]));
    const [a, b] = (await movimientos('fuera_periodo')).sort((x, y) => x.fecha.localeCompare(y.fecha));
    assert.equal((await api(T.adminA, 'POST', `${base_()}/movimientos/${a!.id}/vincular`, { pago_id: p.id })).status, 200);
    assert.equal((await api(T.adminA, 'POST', `${base_()}/movimientos/${b!.id}/ignorar`, { motivo: 'Intereses' })).status, 200);
    assert.deepEqual([(await resumen()).conciliados.cantidad, (await resumen()).ignorados.cantidad, (await resumen()).fuera_periodo.cantidad], [1, 1, 0]);
  });

  it('«vouchers sin abono» sólo mira los pagos dentro del rango de fechas del extracto (el último día cuenta; el siguiente no)', async () => {
    const dentro = await crearPago(d, { monto: 31, fecha: '2026-10-10', estado: 'validado' });
    await crearPago(d, { monto: 32, fecha: '2026-10-11', estado: 'validado' });
    await crearPago(d, { monto: 33, fecha: '2026-10-04', estado: 'validado' });
    await subir(csv([{ fecha: '05/10/2026', monto: 1 }, { fecha: '10/10/2026', monto: 2 }]));
    const lista = (await api(T.adminA, 'GET', `${base_()}/sin-abono`)).body;
    assert.deepEqual(lista.items.map((p: { id: number }) => p.id), [dentro.id]);
    const solo = (await resumen()).vouchers_sin_abono;
    assert.deepEqual([solo.cantidad, solo.monto], [1, '31.00']);
  });
});

describe('pista por nombre', () => {
  const persona = (nombre: string) => prisma.usuario.create({ data: { nombre, email: `${nombre.toLowerCase().replace(/\W+/g, '.')}@nombres.demo`, rol: 'propietario' } });

  it('por revisar: los pagos cuyo propietario aparece en la glosa («YAPE MANUEL CAV») van primero; sin nombre, se conserva el orden por fecha', async () => {
    const manuel = await persona('Manuel Cavero Soto');
    const otro = await crearPago(d, { monto: 150, fecha: '2026-10-05' }); // propietario «Propietario 1»: más cerca de la fecha del abono
    const deManuel = await crearPago(d, { monto: 150, fecha: '2026-10-07', propietarioId: manuel.id });
    await subir(csv([{ fecha: '05/10/2026', monto: 150, desc: 'YAPE MANUEL CAV' }]));
    const [m] = await movimientos('por_revisar');
    assert.deepEqual(m!.sugerencias.map((s) => [s.id, s.nombre_coincide]), [[deManuel.id, true], [otro.id, false]]);
    // La misma glosa sin nombre: manda la cercanía de la fecha.
    await prisma.movimientoBancario.deleteMany();
    await subir(csv([{ fecha: '05/10/2026', monto: 150, desc: 'TRANSFERENCIA DEMO' }]), 'b.csv');
    assert.deepEqual((await movimientos('por_revisar'))[0]!.sugerencias.map((s) => s.id), [otro.id, deManuel.id]);
  });

  it('también coincide el inquilino de la unidad y quien registró el pago', async () => {
    const rosa = await persona('Rosa Quispe Rojas');
    const sinRelacion = await crearPago(d, { monto: 150, fecha: '2026-10-05' }); // la más cercana a la fecha del abono, pero sin relación con la glosa
    const registradoPorRosa = await crearPago(d, { monto: 150, fecha: '2026-10-06' });
    await prisma.pago.update({ where: { id: registradoPorRosa.id }, data: { usuario_id: rosa.id } });
    const delInquilino = await crearPago(d, { monto: 150, fecha: '2026-10-07' });
    const cargo = await prisma.reciboConceptoUnidad.findFirstOrThrow({ where: { pagos: { some: { id: delInquilino.id } } }, select: { unidad_id: true } });
    await prisma.unidad.update({ where: { id: cargo.unidad_id! }, data: { inquilino_id: rosa.id } });
    await subir(csv([{ fecha: '05/10/2026', monto: 150, desc: 'TRAN. QUISPE' }, { fecha: '05/10/2026', monto: 150, desc: 'TRANSFERENCIA DEMO' }]));
    const por = Object.fromEntries((await movimientos('por_revisar')).map((m) => [m.descripcion, m.sugerencias]));
    assert.deepEqual(por['TRAN. QUISPE']!.map((s) => [s.id, s.nombre_coincide]), [[registradoPorRosa.id, true], [delInquilino.id, true], [sinRelacion.id, false]]);
    assert.deepEqual(por['TRANSFERENCIA DEMO']!.map((s) => s.id), [sinRelacion.id, registradoPorRosa.id, delInquilino.id], 'sin nombre en la glosa manda la fecha');
  });

  it('sin pago: la búsqueda para vincular a mano pone primero los pagos del nombre de la glosa', async () => {
    const manuel = await persona('Manuel Cavero Soto');
    const otro = await crearPago(d, { monto: 150, fecha: '2026-10-05' });
    const deManuel = await crearPago(d, { monto: 150, fecha: '2026-10-07', propietarioId: manuel.id });
    await subir(csv([{ fecha: '05/10/2026', monto: 99, desc: 'YAPE MANUEL CAV' }, { fecha: '05/10/2026', monto: 98, desc: 'TRANSFERENCIA DEMO' }]));
    const [conNombre, sinNombre] = [(await movimientos('sin_pago')).find((m) => m.monto === '99.00')!, (await movimientos('sin_pago')).find((m) => m.monto === '98.00')!];
    const busq = async (id: number) => (await api(T.adminA, 'GET', `${base_()}/movimientos/${id}/pagos`)).body.items as { id: number; nombre_coincide: boolean }[];
    assert.deepEqual((await busq(conNombre.id)).map((p) => [p.id, p.nombre_coincide]), [[deManuel.id, true], [otro.id, false]]);
    assert.deepEqual((await busq(sinNombre.id)).map((p) => p.id), [otro.id, deManuel.id]);
  });

  it('NUNCA concilia solo por nombre: sólo ordena', async () => {
    const manuel = await persona('Manuel Cavero Soto');
    const deManuel = await crearPago(d, { monto: 150, fecha: '2026-10-05', propietarioId: manuel.id });
    await subir(csv([{ fecha: '05/10/2026', monto: 200, desc: 'YAPE MANUEL CAV' }, { fecha: '06/10/2026', monto: 150, desc: 'YAPE MANUEL CAV' }]));
    const por = Object.fromEntries((await movimientos()).map((m) => [m.monto, m.estado]));
    assert.equal(por['200.00'], 'sin_pago', 'otro monto: el nombre no basta');
    assert.equal(por['150.00'], 'conciliado', 'monto y fecha dentro de la ventana siguen conciliando como siempre (no por el nombre)');
    // Dos pagos de monto igual, uno de Manuel: sigue «por revisar», no se queda con el de Manuel.
    await prisma.movimientoBancario.deleteMany();
    await prisma.pago.deleteMany();
    await crearPago(d, { monto: 150, fecha: '2026-10-05', propietarioId: manuel.id });
    await crearPago(d, { monto: 150, fecha: '2026-10-05' });
    await subir(csv([{ fecha: '05/10/2026', monto: 150, desc: 'YAPE MANUEL CAV' }]), 'otro.csv');
    const [m] = await movimientos();
    assert.deepEqual([m!.estado, m!.pago], ['por_revisar', null]);
    assert.ok(deManuel.id > 0);
  });

  it('la API no devuelve los nombres de las personas, sólo si coincide', async () => {
    const manuel = await persona('Manuel Cavero Soto');
    await crearPago(d, { monto: 150, fecha: '2026-10-05', propietarioId: manuel.id });
    await crearPago(d, { monto: 150, fecha: '2026-10-05' });
    await subir(csv([{ fecha: '05/10/2026', monto: 150, desc: 'YAPE MANUEL CAV' }]));
    const crudo = JSON.stringify((await api(T.adminA, 'GET', `${base_()}/movimientos`)).body);
    assert.ok(!crudo.includes('Cavero') && !crudo.includes('"nombres"'));
  });
});

describe('auditoría de lo nuevo', () => {
  it('importar guarda conteos de salidas y si el saldo cuadra, sin descripciones ni avisos de fila', async () => {
    await subir(fixture('saldo-roto.csv'), 'saldo-roto.csv');
    const filas = await esperar(async () => { const f = await prisma.auditoria.findMany({ where: { entidad: 'conciliacion', accion: 'importar' } }); return f.length ? f : null; });
    const det = filas[0]!.detalle as Record<string, unknown>;
    assert.deepEqual([det.abonos, det.salidas, det.salidas_nuevas, det.total_salidas, det.saldo_cuadra, det.fuera_periodo], [2, 2, 2, '125.50', false, 0]);
    const texto = JSON.stringify(det);
    for (const secreto of ['COMISION', 'INTERESES', 'PAGO LUZ', 'no cuadra']) assert.ok(!texto.includes(secreto), secreto);
  });
});
