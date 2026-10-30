// Consolidado del block: la tabla con TODOS los departamentos del block que la administradora imprime en la cara de atrás de cada recibo
// (GET /api/recibos/:id/consolidado, /excel e /impresion). Datos inventados. Lo que se prueba:
//  - totales = suma de los cargos GUARDADOS (se redondea una sola vez, al final), columnas en el orden del recibo, la multa incluida;
//  - la deuda acumulada es la de `deudaAcumulada` (sólo periodos anteriores);
//  - privacidad: otro tenant → 404, la junta de otro block → 404, un residente → 403, y la junta sólo ve los departamentos de SU block;
//  - el Excel descargado tiene el formato del que se sube y el importador lo vuelve a leer (ida y vuelta por el endpoint real).
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import XLSX from 'xlsx';
import { iniciar, llamar, login, PASSWORD, prisma, sembrar, cabecerasDeSesion, type Datos } from './helpers/app';
import { deudaAcumulada } from '../src/server/lib/mantenimientos';
import { armarImpresion } from '../src/server/services/consolidado';
import { indiceFilaBlock, leerCabecera, leerConceptos, buscarEstructura, codigoEncajaConDpto, limpiarMonto, redondearMonto, normalizarTexto } from '../src/server/lib/excelRecibos';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'adminA' | 'adminB' | 'presi1' | 'presi2' | 'vocal1' | 'resi' | 'inquilino', string>;
let complejoId: number;
let b1: { id: number };
let b2: { id: number };
let rOct1: { id: number }; // Octubre, Block 1
let rOct2: { id: number }; // Octubre, Block 2
let rGeneral: { id: number }; // Noviembre, sin torre (cobra a los dos blocks)
const U: Record<string, { id: number }> = {};

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function recibo(o: { estructura: { id: number } | null; mes: number; anio: number; vence: string }) {
  return prisma.recibo.create({
    data: { empresa_id: d.empresaA.id, complejo_id: complejoId, estructura_id: o.estructura?.id ?? null, mes: o.mes, anio: o.anio, fecha_emision: dia('2026-01-01'), fecha_vencimiento: dia(o.vence), estado: 'emitido', descripcion: `Recibo ${o.mes}/${o.anio}` },
  });
}
const rconcepto = (reciboId: number, nombre: string, orden: number, es_recargo = false) =>
  prisma.reciboConcepto.create({ data: { recibo_id: reciboId, concepto_id: CONCEPTO[nombre]!.id, monto: 0, orden, es_recargo } });
const cargo = (rcId: number, unidad: string, monto: string, estado_pago = 'pendiente') =>
  prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rcId, unidad_id: U[unidad]!.id, monto, estado_pago } });
