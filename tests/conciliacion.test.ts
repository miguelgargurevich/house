// Conciliación bancaria de punta a punta: subir el extracto, cruce automático (único, varios, ninguno, grupo, n.º de operación, rechazados, ventana),
// «voucher sin abono», vincular / desvincular / ignorar, permisos entre empresas, solo lectura, plan sin la capacidad y auditoría sin descripciones.
// Extractos sintéticos (datos inventados): los de `tests/fixtures/conciliacion/` y CSV armados aquí.
import './helpers/env';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { esperar, iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { crearCuenta, crearPago, crearPagoDeGrupo, csv, subirExtracto } from './helpers/conciliacion';
import { hoyLima } from '../src/server/lib/fechas';
import { invalidarComercial } from '../src/server/services/comercial/modulos';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'conciliacion');
const fixture = (n: string) => fs.readFileSync(path.join(FIXTURES, n));
const DIA = 86_400_000;

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1', string>;
let cuenta: { id: number };
let cuentaB: { id: number };

const api = (t: string | null, m: string, ruta: string, cuerpo?: unknown) => llamar(base, m, ruta, t, cuerpo);
const base_ = (id = cuenta.id) => `/api/conciliacion/cuentas/${id}`;
const subir = (bytes: Buffer, nombre = 'extracto.csv', columnas?: unknown, token = T.adminA, id = cuenta.id) => subirExtracto(base, token, id, bytes, nombre, columnas);
const movimientos = async (estado?: string, id = cuenta.id) => (await api(T.adminA, 'GET', `${base_(id)}/movimientos?pageSize=100${estado ? `&estado=${estado}` : ''}`)).body.items as { id: number; estado: string; monto: string; fecha: string; pago: { id: number } | null; sugerencias: { id: number }[]; vinculo: string | null }[];
const resumen = async () => (await api(T.adminA, 'GET', `${base_()}/resumen`)).body;

