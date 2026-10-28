// Lecturas de agua por departamento (el «detalle del consumo de agua» del recibo impreso): cuentas y redondeos, validaciones, carga a mano y por
// Excel/CSV, precarga de la lectura anterior, cruce con el concepto de agua del recibo, alcance (residente, junta, otra empresa) y foto del contómetro.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import XLSX from 'xlsx';
import { alertaAgua, consumoM3, cuentaLectura, errorLectura, esConceptoAgua, INVALIDO, leerArchivoLecturas, leerDecimal, leerFecha, montoAgua } from '../src/server/lib/agua';
import { cabecerasDeSesion, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';

const D = (v: string) => new Prisma.Decimal(v);
const dia = (s: string) => new Date(`${s}T00:00:00Z`);

describe('cuentas del agua (puras)', () => {
  it('consumo = actual − anterior con 3 decimales; monto = m³ × factor, 2 decimales (el caso del recibo impreso de B01-804)', () => {
    assert.equal(consumoM3('1416.574', '1430.897').toFixed(3), '14.323');
    assert.equal(montoAgua('14.323', '4.9313').toFixed(2), '70.63');
    assert.deepEqual(cuentaLectura({ lectura_anterior: D('1416.574'), lectura_actual: D('1430.897'), factor: D('4.9313') }), { consumo_m3: '14.323', monto: '70.63' });
  });
  it('el monto redondea half-up (0.125 → 0.13) y no se pierde precisión de coma flotante', () => {
    assert.equal(montoAgua('1.000', '0.125').toFixed(2), '0.13');
    assert.equal(montoAgua('0.001', '4.93').toFixed(2), '0.00');
    assert.equal(montoAgua('3.000', '0.835').toFixed(2), '2.51'); // 2.505 en binario sería 2.50
    assert.equal(consumoM3('0.100', '0.300').toFixed(3), '0.200'); // 0.3 − 0.1 ≠ 0.2 con números de coma flotante
  });
  it('valida: actual ≥ anterior, factor > 0 y fechas en orden', () => {
    const ok = { fecha_anterior: dia('2026-09-10'), lectura_anterior: D('10'), fecha_actual: dia('2026-10-10'), lectura_actual: D('12'), factor: D('4.93') };
    assert.equal(errorLectura(ok), null);
    assert.equal(errorLectura({ ...ok, lectura_actual: D('10') }), null, 'consumo cero es válido');
    assert.match(errorLectura({ ...ok, lectura_actual: D('9.999') })!.lectura_actual, /no puede ser menor/);
    assert.match(errorLectura({ ...ok, factor: D('0') })!.factor, /mayor que cero/);
    assert.match(errorLectura({ ...ok, fecha_actual: dia('2026-09-09') })!.fecha_actual, /no puede ser anterior/);
    assert.equal(errorLectura({ ...ok, fecha_actual: dia('2026-09-10') }), null, 'el mismo día es válido');
  });
  it('lee números con coma decimal, miles y espacios; rechaza texto y negativos', () => {
    assert.equal((leerDecimal('1416,574', 3) as Prisma.Decimal).toFixed(3), '1416.574');
    assert.equal((leerDecimal('1,416.574', 3) as Prisma.Decimal).toFixed(3), '1416.574');
    assert.equal((leerDecimal(' 1 416.5746 ', 3) as Prisma.Decimal).toFixed(3), '1416.575', 'redondea a 3 decimales');
    assert.equal(leerDecimal('', 3), null);
    assert.equal(leerDecimal('abc', 3), INVALIDO);
    assert.equal(leerDecimal('-1', 3), INVALIDO);
  });
  it('lee fechas día/mes/año (no a la americana), ISO y de Excel', () => {
    assert.equal(leerFecha('10/09/2026')?.toISOString().slice(0, 10), '2026-09-10');
    assert.equal(leerFecha('2026-09-10')?.toISOString().slice(0, 10), '2026-09-10');
    assert.equal(leerFecha('10 DE NOVIEMBRE DE 2026')?.toISOString().slice(0, 10), '2026-11-10');
    assert.equal(leerFecha(46275)?.toISOString().slice(0, 10), '2026-09-10', 'número de serie de Excel');
    assert.equal(leerFecha('31/02/2026'), null);
    assert.equal(leerFecha('nunca'), null);
  });
  it('el concepto de agua del departamento se reconoce; el agua común no', () => {
    for (const n of ['AGUA DPTO.', 'Agua dpto', 'AGUA DEPTO', 'Agua Departamento', 'AGUA  DPTO']) assert.equal(esConceptoAgua(n), true, n);
    for (const n of ['AGUA COMUN DEL CONDOMINIO', 'Agua', 'LUZ COMUN DEL BLOCK', null, undefined]) assert.equal(esConceptoAgua(n), false, String(n));
  });
  it('la alerta salta sólo con más de S/ 0.05 de diferencia, y dice los dos montos', () => {
    assert.equal(alertaAgua('70.63', '70.58'), null, 'justo 0.05: cuadra');
    assert.equal(alertaAgua('70.58', '70.63'), null);
    assert.equal(alertaAgua('70.63', null), null, 'sin concepto de agua no hay con qué cruzar');
    assert.equal(alertaAgua('70.64', '70.58'), 'El agua del recibo es S/ 70.58; con la lectura sale S/ 70.64');
  });
  it('un archivo que no es una hoja de lecturas se rechaza con un 422 que dice qué falta', () => {
    assert.throws(() => leerArchivoLecturas(Buffer.from('hola,mundo\n1,2\n')), /No se encontró el encabezado/);
  });
});

// ---------- API ----------
let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'adminA' | 'adminB' | 'presi1' | 'presi2' | 'prop804' | 'prop805', string>;
let ids: { rGen: number; rAgo: number; rSep: number; rOct: number; rOct2: number; u804: number; u805: number; u806: number; u807: number; u201: number; b1: number; b2: number };

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const lect = (unidad_id: number, extra: Record<string, unknown> = {}) => ({ unidad_id, fecha_anterior: '2026-09-10', lectura_anterior: '1416.574', fecha_actual: '2026-10-10', lectura_actual: '1430.897', factor: '4.9313', ...extra });
const guardar = (token: string, recibo: number, lecturas: unknown[]) => llamar(base, 'PUT', `/api/recibos/${recibo}/agua`, token, { lecturas });
const crudo = (metodo: string, ruta: string, token: string, cuerpo?: Buffer, tipo = 'image/png') =>
  fetch(base + ruta, { method: metodo, headers: { ...cabecerasDeSesion(token), ...(cuerpo ? { 'content-type': tipo, 'x-nombre-archivo': 'medidor.png' } : {}) }, body: cuerpo ? new Uint8Array(cuerpo) : undefined });

function hoja(filas: (string | number)[][], tipo: 'xlsx' | 'csv' = 'xlsx'): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Lecturas');
  return XLSX.write(wb, { type: 'buffer', bookType: tipo === 'csv' ? 'csv' : 'xlsx', ...(tipo === 'csv' ? { FS: ';' } : {}) }) as Buffer;
}
async function subir(token: string, recibo: number, archivo: Buffer, nombre = 'lecturas.xlsx', factor?: string) {
  const f = new FormData();
  if (factor !== undefined) f.append('factor', factor);
  f.append('archivo', new Blob([new Uint8Array(archivo)]), nombre);
  const r = await fetch(`${base}/api/recibos/${recibo}/agua/excel`, { method: 'POST', headers: cabecerasDeSesion(token), body: f });
  const texto = await r.text();
  let body: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = JSON.parse(texto); } catch { /* no es JSON */ }
  return { status: r.status, body, texto };
}
const ENC = ['Dpto', 'Fecha anterior', 'Lectura anterior', 'Fecha actual', 'Lectura actual', 'Factor'];

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  const hash = await bcrypt.hash(PASSWORD, 4);
  const c = await prisma.complejoHabitacional.create({ data: { nombre: 'Condominio Libertadores', tipo: 'Condominio', empresa_id: d.empresaA.id } });
  const b1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'block', complejo_id: c.id } });
  const b2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'block', complejo_id: c.id } });
  const usuario = (nombre: string, email: string, extra: Record<string, unknown>) => prisma.usuario.create({ data: { nombre, email, rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: c.id, ...extra } });
  const prop804 = await usuario('Dueño 804', 'prop804@test.pe', {});
  const prop805 = await usuario('Dueño 805', 'prop805@test.pe', {});
  await usuario('Presi 1', 'presi1@test.pe', { estructura_id: b1.id, cargo_junta: 'presidente' });
  await usuario('Presi 2', 'presi2@test.pe', { estructura_id: b2.id, cargo_junta: 'presidente' });
  const unidad = (codigo: string, estructura_id: number, propietario_id?: number) => prisma.unidad.create({ data: { codigo, tipo: 'Departamento', complejo_id: c.id, empresa_id: d.empresaA.id, estructura_id, estado: 'activa', propietario_id } });
  const u804 = await unidad('B01-804', b1.id, prop804.id);
  const u805 = await unidad('B01-805', b1.id, prop805.id);
  const u806 = await unidad('B01-806', b1.id);
  const u807 = await unidad('B01-807', b1.id);
  const u201 = await unidad('B02-201', b2.id);

  const concepto = (nombre: string) => prisma.concepto.create({ data: { nombre, empresa_id: d.empresaA.id, tipo_monto: 'fijo' } });
  const admin = await concepto('ADMINISTRACIÓN');
  const aguaDpto = await concepto('AGUA DPTO.');
  const aguaComun = await concepto('AGUA COMUN DEL CONDOMINIO');
  const multa = await concepto('MULTA PAGO FUERA DE FECHA');
  const recibo = (estructura_id: number, mes: number, vence: string) => prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: c.id, estructura_id, mes, anio: 2026, fecha_emision: dia(`2026-${String(mes).padStart(2, '0')}-01`), fecha_vencimiento: dia(vence), estado: 'emitido' } });
  const rAgo = await recibo(b1.id, 8, '2026-09-02');
  const rSep = await recibo(b1.id, 9, '2026-10-02');
  const rOct = await recibo(b1.id, 10, '2026-11-02');
  const rOct2 = await recibo(b2.id, 10, '2026-11-02');
  const rc = (recibo_id: number, concepto_id: number, orden: number) => prisma.reciboConcepto.create({ data: { recibo_id, concepto_id, monto: 0, orden } });
  const cargo = (rcid: number, unidad_id: number, monto: string, estado_pago = 'pendiente') => prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rcid, unidad_id, monto, estado_pago } });

  const aAdm = await rc(rAgo.id, admin.id, 1);
  await cargo(aAdm.id, u804.id, '80.00');
  await cargo(aAdm.id, u805.id, '80.00', 'en_revision'); // en revisión: no es deuda todavía
  const sAdm = await rc(rSep.id, admin.id, 1);
  const sAgua = await rc(rSep.id, aguaDpto.id, 2);
  await cargo(sAdm.id, u804.id, '100.00');
  await cargo(sAgua.id, u804.id, '50.00');
  await cargo(sAdm.id, u805.id, '100.00', 'pagado');
  await cargo(sAgua.id, u805.id, '50.00', 'pagado');

  const oAdm = await rc(rOct.id, admin.id, 1);
  const oAgua = await rc(rOct.id, aguaDpto.id, 2);
  const oComun = await rc(rOct.id, aguaComun.id, 3);
  await rc(rOct.id, multa.id, 4); // la multa está en el recibo, pero nadie la debe (S/ 0.00 no crea cargo)
  for (const [u, a] of [[u804, '70.63'], [u805, '60.00'], [u806, '40.00'], [u807, '40.00']] as const) {
    await cargo(oAdm.id, u.id, '120.00');
    await cargo(oAgua.id, u.id, a);
  }
  await cargo(oComun.id, u804.id, '2.53');
  const o2Adm = await rc(rOct2.id, admin.id, 1);
  await cargo(o2Adm.id, u201.id, '100.00');

  // Las lecturas de agosto y septiembre de B01-804: la «anterior» de octubre sale de la MÁS RECIENTE (septiembre), no de la primera que aparezca.
  await prisma.lecturaAgua.create({ data: { unidad_id: u804.id, recibo_id: rAgo.id, fecha_anterior: dia('2026-07-10'), lectura_anterior: '1385.000', fecha_actual: dia('2026-08-10'), lectura_actual: '1400.000', factor: '4.8000' } });
  // La lectura de septiembre de B01-804: de ahí sale la «anterior» de octubre.
  await prisma.lecturaAgua.create({ data: { unidad_id: u804.id, recibo_id: rSep.id, fecha_anterior: dia('2026-08-10'), lectura_anterior: '1400.000', fecha_actual: dia('2026-09-10'), lectura_actual: '1416.574', factor: '4.9313' } });

  // Un recibo «general» (sin torre) que cobra a departamentos de las dos torres: la junta de un block sólo debe alcanzar los de SU block.
  const rGen = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: c.id, estructura_id: null, mes: 11, anio: 2026, fecha_emision: dia('2026-11-01'), fecha_vencimiento: dia('2026-12-02'), estado: 'emitido' } });
  const gAdm = await rc(rGen.id, admin.id, 1);
  await cargo(gAdm.id, u804.id, '10.00');
  await cargo(gAdm.id, u201.id, '10.00');

  ids = { rGen: rGen.id, rAgo: rAgo.id, rSep: rSep.id, rOct: rOct.id, rOct2: rOct2.id, u804: u804.id, u805: u805.id, u806: u806.id, u807: u807.id, u201: u201.id, b1: b1.id, b2: b2.id };
  T = {
    adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'),
    presi1: await login(base, 'presi1@test.pe'), presi2: await login(base, 'presi2@test.pe'),
    prop804: await login(base, 'prop804@test.pe'), prop805: await login(base, 'prop805@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('lecturas: lista y precarga', () => {
  it('lista un renglón por departamento del recibo, con la lectura anterior precargada con la actual del mes previo', async () => {
    const r = await llamar(base, 'GET', `/api/recibos/${ids.rOct}/agua`, T.adminA);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.body.items.map((x: any) => x.unidad.codigo), ['B01-804', 'B01-805', 'B01-806', 'B01-807']); // eslint-disable-line @typescript-eslint/no-explicit-any
    const f804 = r.body.items[0];
    assert.equal(f804.lectura, null);
    assert.equal(f804.anterior.lectura, '1416.574');
    assert.equal(f804.anterior.fecha.slice(0, 10), '2026-09-10');
    assert.equal(f804.agua_recibo, '70.63', 'lo que el recibo cobra por AGUA DPTO. (no cuenta el agua común)');
    assert.equal(r.body.items[1].anterior, null, 'sin lectura previa no se inventa nada');
    assert.equal(r.body.factor_sugerido, '4.9313');
    assert.equal(r.body.recibo.estructura.nombre, 'Block 1');
  });
});

