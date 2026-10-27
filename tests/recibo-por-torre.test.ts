// Cada torre/block tiene SU propio recibo mensual: Excel por torre, emisión por torre, unicidad por (condominio, torre, mes, año) y alcance de la
// junta. Caso real que motivó todo: el Excel de octubre del Block 2 buscaba «el recibo del condominio» y se topaba con el del Block 1.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import XLSX from 'xlsx';
import { iniciar, llamar, login, PASSWORD, prisma, sembrar, cabecerasDeSesion, type Datos } from './helpers/app';
import { migrarRecibosPorTorre } from '../scripts/migrar-recibos-por-torre';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'adminA' | 'adminB' | 'presi1' | 'presi2', string>;
let complejoId: number;
let b1: { id: number };
let b2: { id: number };

type Celda = string | number | null;
/** Excel de la administradora: un renglón por departamento, con el block en la primera columna (uno o varios blocks en el mismo archivo). */
function excel(filas: [string, number, number][], mes = 'Octubre 2026'): Buffer {
  const hoja: Celda[][] = [
    [null, 'LIBERTADORES'],
    [null, null, null, `MES: ${mes}`, null, null, 'VENCIMIENTO:', null, '02 DE NOVIEMBRE DE 2026'],
    ['BLOCK', 'Dpto.', 'Apellidos y Nombres', 'ADMINISTRACION', 'AGUA', 'TOTAL MANT'],
    ...filas.map(([block, dpto, monto]): Celda[] => [block, dpto, 'VECINO', monto, 10, monto + 10]),
    ['TOTALES', null, null, 0, 0, 0],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hoja), 'Consolidado');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const subir = async (token: string, archivo: Buffer, complejo = complejoId) => {
  const f = new FormData();
  f.append('complejo_id', String(complejo));
  f.append('archivo', new Blob([new Uint8Array(archivo)]), 'recibos.xlsx');
  const r = await fetch(`${base}/api/recibos/excel`, { method: 'POST', headers: cabecerasDeSesion(token), body: f });
  const texto = await r.text();
  let body: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = JSON.parse(texto); } catch { /* no es JSON */ }
  return { status: r.status, body, texto };
};

const BLOCK1: [string, number, number][] = [['Block 1', 101, 100], ['Block 1', 102, 110]];
const BLOCK2: [string, number, number][] = [['Block 2', 101, 200], ['Block 2', 102, 210]];

