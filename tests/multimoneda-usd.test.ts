// Todos los países menos Perú pagan la suscripción en dólares (US$) al tipo de cambio: precio en soles ÷ tipo de cambio, redondeado a 2 decimales (también el del
// tramo); sin tipo de cambio, «Consúltanos». El tipo de cambio es automático (tarea diaria con `fetch` inyectado: ninguna prueba toca la red) y editable (manual
// no lo pisa la tarea; sólo superadmin; auditado). El script de moneda de cobro es idempotente y NO toca lo ya emitido.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import { Prisma } from '@prisma/client';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { PAISES, monedaDeCobroSuscripcion } from '../src/lib/paises';
import { sembrarCatalogoComercial } from '../src/server/services/comercial/catalogo';
import { precioEnMoneda, preciosEnDolares, solesADolares, tramoEnMoneda } from '../src/server/services/comercial/impuestos';
import { ajustarMonedaDeCobro } from '../src/server/services/comercial/monedaCobro';
import { invalidarComercial } from '../src/server/services/comercial/modulos';
import { FUENTE_TIPO_CAMBIO, FUENTE_TIPO_CAMBIO_URL, MAX_EDAD_MS, pasadaDeTipoCambio, tipoCambioAutoActivo, tipoCambioDeps, tipoCambioValido } from '../src/server/services/comercial/tipoCambio';

const D = Prisma.Decimal;
const HORA = 3_600_000;
const AHORA = new Date('2026-10-31T15:00:00.000Z');

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'prop1', string>;

const original = { fetch: tipoCambioDeps.fetch, ahora: tipoCambioDeps.ahora };
/** Un `fetch` falso que cuenta las llamadas y responde `cuerpo` (con `estado`); nunca sale a la red. */
function fuente(cuerpo: unknown, estado = 200) {
  const llamadas: string[] = [];
  tipoCambioDeps.fetch = async (url) => { llamadas.push(url); return new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), { status: estado }); };
  return llamadas;
}
const respuesta = (pen: unknown) => ({ result: 'success', base_code: 'USD', rates: { USD: 1, PEN: pen } });
const config = () => prisma.configuracionComercial.findUniqueOrThrow({ where: { id: 1 } });
const fijarEnBase = (tc: string | null, extra: Record<string, unknown> = {}) => prisma.configuracionComercial.update({ where: { id: 1 }, data: { tipo_cambio_usd: tc, tipo_cambio_manual: false, tipo_cambio_at: tc ? new Date(AHORA.getTime() - HORA) : null, tipo_cambio_fuente: tc ? FUENTE_TIPO_CAMBIO : null, ...extra } });
const planPublico = async (clave: string, query = '') => (await llamar(base, 'GET', `/api/publico/planes${query}`)).body.planes.find((p: { clave: string }) => p.clave === clave);

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), prop1: await login(base, 'prop1@test.pe') };
});
after(async () => { await cerrar(); await prisma.$disconnect(); });
beforeEach(async () => {
  tipoCambioDeps.ahora = () => AHORA;
  fuente({ result: 'error' }, 500); // por defecto la fuente no sirve: ninguna prueba depende de ella sin decirlo
  await prisma.auditoria.deleteMany();
  await prisma.pagoSuscripcion.deleteMany();
  await prisma.suscripcionCondominio.deleteMany();
  await prisma.precioPlanMoneda.deleteMany();
  await prisma.complejoHabitacional.updateMany({ data: { pais: 'PE', moneda: 'PEN' } });
  await prisma.planComercial.update({ where: { clave: 'pro' }, data: { precio_por_unidad: '3.00', tramo_desde: null, tramo_precio: null } });
  await prisma.planComercial.update({ where: { clave: 'administradora' }, data: { precio_por_unidad: '2.50', tramo_desde: null, tramo_precio: null } });
  await prisma.planComercial.update({ where: { clave: 'basico' }, data: { precio_por_unidad: '1.50' } });
  await prisma.impuestoPais.deleteMany();
  await sembrarCatalogoComercial(prisma);
  await fijarEnBase('3.8');
  invalidarComercial();
});
afterEach(() => { tipoCambioDeps.fetch = original.fetch; tipoCambioDeps.ahora = original.ahora; mock.restoreAll(); invalidarComercial(); });