describe('lecturas: guardar a mano', () => {
  it('guarda, calcula consumo y monto, y no cambia ningún cargo', async () => {
    const antes = await prisma.reciboConceptoUnidad.findMany({ orderBy: { id: 'asc' } });
    const r = await guardar(T.adminA, ids.rOct, [lect(ids.u804)]);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual([r.body.guardadas, r.body.errores], [1, []]);
    const g = await llamar(base, 'GET', `/api/recibos/${ids.rOct}/agua`, T.adminA);
    const f = g.body.items[0];
    assert.deepEqual([f.lectura.lectura_anterior, f.lectura.lectura_actual, f.lectura.consumo_m3, f.lectura.factor, f.lectura.monto], ['1416.574', '1430.897', '14.323', '4.9313', '70.63']);
    assert.equal(f.alerta, null, '70.63 contra 70.63');
    assert.deepEqual(await prisma.reciboConceptoUnidad.findMany({ orderBy: { id: 'asc' } }), antes, 'los cargos quedan idénticos');
  });

  it('avisa si el agua del recibo y la de la lectura difieren en más de S/ 0.05 (sin tocar el cargo)', async () => {
    await guardar(T.adminA, ids.rOct, [lect(ids.u805, { lectura_anterior: '100.000', lectura_actual: '112.000', factor: '4.93' })]); // 12 m³ × 4.93 = 59.16
    const g = await llamar(base, 'GET', `/api/recibos/${ids.rOct}/agua`, T.adminA);
    const f = g.body.items.find((x: any) => x.unidad.codigo === 'B01-805'); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(f.lectura.monto, '59.16');
    assert.equal(f.alerta, 'El agua del recibo es S/ 60.00; con la lectura sale S/ 59.16');
    // 8.12 m³ × 4.93 = 40.03: dentro de la tolerancia contra los S/ 40.00 del recibo
    await guardar(T.adminA, ids.rOct, [lect(ids.u806, { lectura_anterior: '0', lectura_actual: '8.12', factor: '4.93' })]);
    const h = await llamar(base, 'GET', `/api/recibos/${ids.rOct}/agua`, T.adminA);
    assert.equal(h.body.items.find((x: any) => x.unidad.codigo === 'B01-806').alerta, null); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('volver a guardar reemplaza la lectura (una por departamento y recibo)', async () => {
    await guardar(T.adminA, ids.rOct, [lect(ids.u804, { lectura_actual: '1431.000' })]);
    assert.equal(await prisma.lecturaAgua.count({ where: { unidad_id: ids.u804, recibo_id: ids.rOct } }), 1);
    const l = await prisma.lecturaAgua.findFirstOrThrow({ where: { unidad_id: ids.u804, recibo_id: ids.rOct } });
    assert.equal(l.lectura_actual.toFixed(3), '1431.000');
    await guardar(T.adminA, ids.rOct, [lect(ids.u804)]); // lo deja como estaba para el resto
  });

  it('rechaza con 422 y el campo: lectura menor, factor cero, fechas al revés, números inválidos', async () => {
    for (const [extra, campo] of [
      [{ lectura_actual: '1400.000' }, 'lectura_actual'],
      [{ factor: '0' }, 'factor'],
      [{ fecha_actual: '2026-09-01' }, 'fecha_actual'],
      [{ lectura_actual: 'mucho' }, ''],
      [{ fecha_actual: '10/10/2026' }, ''],
    ] as [Record<string, unknown>, string][]) {
      const r = await guardar(T.adminA, ids.rOct, [lect(ids.u807, extra)]);
      assert.equal(r.status, 422, JSON.stringify(extra) + r.texto);
      if (campo) assert.ok(r.texto.includes(campo), r.texto);
    }
    assert.equal(await prisma.lecturaAgua.count({ where: { unidad_id: ids.u807 } }), 0, 'no se guardó nada');
  });

  it('un departamento que no es de este recibo vuelve en `errores` y no se guarda', async () => {
    const r = await guardar(T.adminA, ids.rOct, [lect(ids.u201)]);
    assert.equal(r.status, 200);
    assert.equal(r.body.guardadas, 0);
    assert.match(r.body.errores[0].mensaje, /no pertenece a este recibo/);
    assert.equal(await prisma.lecturaAgua.count({ where: { unidad_id: ids.u201 } }), 0);
  });

  it('quitar la lectura la borra', async () => {
    await guardar(T.adminA, ids.rOct, [lect(ids.u807)]);
    const r = await llamar(base, 'DELETE', `/api/recibos/${ids.rOct}/agua/${ids.u807}`, T.adminA);
    assert.equal(r.status, 204);
    assert.equal(await prisma.lecturaAgua.count({ where: { unidad_id: ids.u807 } }), 0);
    assert.equal((await llamar(base, 'DELETE', `/api/recibos/${ids.rOct}/agua/${ids.u807}`, T.adminA)).status, 404);
  });
});

describe('lecturas: Excel y CSV', () => {
  it('importa lo válido y devuelve cada fila con problema: depto inexistente, lectura menor, duplicado en el archivo', async () => {
    await prisma.lecturaAgua.deleteMany({ where: { recibo_id: ids.rOct, unidad_id: { in: [ids.u806, ids.u807] } } });
    const archivo = hoja([
      ENC,
      ['804', '10/09/2026', 1416.574, '10/10/2026', 1430.897, 4.93],     // válida, sólo el número
      ['B01-805', '10/09/2026', 100, '10/10/2026', 112, 4.93],           // válida, código completo
      ['999', '10/09/2026', 1, '10/10/2026', 2, 4.93],                   // no existe
      ['806', '10/09/2026', 500, '10/10/2026', 499.5, 4.93],             // lectura menor
      ['807', '10/09/2026', 10, '10/10/2026', 12, 4.93],                 // repetido…
      ['B01-807', '10/09/2026', 10, '10/10/2026', 13, 4.93],             // …con otro formato
    ]);
    const r = await subir(T.adminA, ids.rOct, archivo);
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.filas, 6);
    assert.equal(r.body.guardadas, 2);
    const por = (dpto: string) => r.body.errores.filter((e: any) => e.dpto === dpto).map((e: any) => e.mensaje); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.match(por('999')[0], /No existe ese departamento/);
    assert.match(por('806')[0], /no puede ser menor/);
    assert.equal(por('807').length, 1);
    assert.equal(por('B01-807').length, 1);
    assert.match(por('807')[0], /aparece 2 veces en el archivo \(filas 6, 7\)/);
    assert.equal(r.body.errores.length, 4);
    assert.equal(await prisma.lecturaAgua.count({ where: { recibo_id: ids.rOct, unidad_id: { in: [ids.u806, ids.u807] } } }), 0, 'ni la lectura menor ni los duplicados se guardaron');
    const l = await prisma.lecturaAgua.findFirstOrThrow({ where: { recibo_id: ids.rOct, unidad_id: ids.u805 } });
    assert.equal(l.lectura_actual.toFixed(3), '112.000');
  });

  it('completa la lectura y fecha anteriores con las del mes previo y el factor con el del formulario', async () => {
    const archivo = hoja([ENC, ['804', '', '', '10/10/2026', 1430.897, '']]);
    const sinFactor = await subir(T.adminA, ids.rOct, archivo);
    assert.equal(sinFactor.status, 201, sinFactor.texto);
    assert.equal(sinFactor.body.guardadas, 0);
    assert.match(sinFactor.body.errores[0].mensaje, /Falta el factor/);
    const r = await subir(T.adminA, ids.rOct, archivo, 'lecturas.xlsx', '4.9313');
    assert.equal(r.body.guardadas, 1, r.texto);
    const l = await prisma.lecturaAgua.findFirstOrThrow({ where: { recibo_id: ids.rOct, unidad_id: ids.u804 } });
    assert.deepEqual([l.lectura_anterior.toFixed(3), l.fecha_anterior.toISOString().slice(0, 10), l.factor.toFixed(4)], ['1416.574', '2026-09-10', '4.9313']);
  });

  it('lee un CSV con punto y coma, coma decimal y fechas día/mes/año', async () => {
    const csv = Buffer.from(`Dpto;Fecha anterior;Lectura anterior;Fecha actual;Lectura actual;Factor\n806;10/09/2026;100,500;10/10/2026;108,614;4,93\n`);
    const r = await subir(T.adminA, ids.rOct, csv, 'lecturas.csv');
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.guardadas, 1, r.texto);
    const l = await prisma.lecturaAgua.findFirstOrThrow({ where: { recibo_id: ids.rOct, unidad_id: ids.u806 } });
    assert.deepEqual([l.lectura_anterior.toFixed(3), l.lectura_actual.toFixed(3), l.fecha_anterior.toISOString().slice(0, 10), l.fecha_actual.toISOString().slice(0, 10), l.factor.toFixed(4)], ['100.500', '108.614', '2026-09-10', '2026-10-10', '4.9300']);
  });

  it('un archivo que no es de lecturas, o vacío, es 422', async () => {
    assert.equal((await subir(T.adminA, ids.rOct, hoja([['x', 'y'], [1, 2]]))).status, 422);
    assert.equal((await subir(T.adminA, ids.rOct, Buffer.from('basura\u0000\u0001'), 'a.xlsx')).status, 422);
    const f = new FormData();
    const sin = await fetch(`${base}/api/recibos/${ids.rOct}/agua/excel`, { method: 'POST', headers: cabecerasDeSesion(T.adminA), body: f });
    assert.equal(sin.status, 422);
  });

  it('la plantilla trae los departamentos del recibo con la lectura y fecha anteriores ya puestas, y se puede volver a subir', async () => {
    const r = await fetch(`${base}/api/recibos/${ids.rOct}/agua/plantilla`, { headers: cabecerasDeSesion(T.adminA) });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /spreadsheetml/);
    const wb = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });
    const filas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    assert.deepEqual(filas[0], ENC);
    assert.deepEqual(filas.slice(1).map((f) => f[0]), ['B01-804', 'B01-805', 'B01-806', 'B01-807']);
    assert.equal(filas[1][2], 1416.574, 'anterior de B01-804');
  });
});

