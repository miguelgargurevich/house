// Rendición de cuentas del mes (`GET /api/reportes/rendicion`): ingresos (pagos validados con fecha de voucher en el mes), egresos de los cierres, cuadre encadenado de mes a mes,
// fondos, morosidad y el desglose por block. Las cifras están calculadas a mano (ver el comentario de cada bloque). Permisos: administración y junta; módulo `reportes`;
// otra empresa o el block de otra junta → 404.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import XLSX from 'xlsx';
import { cabecerasDeSesion, darCortesia, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { invalidarComercial } from '../src/server/services/comercial/modulos';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let C: { id: number };      // «Los Pinos»: el condominio de las cifras (empresa A, con reportes)
let D: { id: number };      // otro condominio de la empresa A sin suscripción (Gratis: sin reportes)
let B1: { id: number };
let B2: { id: number };
let T: Record<'adminA' | 'adminB' | 'superadmin' | 'prop1' | 'presiB1' | 'tesorCentral' | 'presiB2' | 'mtto', string>;
let extractoId: number;
let cuentaId: number;

const get = (t: string | null, ruta: string) => llamar(base, 'GET', ruta, t);
const ren = (t: string | null, q: string) => get(t, `/api/reportes/rendicion?${q}`);
const OCT = 'mes=10&anio=2026';

// ---------- Datos ----------
const cargosPor: Record<string, number> = {};
async function recibo(estructuraId: number | null, mes: number, partidas: { concepto: { id: number }; recargo?: boolean; cargos: [string, number, string][] }[], empresaId = d.empresaA.id) {
  const r = await prisma.recibo.create({ data: { empresa_id: empresaId, complejo_id: C.id, estructura_id: estructuraId, mes, anio: 2026, fecha_emision: new Date(Date.UTC(2026, mes - 1, 1)), fecha_vencimiento: new Date(Date.UTC(2026, mes - 1, 20)), estado: 'emitido' } });
  let orden = 0;
  for (const p of partidas) {
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: r.id, concepto_id: p.concepto.id, monto: p.cargos.reduce((s, c) => s + c[1], 0), es_recargo: p.recargo ?? false, orden: ++orden } });
    for (const [codigo, monto, estado_pago] of p.cargos) {
      const c = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: U[codigo]!.id, monto, estado_pago } });
      cargosPor[`${mes}|${codigo}|${p.concepto === K.admin ? 'admin' : p.concepto === K.central ? 'central' : p.concepto === K.ahorro ? 'ahorro' : p.concepto === K.luz ? 'luz' : 'otro'}`] = c.id;
    }
  }
  return r;
}
const U: Record<string, { id: number }> = {};
const K: Record<'admin' | 'central' | 'ahorro' | 'luz' | 'otro', { id: number }> = {} as never;

/** Un pago como lo deja la validación: la fecha es el instante exacto (el de Lima es UTC−5). */
async function pago(cargo: string, monto: number, fecha: string, estado: 'validado' | 'por_validar' | 'rechazado' = 'validado', extra: Record<string, unknown> = {}) {
  return prisma.pago.create({ data: { recibo_concepto_unidad_id: cargosPor[cargo]!, monto, fecha_pago: new Date(fecha), metodo_pago: 'transferencia', estado_validacion: estado, ...extra } });
}
async function egreso(est: { id: number }, mes: number, linea: string, destino: string, facturado: number, pagado: number, fecha: string, conforme: boolean, conceptoId?: number) {
  return prisma.egresoBlock.create({ data: { complejo_id: C.id, estructura_id: est.id, mes, anio: 2026, linea, destino, concepto_id: conceptoId ?? null, facturado, monto_pagado: pagado, fecha_pago: new Date(`${fecha}T00:00:00Z`), ...(conforme ? { conformidad_at: new Date('2026-11-06T15:00:00Z') } : {}) } });
}
const movimiento = (tipo: 'ingreso' | 'egreso', categoria: string, mes: number, monto: number, extra: Record<string, unknown> = {}) =>
  prisma.movimientoCentral.create({ data: { complejo_id: C.id, tipo, categoria, mes, anio: 2026, monto, fecha: new Date(`2026-${String(mes).padStart(2, '0')}-15T00:00:00Z`), ...extra } });