/** Condominio A en el plan indicado: `gratis` con la conciliación suelta y/o el plazo gratis vencido, o `cortesia`. */
async function fijarPlan(plan: 'cortesia' | 'gratis' | 'pro', opts: { modulos?: string[]; gratisHasta?: Date | null } = {}) {
  await prisma.suscripcionCondominio.upsert({
    where: { complejo_id: d.complejoA.id },
    create: { complejo_id: d.complejoA.id, plan_clave: plan, modulos: opts.modulos ?? [], estado: plan === 'gratis' ? 'gratis' : 'activa', gratis_hasta: opts.gratisHasta ?? null },
    update: { plan_clave: plan, modulos: opts.modulos ?? [], estado: plan === 'gratis' ? 'gratis' : 'activa', es_prueba: false, vigente_hasta: null, solicitud_plan: null, solicitud_modulos: [], gratis_hasta: opts.gratisHasta ?? null },
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
  await fijarPlan('cortesia');
});

describe('subir un extracto', () => {
  it('lee el extracto de un banco, guarda sólo los abonos y reporta los totales', async () => {
    const r = await subir(fixture('bcp.xlsx'), 'bcp.xlsx');
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.requiere_mapeo, false);
    assert.deepEqual([r.body.extracto.filas_leidas, r.body.extracto.filas_nuevas, r.body.extracto.filas_repetidas], [5, 5, 0]);
    assert.equal(r.body.extracto.total_abonos, '1687.56');
    assert.deepEqual([r.body.extracto.fecha_desde, r.body.extracto.fecha_hasta], ['2026-10-05', '2026-10-12']);
    assert.equal(r.body.descartes.cargos, 2);
    const filas = await prisma.movimientoBancario.findMany({ orderBy: { fecha: 'asc' } });
    assert.equal(filas.length, 5, 'los cargos no se guardan');
    assert.ok(filas.every((f) => f.monto.gt(0)));
    const extracto = await prisma.extractoBancario.findFirstOrThrow();
    assert.equal(extracto.archivo_nombre, 'bcp.xlsx');
    assert.equal(extracto.subido_por_id, d.adminA.id);
    assert.ok(!('archivo' in extracto) && !('contenido' in extracto), 'no se guarda el archivo crudo');
  });

  it('todos los bancos de los fixtures entran con los mismos abonos', async () => {
    for (const [i, n] of ['bcp.xlsx', 'interbank.csv', 'bbva.xls', 'scotiabank.xlsx', 'banbif.csv'].entries()) {
      const c = await crearCuenta(d.complejoA.id, { titular: `Demo ${i}` });
      const r = await subir(fixture(n), n, undefined, T.adminA, c.id);
      assert.equal(r.status, 201, `${n}: ${r.texto}`);
      assert.equal(r.body.extracto.total_abonos, '1687.56', n);
    }
  });

  it('un extracto que se solapa NO duplica movimientos', async () => {
    assert.equal((await subir(csv([{ fecha: '05/10/2026', monto: 150, op: '100234' }, { fecha: '06/10/2026', monto: 80 }]))).body.extracto.filas_nuevas, 2);
    const r = await subir(csv([{ fecha: '06/10/2026', monto: 80 }, { fecha: '07/10/2026', monto: 99 }, { fecha: '05/10/2026', monto: 150, op: '100234' }]), 'otro.csv');
    assert.deepEqual([r.body.extracto.filas_leidas, r.body.extracto.filas_nuevas, r.body.extracto.filas_repetidas], [3, 1, 2]);
    assert.equal(await prisma.movimientoBancario.count(), 3);
    // Re-subir exactamente lo mismo no cambia nada.
    const otra = await subir(csv([{ fecha: '06/10/2026', monto: 80 }, { fecha: '07/10/2026', monto: 99 }, { fecha: '05/10/2026', monto: 150, op: '100234' }]), 'otro.csv');
    assert.deepEqual([otra.body.extracto.filas_nuevas, otra.body.extracto.filas_repetidas], [0, 3]);
    assert.equal(await prisma.movimientoBancario.count(), 3);
  });

  it('dos abonos idénticos el mismo día (sin operación) se conservan los dos, y re-subir no los duplica', async () => {
    const dos = csv([{ fecha: '05/10/2026', monto: 150 }, { fecha: '05/10/2026', monto: 150 }]);
    assert.equal((await subir(dos)).body.extracto.filas_nuevas, 2);
    assert.equal((await subir(dos)).body.extracto.filas_nuevas, 0);
    assert.equal(await prisma.movimientoBancario.count(), 2);
  });

  it('la misma fila en OTRA cuenta no es un duplicado', async () => {
    const x = csv([{ fecha: '05/10/2026', monto: 150 }]);
    await subir(x);
    const otra = await crearCuenta(d.complejoA.id, { titular: 'Segunda' });
    assert.equal((await subir(x, 'x.csv', undefined, T.adminA, otra.id)).body.extracto.filas_nuevas, 1);
  });

  it('columnas que no se reconocen: pide elegirlas (con las primeras filas) y no guarda nada; con el mapeo se importa y se recuerda para la cuenta', async () => {
    const r = await subir(fixture('raro.xlsx'), 'raro.xlsx');
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.requiere_mapeo, true);
    assert.deepEqual(r.body.vista[0], ['Cuándo', 'Qué pasó', 'Plata que entró', 'Plata que salió', 'Clave']);
    assert.equal(await prisma.movimientoBancario.count(), 0);
    assert.equal(await prisma.extractoBancario.count(), 0);

    const mapeo = { fecha: 0, descripcion: 1, abono: 2, cargo: 3, operacion: 4, fila_inicio: 1 };
    const ok = await subir(fixture('raro.xlsx'), 'raro.xlsx', mapeo);
    assert.equal(ok.status, 201, ok.texto);
    assert.equal(ok.body.extracto.total_abonos, '1687.56');
    assert.deepEqual((await prisma.configuracionConciliacion.findUniqueOrThrow({ where: { medio_pago_id: cuenta.id } })).columnas, mapeo);
    assert.equal((await api(T.adminA, 'GET', '/api/conciliacion/cuentas')).body.items.find((c: { id: number }) => c.id === cuenta.id).tiene_mapeo, true);

    // La siguiente vez no hace falta elegir: se reutiliza el mapeo de la cuenta.
    await prisma.movimientoBancario.deleteMany();
    const otra = await subir(fixture('raro.xlsx'), 'raro.xlsx');
    assert.equal(otra.status, 201, otra.texto);
    assert.equal(otra.body.extracto.filas_nuevas, 5);
    // …pero no en otra cuenta.
    const c2 = await crearCuenta(d.complejoA.id, { titular: 'Otra' });
    assert.equal((await subir(fixture('raro.xlsx'), 'raro.xlsx', undefined, T.adminA, c2.id)).body.requiere_mapeo, true);
  });

  it('mapeo inválido: 422; archivo vacío, ilegible, sin abonos o demasiado grande: 422', async () => {
    assert.equal((await subir(fixture('raro.xlsx'), 'raro.xlsx', { fecha: 'x' })).status, 422);
    assert.equal((await subir(Buffer.alloc(0), 'v.csv')).status, 422);
    assert.equal((await subir(Buffer.from([0, 1, 2, 3, 250, 251, 0, 9]), 'roto.xlsx')).status, 422);
    const soloCargos = await subir(csv([{ fecha: '05/10/2026', monto: -80 }]));
    assert.equal(soloCargos.status, 422);
    assert.match(soloCargos.body.error, /ningún abono/);
    const grande = await subir(Buffer.alloc(6 * 1024 * 1024, 65), 'grande.csv');
    assert.equal(grande.status, 422);
    assert.match(grande.body.error, /pesa más de 5 MB/);
    const filas = ['Fecha,Abono', ...Array.from({ length: 5200 }, () => '05/10/2026,10.00')].join('\n');
    const muchas = await subir(Buffer.from(filas), 'mucho.csv');
    assert.equal(muchas.status, 422);
    assert.match(muchas.body.error, /más de 5000 filas/);
    assert.equal(await prisma.movimientoBancario.count(), 0);
    const sinArchivo = await fetch(`${base}${base_()}/extractos`, { method: 'POST', headers: { cookie: `house_sesion=${T.adminA.split('.')[0]}`, 'x-csrf-token': T.adminA.split('.')[1]! }, body: new FormData() });
    assert.equal(sinArchivo.status, 422);
  });
});