const recibosDe = (c = complejoId) => prisma.recibo.findMany({ where: { complejo_id: c }, orderBy: [{ mes: 'asc' }, { estructura_id: 'asc' }, { id: 'asc' }] });
const cargosDeRecibo = (reciboId: number) => prisma.reciboConceptoUnidad.findMany({ where: { reciboConcepto: { recibo_id: reciboId } }, include: { unidad: true }, orderBy: { id: 'asc' } });
/** Todo lo que cuelga de un recibo: sirve para comprobar que NO cambió. */
async function foto(reciboId: number) {
  const recibo = await prisma.recibo.findUniqueOrThrow({ where: { id: reciboId } });
  const conceptos = await prisma.reciboConcepto.findMany({ where: { recibo_id: reciboId }, orderBy: { id: 'asc' } });
  const cargos = await prisma.reciboConceptoUnidad.findMany({ where: { reciboConcepto: { recibo_id: reciboId } }, orderBy: { id: 'asc' } });
  const pagos = await prisma.pago.findMany({ where: { reciboConceptoUnidad: { reciboConcepto: { recibo_id: reciboId } } }, orderBy: { id: 'asc' } });
  return { recibo, conceptos, cargos, pagos };
}
async function limpiarRecibos(c = complejoId) {
  const recibos = await prisma.recibo.findMany({ where: { complejo_id: c }, select: { id: true } });
  const ids = recibos.map((r) => r.id);
  await prisma.pago.deleteMany({ where: { reciboConceptoUnidad: { reciboConcepto: { recibo_id: { in: ids } } } } });
  await prisma.reciboConceptoUnidad.deleteMany({ where: { reciboConcepto: { recibo_id: { in: ids } } } });
  await prisma.reciboConcepto.deleteMany({ where: { recibo_id: { in: ids } } });
  await prisma.recibo.deleteMany({ where: { id: { in: ids } } });
}

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  const hash = await bcrypt.hash(PASSWORD, 4);
  const c = await prisma.complejoHabitacional.create({ data: { nombre: 'Condominio Libertadores', tipo: 'Condominio', empresa_id: d.empresaA.id } });
  complejoId = c.id;
  b1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'block', complejo_id: c.id } });
  b2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'block', complejo_id: c.id } });
  for (const [e, pref] of [[b1, 'B01'], [b2, 'B02']] as const) {
    for (const n of [101, 102]) await prisma.unidad.create({ data: { codigo: `${pref}-${n}`, tipo: 'Departamento', complejo_id: c.id, empresa_id: d.empresaA.id, estructura_id: e.id, estado: 'activa' } });
  }
  const concepto = await prisma.concepto.create({ data: { nombre: 'Mantenimiento', empresa_id: d.empresaA.id, tipo_monto: 'fijo' } });
  void concepto;
  for (const [n, e] of [[1, b1], [2, b2]] as const) {
    await prisma.usuario.create({ data: { nombre: `Presidente ${n}`, email: `presi${n}@test.pe`, rol: 'propietario', password_hash: hash, complejo_id: c.id, estructura_id: e.id, cargo_junta: 'presidente' } });
  }
  T = {
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    presi1: await login(base, 'presi1@test.pe'),
    presi2: await login(base, 'presi2@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('Excel: cada torre tiene su recibo', () => {
  it('un Excel con dos blocks crea UN recibo por block, cada uno con los cargos de SU block y la torre en la descripción', async () => {
    await limpiarRecibos();
    const r = await subir(T.adminA, excel([...BLOCK1, ...BLOCK2]));
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.recibos.length, 2);
    assert.deepEqual(r.body.recibos.map((x: { torre: string; accion: string; unidades_procesadas: number }) => [x.torre, x.accion, x.unidades_procesadas]), [['Block 1', 'creado', 2], ['Block 2', 'creado', 2]]);
    assert.equal(r.body.recibo_id, r.body.recibos[0].recibo_id);
    assert.equal(r.body.unidades_procesadas, 4);
    const recibos = await recibosDe();
    assert.equal(recibos.length, 2);
    assert.deepEqual(recibos.map((x) => [x.estructura_id, x.descripcion]), [[b1.id, 'Mantenimiento de octubre de 2026 · Block 1'], [b2.id, 'Mantenimiento de octubre de 2026 · Block 2']]);
    for (const rec of recibos) {
      const cargos = await cargosDeRecibo(rec.id);
      assert.equal(cargos.length, 4, '2 departamentos × 2 conceptos');
      assert.ok(cargos.every((c) => c.unidad?.estructura_id === rec.estructura_id), 'sólo unidades de su block');
    }
  });

  it('el Excel del Block 2 NO toca el recibo del Block 1, aunque el Block 1 ya tenga pagos (el caso real)', async () => {
    await limpiarRecibos();
    const r1 = await subir(T.adminA, excel(BLOCK1));
    assert.equal(r1.status, 201, r1.texto);
    const idB1: number = r1.body.recibo_id;
    const unidadB1 = (await cargosDeRecibo(idB1))[0].unidad_id!;
    const pago = await llamar(base, 'POST', `/api/recibos/${idB1}/mantenimientos/${unidadB1}/pagos`, T.adminA, { metodo_pago: 'efectivo' });
    assert.equal(pago.status, 201, pago.texto);
    const antes = await foto(idB1);
    assert.ok(antes.pagos.length > 0);

    const r2 = await subir(T.adminA, excel(BLOCK2));
    assert.equal(r2.status, 201, r2.texto);
    assert.equal(r2.body.recibos.length, 1);
    assert.equal(r2.body.recibos[0].torre, 'Block 2');
    assert.notEqual(r2.body.recibo_id, idB1);
    assert.deepEqual(await foto(idB1), antes, 'el recibo del Block 1 (con sus pagos) quedó exactamente igual');
    assert.equal((await recibosDe()).length, 2);
  });

  it('subir otra vez el Excel de un block sin pagos lo reemplaza y no toca el de otro block', async () => {
    await limpiarRecibos();
    const r1 = await subir(T.adminA, excel([...BLOCK1, ...BLOCK2]));
    const [idB1, idB2] = r1.body.recibos.map((x: { recibo_id: number }) => x.recibo_id);
    const antesB1 = await foto(idB1);
    const r2 = await subir(T.adminA, excel([['Block 2', 101, 999], ['Block 2', 102, 210]]));
    assert.equal(r2.status, 201, r2.texto);
    assert.deepEqual(r2.body.recibos.map((x: { recibo_id: number; accion: string }) => [x.recibo_id, x.accion]), [[idB2, 'reemplazado']]);
    assert.deepEqual(await foto(idB1), antesB1);
    const montos = (await cargosDeRecibo(idB2)).filter((c) => c.unidad?.codigo === 'B02-101').map((c) => c.monto.toString()).sort();
    assert.deepEqual(montos, ['10', '999']);
    assert.equal((await recibosDe()).length, 2);
  });

  it('un block con pagos → 409 con la torre en el mensaje; y un Excel con varios blocks no cambia NADA (ni crea el que faltaba)', async () => {
    await limpiarRecibos();
    const r1 = await subir(T.adminA, excel(BLOCK1));
    const idB1: number = r1.body.recibo_id;
    const unidad = (await cargosDeRecibo(idB1))[0].unidad_id!;
    assert.equal((await llamar(base, 'POST', `/api/recibos/${idB1}/mantenimientos/${unidad}/pagos`, T.adminA, { metodo_pago: 'efectivo' })).status, 201);
    const antes = await foto(idB1);
    const r = await subir(T.adminA, excel([...BLOCK1, ...BLOCK2]));
    assert.equal(r.status, 409, r.texto);
    assert.equal(r.body.error, 'El recibo de octubre de 2026 · Block 1 ya tiene pagos registrados; no se puede reemplazar desde Excel');
    assert.deepEqual(await foto(idB1), antes);
    assert.equal((await recibosDe()).length, 1, 'la transacción se deshizo: no quedó el recibo del Block 2');
  });

  it('un recibo viejo SIN torre que ya cobra a unidades del block → 409 y no se crea el recibo de la torre (evita cobrar dos veces)', async () => {
    await limpiarRecibos();
    const general = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: complejoId, mes: 10, anio: 2026, fecha_emision: new Date(), fecha_vencimiento: new Date('2026-11-02'), estado: 'emitido' } });
    const concepto = await prisma.concepto.create({ data: { nombre: 'Viejo', empresa_id: d.empresaA.id, tipo_monto: 'fijo' } });
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: general.id, concepto_id: concepto.id, monto: 50, orden: 1 } });
    const unidad = await prisma.unidad.findFirstOrThrow({ where: { estructura_id: b1.id } });
    await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidad.id, monto: 50, estado_pago: 'pendiente' } });
    const r = await subir(T.adminA, excel(BLOCK1));
    assert.equal(r.status, 409, r.texto);
    assert.match(r.body.error, /sin torre/);
    assert.match(r.body.error, /Block 1/);
    assert.equal((await recibosDe()).length, 1);
    // El Block 2 no tiene cargos en ese recibo viejo: su Excel sí pasa.
    assert.equal((await subir(T.adminA, excel(BLOCK2))).status, 201);
  });

  it('dos subidas simultáneas del mismo block y mes dejan UN solo recibo', async () => {
    await limpiarRecibos();
    const [a, b] = await Promise.all([subir(T.adminA, excel(BLOCK1)), subir(T.adminA, excel(BLOCK1))]);
    assert.deepEqual([a.status, b.status].sort(), [201, 201], `${a.texto} / ${b.texto}`);
    assert.equal((await recibosDe()).length, 1);
    const [r] = await recibosDe();
    assert.equal((await cargosDeRecibo(r.id)).length, 4, 'sin cargos duplicados');
  });

  it('un Excel sin ninguna fila de torres del condominio → 422 y no crea nada', async () => {
    await limpiarRecibos();
    const r = await subir(T.adminA, excel([['Block 9', 101, 100]]));
    assert.equal(r.status, 422, r.texto);
    assert.equal((await recibosDe()).length, 0);
  });

  it('«setiembre» y «septiembre» en el Excel dan el mes 9; la descripción sale con «setiembre»', async () => {
    await limpiarRecibos();
    for (const mes of ['Setiembre 2026', 'Septiembre 2026']) {
      const r = await subir(T.adminA, excel(BLOCK1, mes));
      assert.equal(r.status, 201, r.texto);
      assert.equal(r.body.mes, 9);
    }
    const [rec] = await recibosDe();
    assert.equal(rec.descripcion, 'Mantenimiento de setiembre de 2026 · Block 1');
  });
});