describe('la moneda de cobro: Perú en soles, todos los demás en dólares', () => {
  it('la regla: PE → PEN y cualquier otro país → USD; el seed la aplica y deja intacto el impuesto de cada país', async () => {
    assert.equal(monedaDeCobroSuscripcion('PE'), 'PEN');
    assert.equal(monedaDeCobroSuscripcion(undefined), 'PEN', 'sin país cuenta como Perú');
    for (const p of PAISES.filter((x) => x.codigo !== 'PE')) assert.equal(monedaDeCobroSuscripcion(p.codigo), 'USD', p.codigo);
    const filas = await prisma.impuestoPais.findMany();
    assert.equal(filas.length, PAISES.length);
    for (const f of filas) assert.equal(f.moneda, f.pais === 'PE' ? 'PEN' : 'USD', `moneda de ${f.pais}`);
    const f = (p: string) => filas.find((x) => x.pais === p)!;
    assert.deepEqual([f('AR').nombre, f('AR').tasa.toString(), f('CL').tasa.toString(), f('PE').tasa.toString()], ['IVA', '0.21', '0.19', '0.18'], 'el impuesto se mantiene');
  });

  it('la API pública: todos los países abiertos menos Perú cobran en USD (y «?pais=XX» responde en USD con su impuesto)', async () => {
    const c = (await llamar(base, 'GET', '/api/publico/planes')).body;
    assert.equal(c.paises.length, PAISES.length);
    for (const p of c.paises) assert.equal(p.moneda, p.codigo === 'PE' ? 'PEN' : 'USD', p.codigo);
    for (const p of PAISES.filter((x) => x.codigo !== 'PE')) {
      const r = (await llamar(base, 'GET', `/api/publico/planes?pais=${p.codigo}`)).body;
      assert.deepEqual([r.pais, r.moneda], [p.codigo, 'USD'], p.codigo);
    }
    assert.deepEqual((await llamar(base, 'GET', '/api/publico/planes?pais=PE')).body.moneda, 'PEN');
  });
});