describe('lecturas: alcance', () => {
  it('otra empresa: 404 en todo (lista, guardar, importar, plantilla, foto, fecha de corte)', async () => {
    assert.equal((await llamar(base, 'GET', `/api/recibos/${ids.rOct}/agua`, T.adminB)).status, 404);
    assert.equal((await guardar(T.adminB, ids.rOct, [lect(ids.u804)])).status, 404);
    assert.equal((await subir(T.adminB, ids.rOct, hoja([ENC, ['804', '10/09/2026', 1, '10/10/2026', 2, 4.93]]))).status, 404);
    assert.equal((await llamar(base, 'GET', `/api/recibos/${ids.rOct}/agua/plantilla`, T.adminB)).status, 404);
    assert.equal((await llamar(base, 'PUT', `/api/recibos/${ids.rOct}/datos`, T.adminB, { fecha_corte_agua: '2026-11-10' })).status, 404);
    assert.equal((await crudo('PUT', `/api/recibos/${ids.rOct}/agua/${ids.u804}/foto`, T.adminB, PNG)).status, 404);
  });

  it('la junta de un block sólo alcanza su block: ve y carga el suyo; el de otra torre es 404', async () => {
    const mio = await llamar(base, 'GET', `/api/recibos/${ids.rOct}/agua`, T.presi1);
    assert.equal(mio.status, 200, mio.texto);
    assert.equal(mio.body.items.length, 4);
    assert.equal((await guardar(T.presi1, ids.rOct, [lect(ids.u804)])).body.guardadas, 1);
    // la junta del Block 2 no ve ni toca el recibo del Block 1…
    assert.equal((await llamar(base, 'GET', `/api/recibos/${ids.rOct}/agua`, T.presi2)).status, 404);
    assert.equal((await guardar(T.presi2, ids.rOct, [lect(ids.u804, { lectura_actual: '1500.000' })])).status, 404);
    assert.equal((await subir(T.presi2, ids.rOct, hoja([ENC, ['804', '10/09/2026', 1, '10/10/2026', 2, 4.93]]))).status, 404);
    assert.equal((await crudo('DELETE', `/api/recibos/${ids.rOct}/agua/${ids.u804}`, T.presi2)).status, 404);
    // …ni cuela un departamento ajeno dentro de su propio recibo
    const colado = await guardar(T.presi2, ids.rOct2, [lect(ids.u804)]);
    assert.equal(colado.body.guardadas, 0);
    assert.equal((await prisma.lecturaAgua.findFirstOrThrow({ where: { recibo_id: ids.rOct, unidad_id: ids.u804 } })).lectura_actual.toFixed(3), '1430.897', 'la lectura del Block 1 sigue como estaba');
  });

  it('en un recibo general (sin torre) la junta de un block sólo ve y carga los departamentos de SU block', async () => {
    const lista = await llamar(base, 'GET', `/api/recibos/${ids.rGen}/agua`, T.presi1);
    assert.equal(lista.status, 200, lista.texto);
    assert.deepEqual(lista.body.items.map((x: any) => x.unidad.codigo), ['B01-804']); // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await guardar(T.presi1, ids.rGen, [lect(ids.u804), lect(ids.u201)]);
    assert.equal(r.body.guardadas, 1);
    assert.match(r.body.errores[0].mensaje, /no pertenece a este recibo/);
    assert.equal(await prisma.lecturaAgua.count({ where: { recibo_id: ids.rGen, unidad_id: ids.u201 } }), 0, 'el departamento de la otra torre no se tocó');
    const admin = await llamar(base, 'GET', `/api/recibos/${ids.rGen}/agua`, T.adminA);
    assert.equal(admin.body.items.length, 2, 'la administración sí ve las dos torres');
  });

  it('los residentes no cargan ni leen la lista de lecturas (403)', async () => {
    assert.equal((await llamar(base, 'GET', `/api/recibos/${ids.rOct}/agua`, T.prop804)).status, 403);
    assert.equal((await guardar(T.prop804, ids.rOct, [lect(ids.u804)])).status, 403);
    assert.equal((await crudo('PUT', `/api/recibos/${ids.rOct}/agua/${ids.u804}/foto`, T.prop804, PNG)).status, 403);
  });
});

