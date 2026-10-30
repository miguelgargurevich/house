// Multimoneda (fase 2): país y moneda por condominio; los montos salen con la moneda de SU condominio y nunca se suman entre monedas.
// Datos: Complejo A (empresa A) y Complejo B (empresa B) de `sembrar()`. Cada bloque deja las monedas como las encontró.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import { esperar, iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { encolarAviso } from '../src/server/services/avisos';
import { informeDeMora, montoMoraTexto } from '../src/server/services/mora';
import { cargarDatos, bloqueDe } from '../src/server/services/asistente/contexto';
import { ejecutarHerramienta } from '../src/server/tools';
import { alertaAgua } from '../src/server/lib/agua';
import { PROMPT_SISTEMA, promptSistema, parsearLectura, type Lectura } from '../src/server/lib/lecturaComprobante';
import { contrastar, contrastarMonto } from '../src/server/services/contraste';
import { lecturaOcrEnMoneda, leerVoucherDeTexto } from '../src/server/services/ocrVoucher';
import { historialXlsx } from '../src/server/lib/historialExcel';
import type { AuthUser } from '../src/server/middleware/auth';
import XLSX from 'xlsx';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1' | 'propB', string>;

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    super: await login(base, 'super@test.pe'),
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    prop1: await login(base, 'prop1@test.pe'),
    propB: await login(base, 'propb@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

const ponerMoneda = (complejoId: number, moneda: string, pais?: string) => prisma.complejoHabitacional.update({ where: { id: complejoId }, data: { moneda, ...(pais ? { pais } : {}) } });
/** Los `datos` de una herramienta que respondió bien. */
const datosDe = (r: Awaited<ReturnType<typeof ejecutarHerramienta>>): Record<string, unknown> => {
  assert.ok(r.ok, JSON.stringify(r));
  return (r as { datos: Record<string, unknown> }).datos;
};
const comoUsuario = async (email: string): Promise<AuthUser> => {
  const u = await prisma.usuario.findUniqueOrThrow({ where: { email } });
  return { id: u.id, email: u.email, rol: u.rol, empresa_id: u.empresa_id, complejo_id: u.complejo_id, estructura_id: null, cargo_junta: null } as unknown as AuthUser;
};

describe('condominios: país y moneda', () => {
  beforeEach(async () => {
    await prisma.complejoHabitacional.deleteMany({ where: { nombre: { startsWith: 'Nuevo ' } } });
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { pais: 'PE' } });
  });

  it('un condominio nuevo sin país ni moneda nace con el país de su empresa y la moneda de ese país', async () => {
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { pais: 'CL' } });
    const r = await llamar(base, 'POST', '/api/complejos', T.adminA, { nombre: 'Nuevo Santiago', tipo: 'Edificio' });
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual([r.body.pais, r.body.moneda], ['CL', 'CLP']);
  });

  it('con país elegido propone su moneda; la moneda explícita manda sobre la del país', async () => {
    const mx = await llamar(base, 'POST', '/api/complejos', T.adminA, { nombre: 'Nuevo Mexico', tipo: 'Edificio', pais: 'MX' });
    assert.deepEqual([mx.body.pais, mx.body.moneda], ['MX', 'MXN']);
    // Gratis incluye un condominio por administradora: el segundo lo crea el superadmin (sin ese límite); lo que se prueba es la moneda.
    const usd = await llamar(base, 'POST', '/api/complejos', T.super, { nombre: 'Nuevo Lima USD', tipo: 'Edificio', pais: 'PE', moneda: 'USD', empresa_id: d.empresaA.id });
    assert.deepEqual([usd.body.pais, usd.body.moneda], ['PE', 'USD']);
  });

  it('el superadmin también elige país y moneda (y el país por defecto es el de la empresa elegida)', async () => {
    await prisma.empresaAdministradora.update({ where: { id: d.empresaB.id }, data: { pais: 'CO' } });
    const r = await llamar(base, 'POST', '/api/complejos', T.super, { nombre: 'Nuevo Bogota', tipo: 'Edificio', empresa_id: d.empresaB.id });
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual([r.body.pais, r.body.moneda], ['CO', 'COP']);
    await prisma.empresaAdministradora.update({ where: { id: d.empresaB.id }, data: { pais: 'PE' } });
  });

  it('país o moneda fuera del catálogo → 422 con el campo', async () => {
    const a = await llamar(base, 'POST', '/api/complejos', T.adminA, { nombre: 'Nuevo Malo', tipo: 'Edificio', pais: 'ZZ' });
    assert.equal(a.status, 422);
    assert.ok(a.body.campos.pais, JSON.stringify(a.body));
    const b = await llamar(base, 'POST', '/api/complejos', T.adminA, { nombre: 'Nuevo Malo', tipo: 'Edificio', moneda: 'XXX' });
    assert.equal(b.status, 422);
    assert.ok(b.body.campos.moneda, JSON.stringify(b.body));
    const c = await llamar(base, 'PUT', `/api/complejos/${d.complejoA.id}`, T.adminA, { moneda: 'pen' });
    assert.equal(c.status, 422, 'el código va en mayúsculas, como el catálogo');
  });

  it('sin recibos la moneda se puede cambiar; queda en la auditoría', async () => {
    const n = await llamar(base, 'POST', '/api/complejos', T.adminA, { nombre: 'Nuevo Sin Recibos', tipo: 'Edificio' });
    const r = await llamar(base, 'PUT', `/api/complejos/${n.body.id}`, T.adminA, { moneda: 'USD' });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.moneda, 'USD');
    const aud = await esperar(() => prisma.auditoria.findFirst({ where: { entidad: 'complejo', entidad_id: n.body.id, accion: { in: ['actualizar', 'editar', 'update', 'PUT'] } }, orderBy: { id: 'desc' } }).then((x) => x ?? prisma.auditoria.findFirst({ where: { entidad: 'complejo', entidad_id: n.body.id }, orderBy: { id: 'desc' } })));
    assert.ok(JSON.stringify(aud.detalle).includes('USD'), JSON.stringify(aud));
  });

  it('con recibos emitidos, cambiar la moneda → 409 con el mensaje; la moneda queda igual', async () => {
    const r = await llamar(base, 'PUT', `/api/complejos/${d.complejoA.id}`, T.adminA, { moneda: 'USD' });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'Este condominio ya tiene recibos en PEN; no se puede cambiar');
    assert.equal((await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: d.complejoA.id } })).moneda, 'PEN');
  });

  it('con recibos sí se puede repetir la misma moneda y cambiar el país', async () => {
    const r = await llamar(base, 'PUT', `/api/complejos/${d.complejoA.id}`, T.adminA, { moneda: 'PEN', pais: 'EC', nombre: 'Complejo A' });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual([r.body.pais, r.body.moneda], ['EC', 'PEN']);
    await ponerMoneda(d.complejoA.id, 'PEN', 'PE');
  });

  it('un admin no cambia la moneda del condominio de otra empresa (404)', async () => {
    const r = await llamar(base, 'PUT', `/api/complejos/${d.complejoB.id}`, T.adminA, { moneda: 'USD' });
    assert.equal(r.status, 404);
  });

  it('la empresa elige su país (y sólo uno del catálogo)', async () => {
    const ok = await llamar(base, 'PUT', `/api/empresas/${d.empresaA.id}`, T.adminA, { pais: 'AR' });
    assert.equal(ok.status, 200, ok.texto);
    assert.equal(ok.body.pais, 'AR');
    const mal = await llamar(base, 'PUT', `/api/empresas/${d.empresaA.id}`, T.adminA, { pais: 'XX' });
    assert.equal(mal.status, 422);
    const ajena = await llamar(base, 'PUT', `/api/empresas/${d.empresaB.id}`, T.adminA, { pais: 'AR' });
    assert.equal(ajena.status, 404);
  });

  it('el listado trae país y moneda de cada condominio', async () => {
    const r = await llamar(base, 'GET', '/api/complejos', T.adminA);
    const a = r.body.items.find((c: { id: number }) => c.id === d.complejoA.id);
    assert.deepEqual([a.pais, a.moneda], ['PE', 'PEN']);
  });
});