describe('precio en dólares = precio en soles ÷ tipo de cambio, a 2 decimales', () => {
  it('solesADolares redondea la mitad hacia arriba (0,50 ÷ 4 = 0,125 → 0,13) y no a la baja', () => {
    assert.equal(solesADolares(new D('0.50'), new D('4')).toFixed(2), '0.13');
    assert.equal(solesADolares(new D('3.00'), new D('3.8')).toFixed(2), '0.79');
    assert.equal(solesADolares(new D('2.50'), new D('3.8')).toFixed(2), '0.66');
    assert.equal(solesADolares(new D('1.50'), new D('3.8')).toFixed(2), '0.39');
  });

  it('precioEnMoneda y tramoEnMoneda: dólares con tipo de cambio; sin él, null; soles y gratis no cambian; las filas en USD se ignoran', () => {
    const pro = { clave: 'pro', precio_por_unidad: new D('3.00'), tramo_desde: 61, tramo_precio: new D('2.00') };
    const filaUsd = { plan_clave: 'pro', moneda: 'USD', precio_por_unidad: new D('99'), tramo_precio_por_unidad: new D('98'), updated_at: AHORA };
    const ref = { precios: [filaUsd], tipoCambio: new D('3.8') };
    assert.equal(precioEnMoneda(pro, 'USD', ref)?.toFixed(2), '0.79', 'manda el precio convertido, no la fila');
    assert.deepEqual([tramoEnMoneda(pro, 'USD', ref)?.desde, tramoEnMoneda(pro, 'USD', ref)?.precio.toFixed(2)], [61, '0.53']);
    assert.equal(precioEnMoneda(pro, 'USD', { precios: [filaUsd], tipoCambio: null }), null, 'sin tipo de cambio: Consúltanos (aunque haya fila)');
    assert.equal(tramoEnMoneda(pro, 'USD', { precios: [filaUsd], tipoCambio: null }), null);
    assert.equal(precioEnMoneda(pro, 'PEN', ref)?.toFixed(2), '3.00', 'soles: el del plan');
    assert.equal(precioEnMoneda({ clave: 'gratis', precio_por_unidad: new D(0) }, 'USD', { precios: [], tipoCambio: null })?.toFixed(2), '0.00', 'gratis es gratis en todas partes');
    assert.equal(tramoEnMoneda({ ...pro, tramo_desde: null, tramo_precio: null }, 'USD', ref), null, 'sin tramo en el plan, precio único');
  });

  it('/api/publico/planes?pais=AR con tipo de cambio 3,8: Pro 0,79, Administradora 0,66, Básico 0,39, Gratis 0,00; mínimo de Pro 20 × 0,79 = 15,80; IVA 21 %', async () => {
    const c = (await llamar(base, 'GET', '/api/publico/planes?pais=AR')).body;
    assert.deepEqual([c.pais, c.moneda, c.impuesto], ['AR', 'USD', { nombre: 'IVA', tasa: '0.21' }]);
    const por = (k: string) => c.planes.find((p: { clave: string }) => p.clave === k);
    assert.deepEqual(['pro', 'administradora', 'basico', 'gratis'].map((k) => [por(k).precio_por_unidad, por(k).consultar]), [['0.79', false], ['0.66', false], ['0.39', false], ['0.00', false]]);
    assert.equal(por('pro').total_minimo_mes, '15.80');
    assert.equal((await planPublico('pro', '?pais=PE')).precio_por_unidad, '3.00', 'Perú sigue en soles, sin tocar');
  });

  it('con tramo en el plan, el tramo también se convierte: desde el 61 a 2,00 soles = 0,53 US$', async () => {
    await prisma.planComercial.update({ where: { clave: 'pro' }, data: { tramo_desde: 61, tramo_precio: '2.00' } });
    const p = await planPublico('pro', '?pais=AR');
    assert.deepEqual([p.precio_por_unidad, p.tramo_desde, p.tramo_precio], ['0.79', 61, '0.53']);
    const pe = await planPublico('pro', '?pais=PE');
    assert.deepEqual([pe.precio_por_unidad, pe.tramo_desde, pe.tramo_precio], ['3.00', 61, '2.00']);
  });

  it('sin tipo de cambio guardado: «Consúltanos» (precio null) salvo Gratis; Perú no se entera', async () => {
    await fijarEnBase(null);
    const c = (await llamar(base, 'GET', '/api/publico/planes?pais=AR')).body;
    const por = (k: string) => c.planes.find((p: { clave: string }) => p.clave === k);
    assert.deepEqual([por('pro').precio_por_unidad, por('pro').consultar, por('pro').total_minimo_mes], [null, true, null]);
    assert.deepEqual([por('gratis').precio_por_unidad, por('gratis').consultar], ['0.00', false]);
    assert.equal(c.moneda, 'USD');
    assert.deepEqual([(await planPublico('pro', '?pais=PE')).precio_por_unidad, (await planPublico('pro', '?pais=PE')).consultar], ['3.00', false]);
    const cot = (await llamar(base, 'GET', '/api/publico/cotizar?unidades=100&plan=pro&pais=AR')).body;
    assert.deepEqual([cot.consultar, cot.total_mes, cot.total_con_igv_mes, cot.moneda], [true, null, null, 'USD']);
  });

  it('cotizar en Argentina: 100 deptos en Pro = 79,00 + IVA 16,59 = 95,59 US$ al mes; con el tramo (desde el 61 a 0,53) = 68,60 + 14,41 = 83,01', async () => {
    const a = (await llamar(base, 'GET', '/api/publico/cotizar?unidades=100&plan=pro&pais=AR')).body;
    assert.deepEqual([a.moneda, a.impuesto_nombre, a.consultar, a.total_mes, a.igv_mes, a.total_con_igv_mes], ['USD', 'IVA', false, '79.00', '16.59', '95.59']);
    await prisma.planComercial.update({ where: { clave: 'pro' }, data: { tramo_desde: 61, tramo_precio: '2.00' } });
    const b = (await llamar(base, 'GET', '/api/publico/cotizar?unidades=100&plan=pro&pais=AR')).body;
    assert.deepEqual([b.unidades_tramo, b.tramo_precio, b.total_mes, b.igv_mes, b.total_con_igv_mes], [40, '0.53', '68.60', '14.41', '83.01']);
    const pe = (await llamar(base, 'GET', '/api/publico/cotizar?unidades=100&plan=pro&pais=PE')).body;
    assert.deepEqual([pe.moneda, pe.total_mes], ['PEN', '260.00'], 'Perú: 60 × 3,00 + 40 × 2,00');
  });

  it('un cambio del tipo de cambio mueve el precio en el acto (3,9 → 0,77); una fila de precio en USD o en la moneda propia del país NO manda', async () => {
    await prisma.precioPlanMoneda.createMany({ data: [{ plan_clave: 'pro', moneda: 'USD', precio_por_unidad: '99' }, { plan_clave: 'pro', moneda: 'ARS', precio_por_unidad: '7777' }] });
    assert.equal((await planPublico('pro', '?pais=AR')).precio_por_unidad, '0.79');
    await fijarEnBase('3.9');
    assert.equal((await planPublico('pro', '?pais=AR')).precio_por_unidad, '0.77');
  });

  it('Mi plan de un condominio argentino: cotiza en USD al tipo de cambio y puede pedir Pro; sin tipo de cambio no se puede pedir (422 «Consúltanos») y el plan sale por consultar', async () => {
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { pais: 'AR', moneda: 'ARS' } });
    await prisma.suscripcionCondominio.create({ data: { complejo_id: d.complejoA.id, plan_clave: 'pro', estado: 'activa', vigente_hasta: new Date(AHORA.getTime() + 30 * 86_400_000) } });
    const a = (await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminA)).body.condominios[0];
    assert.deepEqual([a.pais, a.moneda, a.precio_consultar], ['AR', 'USD', false]);
    assert.equal(a.cotizacion.base, new D('0.79').times(a.unidades_cobradas).toFixed(2));
    assert.equal(a.cotizacion.moneda, 'USD');
    assert.deepEqual(a.planes_disponibles, ['basico', 'pro', 'administradora']);
    const ok = await llamar(base, 'POST', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, T.adminA, { plan: 'administradora' });
    assert.equal(ok.status, 200, ok.texto);
    assert.equal(ok.body.solicitud.cotizacion.moneda, 'USD');
    await fijarEnBase(null);
    const sin = (await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminA)).body.condominios[0];
    assert.deepEqual([sin.precio_consultar, sin.planes_disponibles], [true, []]);
    const mal = await llamar(base, 'POST', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, T.adminA, { plan: 'pro' });
    assert.equal(mal.status, 422, mal.texto);
    assert.match(mal.body.error, /consúltanos/i);
  });

  it('lo ya contratado no cambia: un pago registrado en pesos queda con su moneda y su monto aunque el país pase a dólares y el tipo de cambio cambie', async () => {
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { pais: 'CL', moneda: 'CLP' } });
    const pago = await prisma.pagoSuscripcion.create({ data: { complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, monto_base: '38000', igv: '7220', monto: '45220', moneda: 'CLP', impuesto_nombre: 'IVA', impuesto_tasa: '0.19', fecha_pago: AHORA, medio: 'transferencia', periodo_desde: AHORA, periodo_hasta: new Date(AHORA.getTime() + 30 * 86_400_000), registrado_por_id: d.superadmin.id } });
    await prisma.impuestoPais.update({ where: { pais: 'CL' }, data: { moneda: 'CLP' } });
    const informe = await ajustarMonedaDeCobro(prisma);
    assert.deepEqual(informe.cambios, [{ pais: 'CL', de: 'CLP', a: 'USD' }]);
    assert.deepEqual(informe.pagos_en_otra_moneda, [{ moneda: 'CLP', cantidad: 1 }], 'se informa, no se toca');
    await fijarEnBase('4.1');
    const despues = await prisma.pagoSuscripcion.findUniqueOrThrow({ where: { id: pago.id } });
    assert.deepEqual([despues.moneda, despues.monto.toString(), despues.monto_base.toString(), despues.impuesto_tasa.toString()], ['CLP', '45220', '38000', '0.19']);
    const hist = (await llamar(base, 'GET', `/api/comercial/suscripciones/${d.complejoA.id}/pagos`, T.super)).body.items[0];
    assert.deepEqual([hist.moneda, hist.monto], ['CLP', '45220']);
  });
});

