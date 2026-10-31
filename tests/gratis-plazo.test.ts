// Plan Gratis con plazo: `gratis_hasta` al registrarse (la prueba de Pro va DENTRO), el estado `solo_lectura`, la migración de una sola vez para los
// condominios que ya estaban en Gratis y los avisos al administrador (al aplicarse el plazo, 7 días antes y el día que vence), sin repetirse.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import type { DepsAvisos } from '../src/server/services/avisos/canales';
import { comercialCorreo } from '../src/server/services/comercial/configuracion';
import { estadoEfectivo, primerDiaSoloLectura, type EntradaSuscripcion } from '../src/server/services/comercial/estado';
import { migracionGratis, migracionInicial } from '../src/server/services/comercial/migracion';
import { invalidarComercial } from '../src/server/services/comercial/modulos';
import { plazoGratisNuevo, duracionTexto } from '../src/server/services/comercial/plazoGratis';
import { procesarVencimientos } from '../src/server/services/comercial/vencimientos';
import { hoyLima } from '../src/server/lib/fechas';

const DIA = 86_400_000;
const HOY = () => hoyLima().getTime();
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
/** 17:00 UTC = 12:00 en Lima del día de hoy + `dias`: el reloj de las pruebas cae en el día que se espera. */
const ahoraEn = (dias: number) => new Date(HOY() + dias * DIA + 17 * 3_600_000);

const PLAZOS = { dias_gracia: 7, dias_aviso_vencimiento: 5 };
const PLANES = [
  { clave: 'gratis', modulos_incluidos: [] as string[], unidades_maximas: 20 as number | null },
  { clave: 'basico', modulos_incluidos: [] as string[], unidades_maximas: 50 as number | null },
  { clave: 'pro', modulos_incluidos: ['ia_vouchers', 'whatsapp_avisos', 'asistente', 'mora_automatica', 'reportes'], unidades_maximas: null },
  { clave: 'cortesia', modulos_incluidos: ['ia_vouchers', 'whatsapp_avisos', 'asistente', 'mora_automatica', 'reportes'], unidades_maximas: null },
];
const gratis = (finDias: number | null, over: Partial<EntradaSuscripcion> = {}): EntradaSuscripcion => ({
  plan_clave: 'gratis', modulos: [], estado: 'gratis', vigente_hasta: null, solicitud_plan: null, solicitud_modulos: [], gratis_hasta: finDias == null ? null : new Date(HOY() + finDias * DIA), ...over,
});