before(async () => {
  d = await sembrar();
  C = await prisma.complejoHabitacional.create({ data: { nombre: 'Los Pinos', tipo: 'Condominio', empresa_id: d.empresaA.id } });
  D = await prisma.complejoHabitacional.create({ data: { nombre: 'Sin reportes', tipo: 'Condominio', empresa_id: d.empresaA.id } });
  await darCortesia(C.id); // D queda sin suscripción: Gratis
  B1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: C.id } });
  B2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'Block', complejo_id: C.id } });
  const unidad = async (codigo: string, estructura_id: number | null) => (U[codigo] = await prisma.unidad.create({ data: { codigo, tipo: 'Departamento', complejo_id: C.id, empresa_id: d.empresaA.id, estructura_id, propietario_id: d.propietario2.id, estado: 'activa' } }));
  await unidad('U1', B1.id); await unidad('U2', B1.id); await unidad('U3', B2.id); await unidad('U4', null);
  const concepto = async (nombre: string, destino: string | null) => prisma.concepto.create({ data: { nombre, empresa_id: d.empresaA.id, destino } });
  K.admin = await concepto('admin', 'administradora');
  K.central = await concepto('luz_comunes', 'central');
  K.ahorro = await concepto('fondo_block', 'ahorro_block');
  K.luz = await concepto('luz_block', 'servicio');
  K.otro = await concepto('varios', null);

  // Septiembre (el mes anterior: de ahí sale el saldo inicial de octubre).
  await recibo(B1.id, 9, [{ concepto: K.admin, cargos: [['U1', 100, 'pagado'], ['U2', 100, 'pagado']] }, { concepto: K.central, cargos: [['U1', 30, 'pagado'], ['U2', 20, 'pagado']] }]);
  await recibo(B2.id, 9, [{ concepto: K.admin, cargos: [['U3', 50, 'pagado']] }]);
  // Octubre: Block 1 (emitido 335 = admin 200 + central 50 + fondo 5 + luz 80), Block 2 (65), y un recibo general sin block (40).
  await recibo(B1.id, 10, [
    { concepto: K.admin, cargos: [['U1', 100, 'pagado'], ['U2', 100, 'en_revision']] },
    { concepto: K.central, cargos: [['U1', 30, 'pagado'], ['U2', 20, 'pendiente']] },
    { concepto: K.ahorro, cargos: [['U1', 5, 'pagado']] },
    { concepto: K.luz, cargos: [['U1', 40, 'pendiente'], ['U2', 40, 'pendiente']] },
  ]);
  await recibo(B2.id, 10, [{ concepto: K.admin, cargos: [['U3', 50, 'pagado']] }, { concepto: K.central, cargos: [['U3', 15, 'pagado']] }]);
  await recibo(null, 10, [{ concepto: K.otro, cargos: [['U4', 40, 'pagado']] }]);
  await recibo(B1.id, 11, [{ concepto: K.admin, cargos: [['U1', 100, 'pagado']] }]); // se pagó por adelantado en octubre

  // Pagos. Lima es UTC−5: «2026-11-01T03:00Z» es el 31-oct 22:00 y «2026-10-01T03:00Z» es el 30-sep 22:00.
  await pago('9|U1|admin', 100, '2026-09-10T15:00:00Z');
  await pago('9|U2|admin', 100, '2026-09-12T15:00:00Z');
  await pago('9|U3|admin', 50, '2026-09-15T15:00:00Z');
  await pago('10|U4|otro', 40, '2026-10-01T03:00:00Z'); // 30-sep en Lima: antes de octubre, de un recibo de octubre (adelantado de septiembre)
  // Octubre: U1 paga su mantenimiento de octubre completo en UN pago (grupo: admin 100 + central 30 + fondo 5 = 135).
  const principal = await pago('10|U1|admin', 100, '2026-10-05T15:00:00Z', 'validado', { grupo: 'g-u1', grupo_principal: true });
  await pago('10|U1|central', 30, '2026-10-05T15:00:00Z', 'validado', { grupo: 'g-u1' });
  await pago('10|U1|ahorro', 5, '2026-10-05T15:00:00Z', 'validado', { grupo: 'g-u1' });
  await pago('9|U1|central', 30, '2026-10-08T15:00:00Z'); // de septiembre, pagado en octubre
  await pago('9|U2|central', 20, '2026-11-01T03:00:00Z'); // 31-oct 22:00 en Lima: octubre
  await pago('10|U2|admin', 100, '2026-10-10T15:00:00Z', 'por_validar'); // no suma
  await pago('10|U2|central', 20, '2026-10-10T15:00:00Z', 'rechazado'); // no cuenta
  await pago('10|U3|admin', 50, '2026-10-31T15:00:00Z', 'validado', { metodo_pago: 'efectivo' });
  await pago('10|U3|central', 15, '2026-10-31T15:00:00Z', 'validado', { metodo_pago: 'efectivo' });
  await pago('11|U1|admin', 100, '2026-10-25T15:00:00Z'); // adelantado: recibo de noviembre

  // Cierres. Septiembre (Block 1): administradora facturó 200, pagó 190; central facturó 50, pagó 50 (con conformidad). Block 2: administradora 50/50.
  await egreso(B1, 9, 'administradora', 'administradora', 200, 190, '2026-10-05', false);
  await egreso(B1, 9, 'central', 'central', 50, 50, '2026-10-05', true);
  await egreso(B2, 9, 'administradora', 'administradora', 50, 50, '2026-10-05', false);
  // Octubre (Block 1): administradora 200/200 pagada en noviembre y SIN conformidad; luz 80 facturada, boleta de 75; el aporte a la Junta central (50) sin pagar.
  await egreso(B1, 10, 'administradora', 'administradora', 200, 200, '2026-11-05', false);
  await egreso(B1, 10, `concepto:${K.luz.id}`, 'servicio', 80, 75, '2026-10-28', false, K.luz.id);
  // Octubre (Block 2): administradora 50/50 y aporte a la Junta central 15/15, ambos con conformidad.
  await egreso(B2, 10, 'administradora', 'administradora', 50, 50, '2026-11-05', true);
  await egreso(B2, 10, 'central', 'central', 15, 15, '2026-11-05', true);
  // Junta central: septiembre +80 −30; octubre +300 (alquiler) −120 (luz de las áreas comunes).
  await movimiento('ingreso', 'otro_ingreso', 9, 80, { descripcion: 'Intereses' });
  await movimiento('egreso', 'servicio', 9, 30, { descripcion: 'Agua comunes' });
  await movimiento('ingreso', 'alquiler_estacionamiento', 10, 300, { pagador: 'Vecino', estacionamiento: 'E-1' });
  await movimiento('egreso', 'servicio', 10, 120, { descripcion: 'Luz comunes' });

  // Banco: un extracto de octubre con saldo, y el abono del pago de U1 conciliado.
  const cuenta = await prisma.medioPago.create({ data: { complejo_id: C.id, tipo: 'banco', banco: 'BCP', numero_cuenta: '194-1234567-0-55', moneda: 'PEN', titular: 'Junta', activo: true } });
  cuentaId = cuenta.id;
  const extracto = await prisma.extractoBancario.create({ data: { complejo_id: C.id, medio_pago_id: cuenta.id, archivo_nombre: 'oct.csv', fecha_desde: new Date('2026-10-01T00:00:00Z'), fecha_hasta: new Date('2026-10-31T05:00:00Z'), saldo_inicial: 100, saldo_final: 300, saldo_cuadra: true } });
  extractoId = extracto.id;
  await prisma.movimientoBancario.create({ data: { extracto_id: extracto.id, complejo_id: C.id, medio_pago_id: cuenta.id, fecha: new Date('2026-10-05T00:00:00Z'), descripcion: 'TRANSF U1', monto: 135, huella: 'h-1', estado: 'conciliado', pago_id: principal.id, vinculo: 'manual' } });

  // Usuarios de la junta de Los Pinos.
  const hash = await bcrypt.hash(PASSWORD, 4);
  const junta = (nombre: string, email: string, cargo: string, estructura_id: number | null) =>
    prisma.usuario.create({ data: { nombre, email, rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: C.id, cargo_junta: cargo, estructura_id } });
  await junta('Presidente B1', 'presi.b1@test.pe', 'presidente', B1.id);
  await junta('Presidente B2', 'presi.b2@test.pe', 'presidente', B2.id);
  await junta('Tesorero central', 'tesor.central@test.pe', 'tesorero', null);
  invalidarComercial();

  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  const e = (email: string) => login(base, email);
  T = { adminA: await e('admin.a@test.pe'), adminB: await e('admin.b@test.pe'), superadmin: await e('super@test.pe'), prop1: await e('prop1@test.pe'), presiB1: await e('presi.b1@test.pe'), tesorCentral: await e('tesor.central@test.pe'), presiB2: await e('presi.b2@test.pe'), mtto: await e('mtto.a@test.pe') };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