describe('las respuestas con montos llevan la moneda del condominio', () => {
  before(() => ponerMoneda(d.complejoB.id, 'USD', 'US'));
  after(() => ponerMoneda(d.complejoB.id, 'PEN', 'PE'));

  it('recibos: lista, detalle, periodos y totales por block', async () => {
    const lista = await llamar(base, 'GET', '/api/recibos', T.adminB);
    assert.equal(lista.status, 200);
    assert.ok(lista.body.items.length > 0 && lista.body.items.every((r: { moneda: string }) => r.moneda === 'USD'));
    const det = await llamar(base, 'GET', `/api/recibos/${d.reciboB.id}`, T.adminB);
    assert.equal(det.body.moneda, 'USD');
    const per = await llamar(base, 'GET', '/api/recibos/periodos', T.adminB);
    assert.ok(per.body.items.length > 0 && per.body.items.every((r: { moneda: string }) => r.moneda === 'USD'));
    const blocks = await llamar(base, 'GET', `/api/recibos/${d.reciboB.id}/blocks`, T.adminB);
    assert.equal(blocks.body.moneda, 'USD');
    const a = await llamar(base, 'GET', `/api/recibos/${d.reciboVencidoA.id}`, T.adminA);
    assert.equal(a.body.moneda, 'PEN', 'el otro condominio sigue en soles');
  });

  it('mantenimientos: lista y detalle del periodo, y los del residente', async () => {
    const lista = await llamar(base, 'GET', `/api/recibos/${d.reciboB.id}/mantenimientos`, T.adminB);
    assert.equal(lista.status, 200, lista.texto);
    assert.ok(lista.body.items.length > 0 && lista.body.items.every((m: { moneda: string }) => m.moneda === 'USD'));
    const det = await llamar(base, 'GET', `/api/recibos/${d.reciboB.id}/mantenimientos/${d.unidadB1.id}`, T.adminB);
    assert.equal(det.status, 200, det.texto);
    assert.equal(det.body.moneda, 'USD');
    assert.equal(det.body.condominio.moneda, 'USD');
    const mios = await llamar(base, 'GET', '/api/me/mantenimientos', T.propB);
    assert.ok(mios.body.items.length > 0 && mios.body.items.every((m: { moneda: string }) => m.moneda === 'USD'));
    const detRes = await llamar(base, 'GET', `/api/me/mantenimientos/${d.reciboB.id}/${d.unidadB1.id}`, T.propB);
    assert.equal(detRes.body.moneda, 'USD');
    const cargos = await llamar(base, 'GET', '/api/me/cargos', T.propB);
    assert.ok(cargos.body.items.every((c: { moneda: string; recibo: { complejo?: unknown } }) => c.moneda === 'USD' && c.recibo.complejo === undefined));
  });

  it('pagos: cada fila lleva su moneda', async () => {
    await prisma.pago.create({ data: { recibo_concepto_unidad_id: d.cargoB1.id, monto: 30, metodo_pago: 'efectivo', estado_validacion: 'validado' } });
    const r = await llamar(base, 'GET', '/api/pagos', T.adminB);
    assert.equal(r.status, 200);
    assert.ok(r.body.items.length > 0 && r.body.items.every((p: { moneda: string }) => p.moneda === 'USD'));
    const mios = await llamar(base, 'GET', '/api/me/pagos', T.propB);
    assert.ok(mios.body.items.every((p: { moneda: string }) => p.moneda === 'USD'));
    await prisma.pago.deleteMany({ where: { recibo_concepto_unidad_id: d.cargoB1.id } });
  });

  it('morosidad y dashboard de una administradora con una sola moneda: lo de siempre + `moneda`', async () => {
    const mor = await llamar(base, 'GET', '/api/reportes/morosidad', T.adminB);
    assert.equal(mor.status, 200, mor.texto);
    assert.equal(mor.body.resumen.moneda, 'USD');
    assert.equal(mor.body.resumen.deuda_total, '90.00');
    assert.ok(mor.body.items.every((f: { moneda: string }) => f.moneda === 'USD'));
    const dash = await llamar(base, 'GET', '/api/dashboard/resumen', T.adminB);
    assert.equal(dash.body.moneda, 'USD');
    assert.equal(dash.body.cargos_pendientes_monto, '90.00');
    assert.equal(dash.body.por_moneda, undefined);
    assert.ok(dash.body.por_torre.every((t: { moneda: string }) => t.moneda === 'USD'));
  });

  it('historial del residente: moneda arriba y en cada mes; el Excel rotula con su símbolo', async () => {
    const h = await llamar(base, 'GET', '/api/me/historial', T.propB);
    assert.equal(h.status, 200, h.texto);
    assert.equal(h.body.moneda, 'USD');
    assert.ok(h.body.meses.length > 0 && h.body.meses.every((m: { moneda: string }) => m.moneda === 'USD'));
    assert.equal(h.body.resumen.deuda_actual, '90.00');
    const x = await fetch(`${base}/api/me/historial.xlsx`, { headers: { cookie: `house_sesion=${T.propB.split('.')[0]}` } });
    const libro = XLSX.read(Buffer.from(await x.arrayBuffer()));
    const filas = XLSX.utils.sheet_to_json<string[]>(libro.Sheets.Resumen!, { header: 1 }).map((f) => String(f[0]));
    assert.ok(filas.includes('Deuda de hoy (US$)'), filas.join(' | '));
    assert.ok(!filas.some((f) => f.includes('(S/)')));
  });

  it('el Excel del historial con unidades de dos monedas no las mezcla (un bloque por moneda)', () => {
    const mes = (moneda: string) => ({ recibo_id: 1, anio: 2026, mes: 10, unidad: { id: 1, codigo: 'X' }, moneda, total: '10.00', por_concepto: [{ concepto: 'Agua', monto: '10.00' }], pagado: '0.00', saldo: '10.00', estado: 'pendiente' as const, fecha_vencimiento: '2026-10-15', fecha_pago: null, dias_vs_vencimiento: null, agua_m3: null, agua_promedio_block: null });
    const h = {
      unidades: [], anios: [2026], anio: 2026, moneda: null,
      resumen: { pagado: null, promedio_mes: null, deuda_actual: null, en_revision: null, por_moneda: { PEN: { pagado: '0.00', promedio_mes: '0.00', deuda_actual: '10.00', en_revision: '0.00' }, USD: { pagado: '0.00', promedio_mes: '0.00', deuda_actual: '20.00', en_revision: '0.00' } }, meses_a_tiempo: 0, meses_evaluados: 0, meses_en_periodo: 1, agua_promedio_m3: null },
      meses: [mes('PEN'), mes('USD')],
    };
    const libro = XLSX.read(historialXlsx(h as never));
    const filas = XLSX.utils.sheet_to_json<(string | number)[]>(libro.Sheets.Resumen!, { header: 1 });
    const rot = filas.map((f) => String(f[0]));
    assert.ok(rot.includes('Deuda de hoy (S/)') && rot.includes('Deuda de hoy (US$)'));
    assert.equal(filas.find((f) => f[0] === 'Deuda de hoy (US$)')![1], 20);
    assert.equal(filas.find((f) => f[0] === 'Deuda de hoy (S/)')![1], 10);
  });
});