// Lógica pura: el reloj se pasa como parámetro.
describe('solo lectura (lógica pura)', () => {
  it('Gratis con el plazo vigente no está en solo lectura; el último día gratis todavía opera y al día siguiente ya no', () => {
    assert.equal(estadoEfectivo(gratis(10), PLANES, PLAZOS, ahoraEn(0)).solo_lectura, false);
    assert.equal(estadoEfectivo(gratis(0), PLANES, PLAZOS, ahoraEn(0)).solo_lectura, false, 'hoy es el último día gratis');
    const ef = estadoEfectivo(gratis(0), PLANES, PLAZOS, ahoraEn(1));
    assert.equal(ef.solo_lectura, true);
    assert.equal(iso(ef.gratis_hasta!.getTime()), iso(HOY()));
    assert.equal(iso(primerDiaSoloLectura(ef.gratis_hasta!).getTime()), iso(HOY() + DIA));
  });

  it('sin plazo (gratis_hasta null) o sin suscripción nunca queda en solo lectura', () => {
    assert.equal(estadoEfectivo(gratis(null), PLANES, PLAZOS, ahoraEn(400)).solo_lectura, false);
    const sin = estadoEfectivo(null, PLANES, PLAZOS, ahoraEn(400));
    assert.deepEqual([sin.solo_lectura, sin.gratis_hasta], [false, null]);
  });

  it('la cortesía y la prueba de Pro vigente nunca, aunque su gratis_hasta ya haya pasado', () => {
    const cortesia = estadoEfectivo(gratis(-5, { plan_clave: 'cortesia', modulos: ['ia_vouchers'], estado: 'activa' }), PLANES, PLAZOS, ahoraEn(0));
    assert.equal(cortesia.solo_lectura, false);
    const prueba = estadoEfectivo(gratis(-1, { plan_clave: 'pro', estado: 'activa', es_prueba: true, vigente_hasta: new Date(HOY() + 3 * DIA) }), PLANES, PLAZOS, ahoraEn(0));
    assert.deepEqual([prueba.en_prueba, prueba.solo_lectura], [true, false]);
  });

  it('un plan de pago vigente o en gracia nunca; vencido y apagado vuelve a Gratis y, con el plazo pasado, queda en solo lectura de inmediato', () => {
    const pro = (vence: number) => gratis(-30, { plan_clave: 'pro', estado: 'activa', vigente_hasta: new Date(HOY() + vence * DIA) });
    assert.equal(estadoEfectivo(pro(20), PLANES, PLAZOS, ahoraEn(0)).solo_lectura, false, 'vigente');
    const enGracia = estadoEfectivo(pro(-3), PLANES, PLAZOS, ahoraEn(0));
    assert.deepEqual([enGracia.en_gracia, enGracia.solo_lectura], [true, false]);
    const apagado = estadoEfectivo(pro(-20), PLANES, PLAZOS, ahoraEn(0));
    assert.deepEqual([apagado.apagada, apagado.solo_lectura], [true, true]);
    // Si su gratis_hasta no ha pasado, apagado sigue operando como Gratis.
    assert.equal(estadoEfectivo(gratis(15, { plan_clave: 'pro', estado: 'activa', vigente_hasta: new Date(HOY() - 20 * DIA) }), PLANES, PLAZOS, ahoraEn(0)).solo_lectura, false);
  });

  it('una prueba de Pro vencida cuenta como Gratis: con el plazo pasado, solo lectura; con el plazo vigente, no', () => {
    const vencida = (fin: number) => gratis(fin, { plan_clave: 'pro', estado: 'activa', es_prueba: true, vigente_hasta: new Date(HOY() - 1 * DIA) });
    assert.equal(estadoEfectivo(vencida(60), PLANES, PLAZOS, ahoraEn(0)).solo_lectura, false);
    assert.equal(estadoEfectivo(vencida(-2), PLANES, PLAZOS, ahoraEn(0)).solo_lectura, true);
  });

  it('Básico (sin módulos) se paga: vigente es «activa» y no está en solo lectura; vencido y apagado sí', () => {
    const basico = (vence: number | null) => gratis(-30, { plan_clave: 'basico', estado: 'activa', vigente_hasta: vence == null ? null : new Date(HOY() + vence * DIA) });
    const vigente = estadoEfectivo(basico(20), PLANES, PLAZOS, ahoraEn(0));
    assert.deepEqual([vigente.plan_clave, vigente.estado, vigente.solo_lectura, vigente.modulos], ['basico', 'activa', false, []]);
    assert.equal(estadoEfectivo(basico(null), PLANES, PLAZOS, ahoraEn(0)).estado, 'activa', 'sin vencimiento: lo dejó así el superadmin');
    assert.equal(estadoEfectivo(basico(2), PLANES, PLAZOS, ahoraEn(0)).estado, 'por_vencer');
    assert.equal(estadoEfectivo(basico(-20), PLANES, PLAZOS, ahoraEn(0)).solo_lectura, true);
  });

  it('plazoGratisNuevo: hoy (Lima) + días; sin plazo no pone nada; nace con el aviso de inicio dado por hecho', () => {
    const p = plazoGratisNuevo({ dias_gratis: 90 }, ahoraEn(0));
    assert.equal(iso(p.gratis_hasta!.getTime()), iso(HOY() + 90 * DIA));
    assert.equal(p.aviso_gratis_inicio_para?.getTime(), p.gratis_hasta!.getTime());
    assert.deepEqual(plazoGratisNuevo({ dias_gratis: 0 }, ahoraEn(0)), {});
    assert.deepEqual(plazoGratisNuevo({ dias_gratis: null }, ahoraEn(0)), {});
    assert.deepEqual([duracionTexto(90), duracionTexto(30), duracionTexto(45), duracionTexto(1)], ['3 meses', '1 mes', '45 días', '1 día']);
  });
});

// Base de datos y API.
let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1', string>;
let enviados: { para: string; asunto: string; cuerpo: string }[] = [];
const depsFalsas = (dias = 0): DepsAvisos => ({
  ahora: () => ahoraEn(dias),
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
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'), prop1: await login(base, 'prop1@test.pe') };
  comercialCorreo.deps = depsFalsas;
});
after(async () => {
  comercialCorreo.deps = depsOriginal;
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.configuracionComercial.update({ where: { id: 1 }, data: { dias_gratis: 90, dias_prueba_pro: 30, migracion_gratis_at: null, correo_superadmin: null } });
  await prisma.suscripcionCondominio.deleteMany({ where: { complejo_id: d.complejoA.id } });
  invalidarComercial();
});
afterEach(() => { enviados = []; invalidarComercial(); });

