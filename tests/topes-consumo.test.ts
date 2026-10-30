// Topes mensuales de consumo por condominio (asistente de IA y WhatsApp). El tope del mes es el valor del plan × las unidades que se cobran.
// Se reserva ANTES de gastar, con un incremento atómico: pasar el tope a la vez no es posible. Nada sale a la red: los canales y el modelo van inyectados.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import type { DepsAvisos } from '../src/server/services/avisos/canales';
import { canalesDeps } from '../src/server/services/canales/deps';
import { responder } from '../src/server/services/canales/evolution';
import { procesarCola } from '../src/server/services/avisos/cola';
import { MOTIVO_TOPE_WHATSAPP, periodoDe, reservarConsumo, topeDelMes, usoDelMes } from '../src/server/services/comercial/consumo';
import { ajustarOfertaGratisPro } from '../src/server/services/comercial/oferta';
import { invalidarComercial } from '../src/server/services/comercial/modulos';
import { llaveroDeps } from '../src/server/services/llavero';

const DIA = 86_400_000;
const AHORA = () => new Date();

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1', string>;

// Ningún modelo ni canal real: cada llamada queda contada.
let llamadasIA = 0;
const iaOriginal = llaveroDeps.fetch;
const canalesOriginal = { fetch: canalesDeps.fetch, env: canalesDeps.env };
let llamadasWhatsapp: string[] = [];
let llamadasCorreo = 0;

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'), prop1: await login(base, 'prop1@test.pe') };
  llaveroDeps.fetch = (async () => { llamadasIA++; return new Response('{}', { status: 500 }); }) as typeof fetch;
});
after(async () => {
  llaveroDeps.fetch = iaOriginal;
  canalesDeps.fetch = canalesOriginal.fetch;
  canalesDeps.env = canalesOriginal.env;
  await cerrar();
  await prisma.$disconnect();
});

/** Pasa el condominio A a Pro con los topes dados. Sus unidades son 2 (A-101 y A-102), así que sin mínimo el tope es valor × 2. */
async function ponerPro(asistente: number | null, whatsapp: number | null, minimo: number | null = null) {
  await prisma.planComercial.update({ where: { clave: 'pro' }, data: { asistente_por_unidad_mes: asistente, whatsapp_por_unidad_mes: whatsapp, unidades_minimas: minimo } });
  await prisma.suscripcionCondominio.upsert({
    where: { complejo_id: d.complejoA.id },
    create: { complejo_id: d.complejoA.id, plan_clave: 'pro', modulos: [], estado: 'activa', es_prueba: false, vigente_hasta: new Date(Date.now() + 60 * DIA) },
    update: { plan_clave: 'pro', modulos: [], estado: 'activa', es_prueba: false, vigente_hasta: new Date(Date.now() + 60 * DIA) },
  });
  invalidarComercial();
}
/** Gasta `n` unidades del recurso en el mes en curso, como si ya se hubiera consultado tanto. */
const gastar = async (recurso: 'asistente' | 'whatsapp', n: number) => {
  for (let i = 0; i < n; i++) await reservarConsumo(d.complejoA.id, recurso, AHORA());
};

beforeEach(async () => {
  await prisma.consumoMensual.deleteMany({});
  await prisma.notificacion.deleteMany({ where: { usuario_id: d.propietario1.id } });
  llamadasIA = 0;
  invalidarComercial();
});

describe('reserva del tope: atómica y por mes', () => {
  it('tope 2: cuatro reservas a la vez → pasan exactamente 2 y la cuenta queda en 2', async () => {
    await ponerPro(1, null);
    assert.equal(await topeDelMes(d.complejoA.id, 'asistente'), 2);
    const rs = await Promise.all([1, 2, 3, 4].map(() => reservarConsumo(d.complejoA.id, 'asistente', AHORA())));
    assert.equal(rs.filter((r) => r.permitido).length, 2);
    const fila = await prisma.consumoMensual.findFirstOrThrow({ where: { complejo_id: d.complejoA.id, recurso: 'asistente' } });
    assert.equal(fila.cantidad, 2);
  });

  it('el tope es valor × unidades que se cobran: con mínimo de 20, se cobran 20 aunque haya 2', async () => {
    await ponerPro(1, null, 20);
    assert.equal(await topeDelMes(d.complejoA.id, 'asistente'), 20);
  });

  it('cambio de mes: el contador empieza de cero', async () => {
    await ponerPro(1, null);
    await gastar('asistente', 2);
    assert.equal((await reservarConsumo(d.complejoA.id, 'asistente', AHORA())).permitido, false);
    const siguiente = await reservarConsumo(d.complejoA.id, 'asistente', new Date(Date.now() + 40 * DIA));
    assert.equal(siguiente.permitido, true);
    assert.equal(siguiente.usadas, 1);
  });

  it('sin tope (null) no cuenta ni bloquea', async () => {
    await ponerPro(null, null);
    for (let i = 0; i < 5; i++) assert.equal((await reservarConsumo(d.complejoA.id, 'asistente', AHORA())).permitido, true);
    assert.equal(await prisma.consumoMensual.count({ where: { complejo_id: d.complejoA.id } }), 0);
  });

  it('el periodo es AAAAMM de Lima: el mes que se cuenta sale de la hora de Lima', () => {
    assert.match(periodoDe(new Date('2026-11-01T04:30:00Z')), /^202610$/, '23:30 del 31 de octubre en Lima');
  });
});