describe('Emitir recibo: por torre', () => {
  const concepto = () => prisma.concepto.findFirstOrThrow({ where: { empresa_id: d.empresaA.id, nombre: 'Mantenimiento' } });
  const emitir = async (token: string, extra: Record<string, unknown> = {}, c = complejoId) => llamar(base, 'POST', '/api/recibos', token, {
    complejo_id: c, mes: 10, anio: 2026, fecha_emision: '2026-10-01T12:00:00.000Z', fecha_vencimiento: '2026-11-02T12:00:00.000Z',
    conceptos: [{ concepto_id: (await concepto()).id, monto: 150 }], ...extra,
  });

  it('sin elegir torre, «todas las torres»: un recibo por torre, cada uno con los cargos de SU torre', async () => {
    await limpiarRecibos();
    const r = await emitir(T.adminA);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.recibos.length, 2);
    assert.equal(r.body.id, r.body.recibos[0].id, 'la respuesta sigue trayendo el primer recibo en la raíz');
    const recibos = await recibosDe();
    assert.deepEqual(recibos.map((x) => [x.estructura_id, x.descripcion]), [[b1.id, 'Mantenimiento de octubre de 2026 · Block 1'], [b2.id, 'Mantenimiento de octubre de 2026 · Block 2']]);
    for (const rec of recibos) {
      const cargos = await cargosDeRecibo(rec.id);
      assert.equal(cargos.length, 2);
      assert.ok(cargos.every((c) => c.unidad?.estructura_id === rec.estructura_id));
    }
    assert.deepEqual(r.body.recibos.map((x: { estructura: { nombre: string } }) => x.estructura.nombre), ['Block 1', 'Block 2']);
    assert.ok(r.body.recibos.every((x: { totales: { monto: string } }) => x.totales.monto === '300.00'), 'el total de cada recibo es sólo de su torre');
  });

  it('eligiendo una torre emite sólo ese recibo', async () => {
    await limpiarRecibos();
    const r = await emitir(T.adminA, { estructura_id: b2.id, descripcion: 'Cuota de octubre' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.recibos.length, 1);
    const recibos = await recibosDe();
    assert.deepEqual(recibos.map((x) => [x.estructura_id, x.descripcion]), [[b2.id, 'Cuota de octubre']]);
  });

  it('con unidades sin torre, «todas» deja además un recibo sin torre para ellas (nadie queda sin cobrar)', async () => {
    await limpiarRecibos();
    const casa = await prisma.unidad.create({ data: { codigo: 'CASA-1', tipo: 'Casa', complejo_id: complejoId, empresa_id: d.empresaA.id, estado: 'activa' } });
    try {
      const r = await emitir(T.adminA);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      const recibos = await recibosDe();
      assert.equal(recibos.length, 3);
      const sinTorre = recibos.find((x) => x.estructura_id == null)!;
      assert.deepEqual((await cargosDeRecibo(sinTorre.id)).map((c) => c.unidad?.codigo), ['CASA-1']);
    } finally {
      await limpiarRecibos();
      await prisma.unidad.delete({ where: { id: casa.id } });
    }
  });

  it('una torre de otro condominio → 422; un condominio de otra empresa → 422; y no crea nada', async () => {
    await limpiarRecibos();
    const otra = await prisma.estructura.create({ data: { nombre: 'Block X', tipo: 'block', complejo_id: d.complejoA.id } });
    const r = await emitir(T.adminA, { estructura_id: otra.id });
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.equal((await emitir(T.adminB)).status, 422);
    assert.equal((await recibosDe()).length, 0);
    assert.equal((await recibosDe(d.complejoA.id)).filter((x) => x.mes === 10 && x.estructura_id === otra.id).length, 0);
  });

  it('un condominio SIN torres emite un solo recibo sin torre y sin sufijo en la descripción', async () => {
    const complejo = await prisma.complejoHabitacional.create({ data: { nombre: 'Sin torres', tipo: 'Edificio', empresa_id: d.empresaA.id } });
    await prisma.unidad.create({ data: { codigo: 'S-1', tipo: 'Departamento', complejo_id: complejo.id, empresa_id: d.empresaA.id, estado: 'activa' } });
    const r = await emitir(T.adminA, {}, complejo.id);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const [rec] = await recibosDe(complejo.id);
    assert.equal(rec.estructura_id, null);
    assert.equal(rec.descripcion, 'Mantenimiento de octubre de 2026');
    assert.equal((await emitir(T.adminA, {}, complejo.id)).status, 409);
  });

  it('unicidad: el mismo (condominio, torre, mes, año) dos veces → 409 con la torre; si falta una sola torre no se crea ninguna', async () => {
    await limpiarRecibos();
    assert.equal((await emitir(T.adminA, { estructura_id: b1.id })).status, 201);
    const otra = await emitir(T.adminA, { estructura_id: b1.id });
    assert.equal(otra.status, 409);
    assert.equal(otra.body.error, 'Ya existe el recibo de octubre de 2026 · Block 1');
    const todas = await emitir(T.adminA);
    assert.equal(todas.status, 409);
    assert.equal((await recibosDe()).length, 1, '«todas» no creó el del Block 2 porque el del Block 1 ya existía');
    // Otro mes u otra torre sí.
    assert.equal((await emitir(T.adminA, { estructura_id: b2.id })).status, 201);
    assert.equal((await emitir(T.adminA, { estructura_id: b1.id, mes: 11 })).status, 201);
  });

  it('dos emisiones simultáneas de la misma torre: una gana (201) y la otra pierde (409); queda UN recibo', async () => {
    await limpiarRecibos();
    const [a, b] = await Promise.all([emitir(T.adminA, { estructura_id: b1.id }), emitir(T.adminA, { estructura_id: b1.id })]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409], `${JSON.stringify(a.body)} / ${JSON.stringify(b.body)}`);
    assert.equal((await recibosDe()).length, 1);
    assert.equal((await cargosDeRecibo((await recibosDe())[0].id)).length, 2);
  });

  it('cambiar el mes o el año de un recibo a un periodo ya ocupado por esa torre → 409', async () => {
    await limpiarRecibos();
    const a = (await emitir(T.adminA, { estructura_id: b1.id })).body;
    const b = (await emitir(T.adminA, { estructura_id: b1.id, mes: 11 })).body;
    const r = await llamar(base, 'PUT', `/api/recibos/${b.id}`, T.adminA, { mes: 10 });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal((await llamar(base, 'PUT', `/api/recibos/${b.id}`, T.adminA, { mes: 12 })).status, 200);
    assert.ok(a.id);
  });
});