const sesionA = () => prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: d.complejoA.id } });
const registro = (correo: string) => ({
  nombre: 'Rosa Quispe', email: correo, celular: '987 654 321', password: 'Cl4ve-segura-2026', empresa: `Junta ${correo}`, condominio: `Condominio ${correo}`, unidades: 12, acepta_terminos: true,
});
const susDeRegistro = async (correo: string) => {
  const c = await prisma.complejoHabitacional.findFirstOrThrow({ where: { nombre: `Condominio ${correo}` } });
  return prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: c.id } });
};
const ponerGratis = (finDias: number | null, extra: Record<string, unknown> = {}) =>
  prisma.suscripcionCondominio.upsert({
    where: { complejo_id: d.complejoA.id },
    create: { complejo_id: d.complejoA.id, plan_clave: 'gratis', estado: 'gratis', gratis_hasta: finDias == null ? null : new Date(HOY() + finDias * DIA), ...extra },
    update: { plan_clave: 'gratis', modulos: [], estado: 'gratis', es_prueba: false, vigente_hasta: null, gratis_hasta: finDias == null ? null : new Date(HOY() + finDias * DIA), ...extra },
  }).then((r) => { invalidarComercial(); return r; });

describe('registro: el plazo de Gratis y la prueba de Pro dentro', () => {
  it('con el registro: Pro de prueba hasta el día 30, Gratis hasta el día 90 (hoy de Lima + dias_gratis)', async () => {
    const r = await llamar(base, 'POST', '/api/publico/registro', null, registro('plazo90@casa.pe'));
    assert.equal(r.status, 202, r.texto);
    const s = await susDeRegistro('plazo90@casa.pe');
    assert.equal(s.plan_clave, 'pro');
    assert.equal(s.es_prueba, true);
    assert.equal(iso(s.vigente_hasta!.getTime()), iso(HOY() + 30 * DIA), 'la prueba termina el día 30');
    assert.equal(iso(s.gratis_hasta!.getTime()), iso(HOY() + 90 * DIA), 'Gratis termina el día 90');
    assert.ok(s.gratis_hasta! > s.vigente_hasta!, 'la prueba va dentro del plazo');
    assert.equal(s.aviso_gratis_inicio_para?.getTime(), s.gratis_hasta!.getTime(), 'el aviso de inicio es para quien ya estaba en Gratis, no para un registro nuevo');
  });

  it('el día 31 ya es Gratis (sin solo lectura) y el día 91, solo lectura', async () => {
    await llamar(base, 'POST', '/api/publico/registro', null, registro('plazo91@casa.pe'));
    const s = await susDeRegistro('plazo91@casa.pe');
    const planes = await prisma.planComercial.findMany({ select: { clave: true, modulos_incluidos: true } });
    const en = (dias: number) => estadoEfectivo(s, planes, PLAZOS, ahoraEn(dias));
    assert.deepEqual([en(10).plan_clave, en(10).solo_lectura], ['pro', false]);
    assert.deepEqual([en(31).plan_clave, en(31).solo_lectura], ['gratis', false]);
    assert.deepEqual([en(90).plan_clave, en(90).solo_lectura], ['gratis', false], 'el día 90 todavía es gratis');
    assert.deepEqual([en(91).plan_clave, en(91).solo_lectura], ['gratis', true]);
  });

  it('sin prueba de Pro, nace en Gratis con su plazo', async () => {
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { dias_prueba_pro: 0 } });
    invalidarComercial();
    await llamar(base, 'POST', '/api/publico/registro', null, registro('sinprueba@casa.pe'));
    const s = await susDeRegistro('sinprueba@casa.pe');
    assert.deepEqual([s.plan_clave, s.es_prueba, iso(s.gratis_hasta!.getTime())], ['gratis', false, iso(HOY() + 90 * DIA)]);
  });

  it('con dias_gratis = 0 (o null) no hay plazo: gratis_hasta queda vacío', async () => {
    for (const valor of [0, null]) {
      await prisma.configuracionComercial.update({ where: { id: 1 }, data: { dias_gratis: valor } });
      invalidarComercial();
      const correo = `sinplazo${valor}@casa.pe`;
      await llamar(base, 'POST', '/api/publico/registro', null, registro(correo));
      assert.equal((await susDeRegistro(correo)).gratis_hasta, null, `dias_gratis ${valor}`);
    }
  });

  it('un condominio que el admin crea después nace en Gratis con su gratis_hasta', async () => {
    // Una empresa sin condominio en Gratis: el B (cortesía) no cuenta como Gratis.
    const r = await llamar(base, 'POST', '/api/complejos', T.adminB, { nombre: 'Nuevo de B', tipo: 'Edificio' });
    assert.equal(r.status, 201, r.texto);
    const s = await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: r.body.id } });
    assert.deepEqual([s.plan_clave, iso(s.gratis_hasta!.getTime())], ['gratis', iso(HOY() + 90 * DIA)]);
    await prisma.complejoHabitacional.delete({ where: { id: r.body.id } });
  });
});