describe('foto del contómetro', () => {
  it('sube, la ven el admin, la junta del block y SOLO el dueño del departamento; se puede quitar', async () => {
    const sube = await crudo('PUT', `/api/recibos/${ids.rOct}/agua/${ids.u804}/foto`, T.adminA, PNG);
    assert.equal(sube.status, 200, await sube.clone().text());
    for (const t of [T.adminA, T.presi1]) {
      const r = await crudo('GET', `/api/recibos/${ids.rOct}/agua/${ids.u804}/foto`, t);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-type'), 'image/png');
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(Buffer.from(await r.arrayBuffer()), PNG);
    }
    const propia = await crudo('GET', `/api/me/mantenimientos/${ids.rOct}/${ids.u804}/agua/foto`, T.prop804);
    assert.equal(propia.status, 200);
    assert.deepEqual(Buffer.from(await propia.arrayBuffer()), PNG);
    // otro residente, otra junta, otra empresa: 404, sin revelar que existe
    assert.equal((await crudo('GET', `/api/me/mantenimientos/${ids.rOct}/${ids.u804}/agua/foto`, T.prop805)).status, 404);
    assert.equal((await crudo('GET', `/api/recibos/${ids.rOct}/agua/${ids.u804}/foto`, T.presi2)).status, 404);
    assert.equal((await crudo('GET', `/api/recibos/${ids.rOct}/agua/${ids.u804}/foto`, T.adminB)).status, 404);
    // el listado y el detalle no arrastran los bytes
    const lista = await llamar(base, 'GET', `/api/recibos/${ids.rOct}/agua`, T.adminA);
    assert.ok(!lista.texto.includes('foto_datos') && lista.body.items[0].lectura.tiene_foto === true);
    assert.equal((await crudo('DELETE', `/api/recibos/${ids.rOct}/agua/${ids.u804}/foto`, T.adminA)).status, 204);
    assert.equal((await crudo('GET', `/api/recibos/${ids.rOct}/agua/${ids.u804}/foto`, T.adminA)).status, 404);
  });

  it('tope de 2 MB (413), sólo JPG/PNG/WebP (415), los bytes deben ser del tipo (422), vacía (422) y sin lectura guardada (404)', async () => {
    const ruta = `/api/recibos/${ids.rOct}/agua/${ids.u804}/foto`;
    const grande = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    assert.equal((await crudo('PUT', ruta, T.adminA, grande)).status, 413);
    assert.equal((await crudo('PUT', ruta, T.adminA, PNG, 'application/pdf')).status, 415);
    assert.equal((await crudo('PUT', ruta, T.adminA, PNG, 'text/html')).status, 415);
    assert.equal((await crudo('PUT', ruta, T.adminA, Buffer.from('<script>alert(1)</script>'), 'image/png')).status, 422, 'un HTML con cabecera de PNG');
    assert.equal((await crudo('PUT', ruta, T.adminA, Buffer.alloc(0), 'image/png')).status, 422);
    const exacto = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 - PNG.length)]);
    assert.equal((await crudo('PUT', ruta, T.adminA, exacto)).status, 200, 'justo 2 MB cabe');
    await crudo('DELETE', ruta, T.adminA);
    // el 805 no tiene lectura de agua guardada en el recibo 2 (Block 2): no hay a qué colgar la foto
    assert.equal((await crudo('PUT', `/api/recibos/${ids.rOct2}/agua/${ids.u201}/foto`, T.adminA, PNG)).status, 404);
  });
});

