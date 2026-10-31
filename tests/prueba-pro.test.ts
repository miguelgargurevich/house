// Prueba de Pro al registrarse (reverse trial): el condominio nace en Pro por `dias_prueba_pro` días; al vencer vuelve a Gratis AL INSTANTE
// (sin días de gracia ni aviso de «vencida»). Pagar o solicitar Pro funciona igual que siempre; pagar apaga la prueba.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { registrarConCondominio } from './helpers/registro';
import type { DepsAvisos } from '../src/server/services/avisos/canales';
import { comercialCorreo } from '../src/server/services/comercial/configuracion';
import { estadoEfectivo, type EntradaSuscripcion } from '../src/server/services/comercial/estado';
import { invalidarComercial, moduloActivo } from '../src/server/services/comercial/modulos';
import { procesarVencimientos } from '../src/server/services/comercial/vencimientos';
import { hoyLima } from '../src/server/lib/fechas';

const DIA = 86_400_000;
const HOY = () => hoyLima().getTime();
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
/** 17:00 UTC = 12:00 en Lima del día de hoy: el reloj de las pruebas cae en el día que se espera. */
const ahoraEn = (dias: number) => new Date(HOY() + dias * DIA + 17 * 3_600_000);

const PLAZOS = { dias_gracia: 7, dias_aviso_vencimiento: 5 };
const PLANES = [
  { clave: 'gratis', modulos_incluidos: [] as string[], unidades_maximas: 20 as number | null },
  { clave: 'pro', modulos_incluidos: ['ia_vouchers', 'whatsapp_avisos', 'asistente', 'mora_automatica', 'reportes'], unidades_maximas: null },
];
const entrada = (over: Partial<EntradaSuscripcion> = {}): EntradaSuscripcion => ({
  plan_clave: 'pro', modulos: [], estado: 'activa', vigente_hasta: new Date(HOY() + 30 * DIA), solicitud_plan: null, solicitud_modulos: [], es_prueba: true, ...over,
});

// Lógica pura: el reloj se pasa como parámetro (no depende de la hora real).
describe('estado de una prueba de Pro (lógica pura)', () => {
  it('en prueba vigente: Pro completo, en_prueba y los días que faltan', () => {
    const ef = estadoEfectivo(entrada(), PLANES, PLAZOS, ahoraEn(0));
    assert.equal(ef.plan_clave, 'pro');
    assert.equal(ef.estado, 'activa');
    assert.equal(ef.en_prueba, true);
    assert.equal(ef.dias_para_vencer, 30);
    assert.deepEqual([...ef.modulos].sort(), ['asistente', 'ia_vouchers', 'mora_automatica', 'reportes', 'whatsapp_avisos']);
  });

  it('a 3 días de vencer: «por_vencer», sigue en prueba', () => {
    const ef = estadoEfectivo(entrada({ vigente_hasta: new Date(HOY() + 3 * DIA) }), PLANES, PLAZOS, ahoraEn(0));
    assert.equal(ef.estado, 'por_vencer');
    assert.equal(ef.en_prueba, true);
  });

  it('vencida la prueba: vuelve a Gratis al instante, sin gracia y sin apagar nada como «vencida»', () => {
    const ef = estadoEfectivo(entrada({ vigente_hasta: new Date(HOY() - 1 * DIA) }), PLANES, PLAZOS, ahoraEn(0));
    assert.equal(ef.plan_clave, 'gratis');
    assert.equal(ef.estado, 'gratis');
    assert.deepEqual(ef.modulos, []);
    assert.equal(ef.en_gracia, false);
    assert.equal(ef.apagada, false);
    assert.equal(ef.en_prueba, false);
  });

  it('un Pro pagado vencido sigue igual que antes: «vencida» con su gracia (la prueba no cambia nada de eso)', () => {
    const ef = estadoEfectivo(entrada({ es_prueba: false, vigente_hasta: new Date(HOY() - 1 * DIA) }), PLANES, PLAZOS, ahoraEn(0));
    assert.equal(ef.estado, 'vencida');
    assert.equal(ef.en_gracia, true);
    assert.equal(ef.en_prueba, false);
  });
});