describe('uso del mes en Mi plan', () => {
  it('el endpoint dice cuánto va de cada tope y cuál es', async () => {
    await ponerPro(1, 3);
    await gastar('asistente', 2);
    const r = await llamar(base, 'GET', `/api/comercial/mi-plan/${d.complejoA.id}/uso`, T.adminA);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.body.asistente, { usadas: 2, tope: 2 });
    assert.deepEqual(r.body.whatsapp, { usadas: 0, tope: 6 });
  });

  it('otra empresa no ve el uso: 404', async () => {
    await ponerPro(1, 3);
    const r = await llamar(base, 'GET', `/api/comercial/mi-plan/${d.complejoA.id}/uso`, T.adminB);
    assert.equal(r.status, 404, r.texto);
  });

  it('usoDelMes sin tope lo dice con null', async () => {
    await ponerPro(null, null);
    const u = await usoDelMes(d.complejoA.id, AHORA());
    assert.deepEqual([u.asistente.tope, u.whatsapp.tope], [null, null]);
  });
});

describe('asistente pasado el tope: responde sin llamar al modelo', () => {
  it('el admin recibe el mes que viene y el camino a Mi plan; el modelo no se llama', async () => {
    await ponerPro(1, null);
    await gastar('asistente', 2);
    const r = await llamar(base, 'POST', '/api/ai-chat', T.adminA, { message: '¿Cuánto debo?' });
    assert.equal(r.status, 429, r.texto);
    const texto = typeof r.body.error === 'string' ? r.body.error : r.body.error?.message;
    assert.match(texto, /^Este condominio usó las consultas al asistente de este mes\. Se renuevan el 1 de [a-záéíóú]+\. Puedes subir el límite desde Mi plan\.$/);
    assert.equal(llamadasIA, 0);
  });

  it('el residente recibe lo mismo sin la línea de Mi plan', async () => {
    await ponerPro(1, null);
    await gastar('asistente', 2);
    const r = await llamar(base, 'POST', '/api/ai-chat', T.prop1, { message: '¿Cuánto debo?' });
    assert.equal(r.status, 429, r.texto);
    const texto = typeof r.body.error === 'string' ? r.body.error : r.body.error?.message;
    assert.match(texto, /^Este condominio usó las consultas al asistente de este mes\. Se renuevan el 1 de [a-záéíóú]+\.$/);
    assert.equal(llamadasIA, 0);
  });
});

describe('el condominio que carga la consulta', () => {
  it('con el selector en un condominio sin tope, la consulta no cuenta contra el de la otra; sin elegir, cuenta contra el primero', async () => {
    await ponerPro(1, null);
    await gastar('asistente', 2);
    const a2 = await prisma.complejoHabitacional.create({ data: { nombre: 'Complejo A2', tipo: 'Edificio', empresa_id: d.empresaA.id } });
    await prisma.suscripcionCondominio.create({ data: { complejo_id: a2.id, plan_clave: 'cortesia', modulos: ['ia_vouchers', 'whatsapp_avisos', 'asistente'], estado: 'activa' } });
    try {
      const sinElegir = await llamar(base, 'POST', '/api/ai-chat', T.adminA, { message: 'hola' });
      assert.equal(sinElegir.status, 429, sinElegir.texto);
      const elegido = await llamar(base, 'POST', '/api/ai-chat', T.adminA, { message: 'hola', complejo_id: a2.id });
      assert.notEqual(elegido.status, 429, 'el condominio elegido no tiene tope');
      assert.doesNotMatch(JSON.stringify(elegido.body), /usó las consultas al asistente/, 'no es el mensaje de tope');
    } finally {
      await prisma.complejoHabitacional.delete({ where: { id: a2.id } });
    }
  });

  it('elegir un condominio que no es de la administradora → 404', async () => {
    await ponerPro(1, null);
    const r = await llamar(base, 'POST', '/api/ai-chat', T.adminB, { message: 'hola', complejo_id: d.complejoA.id });
    assert.equal(r.status, 404, r.texto);
  });
});