describe('fecha de corte del agua', () => {
  it('la fija la administración o la junta de ese block, sale en el detalle del mantenimiento y se puede quitar', async () => {
    const r = await llamar(base, 'PUT', `/api/recibos/${ids.rOct}/datos`, T.presi1, { fecha_corte_agua: '2026-11-10' });
    assert.equal(r.status, 200, r.texto);
    const det = await llamar(base, 'GET', `/api/me/mantenimientos/${ids.rOct}/${ids.u804}`, T.prop804);
    assert.equal(det.body.fecha_corte_agua.slice(0, 10), '2026-11-10');
    assert.equal((await llamar(base, 'PUT', `/api/recibos/${ids.rOct}/datos`, T.presi2, { fecha_corte_agua: '2026-12-01' })).status, 404);
    assert.equal((await llamar(base, 'PUT', `/api/recibos/${ids.rOct}/datos`, T.prop804, { fecha_corte_agua: '2026-12-01' })).status, 403);
    assert.equal((await llamar(base, 'PUT', `/api/recibos/${ids.rOct}/datos`, T.adminA, { fecha_corte_agua: 'pronto' })).status, 422);
    assert.equal((await llamar(base, 'PUT', `/api/recibos/${ids.rOct}/datos`, T.adminA, { fecha_corte_agua: null })).body.fecha_corte_agua, null);
    await llamar(base, 'PUT', `/api/recibos/${ids.rOct}/datos`, T.adminA, { fecha_corte_agua: '2026-11-10' });
  });
});