const q = (extra = '') => `complejo_id=${C.id}&${OCT}${extra}`;

describe('condominio completo, octubre de 2026 (cifras a mano)', () => {
  let r: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  before(async () => {
    const x = await ren(T.adminA, q());
    assert.equal(x.status, 200, x.texto);
    r = x.body;
  });

  it('el periodo y el alcance', () => {
    assert.deepEqual(r.periodo, { mes: 10, anio: 2026, desde: '2026-10-01', hasta: '2026-10-31' });
    assert.equal(r.alcance, 'condominio');
    assert.equal(r.estructura, null);
    assert.equal(r.complejo.nombre, 'Los Pinos');
  });

  it('INGRESOS: emitido 440 y cobrado 350 con fecha de voucher en el mes (del mes 200, anteriores 50, adelantado 100)', () => {
    // Emitido: Block 1 335 (200 + 50 + 5 + 80), Block 2 65, general 40.
    assert.equal(r.ingresos.emitido, '440.00');
    // Cobrado: Block 1 = 135 (grupo de U1) + 30 (sept) + 20 (sept, 31-oct 22:00 Lima) + 100 (adelantado) = 285; Block 2 = 65. U4 pagó el 30-sep en Lima: no cuenta.
    assert.deepEqual(r.ingresos.cobrado, { total: '350.00', del_mes: '200.00', de_meses_anteriores: '50.00', adelantado: '100.00', pagos: 8 });
  });

  it('un pago por validar y uno rechazado NO suman: el por validar va aparte', () => {
    assert.deepEqual(r.ingresos.por_validar, { total: '100.00', pagos: 1 });
    assert.equal(r.ingresos.cobrado.total, '350.00', 'ni el por validar (100) ni el rechazado (20) están en el cobrado');
  });

  it('el pago del mes se mide con la fecha del voucher en la zona del condominio, no con la de emisión del recibo', () => {
    assert.equal(r.ingresos.cobrado.de_meses_anteriores, '50.00', 'pagos de recibos de septiembre hechos en octubre');
    assert.equal(r.ingresos.cobrado.adelantado, '100.00', 'recibo de noviembre pagado en octubre');
  });

  it('CONCILIACIÓN: el grupo de U1 (135) está conciliado, lo de Block 2 fue en efectivo (65) y el resto (150) sigue sin conciliar', () => {
    assert.deepEqual(r.ingresos.conciliacion, { activa: true, conciliado: '135.00', efectivo: '65.00', sin_conciliar: '150.00' });
  });

  it('OTROS INGRESOS de la Junta central (alquiler): 300', () => {
    assert.equal(r.ingresos.otros_central.total, '300.00');
    assert.equal(r.ingresos.otros_central.movimientos.length, 1);
    assert.equal(r.ingresos.total, '650.00', 'cobrado 350 + alquiler 300');
  });

  it('EGRESOS de los cierres: facturado 395, pagado 340 (275 de Block 1 + 65 de Block 2), la parte de la Junta central 15', () => {
    assert.equal(r.egresos.facturado, '395.00'); // B1: 200 + 50 + 80; B2: 50 + 15
    assert.equal(r.egresos.pagado, '340.00');
    assert.equal(r.egresos.traspaso_central, '15.00', 'el único aporte pagado de octubre es el del Block 2');
    assert.deepEqual(r.egresos.por_pagar, { lineas: 1, facturado: '50.00' }, 'el aporte del Block 1 sigue sin pagar');
  });

  it('el pago a la administradora de Block 1 está SIN conformidad y se marca', () => {
    assert.deepEqual(r.egresos.sin_conformidad, { lineas: 1, monto: '200.00' });
    const l = r.egresos.lineas.find((x: any) => x.estructura.id === B1.id && x.destino === 'administradora'); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(l.conformidad, 'sin_conformidad');
    assert.equal(l.pagado, '200.00');
    assert.equal(l.fecha_pago, '2026-11-05', 'se pagó en noviembre pero es del cierre de octubre');
    const luz = r.egresos.lineas.find((x: any) => x.destino === 'servicio'); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual([luz.facturado, luz.pagado, luz.conformidad], ['80.00', '75.00', 'no_aplica'], 'pagado (la boleta) vs facturado');
    const sinPagar = r.egresos.lineas.find((x: any) => x.estructura.id === B1.id && x.destino === 'central'); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual([sinPagar.estado, sinPagar.pagado, sinPagar.conformidad], ['por_pagar', null, 'por_pagar']);
  });

  it('por destino: administradora 250/250, Junta central 65/15, servicio 80/75', () => {
    const por = Object.fromEntries(r.egresos.por_destino.map((x: any) => [x.destino, [x.facturado, x.pagado]])); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual(por, { administradora: ['250.00', '250.00'], central: ['65.00', '15.00'], servicio: ['80.00', '75.00'] });
  });

  it('EGRESOS de la Junta central 120; el aporte (15) es un traspaso interno que no se resta: total = 340 − 15 + 120 = 445', () => {
    assert.equal(r.egresos.central.total, '120.00');
    assert.equal(r.egresos.total, '445.00');
  });

  it('CUADRE: saldo inicial 100 + ingresos 650 − egresos 445 = saldo final 305', () => {
    // Saldo inicial: Block 1 (200 − 240 + 50) = 10, Block 2 (50 − 50) = 0, sin block (40 pagados el 30-sep) = 40, Junta central (80 − 30) = 50 → 100.
    assert.equal(r.cuadre.saldo_inicial, '100.00');
    assert.equal(r.cuadre.ingresos, '650.00');
    assert.equal(r.cuadre.egresos, '445.00');
    assert.equal(r.cuadre.saldo_final, '305.00');
    assert.equal(r.cuadre.saldo_inicial_cargado, false);
    assert.deepEqual(r.cuadre.primer_mes, { mes: 9, anio: 2026 });
    assert.match(r.cuadre.nota, /Sin saldo inicial cargado/);
  });

  it('EXTRACTO del banco: saldo 300 vs 305 de la rendición → diferencia 5.00, no cuadra', () => {
    const x = r.cuadre.extracto;
    assert.equal(x.saldo_banco, '300.00');
    assert.equal(x.saldo_rendicion, '305.00');
    assert.equal(x.diferencia, '5.00');
    assert.equal(x.cuadra, false);
    assert.equal(x.cuentas.length, 1);
    assert.equal(x.cuentas[0].cuenta, 'BCP ···7055', 'sólo los últimos 4 dígitos');
    assert.doesNotMatch(JSON.stringify(x), /194-1234567/);
  });

  it('FONDOS: Block 1 10 (el sobrante de septiembre), Block 2 0; Junta central 295 (aportes 65 + otros 380 − egresos 150)', () => {
    const por = Object.fromEntries(r.fondos.blocks.map((b: any) => [b.estructura.nombre, b.fondo_ahorros])); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual(por, { 'Block 1': '10.00', 'Block 2': '0.00' });
    assert.equal(r.fondos.fondo_ahorros_blocks, '10.00');
    assert.equal(r.fondos.central.fondo_ahorros, '295.00');
  });

  it('MOROSIDAD: U1 (40) y U2 (60) deben su octubre; % cobrado = 240 de 440 = 54.5', () => {
    const m = r.morosidad;
    assert.equal(m.unidades_morosas, 2);
    assert.equal(m.deuda_total, '100.00');
    assert.equal(m.deuda_del_mes, '100.00');
    assert.equal(m.pagado_del_recibo, '240.00');
    assert.equal(m.pct_cobrado, 54.5);
    assert.deepEqual(m.unidades.map((x: any) => [x.unidad.codigo, x.deuda, x.meses]), [['U2', '60.00', 1], ['U1', '40.00', 1]]); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('POR BLOCK: la suma de los blocks es el condominio (emitido, cobrado, por validar, egresos y morosos)', () => {
    const filas = r.blocks as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual(filas.map((f) => f.estructura.nombre), ['Block 1', 'Block 2', 'Sin block']);
    const suma = (campo: string) => filas.reduce((s, f) => s + Number(f[campo]), 0).toFixed(2);
    assert.equal(suma('emitido'), r.ingresos.emitido);
    assert.equal(suma('cobrado'), r.ingresos.cobrado.total);
    assert.equal(suma('por_validar'), r.ingresos.por_validar.total);
    assert.equal(suma('egresos_pagado'), r.egresos.pagado);
    assert.equal(suma('traspaso_central'), r.egresos.traspaso_central);
    assert.equal(suma('deuda_morosa'), r.morosidad.deuda_total);
    assert.equal(filas.reduce((s, f) => s + f.unidades_morosas, 0), r.morosidad.unidades_morosas);
    const b1 = filas[0];
    assert.deepEqual([b1.emitido, b1.cobrado, b1.egresos_pagado, b1.saldo_inicial, b1.saldo_final, b1.fondo_ahorros], ['335.00', '285.00', '275.00', '-40.00', '-30.00', '10.00']);
    const b2 = filas[1];
    assert.deepEqual([b2.emitido, b2.cobrado, b2.egresos_pagado, b2.saldo_inicial, b2.saldo_final], ['65.00', '65.00', '65.00', '0.00', '0.00']);
    const sin = filas[2];
    assert.deepEqual([sin.emitido, sin.cobrado, sin.saldo_inicial, sin.saldo_final], ['40.00', '0.00', '40.00', '40.00']);
  });

  it('el saldo final del condominio es la suma de los blocks más lo acumulado de la Junta central (10 + 295 = 305)', () => {
    const blocks = (r.blocks as any[]).reduce((s, f) => s + Number(f.saldo_final), 0); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal((blocks + Number(r.fondos.central.fondo_ahorros)).toFixed(2), r.cuadre.saldo_final);
  });
});

describe('un block', () => {
  it('Block 1: inicial −40 + cobrado 285 − egresos 275 = −30; sin Junta central ni «por block»; el banco (cuenta de la Junta) no se compara', async () => {
    const r = (await ren(T.adminA, q(`&estructura_id=${B1.id}`))).body;
    assert.equal(r.alcance, 'block');
    assert.deepEqual(r.estructura, { id: B1.id, nombre: 'Block 1' });
    assert.deepEqual([r.ingresos.emitido, r.ingresos.cobrado.total, r.ingresos.por_validar.total], ['335.00', '285.00', '100.00']);
    assert.equal(r.ingresos.otros_central, null);
    assert.equal(r.egresos.central, null);
    assert.equal(r.egresos.pagado, '275.00');
    assert.equal(r.egresos.total, '275.00', 'en un block el aporte a la Junta central sí es un egreso');
    assert.deepEqual([r.cuadre.saldo_inicial, r.cuadre.ingresos, r.cuadre.egresos, r.cuadre.saldo_final], ['-40.00', '285.00', '275.00', '-30.00']);
    assert.equal(r.cuadre.extracto, null);
    assert.equal(r.blocks, null);
    assert.equal(r.fondos.central, null);
    assert.deepEqual(r.fondos.blocks.map((b: any) => b.estructura.nombre), ['Block 1']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(r.morosidad.unidades_morosas, 2);
    assert.equal(r.morosidad.pct_cobrado, 40.3, '135 pagados de 335 emitidos');
  });

  it('Block 2: el aporte a la Junta central (15) cuenta como egreso del block', async () => {
    const r = (await ren(T.adminA, q(`&estructura_id=${B2.id}`))).body;
    assert.deepEqual([r.ingresos.cobrado.total, r.egresos.pagado, r.egresos.total, r.egresos.traspaso_central], ['65.00', '65.00', '65.00', '15.00']);
    assert.deepEqual([r.cuadre.saldo_inicial, r.cuadre.saldo_final], ['0.00', '0.00']);
    assert.equal(r.morosidad.unidades_morosas, 0);
    assert.equal(r.morosidad.pct_cobrado, 100);
  });

  it('un block de otro condominio (de otra empresa o de la misma) → 404', async () => {
    const otro = await prisma.estructura.create({ data: { nombre: 'Ajeno', tipo: 'Block', complejo_id: d.complejoB.id } });
    assert.equal((await ren(T.adminA, q(`&estructura_id=${otro.id}`))).status, 404);
    const deA = await prisma.estructura.create({ data: { nombre: 'De Sin reportes', tipo: 'Block', complejo_id: D.id } });
    assert.equal((await ren(T.adminA, q(`&estructura_id=${deA.id}`))).status, 404, 'es de su empresa pero de otro condominio');
    assert.equal((await ren(T.adminA, q('&estructura_id=999999'))).status, 404);
  });
});

describe('saldo encadenado de un mes al siguiente', () => {
  it('el saldo inicial de noviembre es el saldo final de octubre (condominio y block); noviembre sin movimientos lo deja igual', async () => {
    const oct = (await ren(T.adminA, q())).body;
    const nov = (await ren(T.adminA, `complejo_id=${C.id}&mes=11&anio=2026`)).body;
    assert.equal(nov.cuadre.saldo_inicial, oct.cuadre.saldo_final);
    assert.equal(nov.cuadre.saldo_inicial, '305.00');
    assert.deepEqual([nov.cuadre.ingresos, nov.cuadre.egresos, nov.cuadre.saldo_final], ['0.00', '0.00', '305.00']);
    assert.equal(nov.ingresos.emitido, '100.00', 'el recibo de noviembre ya existe');
    const b1 = (await ren(T.adminA, `complejo_id=${C.id}&mes=11&anio=2026&estructura_id=${B1.id}`)).body;
    assert.equal(b1.cuadre.saldo_inicial, '-30.00');
  });

  it('septiembre es el primer mes: parte de 0 y el de octubre ya trae lo de septiembre', async () => {
    const sep = (await ren(T.adminA, `complejo_id=${C.id}&mes=9&anio=2026`)).body;
    // Septiembre: cobrado 290 (B1 200, B2 50 y los 40 de U4 pagados el 30-sep a las 22:00 en Lima) + otros ingresos de la Junta central 80 = 370;
    // egresos de los cierres 290 (B1 190 + 50, B2 50) − 50 de aporte (traspaso) + 30 de la Junta central = 270.
    assert.equal(sep.cuadre.saldo_inicial, '0.00');
    assert.deepEqual([sep.cuadre.ingresos, sep.cuadre.egresos], ['370.00', '270.00']);
    assert.equal(sep.cuadre.saldo_final, '100.00', 'lo mismo que el saldo inicial de octubre');
  });
});

describe('permisos', () => {
  it('el módulo `reportes` es obligatorio: un condominio sin él → 403 MODULO_NO_ACTIVO (y la pantalla muestra el aviso)', async () => {
    const r = await ren(T.adminA, `complejo_id=${D.id}&${OCT}`);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'MODULO_NO_ACTIVO');
    assert.equal(r.body.modulo, 'reportes');
    const x = await get(T.adminA, `/api/reportes/rendicion.xlsx?complejo_id=${D.id}&${OCT}`);
    assert.equal(x.status, 403, 'el Excel también');
  });

  it('otra empresa → 404 (el condominio no se revela)', async () => {
    assert.equal((await ren(T.adminB, q())).status, 404);
    assert.equal((await ren(T.adminB, `complejo_id=${d.complejoA.id}&${OCT}`)).status, 404);
    assert.equal((await ren(T.adminA, `complejo_id=${d.complejoB.id}&${OCT}`)).status, 404);
    assert.equal((await ren(T.adminA, 'complejo_id=999999&mes=10&anio=2026')).status, 404);
  });

  it('la administración debe decir el condominio; el mes y el año se validan', async () => {
    assert.equal((await ren(T.adminA, OCT)).status, 422);
    assert.equal((await ren(T.adminA, q('&mes=13'))).status, 422);
    assert.equal((await ren(T.adminA, `complejo_id=${C.id}&mes=10&anio=1990`)).status, 422);
  });

  it('sólo administración y junta: un propietario cualquiera, un inquilino y el personal → 403; sin sesión → 401', async () => {
    for (const t of [T.prop1, T.mtto]) assert.equal((await ren(t, q())).status, 403);
    assert.equal((await ren(null, q())).status, 401);
    assert.equal((await get(T.prop1, `/api/reportes/rendicion.xlsx?${q()}`)).status, 403);
  });

  it('el superadmin entra a cualquier condominio', async () => {
    const r = await ren(T.superadmin, q());
    assert.equal(r.status, 200);
    assert.equal(r.body.cuadre.saldo_final, '305.00');
  });

  it('la junta de Block 1 ve SU block, lo pida o no, sin el banco ni la conciliación; el block de otro → 404', async () => {
    const sin = (await ren(T.presiB1, OCT)).body;
    assert.equal(sin.alcance, 'block');
    assert.equal(sin.estructura.id, B1.id);
    assert.equal(sin.cuadre.saldo_final, '-30.00');
    assert.equal(sin.ingresos.conciliacion, null);
    assert.equal(sin.cuadre.extracto, null);
    assert.equal(sin.blocks, null);
    const pide = (await ren(T.presiB1, `${OCT}&estructura_id=${B1.id}&complejo_id=${C.id}`)).body;
    assert.equal(pide.cuadre.saldo_final, '-30.00');
    assert.equal((await ren(T.presiB1, `${OCT}&estructura_id=${B2.id}`)).status, 404, 'otro block del mismo condominio');
    assert.equal((await ren(T.presiB2, `${OCT}&estructura_id=${B1.id}`)).status, 404);
    assert.equal((await ren(T.presiB1, `${OCT}&complejo_id=${d.complejoA.id}`)).status, 404, 'otro condominio');
    assert.equal((await ren(T.presiB1, `${OCT}&complejo_id=${d.complejoB.id}`)).status, 404);
  });

  it('la Junta central ve el condominio completo (sin el banco) y puede abrir cualquier block de él', async () => {
    const todo = (await ren(T.tesorCentral, OCT)).body;
    assert.equal(todo.alcance, 'condominio');
    assert.equal(todo.cuadre.saldo_final, '305.00');
    assert.equal(todo.cuadre.extracto, null);
    assert.equal(todo.ingresos.conciliacion, null);
    assert.equal(todo.blocks.length, 3);
    const b2 = (await ren(T.tesorCentral, `${OCT}&estructura_id=${B2.id}`)).body;
    assert.equal(b2.alcance, 'block');
    assert.equal(b2.cuadre.saldo_final, '0.00');
  });

  it('el módulo también se exige a la junta', async () => {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const bD = await prisma.estructura.create({ data: { nombre: 'Block D', tipo: 'Block', complejo_id: D.id } });
    await prisma.usuario.create({ data: { nombre: 'Presi D', email: 'presi.d@test.pe', rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: D.id, cargo_junta: 'presidente', estructura_id: bD.id } });
    const t = await login(base, 'presi.d@test.pe');
    const r = await ren(t, OCT);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'MODULO_NO_ACTIVO');
  });

  it('lo cobrado por una administradora ANTERIOR no le llega a la nueva (igual que en pagos y recibos)', async () => {
    // Un recibo de octubre emitido por la empresa B en Los Pinos, ya pagado del todo: la empresa A (la actual) no lo ve; el superadmin sí.
    const antes = (await ren(T.adminA, q())).body.ingresos.cobrado.total;
    const r = await prisma.recibo.create({ data: { empresa_id: d.empresaB.id, complejo_id: C.id, estructura_id: B1.id, mes: 10, anio: 2026, fecha_emision: new Date('2026-10-01T00:00:00Z'), fecha_vencimiento: new Date('2026-10-20T00:00:00Z'), estado: 'emitido' } });
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: r.id, concepto_id: K.admin.id, monto: 77, orden: 1 } });
    const cargo = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: U.U1!.id, monto: 77, estado_pago: 'pagado' } });
    await prisma.pago.create({ data: { recibo_concepto_unidad_id: cargo.id, monto: 77, fecha_pago: new Date('2026-10-12T15:00:00Z'), estado_validacion: 'validado', metodo_pago: 'transferencia' } });
    try {
      assert.equal((await ren(T.adminA, q())).body.ingresos.cobrado.total, antes, 'la empresa actual no suma lo de la anterior');
      assert.equal((await ren(T.superadmin, q())).body.ingresos.cobrado.total, (Number(antes) + 77).toFixed(2), 'el superadmin lo ve todo');
    } finally {
      await prisma.pago.deleteMany({ where: { recibo_concepto_unidad_id: cargo.id } });
      await prisma.reciboConceptoUnidad.delete({ where: { id: cargo.id } });
      await prisma.reciboConcepto.delete({ where: { id: rc.id } });
      await prisma.recibo.delete({ where: { id: r.id } });
    }
  });
});