describe('configuración: dias_gratis', () => {
  it('el superadmin lo fija de 0 a 365 (366 y -1 dan 422) y nadie más', async () => {
    for (const malo of [366, -1, 1.5]) assert.equal((await llamar(base, 'PUT', '/api/comercial/configuracion', T.super, { dias_gratis: malo })).status, 422, String(malo));
    assert.equal((await llamar(base, 'PUT', '/api/comercial/configuracion', T.adminA, { dias_gratis: 60 })).status, 403);
    const ok = await llamar(base, 'PUT', '/api/comercial/configuracion', T.super, { dias_gratis: 60 });
    assert.equal(ok.status, 200, ok.texto);
    assert.equal((await prisma.configuracionComercial.findUniqueOrThrow({ where: { id: 1 } })).dias_gratis, 60);
    assert.equal((await llamar(base, 'PUT', '/api/comercial/configuracion', T.super, { dias_gratis: 0 })).status, 200);
    assert.equal((await llamar(base, 'PUT', '/api/comercial/configuracion', T.super, { dias_gratis: null })).status, 200);
  });

  it('la API pública de planes dice cuántos días dura Gratis', async () => {
    const r = await llamar(base, 'GET', '/api/publico/planes');
    assert.equal(r.body.dias_gratis, 90);
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { dias_gratis: 0 } });
    assert.equal((await llamar(base, 'GET', '/api/publico/planes')).body.dias_gratis, null);
  });
});