describe('detalle del mantenimiento: agua y deuda acumulada', () => {
  it('el residente ve el consumo de SU departamento (lecturas, m³, factor, monto) y nada de otro', async () => {
    const r = await llamar(base, 'GET', `/api/me/mantenimientos/${ids.rOct}/${ids.u804}`, T.prop804);
    assert.equal(r.status, 200, r.texto);
    const a = r.body.agua;
    assert.deepEqual([a.lectura_anterior, a.lectura_actual, a.consumo_m3, a.factor, a.monto], ['1416.574', '1430.897', '14.323', '4.9313', '70.63']);
    assert.equal(a.fecha_anterior.slice(0, 10), '2026-09-10');
    assert.equal(a.foto_url, null, 'aún sin foto');
    assert.ok(!r.texto.includes('foto_datos'));
    // otro departamento: no es suyo → 404
    assert.equal((await llamar(base, 'GET', `/api/me/mantenimientos/${ids.rOct}/${ids.u804}`, T.prop805)).status, 404);
    const otro = await llamar(base, 'GET', `/api/me/mantenimientos/${ids.rOct}/${ids.u805}`, T.prop805);
    assert.equal(otro.status, 200);
    assert.ok(!otro.texto.includes('1430.897'), 'la lectura del 804 no se cuela en el recibo del 805');
  });

  it('deuda acumulada: suma lo adeudado de periodos ANTERIORES, no cuenta el mes actual ni lo que está en revisión', async () => {
    const r = await llamar(base, 'GET', `/api/me/mantenimientos/${ids.rOct}/${ids.u804}`, T.prop804);
    assert.equal(r.body.total, '193.16', '120.00 + 70.63 + 2.53 de octubre');
    assert.equal(r.body.deuda_acumulada, '230.00', 'agosto 80.00 + septiembre 150.00; octubre no entra');
    assert.equal(r.body.total_general, '423.16');
    // 805: septiembre pagado y agosto en revisión → sin deuda
    const s = await llamar(base, 'GET', `/api/me/mantenimientos/${ids.rOct}/${ids.u805}`, T.prop805);
    assert.equal(s.body.deuda_acumulada, '0.00');
    assert.equal(s.body.total_general, s.body.total);
    // la deuda del primer mes que existe es cero
    const ago = await llamar(base, 'GET', `/api/me/mantenimientos/${ids.rAgo}/${ids.u804}`, T.prop804);
    assert.equal(ago.body.deuda_acumulada, '0.00');
    const sep = await llamar(base, 'GET', `/api/me/mantenimientos/${ids.rSep}/${ids.u804}`, T.prop804);
    assert.equal(sep.body.deuda_acumulada, '80.00', 'desde septiembre sólo cuenta agosto');
  });

  it('pagar lo anterior baja la deuda acumulada', async () => {
    const cargosAgo = await prisma.reciboConceptoUnidad.findMany({ where: { unidad_id: ids.u804, reciboConcepto: { recibo_id: ids.rAgo } } });
    await prisma.reciboConceptoUnidad.updateMany({ where: { id: { in: cargosAgo.map((c) => c.id) } }, data: { estado_pago: 'pagado' } });
    const r = await llamar(base, 'GET', `/api/me/mantenimientos/${ids.rOct}/${ids.u804}`, T.prop804);
    assert.equal(r.body.deuda_acumulada, '150.00');
    await prisma.reciboConceptoUnidad.updateMany({ where: { id: { in: cargosAgo.map((c) => c.id) } }, data: { estado_pago: 'pendiente' } });
  });

  it('la línea de multa se imprime en 0.00 cuando el recibo tiene ese concepto y el departamento no lo debe', async () => {
    const r = await llamar(base, 'GET', `/api/me/mantenimientos/${ids.rOct}/${ids.u804}`, T.prop804);
    assert.equal(r.body.linea_mora, 'MULTA PAGO FUERA DE FECHA');
    const sep = await llamar(base, 'GET', `/api/me/mantenimientos/${ids.rSep}/${ids.u804}`, T.prop804);
    assert.equal(sep.body.linea_mora, null, 'septiembre no tiene concepto de multa');
  });
});