describe('Alcance: la junta de un block sólo ve el recibo de SU block', () => {
  let r1: number;
  let r2: number;
  let u1: number;
  let u2: number;
  before(async () => {
    await limpiarRecibos();
    const r = await subir(T.adminA, excel([...BLOCK1, ...BLOCK2]));
    [r1, r2] = r.body.recibos.map((x: { recibo_id: number }) => x.recibo_id);
    u1 = (await cargosDeRecibo(r1))[0].unidad_id!;
    u2 = (await cargosDeRecibo(r2))[0].unidad_id!;
  });

  it('la junta del Block 1 ve el recibo del Block 1 y recibe 404 en TODO lo del Block 2', async () => {
    assert.equal((await llamar(base, 'GET', `/api/recibos/${r1}/mantenimientos`, T.presi1)).status, 200);
    assert.equal((await llamar(base, 'GET', `/api/recibos/${r2}/mantenimientos`, T.presi1)).status, 404);
    assert.equal((await llamar(base, 'GET', `/api/recibos/${r2}/mantenimientos/${u2}`, T.presi1)).status, 404);
    assert.equal((await llamar(base, 'POST', `/api/recibos/${r2}/mantenimientos/${u2}/pagos`, T.presi1, { metodo_pago: 'efectivo' })).status, 404);
    assert.equal((await llamar(base, 'GET', `/api/recibos/${r2}/blocks`, T.presi1)).status, 403, 'blocks es sólo de la administración');
    // Y a la inversa.
    assert.equal((await llamar(base, 'GET', `/api/recibos/${r1}/mantenimientos`, T.presi2)).status, 404);
    assert.equal((await llamar(base, 'GET', `/api/recibos/${r2}/mantenimientos/${u2}`, T.presi2)).status, 200);
    // Sin tocar: la unidad del Block 2 sigue sin pagos.
    assert.equal(await prisma.pago.count({ where: { reciboConceptoUnidad: { unidad_id: u2 } } }), 0);
    assert.ok(u1);
  });

  it('GET /api/recibos/periodos de la junta trae sólo el recibo de su block', async () => {
    const a = await llamar(base, 'GET', '/api/recibos/periodos', T.presi1);
    assert.equal(a.status, 200);
    assert.deepEqual(a.body.items.map((x: { id: number }) => x.id), [r1]);
    assert.equal(a.body.items[0].estructura.nombre, 'Block 1');
    const b = await llamar(base, 'GET', '/api/recibos/periodos', T.presi2);
    assert.deepEqual(b.body.items.map((x: { id: number }) => x.id), [r2]);
  });

  it('un recibo SIN torre (general o viejo) lo ve la junta, pero su lista de departamentos sigue acotada a su block', async () => {
    const general = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: complejoId, mes: 3, anio: 2026, fecha_emision: new Date(), fecha_vencimiento: new Date('2026-04-02'), estado: 'emitido' } });
    const concepto = await prisma.concepto.findFirstOrThrow({ where: { empresa_id: d.empresaA.id, nombre: 'Mantenimiento' } });
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: general.id, concepto_id: concepto.id, monto: 10, orden: 1 } });
    for (const unidad_id of [u1, u2]) await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id, monto: 10, estado_pago: 'pendiente' } });
    const r = await llamar(base, 'GET', `/api/recibos/${general.id}/mantenimientos`, T.presi1);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.items.map((x: { unidad_id: number }) => x.unidad_id), [u1]);
  });

  it('un cargo de un recibo de torre sólo admite unidades de esa torre (422 con otra); con la suya, 201', async () => {
    const rcs = await prisma.reciboConcepto.findMany({ where: { recibo_id: r1 } });
    const ajena = await llamar(base, 'POST', '/api/recibo-concepto-unidades', T.adminA, { recibo_concepto_id: rcs[0].id, unidad_id: u2, monto: 5 });
    assert.equal(ajena.status, 422, JSON.stringify(ajena.body));
    assert.match(ajena.body.error, /torre/);
    const propia = await prisma.unidad.findFirstOrThrow({ where: { estructura_id: b1.id, id: { not: u1 } } });
    const sin = await prisma.reciboConceptoUnidad.count({ where: { recibo_concepto_id: rcs[0].id, unidad_id: propia.id } });
    await prisma.reciboConceptoUnidad.deleteMany({ where: { recibo_concepto_id: rcs[0].id, unidad_id: propia.id } });
    const ok = await llamar(base, 'POST', '/api/recibo-concepto-unidades', T.adminA, { recibo_concepto_id: rcs[0].id, unidad_id: propia.id, monto: 5 });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.ok(sin >= 0);
  });
});