const CONCEPTO: Record<string, { id: number }> = {};

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  const hash = await bcrypt.hash(PASSWORD, 4);
  const c = await prisma.complejoHabitacional.create({ data: { nombre: 'Condominio Los Olivos', tipo: 'Condominio', empresa_id: d.empresaA.id } });
  complejoId = c.id;
  b1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'block', complejo_id: c.id } });
  b2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'block', complejo_id: c.id } });
  const vecino = (nombre: string, email: string) => prisma.usuario.create({ data: { nombre, email, rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: c.id } });
  const unidad = async (codigo: string, estructura: { id: number }, extra: Record<string, unknown> = {}) => {
    U[codigo] = await prisma.unidad.create({ data: { codigo, tipo: 'departamento', complejo_id: c.id, empresa_id: d.empresaA.id, estructura_id: estructura.id, estado: 'activa', ...extra } });
  };
  await unidad('B01-101', b1, { propietario_id: (await vecino('ROJAS PAREDES ANA MARIA', 'ana@test.pe')).id });
  await unidad('B01-102', b1, { propietario_id: (await vecino('SOTO LIMA CARLOS', 'carlos@test.pe')).id });
  await unidad('B01-103', b1, { propietario_id: (await vecino('VEGA RUIZ LUISA', 'luisa@test.pe')).id });
  await unidad('B01-104', b1, { propietario_id: (await vecino('DIAZ MORA PEDRO', 'pedro@test.pe')).id }); // sin cargos este mes, pero del block
  await unidad('B01-E1', b1, { tipo: 'estacionamiento' }); // no es departamento: no sale si no tiene cargos
  await unidad('B02-101', b2, { propietario_id: (await vecino('NAVARRO CRUZ ROSA', 'rosa@test.pe')).id });
  await unidad('B02-102', b2); // sin propietario
  for (const nombre of ['ADMINISTRACION', 'AGUA DPTO.', 'MULTA PAGO FUERA DE FECHA']) CONCEPTO[nombre] = await prisma.concepto.create({ data: { nombre, empresa_id: d.empresaA.id, tipo_monto: 'fijo' } });

  // Setiembre, Block 1 (ya vencido): B01-101 debe 100; B01-102 pagó todo; B01-103 pagó 40 de 100 (validado) y debe 60.
  const sep = await recibo({ estructura: b1, mes: 9, anio: 2026, vence: '2026-10-02' });
  const sepAdm = await rconcepto(sep.id, 'ADMINISTRACION', 1);
  await cargo(sepAdm.id, 'B01-101', '100');
  await cargo(sepAdm.id, 'B01-102', '100', 'pagado');
  const c103 = await cargo(sepAdm.id, 'B01-103', '100');
  await prisma.pago.create({ data: { recibo_concepto_unidad_id: c103.id, monto: '40', metodo_pago: 'efectivo', estado_validacion: 'validado' } });

  // Octubre, Block 1: con montos de 3 decimales (el redondeo de cada celda NO debe cambiar los totales).
  rOct1 = await recibo({ estructura: b1, mes: 10, anio: 2026, vence: '2026-11-02' });
  const adm = await rconcepto(rOct1.id, 'ADMINISTRACION', 1);
  const agua = await rconcepto(rOct1.id, 'AGUA DPTO.', 2);
  const multa = await rconcepto(rOct1.id, 'MULTA PAGO FUERA DE FECHA', 3, true);
  await cargo(adm.id, 'B01-101', '123.69');
  await cargo(adm.id, 'B01-102', '123.69');
  const adm103 = await cargo(adm.id, 'B01-103', '123.69');
  // B01-103 ya pagó algo de octubre: el recibo de «Imprimir recibos del block» NO debe traer ese historial de pagos.
  await prisma.pago.create({ data: { recibo_concepto_unidad_id: adm103.id, monto: '50', metodo_pago: 'efectivo', estado_validacion: 'validado', referencia: 'OP-777' } });
  await cargo(agua.id, 'B01-101', '70.633');
  await cargo(agua.id, 'B01-102', '21.834');
  await cargo(agua.id, 'B01-103', '10.004');
  await cargo(multa.id, 'B01-101', '20');

  // Octubre, Block 2.
  rOct2 = await recibo({ estructura: b2, mes: 10, anio: 2026, vence: '2026-11-02' });
  const adm2 = await rconcepto(rOct2.id, 'ADMINISTRACION', 1);
  await cargo(adm2.id, 'B02-101', '200');
  await cargo(adm2.id, 'B02-102', '210');

  // Noviembre del Block 1 (posterior: no cuenta como deuda de octubre) y uno general sin torre que cobra a los dos blocks.
  const nov = await recibo({ estructura: b1, mes: 11, anio: 2026, vence: '2026-12-02' });
  await cargo((await rconcepto(nov.id, 'ADMINISTRACION', 1)).id, 'B01-101', '999');
  rGeneral = await recibo({ estructura: null, mes: 12, anio: 2026, vence: '2027-01-02' });
  const gen = await rconcepto(rGeneral.id, 'ADMINISTRACION', 1);
  await cargo(gen.id, 'B01-101', '50');
  await cargo(gen.id, 'B02-101', '60');

  const junta = (n: string, e: { id: number }, cargo_junta: string) => prisma.usuario.create({ data: { nombre: n, email: `${n.toLowerCase().replace(/ /g, '')}@test.pe`, rol: 'propietario', password_hash: hash, complejo_id: c.id, estructura_id: e.id, cargo_junta } });
  await junta('Presi Uno', b1, 'presidente');
  await junta('Presi Dos', b2, 'presidente');
  await junta('Vocal Uno', b1, 'vocal');
  T = {
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    presi1: await login(base, 'presiuno@test.pe'),
    presi2: await login(base, 'presidos@test.pe'),
    vocal1: await login(base, 'vocaluno@test.pe'),
    resi: await login(base, 'ana@test.pe'), // propietario de B01-101, sin cargo en la junta
    inquilino: await login(base, 'inq1@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

const consolidado = async (token: string, id = rOct1.id) => llamar(base, 'GET', `/api/recibos/${id}/consolidado`, token);
const fila = (b: any, codigo: string) => b.filas.find((f: any) => f.codigo === codigo); // eslint-disable-line @typescript-eslint/no-explicit-any

describe('consolidado del block: los números', () => {
  it('trae las columnas del recibo en su orden (la multa incluida) y una fila por departamento del block, con su propietario', async () => {
    const r = await consolidado(T.adminA);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.body.conceptos.map((c: any) => [c.nombre, c.es_recargo]), [['ADMINISTRACION', false], ['AGUA DPTO.', false], ['MULTA PAGO FUERA DE FECHA', true]]); // eslint-disable-line @typescript-eslint/no-explicit-any
    // B01-104 no tiene cargos este mes pero es del block (puede deber de antes); el estacionamiento sin cargos no sale; ni nada del Block 2.
    assert.deepEqual(r.body.filas.map((f: any) => f.codigo), ['B01-101', 'B01-102', 'B01-103', 'B01-104']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(r.body.block, 'Block 1');
    assert.equal(r.body.condominio, 'Condominio Los Olivos');
    assert.equal(r.body.empresa, 'Empresa A');
    assert.equal(r.body.mes, 10);
    assert.equal(r.body.anio, 2026);
    assert.equal(r.body.moneda, 'PEN');
    assert.match(r.body.fecha_vencimiento, /^2026-11-02/);
    const f = fila(r.body, 'B01-101');
    assert.equal(f.propietario, 'ROJAS PAREDES ANA MARIA');
    assert.equal(f.dpto, '101');
    assert.equal(f.block, 'Block 1');
    assert.deepEqual(f.montos, ['123.69', '70.63', '20.00']);
    assert.deepEqual(fila(r.body, 'B01-102').montos, ['123.69', '21.83', '0.00']);
    assert.deepEqual(fila(r.body, 'B01-104').montos, ['0.00', '0.00', '0.00']);
  });

  it('los totales son la suma de los cargos GUARDADOS, redondeada una sola vez (no la suma de las celdas ya redondeadas)', async () => {
    const r = await consolidado(T.adminA);
    // Lo guardado, sumado en la base y no con el código que se prueba.
    const porConcepto = await prisma.reciboConceptoUnidad.groupBy({ by: ['recibo_concepto_id'], where: { reciboConcepto: { recibo_id: rOct1.id } }, _sum: { monto: true } });
    const esperadoColumnas = r.body.conceptos.map((c: any) => porConcepto.find((p) => p.recibo_concepto_id === c.id)!._sum.monto!.toFixed(2)); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual(r.body.totales.montos, esperadoColumnas);
    assert.deepEqual(r.body.totales.montos, ['371.07', '102.47', '20.00']); // 70.633 + 21.834 + 10.004 = 102.471 (las celdas redondeadas sumarían 102.46)
    assert.equal(r.body.totales.total_mant, '493.54'); // 371.07 + 102.471 + 20 = 493.541
    for (const [codigo, esperado] of [['B01-101', '214.32'], ['B01-102', '145.52'], ['B01-103', '133.69'], ['B01-104', '0.00']] as const) {
      const f = fila(r.body, codigo);
      assert.equal(f.total_mant, esperado, codigo);
      assert.equal(f.total, new Prisma.Decimal(f.total_mant).plus(f.deuda_acumulada).toFixed(2), `${codigo}: TOTAL = TOTAL MANT + DEUDA ACUMULADA`);
    }
    const sumaFilas = r.body.filas.reduce((s: number, f: any) => s + Number(f.total_mant), 0); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.ok(Math.abs(sumaFilas - Number(r.body.totales.total_mant)) < 0.05, 'el total del recibo cuadra (±1 centavo por fila redondeada)');
    assert.equal(r.body.totales.total, new Prisma.Decimal(r.body.totales.total_mant).plus(r.body.totales.deuda_acumulada).toFixed(2));
  });

  it('la deuda acumulada es la de deudaAcumulada() (sólo periodos ANTERIORES: ni octubre ni noviembre)', async () => {
    const r = await consolidado(T.adminA);
    for (const f of r.body.filas) assert.equal(f.deuda_acumulada, await deudaAcumulada(f.unidad_id, 2026, 10), f.codigo);
    assert.deepEqual(r.body.filas.map((f: any) => [f.codigo, f.deuda_acumulada]), [['B01-101', '100.00'], ['B01-102', '0.00'], ['B01-103', '60.00'], ['B01-104', '0.00']]); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(r.body.totales.deuda_acumulada, '160.00');
    assert.equal(fila(r.body, 'B01-101').total, '314.32'); // 214.32 + 100
  });

  it('el departamento sin propietario sale con el nombre vacío y el Block 2 tiene lo suyo', async () => {
    const r = await consolidado(T.adminA, rOct2.id);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.block, 'Block 2');
    assert.deepEqual(r.body.filas.map((f: any) => [f.codigo, f.propietario, f.total]), [['B02-101', 'NAVARRO CRUZ ROSA', '200.00'], ['B02-102', '', '210.00']]); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(r.body.totales.total, '410.00');
  });
});

describe('consolidado del block: quién lo ve', () => {
  it('la administración de la empresa y el presidente de ESE block lo ven', async () => {
    assert.equal((await consolidado(T.adminA)).status, 200);
    const r = await consolidado(T.presi1);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.filas.length, 4);
  });

  it('otra empresa → 404 (JSON, Excel e impresión)', async () => {
    for (const ruta of ['consolidado', 'consolidado/excel', 'consolidado/impresion']) {
      const r = await llamar(base, 'GET', `/api/recibos/${rOct1.id}/${ruta}`, T.adminB);
      assert.equal(r.status, 404, `${ruta}: ${r.texto.slice(0, 120)}`);
    }
  });

  it('la junta de OTRO block → 404 (JSON, Excel e impresión)', async () => {
    for (const ruta of ['consolidado', 'consolidado/excel', 'consolidado/impresion']) {
      const r = await llamar(base, 'GET', `/api/recibos/${rOct1.id}/${ruta}`, T.presi2);
      assert.equal(r.status, 404, `${ruta}: ${r.texto.slice(0, 120)}`);
    }
  });

  it('un residente (propietario o inquilino) y un cargo de la junta sin gestión (vocal) → 403; sin sesión → 401', async () => {
    for (const t of [T.resi, T.inquilino, T.vocal1]) {
      for (const ruta of ['consolidado', 'consolidado/excel', 'consolidado/impresion']) {
        const r = await llamar(base, 'GET', `/api/recibos/${rOct1.id}/${ruta}`, t);
        assert.equal(r.status, 403, `${ruta}: ${r.texto.slice(0, 120)}`);
      }
    }
    assert.equal((await llamar(base, 'GET', `/api/recibos/${rOct1.id}/consolidado`, null)).status, 401);
  });

  it('en un recibo sin torre que cobra a los dos blocks, la junta del Block 1 sólo ve SUS departamentos; la administración ve todos', async () => {
    const junta = await consolidado(T.presi1, rGeneral.id);
    assert.equal(junta.status, 200, junta.texto);
    assert.deepEqual(junta.body.filas.map((f: any) => f.codigo), ['B01-101']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(junta.body.totales.total_mant, '50.00', 'los totales también son sólo de su block');
    assert.ok(!junta.texto.includes('NAVARRO'), 'ningún nombre del otro block');
    const admin = await consolidado(T.adminA, rGeneral.id);
    assert.deepEqual(admin.body.filas.map((f: any) => f.codigo), ['B01-101', 'B02-101']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(admin.body.block, null, 'un recibo que mezcla blocks no tiene un block único');
    assert.equal(admin.body.totales.total_mant, '110.00');
  });

  it('?estructura_id acota un recibo que cobra a varios blocks a UNO (JSON, Excel e impresión); la junta de un block no puede ampliarlo a otro', async () => {
    const r = await llamar(base, 'GET', `/api/recibos/${rGeneral.id}/consolidado?estructura_id=${b2.id}`, T.adminA);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.body.filas.map((f: any) => f.codigo), ['B02-101']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(r.body.block, 'Block 2', 'con un solo block, el título dice cuál');
    assert.equal(r.body.totales.total_mant, '60.00');
    const imp = await llamar(base, 'GET', `/api/recibos/${rGeneral.id}/consolidado/impresion?estructura_id=${b2.id}`, T.adminA);
    assert.deepEqual(imp.body.recibos.map((x: any) => x.unidad.codigo), ['B02-101']); // eslint-disable-line @typescript-eslint/no-explicit-any
    const xl = await fetch(`${base}/api/recibos/${rGeneral.id}/consolidado/excel?estructura_id=${b2.id}`, { headers: cabecerasDeSesion(T.adminA) });
    assert.match(xl.headers.get('content-disposition') ?? '', /consolidado-block-2-diciembre-2026\.xlsx/);
    // La junta del Block 1 pidiendo el Block 2: nada (ni nombres ni montos del otro block).
    const ajeno = await llamar(base, 'GET', `/api/recibos/${rGeneral.id}/consolidado?estructura_id=${b2.id}`, T.presi1);
    assert.equal(ajeno.status, 200);
    assert.deepEqual(ajeno.body.filas, []);
    assert.ok(!ajeno.texto.includes('NAVARRO'));
    assert.equal((await llamar(base, 'GET', `/api/recibos/${rGeneral.id}/consolidado?estructura_id=abc`, T.adminA)).status, 422);
  });

  it('la respuesta no se guarda en caché (trae datos de todos los vecinos)', async () => {
    assert.match((await consolidado(T.adminA)).headers.get('cache-control') ?? '', /no-store/);
  });

  it('un recibo que no existe → 404; un id inválido → 422', async () => {
    assert.equal((await consolidado(T.adminA, 999999)).status, 404);
    assert.equal((await llamar(base, 'GET', '/api/recibos/abc/consolidado', T.adminA)).status, 422);
  });
});

describe('consolidado del block: el Excel descargado', () => {
  const bajar = async (token: string, id = rOct1.id) => {
    const r = await fetch(`${base}/api/recibos/${id}/consolidado/excel`, { headers: cabecerasDeSesion(token) });
    return { status: r.status, tipo: r.headers.get('content-type') ?? '', disposicion: r.headers.get('content-disposition') ?? '', buffer: Buffer.from(await r.arrayBuffer()) };
  };
  const leer = (buffer: Buffer) => {
    const hoja = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellNF: true }).Sheets['Consolidado']!;
    return { hoja, datos: XLSX.utils.sheet_to_json(hoja, { header: 1, blankrows: false, defval: '' }) as unknown[][] };
  };

  it('es un .xlsx con el formato del que sube la administradora: título, MES, VENCIMIENTO, encabezado en dos filas, una fila por departamento y TOTALES', async () => {
    const x = await bajar(T.adminA);
    assert.equal(x.status, 200);
    assert.match(x.tipo, /spreadsheetml\.sheet/);
    assert.match(x.disposicion, /attachment; filename="consolidado-block-1-octubre-2026\.xlsx"/);
    const { hoja, datos } = leer(x.buffer);
    assert.equal(hoja['B2']?.v, 'EMPRESA A');
    assert.equal(hoja['D2']?.v, 'MANTENIMIENTO DE OCTUBRE 2026');
    assert.equal(hoja['D4']?.v, 'MES');
    assert.equal(hoja['E4']?.v, 'Octubre');
    assert.equal(hoja['G4']?.v, 'VENCIMIENTO:');
    assert.equal(hoja['I4']?.v, '02 DE NOVIEMBRE DE 2026');
    assert.deepEqual([hoja['A6']?.v, hoja['B6']?.v, hoja['C6']?.v, hoja['D6']?.v], ['BLOCK', 'Dpto.', 'Apellidos y Nombres', 'Conceptos por cobrar']);
    // `sheet_to_json` descarta las filas en blanco (como el importador): título, MES, BLOCK, nombres, 4 departamentos y TOTALES.
    assert.deepEqual(datos[4]!.slice(3).map(String), ['ADMINISTRACION', 'AGUA DPTO.', 'MULTA PAGO FUERA DE FECHA', 'TOTAL MANT', 'DEUDA ACUMULADA', 'TOTAL']);
    assert.deepEqual(datos[5]!.map(String), ['B.1', '101', 'ROJAS PAREDES ANA MARIA', '123.69', '70.63', '20', '214.32', '100', '314.32']);
    assert.equal(datos.length, 10);
    assert.deepEqual(datos.at(-1)!.map(String), ['TOTALES', '', '', '371.07', '102.47', '20', '493.54', '160', '653.54']);
    const celdas = hoja['!merges']!.map((m) => XLSX.utils.encode_range(m));
    for (const m of ['B2:C2', 'D2:I2', 'E4:F4', 'G4:H4', 'A6:A7', 'B6:B7', 'C6:C7', 'D6:I6', 'A12:C12']) assert.ok(celdas.includes(m), `falta la celda unida ${m}`);
    assert.equal(hoja['D8']?.z, '0.00');
  });

  it('el importador de siempre lo lee: cabecera, conceptos, departamentos y montos', async () => {
    const { datos } = leer((await bajar(T.adminA)).buffer);
    const filaBlock = indiceFilaBlock(datos);
    assert.equal(filaBlock, 3);
    const cab = leerCabecera(datos.slice(0, filaBlock));
    assert.deepEqual([cab.mes, cab.anio, cab.vencimiento?.toISOString()], [10, 2026, '2026-11-02T00:00:00.000Z']);
    const cols = leerConceptos(datos, filaBlock);
    assert.deepEqual(cols.conceptos.map((c) => c.nombre), ['ADMINISTRACION', 'AGUA DPTO.', 'MULTA PAGO FUERA DE FECHA']);
    assert.equal(cols.columnaTotalMant, 6);
    assert.deepEqual(cols.duplicados, []);
    const estructuras = [{ nombre: 'Block 1' }, { nombre: 'Block 2' }];
    const unidades = ['B01-101', 'B01-102', 'B01-103', 'B01-104'];
    const filasDatos = datos.slice(cols.primeraFilaDatos).filter((f) => normalizarTexto(f[0]) && normalizarTexto(f[0]).toUpperCase() !== 'TOTALES');
    assert.equal(filasDatos.length, 4);
    for (const [i, f] of filasDatos.entries()) {
      assert.equal(buscarEstructura(estructuras, Number(/\d+/.exec(normalizarTexto(f[0]))![0])).estructura?.nombre, 'Block 1');
      assert.ok(codigoEncajaConDpto(unidades[i]!, normalizarTexto(f[1])), `Dpto. ${f[1]} encaja con ${unidades[i]}`);
      // La suma de los montos redondeados por el importador coincide con TOTAL MANT (si no, avisaría).
      const suma = cols.conceptos.reduce((s, c) => s + Number(redondearMonto(limpiarMonto(f[c.indice]) ?? 0)), 0);
      assert.ok(Math.abs(suma - Number(limpiarMonto(f[cols.columnaTotalMant!]))) <= 0.05, `${unidades[i]}: la suma de conceptos cuadra con TOTAL MANT`);
    }
  });

  it('ida y vuelta por el endpoint real: subir el Excel descargado reemplaza el recibo SIN cambiar ningún cargo ni avisar de nada', async () => {
    const c2 = await prisma.complejoHabitacional.create({ data: { nombre: 'Condominio Ida y Vuelta', tipo: 'Condominio', empresa_id: d.empresaA.id } });
    const e1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'block', complejo_id: c2.id } });
    for (const [n, nombre] of [[101, 'PEREZ LUNA JUAN'], [102, 'TORRES VEGA MARTA']] as const) {
      const p = await prisma.usuario.create({ data: { nombre, email: `rt${n}@test.pe`, rol: 'propietario', complejo_id: c2.id, empresa_id: d.empresaA.id } });
      await prisma.unidad.create({ data: { codigo: `B01-${n}`, tipo: 'departamento', complejo_id: c2.id, empresa_id: d.empresaA.id, estructura_id: e1.id, estado: 'activa', propietario_id: p.id } });
    }
    const original = (() => {
      const hoja: (string | number | null)[][] = [
        [null, 'LOS OLIVOS', null, 'MANTENIMIENTO DE OCTUBRE 2026'],
        [null, null, null, 'MES', 'Octubre', null, 'VENCIMIENTO:', null, '02 DE NOVIEMBRE DE 2026'],
        ['BLOCK', 'Dpto.', 'Apellidos y Nombres', 'Conceptos por cobrar'],
        [null, null, null, 'ADMINISTRACION', 'AGUA DPTO.', 'MULTA PAGO FUERA DE FECHA', 'TOTAL MANT', 'DEUDA ACUMULADA', 'TOTAL'],
        ['B.1', 101, 'PEREZ LUNA JUAN', 123.69, 70.63, 0, 194.32, 0, 194.32],
        ['B.1', 102, 'TORRES VEGA MARTA', 110.5, 0, 20, 130.5, 0, 130.5],
        ['TOTALES', null, null, 234.19, 70.63, 20, 324.82, 0, 324.82],
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hoja), 'Consolidado');
      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    })();
    const subir = async (archivo: Buffer) => {
      const f = new FormData();
      f.append('complejo_id', String(c2.id));
      f.append('archivo', new Blob([new Uint8Array(archivo)]), 'recibos.xlsx');
      const r = await fetch(`${base}/api/recibos/excel`, { method: 'POST', headers: cabecerasDeSesion(T.adminA), body: f });
      const texto = await r.text();
      return { status: r.status, texto, body: JSON.parse(texto) };
    };
    const cargos = async (reciboId: number) => (await prisma.reciboConceptoUnidad.findMany({ where: { reciboConcepto: { recibo_id: reciboId } }, include: { unidad: true, reciboConcepto: { include: { concepto: true } } } }))
      .map((c) => `${c.unidad!.codigo}|${c.reciboConcepto!.concepto!.nombre}|${c.monto.toFixed(2)}`).sort();

    const r1 = await subir(original);
    assert.equal(r1.status, 201, r1.texto);
    const id = r1.body.recibo_id as number;
    const antes = await cargos(id);
    assert.deepEqual(antes, ['B01-101|ADMINISTRACION|123.69', 'B01-101|AGUA DPTO.|70.63', 'B01-102|ADMINISTRACION|110.50', 'B01-102|MULTA PAGO FUERA DE FECHA|20.00']);

    const x = await bajar(T.adminA, id);
    assert.equal(x.status, 200);
    const r2 = await subir(x.buffer);
    assert.equal(r2.status, 201, r2.texto);
    assert.deepEqual(r2.body.advertencias, [], 'el Excel descargado no genera advertencias');
    assert.equal(r2.body.recibos[0].accion, 'reemplazado');
    assert.equal(r2.body.recibos[0].unidades_procesadas, 2);
    assert.deepEqual(await cargos(r2.body.recibo_id), antes, 'los mismos cargos, por departamento y concepto');
    // Y el consolidado del recibo reimportado es el mismo que el primero.
    const a = (await consolidado(T.adminA, id)).body;
    const b = (await consolidado(T.adminA, r2.body.recibo_id)).body;
    assert.deepEqual(b.filas.map((f: any) => [f.codigo, f.propietario, f.montos, f.total]), a.filas.map((f: any) => [f.codigo, f.propietario, f.montos, f.total])); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual(b.totales, a.totales);
  });

  it('descargarlo queda en la auditoría (quién, qué recibo y cuántos departamentos), sin los nombres de los vecinos', async () => {
    await bajar(T.presi1);
    const a = await prisma.auditoria.findFirst({ where: { accion: 'descargar_consolidado', entidad_id: rOct1.id }, orderBy: { id: 'desc' } });
    assert.ok(a, 'hay un registro');
    assert.deepEqual(a.detalle, { mes: 10, anio: 2026, block: 'Block 1', departamentos: 4 });
    assert.ok(!JSON.stringify(a.detalle).includes('ROJAS'));
  });
});