describe('cruce automático', () => {
  it('un solo candidato → conciliado (automático) y el pago queda vinculado', async () => {
    const p = await crearPago(d, { monto: 150, fecha: '2026-10-06' });
    await subir(csv([{ fecha: '05/10/2026', monto: 150 }]));
    const [m] = await movimientos();
    assert.equal(m!.estado, 'conciliado');
    assert.equal(m!.vinculo, 'automatico');
    assert.equal(m!.pago!.id, p.id);
    assert.equal(m!.fecha, '2026-10-05');
  });

  it('varios candidatos → por revisar con sugerencias ordenadas; ninguno → abono sin voucher', async () => {
    const lejos = await crearPago(d, { monto: 150, fecha: '2026-10-08' });
    const cerca = await crearPago(d, { monto: 150, fecha: '2026-10-05' });
    const medio = await crearPago(d, { monto: 150, fecha: '2026-10-06' });
    await subir(csv([{ fecha: '05/10/2026', monto: 150 }, { fecha: '05/10/2026', monto: 77.7 }]));
    const [revisar] = await movimientos('por_revisar');
    assert.deepEqual(revisar!.sugerencias.map((s) => s.id), [cerca.id, medio.id, lejos.id]);
    const [sin] = await movimientos('sin_pago');
    assert.equal(sin!.monto, '77.70');
    assert.deepEqual(sin!.sugerencias, []);
    const r = await resumen();
    assert.deepEqual([r.por_revisar.cantidad, r.sin_pago.cantidad, r.conciliados.cantidad], [1, 1, 0]);
  });

  it('un pago del mantenimiento completo se compara con el TOTAL del grupo y se vincula el principal', async () => {
    const principal = await crearPagoDeGrupo(d, [100, 50, 30], { fecha: '2026-10-05' });
    await subir(csv([{ fecha: '05/10/2026', monto: 180 }, { fecha: '05/10/2026', monto: 100 }]));
    const conciliados = await movimientos('conciliado');
    assert.equal(conciliados.length, 1);
    assert.equal(conciliados[0]!.monto, '180.00');
    assert.equal(conciliados[0]!.pago!.id, principal.id);
    assert.equal((await movimientos('sin_pago'))[0]!.monto, '100.00', 'un solo concepto del grupo no es el pago');
  });

  it('el número de operación gana entre pagos del mismo monto y fecha (de la referencia o de lo que leyó la IA)', async () => {
    await crearPago(d, { monto: 150, fecha: '2026-10-05' });
    const buena = await crearPago(d, { monto: 150, fecha: '2026-10-05', referencia: 'OP-100234' });
    const leidaPorIA = await crearPago(d, { monto: 150, fecha: '2026-10-05' });
    await prisma.evaluacionComprobante.create({ data: { pago_id: leidaPorIA.id, estado: 'completada', extraido: { numero_operacion: '0100777', monto: 150 } } });
    await subir(csv([{ fecha: '05/10/2026', monto: 150, op: '100234' }, { fecha: '05/10/2026', monto: 150, op: '100777' }]));
    const por = Object.fromEntries((await movimientos('conciliado')).map((m) => [m.pago!.id, m]));
    assert.ok(por[buena.id] && por[leidaPorIA.id]);
    assert.equal((await movimientos()).length, 2);
  });

  it('un pago rechazado nunca es candidato; uno por validar o validado sí', async () => {
    await crearPago(d, { monto: 150, estado: 'rechazado' });
    await subir(csv([{ fecha: '05/10/2026', monto: 150 }]));
    assert.equal((await movimientos())[0]!.estado, 'sin_pago');
    await crearPago(d, { monto: 150, estado: 'por_validar', fecha: '2026-10-05' });
    await api(T.adminA, 'POST', `${base_()}/cruzar`);
    assert.equal((await movimientos())[0]!.estado, 'conciliado');
    await prisma.movimientoBancario.deleteMany();
    await subir(csv([{ fecha: '09/10/2026', monto: 99 }]), 'v.csv');
    await crearPago(d, { monto: 99, estado: 'validado', fecha: '2026-10-09' });
    await api(T.adminA, 'POST', `${base_()}/cruzar`);
    assert.equal((await movimientos())[0]!.estado, 'conciliado');
  });

  it('el monto debe coincidir al centavo', async () => {
    await crearPago(d, { monto: '150.01', fecha: '2026-10-05' });
    await crearPago(d, { monto: '149.99', fecha: '2026-10-05' });
    await subir(csv([{ fecha: '05/10/2026', monto: '150.00' }]));
    assert.equal((await movimientos())[0]!.estado, 'sin_pago');
  });

  it('la ventana de días: ±3 por defecto y se cambia por cuenta en la base', async () => {
    await crearPago(d, { monto: 150, fecha: '2026-10-08' }); // 3 días después: dentro
    await crearPago(d, { monto: 80, fecha: '2026-10-09' }); // 4 días: fuera
    await subir(csv([{ fecha: '05/10/2026', monto: 150 }, { fecha: '05/10/2026', monto: 80 }]));
    const por = Object.fromEntries((await movimientos()).map((m) => [m.monto, m.estado]));
    assert.deepEqual(por, { '150.00': 'conciliado', '80.00': 'sin_pago' });
    // Con una ventana de 5 días el de 80 también entra al volver a cruzar.
    assert.equal((await api(T.adminA, 'PUT', `${base_()}/configuracion`, { ventana_dias: 5 })).status, 200);
    await api(T.adminA, 'POST', `${base_()}/cruzar`);
    assert.deepEqual(Object.fromEntries((await movimientos()).map((m) => [m.monto, m.estado])), { '150.00': 'conciliado', '80.00': 'conciliado' });
    assert.equal((await api(T.adminA, 'PUT', `${base_()}/configuracion`, { ventana_dias: 99 })).status, 422);
  });

  it('sólo los pagos del mismo condominio; con una cuenta de block, sólo los de ese block', async () => {
    const block1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
    const block2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'Block', complejo_id: d.complejoA.id } });
    const cuentaBlock1 = await crearCuenta(d.complejoA.id, { estructura_id: block1.id, titular: 'Junta B1' });
    const delBlock2 = await crearPago(d, { monto: 150, estructuraId: block2.id });
    await crearPago(d, { monto: 150, complejoId: d.complejoB.id, empresaId: d.empresaB.id, propietarioId: d.propietarioB.id });
    await subir(csv([{ fecha: '05/10/2026', monto: 150 }]), 'b.csv', undefined, T.adminA, cuentaBlock1.id);
    assert.equal((await movimientos(undefined, cuentaBlock1.id))[0]!.estado, 'sin_pago', 'ni el otro block ni el otro condominio');
    const delBlock1 = await crearPago(d, { monto: 150, estructuraId: block1.id });
    await api(T.adminA, 'POST', `${base_(cuentaBlock1.id)}/cruzar`);
    assert.equal((await movimientos(undefined, cuentaBlock1.id))[0]!.pago!.id, delBlock1.id);
    // La cuenta del condominio (sin block) sí ve los pagos de todos sus blocks (el del block 2, libre), y nunca los de otro condominio.
    await subir(csv([{ fecha: '05/10/2026', monto: 150 }]), 'c.csv');
    assert.equal((await movimientos())[0]!.pago!.id, delBlock2.id);
  });

  it('es idempotente: volver a cruzar no cambia lo conciliado, ni a mano', async () => {
    const auto = await crearPago(d, { monto: 150, fecha: '2026-10-05' });
    const manual = await crearPago(d, { monto: 999, fecha: '2026-10-05' });
    await subir(csv([{ fecha: '05/10/2026', monto: 150 }, { fecha: '05/10/2026', monto: 80 }]));
    const sinPago = (await movimientos('sin_pago'))[0]!;
    assert.equal((await api(T.adminA, 'POST', `${base_()}/movimientos/${sinPago.id}/vincular`, { pago_id: manual.id })).status, 200);
    const antes = JSON.stringify(await movimientos());
    for (let i = 0; i < 3; i++) assert.equal((await api(T.adminA, 'POST', `${base_()}/cruzar`)).status, 200);
    assert.equal(JSON.stringify(await movimientos()), antes);
    const porPago = Object.fromEntries((await movimientos('conciliado')).map((m) => [m.pago!.id, m.vinculo]));
    assert.deepEqual(porPago, { [auto.id]: 'automatico', [manual.id]: 'manual' });
  });

  it('un pago que se rechaza después suelta su abono automático; uno borrado también', async () => {
    const a = await crearPago(d, { monto: 150, fecha: '2026-10-05' });
    const b = await crearPago(d, { monto: 80, fecha: '2026-10-05' });
    await subir(csv([{ fecha: '05/10/2026', monto: 150 }, { fecha: '05/10/2026', monto: 80 }]));
    assert.equal((await movimientos('conciliado')).length, 2);
    await prisma.pago.update({ where: { id: a.id }, data: { estado_validacion: 'rechazado' } });
    await prisma.pago.delete({ where: { id: b.id } });
    const r = await resumen();
    assert.deepEqual([r.conciliados.cantidad, r.sin_pago.cantidad], [0, 2]);
  });
});