describe('asistente: mis_recibos incluye el consumo de agua y la fecha de corte (sólo de su unidad)', () => {
  it('trae lecturas, m³, factor y corte del residente; el otro residente no ve la lectura ajena', async () => {
    const { ejecutarHerramienta } = await import('../src/server/tools');
    const u = async (email: string) => {
      const x = await prisma.usuario.findUniqueOrThrow({ where: { email }, select: { id: true, email: true, rol: true, empresa_id: true, complejo_id: true, cargo_junta: true, estructura_id: true } });
      return { ...x, rol: x.rol as 'propietario' };
    };
    const r = await ejecutarHerramienta(await u('prop804@test.pe'), 'mis_recibos', {}, { origen: 'asistente' });
    assert.ok(r.ok);
    const m = (r.datos as any).mantenimientos.find((x: any) => x.vencimiento === '2026-11-02'); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual(m.consumo_agua, { fecha_lectura_anterior: '2026-09-10', lectura_anterior: '1416.574', fecha_lectura_actual: '2026-10-10', lectura_actual: '1430.897', consumo_m3: '14.323', factor: '4.9313', monto: '70.63' });
    assert.equal(m.fecha_corte_agua, '2026-11-10');
    const sep = (r.datos as any).mantenimientos.find((x: any) => x.vencimiento === '2026-10-02'); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(sep.consumo_agua.lectura_actual, '1416.574', 'la de septiembre, la suya');
    const otro = await ejecutarHerramienta(await u('prop805@test.pe'), 'mis_recibos', {}, { origen: 'asistente' });
    assert.ok(otro.ok);
    assert.ok(!JSON.stringify(otro.datos).includes('1430.897') && !JSON.stringify(otro.datos).includes('1416.574'));
  });
});