describe('/periodos: N torres no se comen los meses', () => {
  it('con 30 torres emitiendo cada mes, los últimos 24 MESES salen completos (no 24 recibos)', async () => {
    const complejo = await prisma.complejoHabitacional.create({ data: { nombre: 'Muchas torres', tipo: 'Condominio', empresa_id: d.empresaA.id } });
    const torres = [];
    for (let i = 1; i <= 30; i++) torres.push(await prisma.estructura.create({ data: { nombre: `Torre ${i}`, tipo: 'torre', complejo_id: complejo.id } }));
    for (const mes of [1, 2, 3]) {
      await prisma.recibo.createMany({ data: torres.map((t) => ({ empresa_id: d.empresaA.id, complejo_id: complejo.id, estructura_id: t.id, mes, anio: 2025, fecha_emision: new Date(), fecha_vencimiento: new Date('2025-12-31'), estado: 'emitido' })) });
    }
    const r = await llamar(base, 'GET', '/api/recibos/periodos', T.adminA);
    assert.equal(r.status, 200);
    const delComplejo = r.body.items.filter((x: { complejo: { id: number } }) => x.complejo.id === complejo.id);
    assert.equal(delComplejo.length, 90, 'los 3 meses × 30 torres, ninguno truncado');
    assert.equal(new Set(delComplejo.map((x: { mes: number }) => x.mes)).size, 3);
  });
});