describe('el script de moneda de cobro: idempotente, con --seco no escribe', () => {
  const comoAntes = async () => {
    for (const [pais, moneda] of [['AR', 'ARS'], ['CL', 'CLP'], ['MX', 'MXN'], ['EC', 'USD']] as const) await prisma.impuestoPais.update({ where: { pais }, data: { moneda } });
  };

  it('--seco informa los cambios y no escribe nada', async () => {
    await comoAntes();
    const informe = await ajustarMonedaDeCobro(prisma, { seco: true });
    assert.deepEqual(informe.cambios.map((c) => `${c.pais}:${c.de}>${c.a}`), ['AR:ARS>USD', 'CL:CLP>USD', 'MX:MXN>USD']);
    assert.deepEqual((await prisma.impuestoPais.findMany({ where: { pais: { in: ['AR', 'CL', 'MX'] } }, orderBy: { pais: 'asc' } })).map((f) => f.moneda), ['ARS', 'CLP', 'MXN']);
  });

  it('aplica: todos los países ≠ Perú quedan en USD con su impuesto intacto; la segunda corrida no cambia nada', async () => {
    await comoAntes();
    await prisma.impuestoPais.update({ where: { pais: 'AR' }, data: { tasa: '0.25' } });
    const a = await ajustarMonedaDeCobro(prisma);
    assert.equal(a.cambios.length, 3);
    const filas = await prisma.impuestoPais.findMany();
    for (const f of filas) assert.equal(f.moneda, f.pais === 'PE' ? 'PEN' : 'USD', f.pais);
    assert.equal(filas.find((f) => f.pais === 'AR')!.tasa.toString(), '0.25', 'el impuesto no se toca');
    const b = await ajustarMonedaDeCobro(prisma);
    assert.deepEqual(b.cambios, []);
    assert.equal((await ajustarMonedaDeCobro(prisma, { seco: true })).cambios.length, 0);
  });

  it('el script existe con --seco y no corre solo al importarlo', () => {
    const s = readFileSync('scripts/moneda-cobro-usd.ts', 'utf8');
    assert.match(s, /--seco/);
    assert.match(s, /ajustarMonedaDeCobro\(prisma, \{ seco \}\)/);
    assert.match(s, /process\.argv\[1\] === fileURLToPath\(import\.meta\.url\)/);
  });
});