describe('voucher sin abono', () => {
  it('pagos VALIDADOS del rango del extracto sin abono: alerta con cantidad y monto', async () => {
    const sinAbono = await crearPago(d, { monto: 150, fecha: '2026-10-06', estado: 'validado' });
    await crearPago(d, { monto: 80, fecha: '2026-10-07', estado: 'validado' }); // éste sí tiene abono
    await subir(csv([{ fecha: '05/10/2026', monto: 80 }, { fecha: '09/10/2026', monto: 80 }, { fecha: '07/10/2026', monto: 80 }]));
    const lista = (await api(T.adminA, 'GET', `${base_()}/sin-abono`)).body;
    assert.deepEqual(lista.items.map((p: { id: number }) => p.id), [sinAbono.id]);
    assert.equal(lista.monto, '150.00');
    const r = await resumen();
    assert.deepEqual([r.vouchers_sin_abono.cantidad, r.vouchers_sin_abono.monto], [1, '150.00']);
  });

  it('no cuentan: por validar, rechazados, efectivo, fuera del rango, sin extracto, ni los que están por revisar', async () => {
    assert.equal((await api(T.adminA, 'GET', `${base_()}/sin-abono`)).body.cantidad, 0, 'sin extracto no hay rango');
    await crearPago(d, { monto: 11, fecha: '2026-10-06', estado: 'por_validar' });
    await crearPago(d, { monto: 12, fecha: '2026-10-06', estado: 'rechazado' });
    await crearPago(d, { monto: 13, fecha: '2026-10-06', estado: 'validado', metodo: 'efectivo' });
    await crearPago(d, { monto: 14, fecha: '2026-10-20', estado: 'validado' });
    await crearPago(d, { monto: 15, fecha: '2026-09-01', estado: 'validado' });
    // Un abono con dos pagos posibles: están por vincular, no por llegar.
    await crearPago(d, { monto: 16, fecha: '2026-10-06', estado: 'validado' });
    await crearPago(d, { monto: 16, fecha: '2026-10-07', estado: 'validado' });
    await subir(csv([{ fecha: '05/10/2026', monto: 1 }, { fecha: '09/10/2026', monto: 16 }]));
    const lista = (await api(T.adminA, 'GET', `${base_()}/sin-abono`)).body;
    assert.equal(lista.cantidad, 0, JSON.stringify(lista));
  });

  it('un pago del grupo cuenta por su total', async () => {
    await crearPagoDeGrupo(d, [100, 60], { fecha: '2026-10-06', estado: 'validado' });
    await subir(csv([{ fecha: '05/10/2026', monto: 1 }, { fecha: '09/10/2026', monto: 2 }]));
    const lista = (await api(T.adminA, 'GET', `${base_()}/sin-abono`)).body;
    assert.deepEqual([lista.cantidad, lista.monto, lista.items[0].total], [1, '160.00', '160.00']);
  });
});