// Base de datos y API.
let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA', string>;
let enviados: { para: string; asunto: string; cuerpo: string }[] = [];
const depsFalsas = (): DepsAvisos => ({
  ahora: () => ahoraEn(0),
  env: { RESEND_API_KEY: 're_falsa', MAIL_FROM: 'House <house@ejemplo.test>' },
  fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body));
    enviados.push({ para: b.to[0], asunto: b.subject, cuerpo: b.text });
    return new Response('{}', { status: 200 });
  }) as typeof fetch,
});
const depsOriginal = comercialCorreo.deps;

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, registroIp: 100, registroCorreo: 100 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe') };
  comercialCorreo.deps = depsFalsas;
});
after(async () => {
  comercialCorreo.deps = depsOriginal;
  await cerrar();
  await prisma.$disconnect();
});
afterEach(() => { enviados = []; });

/** Pone el condominio A en prueba de Pro (o la deja como esté si `vigente` es undefined). */
const ponerPrueba = (vigenteDias: number, extra: Record<string, unknown> = {}) =>
  prisma.suscripcionCondominio.upsert({
    where: { complejo_id: d.complejoA.id },
    create: { complejo_id: d.complejoA.id, plan_clave: 'pro', modulos: [], estado: 'activa', es_prueba: true, vigente_hasta: new Date(HOY() + vigenteDias * DIA), ...extra },
    update: { plan_clave: 'pro', modulos: [], estado: 'activa', es_prueba: true, vigente_hasta: new Date(HOY() + vigenteDias * DIA), solicitud_plan: null, solicitud_modulos: [], ...extra },
  });
const sesionA = () => prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: d.complejoA.id } });
const pagoBody = (over: Record<string, unknown> = {}) => ({ monto: '59.00', fecha_pago: iso(HOY()), medio: 'transferencia', operacion: `OP-${Math.random()}`, periodo_desde: iso(HOY()), periodo_hasta: iso(HOY() + 30 * DIA), ...over });

describe('registro: el condominio nace en Pro de prueba', () => {
  beforeEach(async () => { await prisma.configuracionComercial.update({ where: { id: 1 }, data: { dias_prueba_pro: 30 } }); invalidarComercial(); });

  it('con 30 días: Pro, es_prueba y vigente hasta hoy + 30 (día de Lima)', async () => {
    await registrarConCondominio(base, 'prueba30@casa.pe');
    const c = await prisma.complejoHabitacional.findFirstOrThrow({ where: { nombre: 'Condominio prueba30@casa.pe' } });
    const s = await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: c.id } });
    assert.equal(s.plan_clave, 'pro');
    assert.equal(s.estado, 'activa');
    assert.equal(s.es_prueba, true);
    assert.equal(iso(s.vigente_hasta!.getTime()), iso(HOY() + 30 * DIA));
  });

  it('con 0 días: sin prueba, nace en Gratis como antes', async () => {
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { dias_prueba_pro: 0 } });
    invalidarComercial();
    await registrarConCondominio(base, 'prueba0@casa.pe');
    const c = await prisma.complejoHabitacional.findFirstOrThrow({ where: { nombre: 'Condominio prueba0@casa.pe' } });
    const s = await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: c.id } });
    assert.equal(s.plan_clave, 'gratis');
    assert.equal(s.estado, 'gratis');
    assert.equal(s.es_prueba, false);
    assert.equal(s.vigente_hasta, null);
  });

  it('la configuración acepta de 0 a 90 días y sólo la cambia el superadmin', async () => {
    const malo = await llamar(base, 'PUT', '/api/comercial/configuracion', T.super, { dias_prueba_pro: 91 });
    assert.equal(malo.status, 422, malo.texto);
    const ajeno = await llamar(base, 'PUT', '/api/comercial/configuracion', T.adminA, { dias_prueba_pro: 45 });
    assert.equal(ajeno.status, 403, ajeno.texto);
    const ok = await llamar(base, 'PUT', '/api/comercial/configuracion', T.super, { dias_prueba_pro: 45 });
    assert.equal(ok.status, 200, ok.texto);
    assert.equal((await prisma.configuracionComercial.findUniqueOrThrow({ where: { id: 1 } })).dias_prueba_pro, 45);
  });
});