describe('script migrar-recibos-por-torre', () => {
  let concepto: { id: number };
  before(async () => { concepto = await prisma.concepto.findFirstOrThrow({ where: { empresa_id: d.empresaA.id, nombre: 'Mantenimiento' } }); });

  /** Un recibo viejo (sin torre) con un cargo por cada unidad dada. */
  async function reciboViejo(unidades: number[], extra: { mes?: number; descripcion?: string | null } = {}) {
    const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: complejoId, mes: extra.mes ?? 10, anio: 2026, fecha_emision: new Date(), fecha_vencimiento: new Date('2026-11-02'), estado: 'emitido', descripcion: extra.descripcion === undefined ? 'Mantenimiento de 10 de 2026' : extra.descripcion } });
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: concepto.id, monto: 10, orden: 1 } });
    for (const unidad_id of unidades) await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id, monto: 10, estado_pago: 'pendiente' } });
    return recibo;
  }
  const unidadesDe = async (estructura_id: number) => (await prisma.unidad.findMany({ where: { estructura_id }, select: { id: true } })).map((u) => u.id);

  it('un recibo con cargos de UNA sola torre recibe esa torre (y su descripción con mes en letras); uno que mezcla torres no se toca', async () => {
    await limpiarRecibos();
    const delBlock1 = await reciboViejo(await unidadesDe(b1.id));
    const mezcla = await reciboViejo([...(await unidadesDe(b1.id)), ...(await unidadesDe(b2.id))], { mes: 11 });
    const vacio = await reciboViejo([], { mes: 12 });
    const aMano = await reciboViejo(await unidadesDe(b2.id), { mes: 9, descripcion: 'Cuota extraordinaria' });
    const sinTorre = await prisma.unidad.create({ data: { codigo: 'SUELTA-1', tipo: 'Casa', complejo_id: complejoId, empresa_id: d.empresaA.id, estado: 'activa' } });
    const soloSinTorre = await reciboViejo([sinTorre.id], { mes: 8 });
    try {
      const i = await migrarRecibosPorTorre(prisma);
      // El script mira TODA la base (también los recibos sembrados de otros condominios): aquí sólo cuentan los de esta prueba.
      const mios = new Set([delBlock1.id, mezcla.id, vacio.id, aMano.id, soloSinTorre.id]);
      assert.deepEqual(i.asignados.filter((a) => mios.has(a.recibo_id)).map((a) => [a.recibo_id, a.torre, a.descripcion]), [
        [delBlock1.id, 'Block 1', 'Mantenimiento de octubre de 2026 · Block 1'],
        [aMano.id, 'Block 2', 'Cuota extraordinaria'],
      ]);
      assert.deepEqual(i.mezclan.filter((m) => mios.has(m.recibo_id)).map((m) => m.recibo_id), [mezcla.id]);
      assert.deepEqual(i.sin_cargos.filter((x) => mios.has(x)), [vacio.id]);
      assert.deepEqual(i.sin_torre.filter((x) => mios.has(x)), [soloSinTorre.id]);
      const ahora = await prisma.recibo.findMany({ where: { id: { in: [delBlock1.id, mezcla.id, vacio.id, aMano.id, soloSinTorre.id] } }, orderBy: { id: 'asc' } });
      assert.deepEqual(ahora.map((r) => r.estructura_id), [b1.id, null, null, b2.id, null]);
      assert.equal(ahora[0].descripcion, 'Mantenimiento de octubre de 2026 · Block 1');
      assert.equal(ahora[1].descripcion, 'Mantenimiento de 10 de 2026', 'el que mezcla queda como estaba');
    } finally {
      await prisma.unidad.deleteMany({ where: { id: sinTorre.id } }).catch(() => undefined);
    }
  });

  it('es idempotente (la segunda corrida no asigna nada) y --seco informa sin cambiar la base', async () => {
    await limpiarRecibos();
    const r = await reciboViejo(await unidadesDe(b1.id));
    const seco = await migrarRecibosPorTorre(prisma, { seco: true });
    assert.deepEqual(seco.asignados.map((a) => a.recibo_id), [r.id], 'el único recibo viejo de una sola torre de toda la base');
    assert.equal((await prisma.recibo.findUniqueOrThrow({ where: { id: r.id } })).estructura_id, null, 'el simulacro no cambió nada');
    assert.equal((await migrarRecibosPorTorre(prisma)).asignados.length, 1);
    const otra = await migrarRecibosPorTorre(prisma);
    assert.deepEqual([otra.asignados.length, otra.mezclan.length], [0, 0]);
    assert.equal((await prisma.recibo.findUniqueOrThrow({ where: { id: r.id } })).estructura_id, b1.id);
  });

  it('si ya existe el recibo de esa torre y periodo, no lo toca y lo informa como duplicado', async () => {
    await limpiarRecibos();
    const viejo = await reciboViejo(await unidadesDe(b1.id));
    const nuevo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: complejoId, estructura_id: b1.id, mes: 10, anio: 2026, fecha_emision: new Date(), fecha_vencimiento: new Date('2026-11-02'), estado: 'emitido' } });
    const i = await migrarRecibosPorTorre(prisma);
    assert.deepEqual(i.duplicados, [{ recibo_id: viejo.id, torre: 'Block 1', con_recibo_id: nuevo.id }]);
    assert.equal((await prisma.recibo.findUniqueOrThrow({ where: { id: viejo.id } })).estructura_id, null);
  });

  it('después de migrar, el Excel del Block 2 ya no choca con el recibo viejo del Block 1 (el caso real de producción)', async () => {
    await limpiarRecibos();
    const viejo = await reciboViejo(await unidadesDe(b1.id));
    // Antes de migrar: el Excel del Block 1 se detiene (el recibo viejo ya cobra a esas unidades); el del Block 2 pasa.
    assert.equal((await subir(T.adminA, excel(BLOCK1))).status, 409);
    await migrarRecibosPorTorre(prisma);
    const r = await subir(T.adminA, excel(BLOCK2));
    assert.equal(r.status, 201, r.texto);
    assert.equal((await prisma.recibo.findUniqueOrThrow({ where: { id: viejo.id } })).estructura_id, b1.id);
    assert.equal((await recibosDe()).length, 2);
  });
});