describe('vincular, desvincular e ignorar', () => {
  it('vincular a mano un abono sin pago con un pago buscado; no se puede vincular dos veces', async () => {
    const p = await crearPago(d, { monto: 140, fecha: '2026-10-05' }); // no coincide en monto: a mano
    await subir(csv([{ fecha: '05/10/2026', monto: 150 }, { fecha: '06/10/2026', monto: 150 }]));
    const [m1, m2] = (await movimientos('sin_pago')).sort((a, b) => a.fecha.localeCompare(b.fecha));
    const buscados = (await api(T.adminA, 'GET', `${base_()}/movimientos/${m1!.id}/pagos`)).body.items;
    assert.deepEqual(buscados.map((x: { id: number }) => x.id), [p.id]);
    assert.equal((await api(T.adminA, 'GET', `${base_()}/movimientos/${m1!.id}/pagos?q=${buscados[0].unidad.codigo}`)).body.items.length, 1);
    const ok = await api(T.adminA, 'POST', `${base_()}/movimientos/${m1!.id}/vincular`, { pago_id: p.id });
    assert.equal(ok.status, 200, ok.texto);
    const vinculado = (await movimientos('conciliado'))[0]!;
    assert.deepEqual([vinculado.id, vinculado.vinculo, vinculado.pago!.id], [m1!.id, 'manual', p.id]);
    assert.equal((await api(T.adminA, 'POST', `${base_()}/movimientos/${m2!.id}/vincular`, { pago_id: p.id })).status, 409, 'ese pago ya tiene abono');
    assert.equal((await api(T.adminA, 'POST', `${base_()}/movimientos/${m1!.id}/vincular`, { pago_id: p.id })).status, 409, 'el abono ya está conciliado');
    assert.equal((await api(T.adminA, 'GET', `${base_()}/movimientos/${m2!.id}/pagos`)).body.items.length, 0, 'un pago vinculado ya no se ofrece');
  });

  it('vincular con un concepto de un grupo vincula al principal; con un rechazado o de otro condominio no', async () => {
    const principal = await crearPagoDeGrupo(d, [100, 50]);
    const concepto = await prisma.pago.findFirstOrThrow({ where: { grupo: principal.grupo, grupo_principal: false } });
    const rechazado = await crearPago(d, { monto: 1, estado: 'rechazado' });
    const ajeno = await crearPago(d, { monto: 1, complejoId: d.complejoB.id, empresaId: d.empresaB.id, propietarioId: d.propietarioB.id });
    await subir(csv([{ fecha: '05/10/2026', monto: 7 }, { fecha: '06/10/2026', monto: 8 }, { fecha: '07/10/2026', monto: 9 }]));
    const [a, b, c] = (await movimientos()).sort((x, y) => x.fecha.localeCompare(y.fecha));
    assert.equal((await api(T.adminA, 'POST', `${base_()}/movimientos/${a!.id}/vincular`, { pago_id: concepto.id })).body.pago_id, principal.id);
    assert.equal((await api(T.adminA, 'POST', `${base_()}/movimientos/${b!.id}/vincular`, { pago_id: rechazado.id })).status, 422);
    assert.equal((await api(T.adminA, 'POST', `${base_()}/movimientos/${c!.id}/vincular`, { pago_id: ajeno.id })).status, 404);
    assert.equal((await api(T.adminA, 'POST', `${base_()}/movimientos/${c!.id}/vincular`, { pago_id: 999_999 })).status, 404);
  });

  it('desvincular suelta el pago, deja el abono sin pago y el cruce automático ya no lo toca; el pago queda libre para otro', async () => {
    const p = await crearPago(d, { monto: 150, fecha: '2026-10-05' });
    await subir(csv([{ fecha: '05/10/2026', monto: 150 }]));
    const [m] = await movimientos();
    assert.equal(m!.estado, 'conciliado');
    const r = await api(T.adminA, 'POST', `${base_()}/movimientos/${m!.id}/desvincular`);
    assert.equal(r.status, 200, r.texto);
    await api(T.adminA, 'POST', `${base_()}/cruzar`);
    const [despues] = await movimientos();
    assert.deepEqual([despues!.estado, despues!.pago], ['sin_pago', null], 'no se vuelve a vincular solo');
    // El pago liberado se puede vincular a mano.
    assert.equal((await api(T.adminA, 'POST', `${base_()}/movimientos/${m!.id}/vincular`, { pago_id: p.id })).status, 200);
    assert.equal((await api(T.adminA, 'POST', `${base_()}/movimientos/${m!.id}/desvincular`)).status, 200);
    assert.equal((await api(T.adminA, 'POST', `${base_()}/movimientos/${m!.id}/desvincular`)).status, 409, 'ya no hay nada que soltar');
  });

  it('ignorar exige un motivo, se desvincula igual, y un abono conciliado no se ignora sin soltarlo', async () => {
    await crearPago(d, { monto: 150, fecha: '2026-10-05' });
    await subir(csv([{ fecha: '05/10/2026', monto: 150 }, { fecha: '09/10/2026', monto: 3, desc: 'INTERESES' }]));
    const interes = (await movimientos('sin_pago'))[0]!;
    assert.equal((await api(T.adminA, 'POST', `${base_()}/movimientos/${interes.id}/ignorar`, {})).status, 422);
    assert.equal((await api(T.adminA, 'POST', `${base_()}/movimientos/${interes.id}/ignorar`, { motivo: '   ' })).status, 422);
    const ok = await api(T.adminA, 'POST', `${base_()}/movimientos/${interes.id}/ignorar`, { motivo: 'Intereses del banco' });
    assert.equal(ok.status, 200, ok.texto);
    const [ign] = await movimientos('ignorado');
    assert.equal(ign!.id, interes.id);
    assert.equal((await api(T.adminA, 'GET', `${base_()}/movimientos?estado=ignorado`)).body.items[0].motivo_ignorar, 'Intereses del banco');
    assert.equal((await resumen()).ignorados.cantidad, 1);
    await api(T.adminA, 'POST', `${base_()}/cruzar`);
    assert.equal((await movimientos('ignorado')).length, 1, 'el cruce no toca lo ignorado');
    const conciliado = (await movimientos('conciliado'))[0]!;
    assert.equal((await api(T.adminA, 'POST', `${base_()}/movimientos/${conciliado.id}/ignorar`, { motivo: 'x' })).status, 409);
    assert.equal((await api(T.adminA, 'POST', `${base_()}/movimientos/${interes.id}/desvincular`)).status, 200, 'quitar el «ignorar»');
    assert.equal((await movimientos('sin_pago')).length, 1);
  });
});