describe('migración de una sola vez: los condominios que ya estaban en Gratis reciben su plazo', () => {
  let nuevos: number[] = [];
  const condominio = async (nombre: string) => {
    const c = await prisma.complejoHabitacional.create({ data: { nombre, tipo: 'Edificio', empresa_id: d.empresaA.id } });
    nuevos.push(c.id);
    return c.id;
  };
  // La migración recorre TODOS los condominios: los que dejaron otras pruebas (el registro crea varios) quedan en cortesía para que sólo cuenten los de cada prueba.
  beforeEach(async () => {
    await prisma.suscripcionCondominio.deleteMany();
    const todos = await prisma.complejoHabitacional.findMany({ select: { id: true } });
    await prisma.suscripcionCondominio.createMany({ data: todos.map((c) => ({ complejo_id: c.id, plan_clave: 'cortesia', modulos: ['ia_vouchers'], estado: 'activa' })) });
  });
  afterEach(async () => {
    await prisma.suscripcionCondominio.deleteMany({ where: { complejo_id: { in: nuevos } } });
    await prisma.complejoHabitacional.deleteMany({ where: { id: { in: nuevos } } });
    nuevos = [];
  });

  it('fija hoy + dias_gratis a Gratis, sin suscripción, prueba vigente y plan de pago apagado; no toca cortesía ni planes de pago vigentes; deja la marca', async () => {
    const sinSus = await condominio('Sin suscripción');
    const enGratis = await condominio('En Gratis');
    const enPrueba = await condominio('En prueba');
    const apagado = await condominio('Pro apagado');
    const proVigente = await condominio('Pro vigente');
    const basicoVigente = await condominio('Básico vigente');
    const cortesia = await condominio('Cortesía');
    const sus = (complejo_id: number, data: Record<string, unknown>) => prisma.suscripcionCondominio.create({ data: { complejo_id, ...data } as never });
    await sus(enGratis, { plan_clave: 'gratis', estado: 'gratis' });
    await sus(enPrueba, { plan_clave: 'pro', estado: 'activa', es_prueba: true, vigente_hasta: new Date(HOY() + 10 * DIA) });
    await sus(apagado, { plan_clave: 'pro', estado: 'vencida', vigente_hasta: new Date(HOY() - 40 * DIA) });
    await sus(proVigente, { plan_clave: 'pro', estado: 'activa', vigente_hasta: new Date(HOY() + 20 * DIA) });
    await sus(basicoVigente, { plan_clave: 'basico', estado: 'activa', vigente_hasta: new Date(HOY() + 20 * DIA) });
    await sus(cortesia, { plan_clave: 'cortesia', modulos: ['ia_vouchers'], estado: 'activa' });

    const r = await migracionGratis(prisma, { ahora: ahoraEn(0) });
    assert.deepEqual(r, { aplicada: true, fijados: 4 });
    const fin = iso(HOY() + 90 * DIA);
    const de = async (id: number) => prisma.suscripcionCondominio.findUnique({ where: { complejo_id: id } });
    assert.equal(iso((await de(sinSus))!.gratis_hasta!.getTime()), fin, 'sin suscripción: se le crea la fila en Gratis');
    assert.equal((await de(sinSus))!.plan_clave, 'gratis');
    for (const id of [enGratis, enPrueba, apagado]) assert.equal(iso((await de(id))!.gratis_hasta!.getTime()), fin);
    for (const id of [proVigente, basicoVigente, cortesia]) assert.equal((await de(id))!.gratis_hasta, null, 'planes de pago vigentes y cortesía no se tocan');
    assert.ok((await prisma.configuracionComercial.findUniqueOrThrow({ where: { id: 1 } })).migracion_gratis_at, 'deja su marca');
    assert.equal((await de(enGratis))!.aviso_gratis_inicio_para, null, 'el aviso de inicio sale en el siguiente ciclo de avisos');
  });

  it('es idempotente: correrla dos veces no corre el plazo', async () => {
    const id = await condominio('En Gratis');
    await prisma.suscripcionCondominio.create({ data: { complejo_id: id, plan_clave: 'gratis', estado: 'gratis' } });
    assert.equal((await migracionGratis(prisma, { ahora: ahoraEn(0) })).fijados, 1);
    const antes = (await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: id } })).gratis_hasta!.getTime();
    assert.deepEqual(await migracionGratis(prisma, { ahora: ahoraEn(20) }), { aplicada: false, fijados: 0 });
    assert.equal((await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: id } })).gratis_hasta!.getTime(), antes);
  });

  it('aun sin la marca, nunca corre un gratis_hasta que ya existe', async () => {
    const id = await condominio('Ya tenía plazo');
    const propio = new Date(HOY() + 12 * DIA);
    await prisma.suscripcionCondominio.create({ data: { complejo_id: id, plan_clave: 'gratis', estado: 'gratis', gratis_hasta: propio } });
    await migracionGratis(prisma, { ahora: ahoraEn(0) });
    assert.equal((await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: id } })).gratis_hasta!.getTime(), propio.getTime());
  });

  it('al arrancar el servidor (migracionInicial) el plazo se aplica una sola vez, sin repetir la cortesía', async () => {
    const id = await condominio('En Gratis');
    await prisma.suscripcionCondominio.create({ data: { complejo_id: id, plan_clave: 'gratis', estado: 'gratis' } });
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { migracion_cortesia_at: new Date() } });
    assert.deepEqual(await migracionInicial(prisma), { aplicada: false, creadas: 0 }, 'la cortesía ya estaba hecha');
    const s = await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: id } });
    assert.equal(iso(s.gratis_hasta!.getTime()), iso(HOY() + 90 * DIA), 'pero el plazo de Gratis sí se aplicó');
    assert.ok((await prisma.configuracionComercial.findUniqueOrThrow({ where: { id: 1 } })).migracion_gratis_at);
    await migracionInicial(prisma);
    assert.equal((await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: id } })).gratis_hasta!.getTime(), s.gratis_hasta!.getTime(), 'la segunda vez no corre el plazo');
  });

  it('sin plazo configurado (dias_gratis 0) no fija nada, pero deja la marca', async () => {
    const id = await condominio('En Gratis');
    await prisma.suscripcionCondominio.create({ data: { complejo_id: id, plan_clave: 'gratis', estado: 'gratis' } });
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { dias_gratis: 0 } });
    assert.deepEqual(await migracionGratis(prisma, { ahora: ahoraEn(0) }), { aplicada: true, fijados: 0 });
    assert.equal((await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: id } })).gratis_hasta, null);
  });
});