describe('Excel', () => {
  it('trae una hoja por sección, con los montos como números', async () => {
    const x = await fetch(`${base}/api/reportes/rendicion.xlsx?${q()}`, { headers: cabecerasDeSesion(T.adminA) });
    assert.equal(x.status, 200);
    assert.match(x.headers.get('content-type') ?? '', /spreadsheetml/);
    assert.match(x.headers.get('content-disposition') ?? '', /rendicion-los-pinos-octubre-2026\.xlsx/);
    const libro = XLSX.read(Buffer.from(await x.arrayBuffer()));
    assert.deepEqual(libro.SheetNames, ['Ingresos', 'Egresos', 'Cuadre', 'Fondos', 'Morosidad', 'Por block']);
    const filas = (n: string) => XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[n]!, { header: 1 });
    const cuadre = filas('Cuadre');
    const monto = (etiqueta: string) => cuadre.find((f) => f[0] === etiqueta)?.[1];
    assert.equal(monto('Saldo inicial'), 100);
    assert.equal(monto('Saldo final'), 305);
    const egresos = filas('Egresos');
    assert.ok(egresos.some((f) => f[1] === 'Pago a la empresa administradora' && f[8] === 'Sin conformidad'));
  });

  it('un block no trae la hoja «Por block»', async () => {
    const x = await fetch(`${base}/api/reportes/rendicion.xlsx?${q(`&estructura_id=${B1.id}`)}`, { headers: cabecerasDeSesion(T.adminA) });
    assert.equal(x.status, 200);
    assert.match(x.headers.get('content-disposition') ?? '', /rendicion-block-1-octubre-2026\.xlsx/);
    assert.ok(!XLSX.read(Buffer.from(await x.arrayBuffer())).SheetNames.includes('Por block'));
  });
});

describe('extracto: cuando el saldo coincide', () => {
  it('con el banco en 305.00 la diferencia es 0 y cuadra; sin extracto con saldo en el mes no hay comparación', async () => {
    await prisma.extractoBancario.update({ where: { id: extractoId }, data: { saldo_final: 305 } });
    const ok = (await ren(T.adminA, q())).body.cuadre.extracto;
    assert.deepEqual([ok.diferencia, ok.cuadra], ['0.00', true]);
    await prisma.extractoBancario.update({ where: { id: extractoId }, data: { saldo_final: null } });
    assert.equal((await ren(T.adminA, q())).body.cuadre.extracto, null, 'un extracto sin saldo no sirve para comparar');
    await prisma.extractoBancario.update({ where: { id: extractoId }, data: { saldo_final: 300 } });
    void cuentaId;
  });
});