describe('permisos, plan y solo lectura', () => {
  it('sólo admin (de su empresa) y superadmin; la junta y los residentes no', async () => {
    assert.equal((await api(T.adminA, 'GET', '/api/conciliacion/cuentas')).status, 200);
    assert.equal((await api(T.super, 'GET', '/api/conciliacion/cuentas')).status, 200);
    assert.equal((await api(T.prop1, 'GET', '/api/conciliacion/cuentas')).status, 403);
    assert.equal((await api(T.prop1, 'GET', `${base_()}/resumen`)).status, 403);
    assert.equal((await api(T.prop1, 'POST', `${base_()}/cruzar`)).status, 403);
    assert.equal((await api(null, 'GET', '/api/conciliacion/cuentas')).status, 401);
    assert.equal((await subir(csv([{ fecha: '05/10/2026', monto: 1 }]), 'x.csv', undefined, T.prop1)).status, 403);
    assert.equal((await api(T.super, 'GET', `${base_()}/resumen`)).status, 200);
  });

  it('otra empresa → 404 en todo (cuentas, resumen, abonos, extractos, subir, vincular…)', async () => {
    await subir(csv([{ fecha: '05/10/2026', monto: 150 }]));
    const [m] = await movimientos();
    const p = await crearPago(d, { monto: 150 });
    const ajenas = [
      ['GET', `${base_()}/resumen`], ['GET', `${base_()}/movimientos`], ['GET', `${base_()}/sin-abono`], ['GET', `${base_()}/extractos`],
      ['POST', `${base_()}/cruzar`], ['PUT', `${base_()}/configuracion`, { ventana_dias: 1 }],
      ['GET', `${base_()}/movimientos/${m!.id}/pagos`],
      ['POST', `${base_()}/movimientos/${m!.id}/vincular`, { pago_id: p.id }], ['POST', `${base_()}/movimientos/${m!.id}/desvincular`], ['POST', `${base_()}/movimientos/${m!.id}/ignorar`, { motivo: 'x' }],
    ] as const;
    for (const [metodo, ruta, cuerpo] of ajenas) assert.equal((await api(T.adminB, metodo, ruta, cuerpo)).status, 404, `${metodo} ${ruta}`);
    assert.equal((await subir(csv([{ fecha: '05/10/2026', monto: 1 }]), 'x.csv', undefined, T.adminB)).status, 404);
    // Y un movimiento de otra cuenta tampoco se alcanza por la cuenta propia.
    assert.equal((await api(T.adminB, 'GET', `${base_(cuentaB.id)}/movimientos/${m!.id}/pagos`)).status, 404);
    assert.equal((await api(T.adminB, 'POST', `${base_(cuentaB.id)}/movimientos/${m!.id}/desvincular`)).status, 404);
    const mias = (await api(T.adminB, 'GET', '/api/conciliacion/cuentas')).body.items;
    assert.deepEqual(mias.map((c: { id: number }) => c.id), [cuentaB.id]);
    assert.equal(await prisma.movimientoBancario.count({ where: { estado: 'sin_pago' } }), 1, 'no se tocó nada');
  });

  it('un medio de pago que no es una cuenta bancaria no se concilia', async () => {
    const yape = await prisma.medioPago.create({ data: { complejo_id: d.complejoA.id, tipo: 'yape', celular: '+51 987 654 321', titular: 'Junta' } });
    assert.equal((await api(T.adminA, 'GET', `${base_(yape.id)}/resumen`)).status, 404);
  });

  it('sin la capacidad (Gratis o Básico): 403 MODULO_NO_ACTIVO con modulo conciliacion, en lectura y en escritura', async () => {
    await subir(csv([{ fecha: '05/10/2026', monto: 150 }]));
    const [m] = await movimientos();
    await fijarPlan('gratis');
    for (const [metodo, ruta, cuerpo] of [['GET', `${base_()}/resumen`], ['GET', `${base_()}/movimientos`], ['GET', `${base_()}/sin-abono`], ['POST', `${base_()}/cruzar`], ['POST', `${base_()}/movimientos/${m!.id}/ignorar`, { motivo: 'x' }]] as const) {
      const r = await api(T.adminA, metodo, ruta, cuerpo);
      assert.equal(r.status, 403, `${metodo} ${ruta}`);
      assert.equal(r.body.code, 'MODULO_NO_ACTIVO');
      assert.equal(r.body.modulo, 'conciliacion');
    }
    const subida = await subir(csv([{ fecha: '06/10/2026', monto: 5 }]));
    assert.equal(subida.status, 403);
    assert.equal(subida.body.modulo, 'conciliacion');
    const cuentas = await api(T.adminA, 'GET', '/api/conciliacion/cuentas');
    assert.equal(cuentas.status, 403);
    assert.equal(cuentas.body.modulo, 'conciliacion');
    assert.equal(await prisma.movimientoBancario.count(), 1, 'no se escribió nada');
    // Pro la trae; el plan Básico (sin módulos) tampoco.
    await fijarPlan('pro');
    assert.equal((await api(T.adminA, 'GET', `${base_()}/resumen`)).status, 200);
    await prisma.suscripcionCondominio.update({ where: { complejo_id: d.complejoA.id }, data: { plan_clave: 'basico' } });
    invalidarComercial();
    assert.equal((await api(T.adminA, 'GET', `${base_()}/resumen`)).status, 403);
  });

  it('el módulo suelto basta (gratis con «conciliacion»), y la cortesía la trae siempre', async () => {
    await fijarPlan('gratis', { modulos: ['conciliacion'] });
    assert.equal((await api(T.adminA, 'GET', `${base_()}/resumen`)).status, 200);
    await fijarPlan('cortesia');
    assert.equal((await api(T.adminA, 'GET', `${base_()}/resumen`)).status, 200);
  });

  it('solo lectura (Gratis vencido): lo que cambia algo da 409 SOLO_LECTURA y se puede leer', async () => {
    await subir(csv([{ fecha: '05/10/2026', monto: 150 }]));
    const [m] = await movimientos();
    const p = await crearPago(d, { monto: 1 });
    await fijarPlan('gratis', { modulos: ['conciliacion'], gratisHasta: new Date(hoyLima().getTime() - DIA) });
    for (const [metodo, ruta, cuerpo] of [
      ['POST', `${base_()}/cruzar`], ['PUT', `${base_()}/configuracion`, { ventana_dias: 2 }],
      ['POST', `${base_()}/movimientos/${m!.id}/vincular`, { pago_id: p.id }], ['POST', `${base_()}/movimientos/${m!.id}/ignorar`, { motivo: 'x' }], ['POST', `${base_()}/movimientos/${m!.id}/desvincular`],
    ] as const) {
      const r = await api(T.adminA, metodo, ruta, cuerpo);
      assert.equal(r.status, 409, `${metodo} ${ruta}`);
      assert.equal(r.body.code, 'SOLO_LECTURA');
    }
    const subida = await subir(csv([{ fecha: '06/10/2026', monto: 5 }]));
    assert.equal(subida.status, 409);
    assert.equal(subida.body.code, 'SOLO_LECTURA');
    assert.equal(await prisma.movimientoBancario.count(), 1);
    assert.equal((await api(T.adminA, 'GET', `${base_()}/resumen`)).status, 200);
    assert.equal((await api(T.adminA, 'GET', `${base_()}/movimientos`)).status, 200);
  });

  it('listado de cuentas: datos de la cuenta sin el número completo', async () => {
    const lista = (await api(T.adminA, 'GET', `/api/conciliacion/cuentas?complejo_id=${d.complejoA.id}`)).body.items;
    assert.equal(lista.length, 1);
    assert.deepEqual([lista[0].id, lista[0].entidad, lista[0].ultimos4, lista[0].ventana_dias, lista[0].tiene_mapeo], [cuenta.id, 'BCP', '0000', 3, false]);
    assert.ok(!JSON.stringify(lista).includes('000-0000000-0-00'));
    // Pedir un condominio ajeno da una lista vacía, no revela nada.
    assert.deepEqual((await api(T.adminA, 'GET', `/api/conciliacion/cuentas?complejo_id=${d.complejoB.id}`)).body.items, []);
  });
});