describe('avisos del plazo de Gratis: al aplicarse, 7 días antes y el día que vence; sin repetirse', () => {
  const ciclo = (dias: number) => procesarVencimientos({ ahora: ahoraEn(dias), deps: depsFalsas(dias) });
  const delPlazo = () => enviados.filter((c) => /gratis/i.test(c.asunto));

  it('al aplicarse la migración: un correo al admin con la fecha de solo lectura y la oferta de Básico o Pro; el segundo ciclo no repite', async () => {
    await ponerGratis(90); // como la dejó la migración: sin la marca de aviso de inicio
    await ciclo(0);
    const mios = delPlazo().filter((c) => c.para === 'admin.a@test.pe');
    assert.equal(mios.length, 1, JSON.stringify(enviados.map((c) => c.asunto)));
    assert.match(mios[0]!.cuerpo, /Desde hoy, Gratis dura 3 meses/);
    assert.match(mios[0]!.cuerpo, /pasa a solo lectura el \d{2}\/\d{2}\/\d{4}/);
    assert.match(mios[0]!.cuerpo, /Básico desde S\/ 20 al mes o Pro/);
    await ciclo(0);
    await ciclo(1);
    assert.equal(delPlazo().length, 1, 'no se repite');
    assert.equal((await sesionA()).aviso_gratis_inicio_para?.getTime(), (await sesionA()).gratis_hasta!.getTime());
  });

  it('7 días antes y el día que vence, una sola vez cada uno; después de vencer no manda nada', async () => {
    await ponerGratis(30, { aviso_gratis_inicio_para: new Date(HOY() + 30 * DIA) });
    await ciclo(0);
    assert.equal(delPlazo().length, 0, 'a 30 días no toca nada');
    await ciclo(23); // faltan 7
    assert.equal(delPlazo().length, 1);
    assert.match(delPlazo()[0]!.asunto, /le quedan 7 días gratis/);
    await ciclo(23);
    await ciclo(25);
    assert.equal(delPlazo().length, 1, 'el aviso de 7 días no se repite');
    await ciclo(30); // hoy es el último día
    assert.equal(delPlazo().length, 2);
    assert.match(delPlazo()[1]!.asunto, /Hoy termina el periodo gratis/);
    assert.match(delPlazo()[1]!.cuerpo, /Desde mañana/);
    await ciclo(30);
    await ciclo(31);
    await ciclo(40);
    assert.equal(delPlazo().length, 2, 'ya en solo lectura no se avisa más');
  });

  it('el plan de pago vigente, la cortesía y quien ya está en solo lectura no reciben avisos', async () => {
    await ponerGratis(0, { plan_clave: 'pro', estado: 'activa', vigente_hasta: new Date(HOY() + 40 * DIA) });
    await ciclo(0);
    assert.equal(delPlazo().length, 0, 'Pro vigente');
    await ponerGratis(0, { plan_clave: 'cortesia', modulos: ['ia_vouchers'], estado: 'activa' });
    await ciclo(0);
    assert.equal(delPlazo().length, 0, 'cortesía');
    await ponerGratis(-3);
    await ciclo(0);
    assert.equal(delPlazo().length, 0, 'ya en solo lectura');
  });

  it('un plazo nuevo (otro gratis_hasta) vuelve a avisar: la marca es por fecha', async () => {
    await ponerGratis(8, { aviso_gratis_inicio_para: new Date(HOY() + 8 * DIA), aviso_gratis_7d_para: new Date(HOY() + 8 * DIA) });
    await ciclo(1);
    assert.equal(delPlazo().length, 0, 'ya avisado para esa fecha');
    await prisma.suscripcionCondominio.update({ where: { complejo_id: d.complejoA.id }, data: { gratis_hasta: new Date(HOY() + 9 * DIA) } });
    await ciclo(2);
    assert.equal(delPlazo().length, 2, 'otro plazo, otros avisos: el de inicio y el de los 7 días');
    assert.ok(delPlazo().some((c) => /le quedan 7 días gratis/.test(c.asunto)));
    await ciclo(2);
    assert.equal(delPlazo().length, 2, 'y no se repiten');
  });
});