describe('con el Excel REAL de docs/ejemplos (el escenario de producción)', () => {
  const real = () => readFileSync('docs/ejemplos/block-1-octubre.xlsx');
  /** El mismo archivo con el block cambiado (B.1 → B.2): lo que mandaría la administradora para el Block 2. */
  function comoBlock2(): Buffer {
    const wb = XLSX.read(real(), { type: 'buffer' });
    const hoja = wb.Sheets[wb.SheetNames[0]];
    for (const celda of Object.keys(hoja)) if (celda.startsWith('A') && hoja[celda].v === 'B.1') hoja[celda].v = 'B.2';
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }
  let complejo: number;
  let bloque1: number;
  before(async () => {
    const c = await prisma.complejoHabitacional.create({ data: { nombre: 'Libertadores real', tipo: 'Condominio', empresa_id: d.empresaA.id } });
    complejo = c.id;
    bloque1 = (await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'block', complejo_id: c.id } })).id;
    const bloque2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'block', complejo_id: c.id } });
    for (const [e, pref] of [[bloque1, 'B01'], [bloque2.id, 'B02']] as const) {
      for (let piso = 1; piso <= 8; piso++) for (let k = 1; k <= 4; k++) await prisma.unidad.create({ data: { codigo: `${pref}-${piso}0${k}`, tipo: 'Departamento', complejo_id: c.id, empresa_id: d.empresaA.id, estructura_id: e, estado: 'activa' } });
    }
  });

  it('octubre del Block 1 con un pago (como B01-804 en producción) y luego el Excel del Block 2: 201, y el Block 1 queda intacto (286 cargos, su pago)', async () => {
    const r1 = await subir(T.adminA, real(), complejo);
    assert.equal(r1.status, 201, r1.texto);
    const idB1: number = r1.body.recibo_id;
    assert.equal(r1.body.recibos[0].torre, 'Block 1');
    assert.equal((await cargosDeRecibo(idB1)).length, 286);
    const b804 = await prisma.unidad.findFirstOrThrow({ where: { complejo_id: complejo, codigo: 'B01-804' } });
    const pago = await llamar(base, 'POST', `/api/recibos/${idB1}/mantenimientos/${b804.id}/pagos`, T.adminA, { metodo_pago: 'transferencia' });
    assert.equal(pago.status, 201, pago.texto);
    const antes = await foto(idB1);

    // Antes de este cambio: 409 por el pago del Block 1 (o, sin pagos, REEMPLAZABA los cargos del Block 1).
    const r2 = await subir(T.adminA, comoBlock2(), complejo);
    assert.equal(r2.status, 201, r2.texto);
    assert.equal(r2.body.recibos.length, 1);
    assert.equal(r2.body.recibos[0].torre, 'Block 2');
    assert.equal(r2.body.recibos[0].accion, 'creado');
    assert.deepEqual(await foto(idB1), antes);
    const recibos = await prisma.recibo.findMany({ where: { complejo_id: complejo }, orderBy: { id: 'asc' } });
    assert.deepEqual(recibos.map((x) => x.descripcion), ['Mantenimiento de octubre de 2026 · Block 1', 'Mantenimiento de octubre de 2026 · Block 2']);
    assert.equal((await cargosDeRecibo(r2.body.recibo_id)).length, 286);
    assert.ok((await cargosDeRecibo(r2.body.recibo_id)).every((c) => c.unidad?.codigo.startsWith('B02-')));
    // Y subir otra vez el Excel del Block 1 sigue protegido por SU pago.
    const r3 = await subir(T.adminA, real(), complejo);
    assert.equal(r3.status, 409);
    assert.match(r3.body.error, /Block 1/);
    assert.ok(bloque1);
  });
});