describe('agregados con dos monedas: nunca se suman', () => {
  before(() => ponerMoneda(d.complejoB.id, 'USD', 'US'));
  after(() => ponerMoneda(d.complejoB.id, 'PEN', 'PE'));

  it('dashboard del superadmin: sin total único; por moneda y por torre', async () => {
    const r = await llamar(base, 'GET', '/api/dashboard/resumen', T.super);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.moneda, null);
    assert.equal(r.body.cargos_pendientes_monto, null);
    assert.equal(r.body.cobrado_mes, null);
    assert.deepEqual(r.body.cobrado_por_mes, []);
    assert.deepEqual(Object.keys(r.body.por_moneda).sort(), ['PEN', 'USD']);
    assert.equal(r.body.por_moneda.PEN.cargos_pendientes_monto, '500.00'); // 150 + 200 + 150 de la empresa A
    assert.equal(r.body.por_moneda.USD.cargos_pendientes_monto, '90.00');
    assert.ok(r.body.por_moneda.USD.cobrado_por_mes.length > 0);
    assert.equal(r.body.morosos, 3, 'los conteos sí son de todo');
  });

  it('el mismo dashboard filtrado por un condominio vuelve a dar una sola moneda', async () => {
    const r = await llamar(base, 'GET', `/api/dashboard/resumen?complejo_id=${d.complejoB.id}`, T.super);
    assert.equal(r.body.moneda, 'USD');
    assert.equal(r.body.cargos_pendientes_monto, '90.00');
    assert.equal(r.body.por_moneda, undefined);
  });

  it('morosidad del superadmin sin filtro: `deuda_total` en null y las cifras por moneda', async () => {
    const r = await llamar(base, 'GET', '/api/reportes/morosidad', T.super);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.resumen.deuda_total, null);
    assert.equal(r.body.resumen.moneda, null);
    assert.equal(r.body.resumen.por_moneda.PEN.deuda_total, '300.00');
    assert.equal(r.body.resumen.por_moneda.USD.deuda_total, '90.00');
    assert.equal(r.body.resumen.unidades, 3);
    assert.deepEqual(r.body.items.map((f: { moneda: string }) => f.moneda).sort(), ['PEN', 'PEN', 'USD']);
  });

  it('un residente con unidades en dos monedas ve su deuda y lo pagado por moneda, y el historial sin total único', async () => {
    const extra = await prisma.unidad.create({ data: { codigo: 'B-201', tipo: 'Departamento', complejo_id: d.complejoB.id, empresa_id: d.empresaB.id, propietario_id: d.propietario1.id, estado: 'activa' } });
    const rc = await prisma.reciboConcepto.findFirstOrThrow({ where: { recibo_id: d.reciboB.id } });
    await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: extra.id, monto: 40, estado_pago: 'pendiente' } });
    try {
      const r = await llamar(base, 'GET', '/api/dashboard/resumen', T.prop1);
      assert.equal(r.status, 200, r.texto);
      assert.equal(r.body.moneda, null);
      assert.equal(r.body.deuda_total, null);
      assert.equal(r.body.por_moneda.PEN.deuda_total, '350.00');
      assert.equal(r.body.por_moneda.USD.deuda_total, '40.00');
      const h = await llamar(base, 'GET', '/api/me/historial', T.prop1);
      assert.equal(h.body.moneda, null);
      assert.equal(h.body.resumen.deuda_actual, null);
      assert.equal(h.body.resumen.por_moneda.PEN.deuda_actual, '350.00');
      assert.equal(h.body.resumen.por_moneda.USD.deuda_actual, '40.00');
      const una = await llamar(base, 'GET', `/api/me/historial?unidad_id=${extra.id}`, T.prop1);
      assert.equal(una.body.moneda, 'USD');
      assert.equal(una.body.resumen.deuda_actual, '40.00');
    } finally {
      await prisma.reciboConceptoUnidad.deleteMany({ where: { unidad_id: extra.id } });
      await prisma.unidad.delete({ where: { id: extra.id } });
    }
  });

  it('las herramientas del asistente avisan: moneda en null y las monedas listadas', async () => {
    const adm = await comoUsuario('super@test.pe');
    const datos = datosDe(await ejecutarHerramienta(adm, 'resumen_cobranza', {}, { origen: 'asistente' }));
    assert.equal(datos.moneda, null);
    assert.deepEqual(datos.monedas, ['PEN', 'USD']);
    assert.match(String(datos.nota_monedas), /NO se pueden sumar/);
  });
});