describe('la lectura automática: una pasada de la tarea', () => {
  it('sin valor: lee de la fuente, guarda valor, fecha y fuente; pide la URL pública sin clave', async () => {
    await fijarEnBase(null);
    const llamadas = fuente(respuesta(3.7456));
    assert.equal(await pasadaDeTipoCambio(), 'actualizado');
    assert.deepEqual(llamadas, [FUENTE_TIPO_CAMBIO_URL]);
    assert.match(FUENTE_TIPO_CAMBIO_URL, /^https:\/\/open\.er-api\.com\/v6\/latest\/USD$/);
    const c = await config();
    assert.deepEqual([c.tipo_cambio_usd!.toString(), c.tipo_cambio_manual, c.tipo_cambio_fuente, c.tipo_cambio_at!.toISOString()], ['3.7456', false, FUENTE_TIPO_CAMBIO, AHORA.toISOString()]);
  });

  it('guarda con 4 decimales (3,745678 → 3,7457)', async () => {
    await fijarEnBase(null);
    fuente(respuesta(3.745678));
    await pasadaDeTipoCambio();
    assert.equal((await config()).tipo_cambio_usd!.toString(), '3.7457');
  });

  it('con un valor de menos de 24 h no vuelve a leer; con más de 24 h, sí', async () => {
    const llamadas = fuente(respuesta(3.7));
    await fijarEnBase('3.8', { tipo_cambio_at: new Date(AHORA.getTime() - (MAX_EDAD_MS - 60_000)) });
    assert.equal(await pasadaDeTipoCambio(), 'vigente');
    assert.equal(llamadas.length, 0);
    await fijarEnBase('3.8', { tipo_cambio_at: new Date(AHORA.getTime() - (MAX_EDAD_MS + 60_000)) });
    assert.equal(await pasadaDeTipoCambio(), 'actualizado');
    assert.equal(llamadas.length, 1);
    assert.equal((await config()).tipo_cambio_usd!.toString(), '3.7');
  });

  it('un valor sin fecha cuenta como viejo y se lee', async () => {
    await fijarEnBase('3.8', { tipo_cambio_at: null });
    fuente(respuesta(3.71));
    assert.equal(await pasadaDeTipoCambio(), 'actualizado');
  });

  it('en manual NO lo pisa: ni siquiera pide la fuente, aunque tenga mucho más de 24 h', async () => {
    const llamadas = fuente(respuesta(3.2));
    await fijarEnBase('3.8', { tipo_cambio_manual: true, tipo_cambio_fuente: 'manual', tipo_cambio_at: new Date(AHORA.getTime() - 90 * 24 * HORA) });
    assert.equal(await pasadaDeTipoCambio(), 'manual');
    assert.equal(llamadas.length, 0);
    const c = await config();
    assert.deepEqual([c.tipo_cambio_usd!.toString(), c.tipo_cambio_manual, c.tipo_cambio_fuente], ['3.8', true, 'manual']);
  });

  it('si el superadmin lo fija a mano mientras se lee la fuente, esa elección gana (el UPDATE va condicionado a «no manual»)', async () => {
    await fijarEnBase('3.8', { tipo_cambio_at: new Date(AHORA.getTime() - 2 * MAX_EDAD_MS) });
    tipoCambioDeps.fetch = async () => {
      await prisma.configuracionComercial.update({ where: { id: 1 }, data: { tipo_cambio_usd: '4.2', tipo_cambio_manual: true, tipo_cambio_fuente: 'manual', tipo_cambio_at: AHORA } });
      return new Response(JSON.stringify(respuesta(3.5)));
    };
    assert.equal(await pasadaDeTipoCambio(), 'manual');
    assert.deepEqual([(await config()).tipo_cambio_usd!.toString(), (await config()).tipo_cambio_manual], ['4.2', true]);
  });

  const malas: [string, () => void][] = [
    ['la fuente responde 500', () => fuente({ result: 'error' }, 500)],
    ['la respuesta no es JSON', () => fuente('<html>caído</html>')],
    ['la fuente dice result: error', () => fuente({ result: 'error', 'error-type': 'quota-reached' })],
    ['falta rates.PEN', () => fuente({ result: 'success', rates: { USD: 1 } })],
    ['PEN es un texto', () => fuente(respuesta('mucho'))],
    ['PEN es 0', () => fuente(respuesta(0))],
    ['PEN es 1,5 (por debajo de 2)', () => fuente(respuesta(1.5))],
    ['PEN es 9 (por encima de 6)', () => fuente(respuesta(9))],
    ['PEN es negativo', () => fuente(respuesta(-3.7))],
    ['PEN es null', () => fuente(respuesta(null))],
    ['la red falla', () => { tipoCambioDeps.fetch = async () => { throw new TypeError('fetch failed'); }; }],
  ];
  for (const [nombre, preparar] of malas) {
    it(`si falla (${nombre}) deja el último valor, lo registra en el log y no lanza`, async () => {
      const log = mock.method(console, 'error', () => undefined);
      await fijarEnBase('3.8', { tipo_cambio_at: new Date(AHORA.getTime() - 2 * MAX_EDAD_MS) });
      preparar();
      assert.equal(await pasadaDeTipoCambio(), 'fallo');
      const c = await config();
      assert.deepEqual([c.tipo_cambio_usd!.toString(), c.tipo_cambio_fuente, c.tipo_cambio_at!.toISOString()], ['3.8', FUENTE_TIPO_CAMBIO, new Date(AHORA.getTime() - 2 * MAX_EDAD_MS).toISOString()], 'nada cambia');
      assert.equal(log.mock.callCount(), 1);
      assert.match(String(log.mock.calls[0].arguments[0]), /\[tipo-cambio\]/);
    });
  }

  it('tipoCambioValido: 2 y 6 entran; 1,99 y 6,01 no; texto y NaN no; redondea a 4 decimales', () => {
    assert.equal(tipoCambioValido(2)?.toString(), '2');
    assert.equal(tipoCambioValido('6')?.toString(), '6');
    assert.equal(tipoCambioValido('3.75')?.toString(), '3.75');
    assert.equal(tipoCambioValido(3.123456)?.toString(), '3.1235');
    for (const mal of [1.99, 6.01, '1.99', '6.01', 'abc', '', NaN, Infinity, null, undefined, {}, '3,75', '-3', '3e0']) assert.equal(tipoCambioValido(mal), null, String(mal));
  });

  it('la tarea sólo corre en producción (o con TIPO_CAMBIO_AUTO=on); las pruebas la apagan; se arranca desde server.ts', () => {
    assert.equal(tipoCambioAutoActivo({ NODE_ENV: 'test' }), false);
    assert.equal(tipoCambioAutoActivo({ NODE_ENV: 'production' }), true);
    assert.equal(tipoCambioAutoActivo({ NODE_ENV: 'production', TIPO_CAMBIO_AUTO: 'off' }), false);
    assert.equal(tipoCambioAutoActivo({ NODE_ENV: 'development', TIPO_CAMBIO_AUTO: 'on' }), true);
    assert.equal(process.env.TIPO_CAMBIO_AUTO, 'off', 'el entorno de pruebas la apaga');
    assert.match(readFileSync('src/server.ts', 'utf8'), /^\s*iniciarTipoCambio\(\);/m);
  });
});