describe('la prueba en pantalla y en las puertas', () => {
  beforeEach(async () => { await prisma.suscripcionCondominio.deleteMany({ where: { complejo_id: d.complejoA.id } }); await darCortesiaA(); invalidarComercial(); });

  it('Mi plan marca la prueba con los días que faltan', async () => {
    await ponerPrueba(12);
    invalidarComercial();
    const r = await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminA);
    assert.equal(r.status, 200, r.texto);
    const c = r.body.condominios.find((x: { complejo_id: number }) => x.complejo_id === d.complejoA.id);
    assert.equal(c.en_prueba, true);
    assert.equal(c.dias_para_vencer, 12);
    assert.equal(c.plan.clave, 'pro');
  });

  it('al vencer, Mi plan y las puertas ya están en Gratis: el asistente se apaga sin esperar un aviso', async () => {
    await ponerPrueba(-1);
    invalidarComercial();
    const r = await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminA);
    const c = r.body.condominios.find((x: { complejo_id: number }) => x.complejo_id === d.complejoA.id);
    assert.equal(c.plan.clave, 'gratis');
    assert.equal(c.estado, 'gratis');
    assert.equal(c.en_prueba, false);
    assert.deepEqual(c.modulos_activos, []);
    assert.equal(await moduloActivo(d.complejoA.id, 'asistente'), false);
  });

  it('el aviso de la prueba que por vencer dice lo que pasa después y no manda el de «vencida»', async () => {
    await ponerPrueba(3);
    await procesarVencimientos({ ahora: ahoraEn(0), deps: depsFalsas() });
    const prueba = enviados.filter((c) => /prueba de Torre Pro/.test(c.asunto));
    assert.equal(prueba.length, 1, JSON.stringify(enviados.map((c) => c.asunto)));
    assert.match(prueba[0]!.cuerpo, /Tu prueba de Torre Pro termina el /);
    assert.match(prueba[0]!.cuerpo, /después sigues en Torre Gratis, sin perder datos\. Para seguir con la IA de vouchers, WhatsApp y reportes, pasa a Torre Pro desde Mi plan\./);
    assert.equal(enviados.some((c) => /venció|apagaron/.test(c.asunto)), false);
  });

  it('al vencer la prueba no sale ningún aviso de «vencida» ni de «apagada», y cada cosa se queda en Gratis', async () => {
    await ponerPrueba(-1);
    const luego = ahoraEn(9);
    await procesarVencimientos({ ahora: luego, deps: depsFalsas() });
    assert.equal(enviados.some((c) => /venció|apagaron/.test(c.asunto)), false, JSON.stringify(enviados.map((c) => c.asunto)));
    assert.equal((await sesionA()).estado, 'gratis');
  });

  it('pagar durante la prueba la convierte en un pago normal y apaga la marca de prueba', async () => {
    await ponerPrueba(5);
    const r = await llamar(base, 'POST', `/api/comercial/suscripciones/${d.complejoA.id}/pagos`, T.super, pagoBody({ periodo_hasta: iso(HOY() + 40 * DIA) }));
    assert.equal(r.status, 201, r.texto);
    const s = await sesionA();
    assert.equal(s.es_prueba, false);
    assert.equal(s.plan_clave, 'pro');
    assert.equal(iso(s.vigente_hasta!.getTime()), iso(HOY() + 40 * DIA));
  });

  it('solicitar Pro durante la prueba funciona igual; la prueba sigue hasta que se pague', async () => {
    await ponerPrueba(5);
    const r = await llamar(base, 'POST', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, T.adminA, { plan: 'administradora' });
    assert.equal(r.status, 200, r.texto);
    const s = await sesionA();
    assert.equal(s.solicitud_plan, 'administradora');
    assert.equal(s.es_prueba, true);
  });

  it('cuando el superadmin cambia el plan o la vigencia a mano, la prueba termina (no se pierde un pago manual)', async () => {
    await ponerPrueba(5);
    const r = await llamar(base, 'PATCH', `/api/comercial/suscripciones/${d.complejoA.id}`, T.super, { plan_clave: 'administradora' });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await sesionA()).es_prueba, false);
  });
});

/** Como sembrar: el condominio A de cortesía; cada prueba parte de ahí y deja la prueba de lo que hizo. */
async function darCortesiaA() {
  await prisma.suscripcionCondominio.create({ data: { complejo_id: d.complejoA.id, plan_clave: 'cortesia', modulos: ['ia_vouchers', 'whatsapp_avisos', 'asistente'], estado: 'activa' } });
}