describe('consolidado del block: imprimir los recibos del block', () => {
  it('trae el recibo de cada departamento CON cargos (el mismo del detalle), en el orden del consolidado y sin su historial de pagos', async () => {
    const r = await llamar(base, 'GET', `/api/recibos/${rOct1.id}/consolidado/impresion`, T.adminA);
    assert.equal(r.status, 200, r.texto.slice(0, 200));
    const c = (await consolidado(T.adminA)).body;
    assert.deepEqual(r.body.consolidado, c, 'el consolidado de la última hoja es el mismo');
    assert.deepEqual(r.body.recibos.map((x: any) => x.unidad.codigo), ['B01-101', 'B01-102', 'B01-103']); // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const x of r.body.recibos) {
      assert.deepEqual(x.pagos, [], 'sin pagos: sólo el recibo');
      const f = fila(c, x.unidad.codigo);
      assert.equal(x.total, f.total_mant, 'mismo TOTAL MANT que el consolidado');
      assert.equal(x.deuda_acumulada, f.deuda_acumulada, 'misma deuda acumulada');
      assert.equal(x.total_general, f.total);
    }
    const detalle = await llamar(base, 'GET', `/api/recibos/${rOct1.id}/mantenimientos/${U['B01-101']!.id}`, T.adminA);
    assert.deepEqual(r.body.recibos[0], { ...detalle.body, pagos: [] }, 'es el mismo recibo que «Ver / imprimir recibo» (sin su historial de pagos)');
    const con103 = await llamar(base, 'GET', `/api/recibos/${rOct1.id}/mantenimientos/${U['B01-103']!.id}`, T.adminA);
    assert.equal(con103.body.pagos.length, 1, 'el detalle normal SÍ trae el pago de B01-103 (la prueba de que se quitó es real)');
    assert.ok(!r.texto.includes('OP-777'), 'la referencia del pago no viaja en el documento para imprimir');
  });

  it('la junta del Block 1 imprime sólo los de su block (aunque el recibo cobre a los dos)', async () => {
    const r = await llamar(base, 'GET', `/api/recibos/${rGeneral.id}/consolidado/impresion`, T.presi1);
    assert.equal(r.status, 200, r.texto.slice(0, 200));
    assert.deepEqual(r.body.recibos.map((x: any) => x.unidad.codigo), ['B01-101']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.ok(!r.texto.includes('NAVARRO'));
  });

  it('un block con demasiados departamentos no se imprime de golpe (422), ni se arma nada', async () => {
    await assert.rejects(armarImpresion(rOct1.id, { reciboWhere: {}, unidadWhere: {} }, 2), (e: unknown) => (e as { status?: number }).status === 422 && /departamentos/.test((e as Error).message));
    assert.equal((await armarImpresion(rOct1.id, { reciboWhere: {}, unidadWhere: {} }, 3)).recibos.length, 3, 'justo en el tope sí');
  });

  it('queda en la auditoría', async () => {
    await llamar(base, 'GET', `/api/recibos/${rOct2.id}/consolidado/impresion`, T.adminA);
    const a = await prisma.auditoria.findFirst({ where: { accion: 'imprimir_recibos_block', entidad_id: rOct2.id } });
    assert.deepEqual(a?.detalle, { mes: 10, anio: 2026, block: 'Block 2', recibos: 2 });
  });
});