describe('el superadmin ve y edita el tipo de cambio (auditado; sólo superadmin)', () => {
  it('GET: valor, modo, fecha y fuente; el admin de empresa y el propietario no entran (403)', async () => {
    const r = await llamar(base, 'GET', '/api/comercial/tipo-cambio', T.super);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual([r.body.tipo_cambio, r.body.manual, r.body.fuente, r.body.actualizado_en], ['3.8', false, FUENTE_TIPO_CAMBIO, new Date(AHORA.getTime() - HORA).toISOString()]);
    assert.equal((await llamar(base, 'GET', '/api/comercial/tipo-cambio', T.adminA)).status, 403);
    assert.equal((await llamar(base, 'GET', '/api/comercial/tipo-cambio', T.prop1)).status, 403);
    assert.equal((await llamar(base, 'GET', '/api/comercial/tipo-cambio')).status, 401);
  });

  it('PUT a mano: pasa a manual con fuente «manual» y fecha de ahora, mueve los precios en el acto y queda en la auditoría (valor anterior y nuevo)', async () => {
    const r = await llamar(base, 'PUT', '/api/comercial/tipo-cambio', T.super, { tipo_cambio: '3.9' });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual([r.body.tipo_cambio, r.body.manual, r.body.fuente, r.body.actualizado_en], ['3.9', true, 'manual', AHORA.toISOString()]);
    assert.equal((await planPublico('pro', '?pais=AR')).precio_por_unidad, '0.77');
    const a = await prisma.auditoria.findFirst({ where: { entidad: 'tipo_cambio', accion: 'editar' } });
    assert.ok(a);
    assert.equal(a.usuario_id, d.superadmin.id);
    assert.deepEqual(a.detalle, { modo: 'manual', anterior: '3.8', nuevo: '3.9' });
    assert.equal((await llamar(base, 'PUT', '/api/comercial/tipo-cambio', T.super, { tipo_cambio: 3.85 })).body.tipo_cambio, '3.85', 'también acepta un número');
  });

  it('a mano y luego la tarea diaria: el valor manual NO se pisa', async () => {
    await llamar(base, 'PUT', '/api/comercial/tipo-cambio', T.super, { tipo_cambio: '3.9' });
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { tipo_cambio_at: new Date(AHORA.getTime() - 5 * MAX_EDAD_MS) } });
    const llamadas = fuente(respuesta(3.3));
    assert.equal(await pasadaDeTipoCambio(), 'manual');
    assert.equal(llamadas.length, 0);
    assert.equal((await config()).tipo_cambio_usd!.toString(), '3.9');
  });

  it('PUT {automatico: true}: vuelve a automático y lo refresca EN ESE MOMENTO; queda auditado', async () => {
    await llamar(base, 'PUT', '/api/comercial/tipo-cambio', T.super, { tipo_cambio: '3.9' });
    const llamadas = fuente(respuesta(3.7321));
    const r = await llamar(base, 'PUT', '/api/comercial/tipo-cambio', T.super, { automatico: true });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual([r.body.tipo_cambio, r.body.manual, r.body.fuente], ['3.7321', false, FUENTE_TIPO_CAMBIO]);
    assert.equal(llamadas.length, 1);
    assert.equal((await planPublico('pro', '?pais=AR')).precio_por_unidad, '0.80');
    const a = await prisma.auditoria.findMany({ where: { entidad: 'tipo_cambio' }, orderBy: { id: 'asc' } });
    assert.deepEqual(a.map((x) => x.detalle), [{ modo: 'manual', anterior: '3.8', nuevo: '3.9' }, { modo: 'automatico', anterior: '3.9', nuevo: '3.7321' }]);
  });

  it('PUT {automatico: true} con la fuente caída: 502, nada cambia (sigue en manual con su valor) y no hay auditoría de esa llamada', async () => {
    mock.method(console, 'error', () => undefined);
    await llamar(base, 'PUT', '/api/comercial/tipo-cambio', T.super, { tipo_cambio: '3.9' });
    fuente({ result: 'error' }, 503);
    const r = await llamar(base, 'PUT', '/api/comercial/tipo-cambio', T.super, { automatico: true });
    assert.equal(r.status, 502, r.texto);
    assert.match(r.body.error, /fuente/);
    const c = await config();
    assert.deepEqual([c.tipo_cambio_usd!.toString(), c.tipo_cambio_manual, c.tipo_cambio_fuente], ['3.9', true, 'manual']);
    assert.equal(await prisma.auditoria.count({ where: { entidad: 'tipo_cambio' } }), 1, 'sólo la del valor a mano');
  });

  it('datos inválidos → 422 con el campo: fuera de 2–6, texto, vacío, nada, los dos a la vez, automatico:false; nada se guarda', async () => {
    for (const mal of [{ tipo_cambio: '1' }, { tipo_cambio: '1.99' }, { tipo_cambio: '6.01' }, { tipo_cambio: '37' }, { tipo_cambio: 'abc' }, { tipo_cambio: '' }, { tipo_cambio: '-3' }, { tipo_cambio: '3,75' }, {}, { tipo_cambio: '3.8', automatico: true }, { automatico: false }, { automatico: 'si' }]) {
      const r = await llamar(base, 'PUT', '/api/comercial/tipo-cambio', T.super, mal);
      assert.equal(r.status, 422, `${JSON.stringify(mal)} → ${r.status} ${r.texto}`);
    }
    assert.equal((await config()).tipo_cambio_usd!.toString(), '3.8');
    assert.equal(await prisma.auditoria.count({ where: { entidad: 'tipo_cambio' } }), 0);
    const r = await llamar(base, 'PUT', '/api/comercial/tipo-cambio', T.super, { tipo_cambio: '9' });
    assert.ok(r.body.campos?.tipo_cambio, 'dice qué campo falla');
  });

  it('nadie más lo cambia: admin de empresa y propietario 403, sin sesión 401; nada se guarda', async () => {
    assert.equal((await llamar(base, 'PUT', '/api/comercial/tipo-cambio', T.adminA, { tipo_cambio: '3.9' })).status, 403);
    assert.equal((await llamar(base, 'PUT', '/api/comercial/tipo-cambio', T.prop1, { tipo_cambio: '3.9' })).status, 403);
    assert.equal((await llamar(base, 'PUT', '/api/comercial/tipo-cambio', null, { tipo_cambio: '3.9' })).status, 401);
    assert.equal((await config()).tipo_cambio_usd!.toString(), '3.8');
  });

  it('el tipo de cambio NO se cuela por PUT /configuracion (sus campos se ignoran: sólo la ruta propia lo valida)', async () => {
    const r = await llamar(base, 'PUT', '/api/comercial/configuracion', T.super, { dias_gracia: 8, tipo_cambio_usd: '9.99', tipo_cambio_manual: true, tipo_cambio_fuente: 'hack' });
    assert.equal(r.status, 200, r.texto);
    const c = await config();
    assert.deepEqual([c.dias_gracia, c.tipo_cambio_usd!.toString(), c.tipo_cambio_manual, c.tipo_cambio_fuente], [8, '3.8', false, FUENTE_TIPO_CAMBIO]);
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { dias_gracia: 7 } });
  });

  it('el catálogo del superadmin trae el tipo de cambio y los precios en dólares ya convertidos (sin editar); sin tipo de cambio la lista va vacía', async () => {
    await prisma.planComercial.update({ where: { clave: 'pro' }, data: { tramo_desde: 61, tramo_precio: '2.00' } });
    await prisma.precioPlanMoneda.create({ data: { plan_clave: 'pro', moneda: 'USD', precio_por_unidad: '99' } });
    const c = (await llamar(base, 'GET', '/api/comercial/catalogo', T.super)).body;
    assert.deepEqual([c.configuracion.tipo_cambio_usd, c.configuracion.tipo_cambio_manual, c.configuracion.tipo_cambio_fuente], ['3.8', false, FUENTE_TIPO_CAMBIO]);
    const por = (k: string) => c.precios_usd.find((p: { plan_clave: string }) => p.plan_clave === k);
    assert.deepEqual([por('pro').precio_por_unidad, por('pro').tramo_precio_por_unidad, por('administradora').precio_por_unidad, por('administradora').tramo_precio_por_unidad, por('basico').precio_por_unidad], ['0.79', '0.53', '0.66', null, '0.39'], 'manda el convertido, no la fila de 99');
    assert.equal(c.precios_usd.every((p: { moneda: string }) => p.moneda === 'USD'), true);
    assert.equal(por('gratis'), undefined);
    await fijarEnBase(null);
    assert.deepEqual((await llamar(base, 'GET', '/api/comercial/catalogo', T.super)).body.precios_usd, []);
  });

  it('preciosEnDolares: sin tipo de cambio sale vacío y Gratis/cortesía no entran', () => {
    const planes = [{ clave: 'gratis', precio_por_unidad: new D(0), tramo_desde: null, tramo_precio: null }, { clave: 'pro', precio_por_unidad: new D('3'), tramo_desde: null, tramo_precio: null }];
    assert.deepEqual(preciosEnDolares(planes, { precios: [], tipoCambio: null }), []);
    assert.deepEqual(preciosEnDolares(planes, { precios: [], tipoCambio: new D('4') }), [{ plan_clave: 'pro', moneda: 'USD', precio_por_unidad: '0.75', tramo_precio_por_unidad: null }]);
  });

  it('el precio en dólares no se fija a mano: PUT …/precios/USD → 422; quitar una fila vieja en USD sí se puede; las otras monedas siguen igual', async () => {
    const r = await llamar(base, 'PUT', '/api/comercial/planes/pro/precios/USD', T.super, { precio_por_unidad: '1.00' });
    assert.equal(r.status, 422, r.texto);
    assert.equal(await prisma.precioPlanMoneda.count({ where: { moneda: 'USD' } }), 0);
    await prisma.precioPlanMoneda.create({ data: { plan_clave: 'pro', moneda: 'USD', precio_por_unidad: '99' } });
    assert.equal((await llamar(base, 'DELETE', '/api/comercial/planes/pro/precios/USD', T.super)).status, 204);
    assert.equal((await llamar(base, 'PUT', '/api/comercial/planes/pro/precios/COP', T.super, { precio_por_unidad: '8000' })).status, 200);
  });
});