describe('textos del servidor con el símbolo de la moneda', () => {
  before(() => ponerMoneda(d.complejoB.id, 'USD', 'US'));
  after(async () => {
    await ponerMoneda(d.complejoB.id, 'PEN', 'PE');
    await prisma.notificacion.deleteMany();
  });

  it('aviso por un cargo de un condominio en dólares: «US$ 90.00»; el de soles sigue en «S/»', async () => {
    await prisma.notificacion.deleteMany();
    assert.equal(await encolarAviso('pago_validado', d.propietarioB.id, { entidad: 'cargo', id: d.cargoB1.id }), 1);
    assert.equal(await encolarAviso('pago_validado', d.propietario1.id, { entidad: 'cargo', id: d.cargoVencidoA1.id }), 1);
    const n = await prisma.notificacion.findMany({ orderBy: { id: 'asc' } });
    assert.match(n[0]!.cuerpo, /US\$ 90\.00/);
    assert.ok(!/S\//.test(n[0]!.cuerpo), n[0]!.cuerpo);
    assert.match(n[1]!.cuerpo, /S\/ 150\.00/);
  });

  it('aviso de un recibo con la mora del condominio: la mora y el monto en dólares', async () => {
    await prisma.notificacion.deleteMany();
    await prisma.complejoHabitacional.update({ where: { id: d.complejoB.id }, data: { mora_monto: 20 } });
    await prisma.reciboConceptoUnidad.update({ where: { id: d.cargoB1.id }, data: { estado_pago: 'pendiente' } });
    const recibo = await prisma.recibo.update({ where: { id: d.reciboB.id }, data: { fecha_vencimiento: new Date(Date.now() + 3 * 86_400_000) } });
    await prisma.suscripcionCondominio.updateMany({ where: { complejo_id: d.complejoB.id }, data: { plan_clave: 'cortesia' } });
    assert.equal(await encolarAviso('por_vencer', d.propietarioB.id, { entidad: 'recibo', id: recibo.id }), 1);
    const n = await prisma.notificacion.findFirstOrThrow();
    assert.match(n.cuerpo, /US\$ 90\.00/);
    assert.match(n.cuerpo, /mora de US\$ 20/);
    assert.ok(!/S\//.test(n.cuerpo), n.cuerpo);
  });

  it('mora: entero sin decimales, con decimales y en cada moneda', () => {
    assert.equal(montoMoraTexto(new Prisma.Decimal(20)), 'S/ 20');
    assert.equal(montoMoraTexto(new Prisma.Decimal(20), 'USD'), 'US$ 20');
    assert.equal(montoMoraTexto(new Prisma.Decimal('20.5'), 'USD'), 'US$ 20.50');
    assert.equal(montoMoraTexto(new Prisma.Decimal(20), 'EUR'), '20 €');
    assert.equal(montoMoraTexto(new Prisma.Decimal(15000), 'CLP'), '$ 15.000');
    const u = [{ id: 1, codigo: 'B-1', torre: null }];
    assert.equal(informeDeMora(new Prisma.Decimal(20), [{ reciboId: 1, torre: null, unidades: u }], 'USD').mensaje, 'Se agregó mora de US$ 20 a 1 departamento: B-1');
    assert.equal(informeDeMora(new Prisma.Decimal(20), [{ reciboId: 1, torre: null, unidades: u }]).mensaje, 'Se agregó mora de S/ 20 a 1 departamento: B-1');
  });

  it('contexto del asistente: la deuda del vecino va en dólares y nunca en soles', async () => {
    const { datos } = { datos: await cargarDatos(await comoUsuario('propb@test.pe')) };
    assert.deepEqual(datos.residente!.deuda_total, [{ moneda: 'USD', monto: '90.00' }]);
    const bloque = bloqueDe(datos);
    assert.match(bloque, /Deuda total \(incluye lo que está en revisión\): US\$ 90\.00/);
    assert.ok(!bloque.includes('S/ 90.00'));
    const adm = bloqueDe(await cargarDatos(await comoUsuario('admin.b@test.pe')));
    assert.match(adm, /Por cobrar: US\$ 90\.00/);
  });

  it('herramientas: la moneda del alcance de quien consulta (no un «PEN» fijo)', async () => {
    const usd = datosDe(await ejecutarHerramienta(await comoUsuario('propb@test.pe'), 'mi_deuda', {}, { origen: 'asistente' }));
    assert.equal(usd.moneda, 'USD');
    assert.equal(usd.nota_monedas, undefined);
    const pen = datosDe(await ejecutarHerramienta(await comoUsuario('prop1@test.pe'), 'mi_deuda', {}, { origen: 'asistente' }));
    assert.equal(pen.moneda, 'PEN');
  });

  it('la alerta del agua dice el monto en la moneda del condominio', () => {
    assert.equal(alertaAgua('70.60', '70.58'), null);
    assert.equal(alertaAgua('80.00', '70.00', 'USD'), 'El agua del recibo es US$ 70.00; con la lectura sale US$ 80.00');
    assert.equal(alertaAgua('80.00', '70.00'), 'El agua del recibo es S/ 70.00; con la lectura sale S/ 80.00');
  });
});

describe('IA de vouchers: la moneda esperada', () => {
  const L = (x: object) => ({ monto: 100, moneda: 'PEN', ...x }) as never;

  it('el prompt de soles no cambia; el de otra moneda dice qué es un «$» sin más', () => {
    assert.equal(promptSistema('PEN'), PROMPT_SISTEMA);
    assert.equal(promptSistema(undefined), PROMPT_SISTEMA);
    const clp = promptSistema('CLP');
    assert.notEqual(clp, PROMPT_SISTEMA);
    assert.match(clp, /un "\$" sin más es CLP \(Peso chileno\)/);
    assert.match(clp, /"PEN" \| "USD"/);
    assert.ok(clp.includes('REGLAS DE SEGURIDAD') && clp.includes('IGNÓRALO por completo'), 'las reglas de seguridad siguen');
    assert.equal(clp.split('\n').length, PROMPT_SISTEMA.split('\n').length, 'sólo cambia la línea de la moneda');
  });

  it('la lectura acepta cualquier moneda del catálogo y rechaza las demás', () => {
    const base = { es_comprobante_de_pago: true, legible: true, medio: 'transferencia', estado_operacion: 'exitosa', monto: 15000, fecha: null, numero_operacion: null, destinatario_nombre: null, destino_numero: null };
    assert.ok(parsearLectura(JSON.stringify({ ...base, moneda: 'CLP' })));
    assert.ok(parsearLectura(JSON.stringify({ ...base, moneda: 'PEN' })));
    assert.equal(parsearLectura(JSON.stringify({ ...base, moneda: 'XYZ' })), null);
  });

  it('el monto se compara en la moneda del condominio', () => {
    assert.equal(contrastarMonto(L({ moneda: 'PEN' }), '100.00'), true);
    assert.equal(contrastarMonto(L({ moneda: 'USD' }), '100.00'), false, 'soles esperados, comprobante en dólares');
    assert.equal(contrastarMonto(L({ moneda: 'USD' }), '100.00', 'USD'), true, 'dólares esperados y dólares leídos');
    assert.equal(contrastarMonto(L({ moneda: 'PEN' }), '100.00', 'USD'), false, 'dólares esperados, comprobante en soles');
    assert.equal(contrastarMonto(L({ moneda: 'CLP', monto: 15000 }), '15000.00', 'CLP'), true);
    assert.equal(contrastarMonto(L({ moneda: null }), '100.00', 'USD'), null);
  });

  it('el OCR no puede distinguir un «$» de un condominio en pesos: queda sin moneda; con soles o dólares esperados no cambia', () => {
    const usd = leerVoucherDeTexto('Transferencia exitosa\n22 oct. 2026\nMonto US$ 150.00\nNumero de operacion 1234567')!.lectura;
    assert.equal(usd.moneda, 'USD');
    assert.equal(lecturaOcrEnMoneda(usd, 'PEN'), usd);
    assert.equal(lecturaOcrEnMoneda(usd, 'USD'), usd);
    assert.equal(lecturaOcrEnMoneda(usd, 'CLP').moneda, null, 'un «$» podría ser pesos chilenos');
    assert.equal(contrastarMonto(lecturaOcrEnMoneda(usd, 'CLP'), '150.00', 'CLP'), null, 'sin moneda no se compara: lo decide una persona');
    const pen = { ...usd, moneda: 'PEN' as const };
    assert.equal(lecturaOcrEnMoneda(pen, 'CLP').moneda, 'PEN', 'un «S/» sí es soles, y no son pesos');
  });

  it('las alertas nombran la moneda que sobra', () => {
    const lectura = { es_comprobante_de_pago: true, legible: true, medio: 'transferencia', estado_operacion: 'exitosa', monto: 100, moneda: 'PEN', fecha: null, numero_operacion: null, destinatario_nombre: null, destino_numero: null, mensaje: null } as unknown as Lectura;
    const hoy = new Date(Date.UTC(2026, 9, 20));
    const dup = { archivoEnPago: null, operacionEnPago: null };
    const usd = contrastar(lectura, { monto: '100.00', moneda: 'USD', emision: hoy, hoy }, [], dup);
    assert.ok(usd.alertas.includes('El comprobante está en soles, no en dólares'), usd.alertas.join(' | '));
    assert.notEqual(usd.veredicto, 'coincide');
    const pen = contrastar({ ...lectura, moneda: 'USD' }, { monto: '100.00', emision: hoy, hoy }, [], dup);
    assert.ok(pen.alertas.includes('El comprobante está en dólares'), pen.alertas.join(' | '));
  });
});