describe('los límites y la oferta', () => {
  it('un tope mayor de 1000 por departamento → 422 con el campo', async () => {
    const r = await llamar(base, 'PUT', '/api/comercial/planes/pro', T.super, { asistente_por_unidad_mes: 1001 });
    assert.equal(r.status, 422, r.texto);
    assert.ok(r.body.campos?.asistente_por_unidad_mes, JSON.stringify(r.body));
  });

  it('la oferta pone los topes de fábrica a Pro y Administradora, y deja Cortesía y Gratis sin tope', async () => {
    await prisma.planComercial.update({ where: { clave: 'pro' }, data: { asistente_por_unidad_mes: null, whatsapp_por_unidad_mes: null } });
    await ajustarOfertaGratisPro(prisma);
    for (const clave of ['pro', 'administradora']) {
      const p = await prisma.planComercial.findUniqueOrThrow({ where: { clave } });
      assert.deepEqual([p.asistente_por_unidad_mes, p.whatsapp_por_unidad_mes], [5, 6], clave);
    }
    for (const clave of ['gratis', 'cortesia']) {
      const p = await prisma.planComercial.findUniqueOrThrow({ where: { clave } });
      assert.deepEqual([p.asistente_por_unidad_mes, p.whatsapp_por_unidad_mes], [null, null], clave);
    }
  });
});

describe('WhatsApp pasado el tope: cae a correo, sin llamar al transporte de WhatsApp', () => {
  /** Un aviso por correo y uno por WhatsApp del mismo recibo, listos para la cola. */
  async function encolar() {
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: 'inst-a' } });
    await prisma.usuario.update({ where: { id: d.propietario1.id }, data: { telefono: '987654321', aviso_whatsapp: true } });
    const aviso = { usuario_id: d.propietario1.id, tipo: 'recordatorio', asunto: 'Tu recibo', cuerpo: 'Paga a tiempo.', ref_entidad: 'recibo', ref_id: d.reciboVencidoA.id };
    await prisma.notificacion.create({ data: { ...aviso, canal: 'email' } });
    await prisma.notificacion.create({ data: { ...aviso, canal: 'whatsapp' } });
  }
  const deps = (): DepsAvisos => ({
    ahora: () => new Date(),
    env: { EVOLUTION_URL: 'https://evo.test', EVOLUTION_APIKEY: 'clave-falsa', RESEND_API_KEY: 're_falsa', MAIL_FROM: 'House <h@ejemplo.test>' },
    fetch: (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('evo.test')) llamadasWhatsapp.push(u);
      else llamadasCorreo++;
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });
  beforeEach(() => { llamadasWhatsapp = []; llamadasCorreo = 0; });

  it('con el tope agotado: el WhatsApp queda omitido con su motivo, el correo sale y Evolution no se llama', async () => {
    await ponerPro(null, 1);
    await gastar('whatsapp', 2);
    await encolar();
    await procesarCola(deps());
    const wa = await prisma.notificacion.findFirstOrThrow({ where: { usuario_id: d.propietario1.id, canal: 'whatsapp' } });
    assert.equal(wa.estado, 'omitida');
    assert.equal(wa.error, MOTIVO_TOPE_WHATSAPP);
    const correo = await prisma.notificacion.findFirstOrThrow({ where: { usuario_id: d.propietario1.id, canal: 'email' } });
    assert.equal(correo.estado, 'enviada');
    assert.equal(llamadasCorreo, 1);
    assert.deepEqual(llamadasWhatsapp, []);
  });

  it('con tope libre: el WhatsApp sale y cuenta 1', async () => {
    await ponerPro(null, 1);
    await encolar();
    await procesarCola(deps());
    const wa = await prisma.notificacion.findFirstOrThrow({ where: { usuario_id: d.propietario1.id, canal: 'whatsapp' } });
    assert.equal(wa.estado, 'enviada');
    assert.equal(llamadasWhatsapp.length, 1);
    assert.equal((await usoDelMes(d.complejoA.id, AHORA())).whatsapp.usadas, 1);
  });
});

describe('respuestas del bot: cuentan contra WhatsApp sólo si son de un condominio', () => {
  beforeEach(() => {
    canalesDeps.env = { EVOLUTION_URL: 'https://evo.test', EVOLUTION_APIKEY: 'clave-falsa' };
    canalesDeps.fetch = (async (url: string | URL | Request) => { llamadasWhatsapp.push(String(url)); return new Response('{}', { status: 200 }); }) as typeof fetch;
    llamadasWhatsapp = [];
  });

  it('una respuesta del asistente con el tope agotado no sale', async () => {
    await ponerPro(null, 1);
    await gastar('whatsapp', 2);
    const r = await responder('inst-a', '987654321', 'Tu saldo es S/ 0.', { complejoId: d.complejoA.id });
    assert.equal(r[0]!.resultado, 'omitida');
    assert.deepEqual(llamadasWhatsapp, []);
  });

  it('un código de vinculación (sin condominio) no cuenta ni se frena', async () => {
    await ponerPro(null, 1);
    await gastar('whatsapp', 2);
    const r = await responder('inst-a', '987654321', 'Tu código es 123456.');
    assert.equal(r[0]!.resultado, 'ok');
    assert.equal(llamadasWhatsapp.length, 1);
  });
});