describe('marca «Conciliado con el banco» en los pagos', () => {
  it('devuelve sólo los pagos conciliados, con la fecha del abono, y nada de otra empresa', async () => {
    const conciliado = await crearPago(d, { monto: 150, fecha: '2026-10-06' });
    const libre = await crearPago(d, { monto: 77, fecha: '2026-10-06' });
    await subir(csv([{ fecha: '05/10/2026', monto: 150 }]));
    const r = await api(T.adminA, 'GET', `/api/conciliacion/pagos?ids=${conciliado.id},${libre.id}`);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body.marcas), [String(conciliado.id)]);
    assert.equal(r.body.marcas[conciliado.id].fecha, '2026-10-05');
    assert.deepEqual((await api(T.adminB, 'GET', `/api/conciliacion/pagos?ids=${conciliado.id}`)).body.marcas, {}, 'otra empresa no ve nada');
    assert.equal((await api(T.adminA, 'GET', '/api/conciliacion/pagos?ids=abc')).status, 422);
    assert.equal((await api(T.prop1, 'GET', `/api/conciliacion/pagos?ids=${conciliado.id}`)).status, 403);
  });
  it('sin la capacidad no devuelve nada (no es un error)', async () => {
    const p = await crearPago(d, { monto: 150, fecha: '2026-10-06' });
    await subir(csv([{ fecha: '05/10/2026', monto: 150 }]));
    await fijarPlan('gratis');
    const r = await api(T.adminA, 'GET', `/api/conciliacion/pagos?ids=${p.id}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.marcas, {});
  });
  it('no cambia cómo se valida un pago: la conformidad del tesorero y el estado siguen igual', async () => {
    const p = await crearPago(d, { monto: 150, fecha: '2026-10-06' });
    await subir(csv([{ fecha: '05/10/2026', monto: 150 }]));
    const despues = await prisma.pago.findUniqueOrThrow({ where: { id: p.id } });
    assert.deepEqual([despues.estado_validacion, despues.conformidad_at, despues.conformidad_por_id, despues.validado_por_id], ['por_validar', null, null, null]);
  });
});

describe('auditoría', () => {
  it('todas las mutaciones quedan, sin las descripciones de los movimientos', async () => {
    const SECRETO = 'JUAN PEREZ DEMO 1234';
    await crearPago(d, { monto: 150, fecha: '2026-10-05' });
    await subir(csv([{ fecha: '05/10/2026', monto: 150, desc: SECRETO }, { fecha: '06/10/2026', monto: 42, desc: SECRETO }]));
    const sin = (await movimientos('sin_pago'))[0]!;
    await api(T.adminA, 'POST', `${base_()}/movimientos/${sin.id}/ignorar`, { motivo: 'Transferencia interna' });
    await api(T.adminA, 'POST', `${base_()}/movimientos/${sin.id}/desvincular`);
    await api(T.adminA, 'POST', `${base_()}/cruzar`);
    await api(T.adminA, 'PUT', `${base_()}/configuracion`, { ventana_dias: 2 });
    const filas = await esperar(async () => { const f = await prisma.auditoria.findMany({ where: { entidad: 'conciliacion' } }); return f.length >= 5 ? f : null; });
    assert.deepEqual(new Set(filas.map((f) => f.accion)), new Set(['importar', 'ignorar', 'desvincular', 'cruzar', 'configurar']));
    for (const f of filas) {
      assert.equal(f.usuario_id, d.adminA.id);
      assert.ok(!JSON.stringify(f.detalle).includes('JUAN'), `la auditoría no guarda descripciones: ${JSON.stringify(f.detalle)}`);
      assert.ok(!JSON.stringify(f.detalle).includes('Transferencia interna') || f.accion !== 'ignorar', 'ni siquiera el motivo hace falta');
    }
    const importar = filas.find((f) => f.accion === 'importar')!.detalle as Record<string, unknown>;
    assert.deepEqual([importar.abonos, importar.nuevos, importar.conciliados], [2, 2, 1]);
  });
});
