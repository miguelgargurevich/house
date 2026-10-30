// Gratis incluye UN condominio por administradora: con uno ya en Gratis (o apagado), la administradora no crea otro (409, sin crear nada).
// Los condominios que ya existen no se tocan; el superadmin no tiene el límite; Mi plan y el endpoint dicen si puede y por qué.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { CARACTERISTICAS_GRATIS_ANTERIORES, sembrarCatalogoComercial } from '../src/server/services/comercial/catalogo';
import { MENSAJE_GRATIS_UN_CONDOMINIO } from '../src/server/services/comercial/cupo';
import { ajustarOfertaGratisPro } from '../src/server/services/comercial/oferta';
import { invalidarComercial } from '../src/server/services/comercial/modulos';
import { hoyLima } from '../src/server/lib/fechas';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB', string>;

const DIA = 86_400_000;
const CARACTERISTICAS_GRATIS = ['1 condominio', ...CARACTERISTICAS_GRATIS_ANTERIORES];

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    super: await login(base, 'super@test.pe'),
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

const crear = (token: string, nombre: string, extra: Record<string, unknown> = {}) => llamar(base, 'POST', '/api/complejos', token, { nombre, tipo: 'Edificio', ...extra });
const condominiosDeA = () => prisma.complejoHabitacional.findMany({ where: { empresa_id: d.empresaA.id }, orderBy: { id: 'asc' }, select: { id: true, nombre: true } });
/** Pasa un condominio a un plan de pago con su vigencia (días desde hoy en Lima; negativo = ya venció). */
const ponerPlan = (complejoId: number, plan: string, diasVigencia: number, estado = 'activa') =>
  prisma.suscripcionCondominio.upsert({
    where: { complejo_id: complejoId },
    create: { complejo_id: complejoId, plan_clave: plan, modulos: [], estado, vigente_hasta: new Date(hoyLima().getTime() + diasVigencia * DIA) },
    update: { plan_clave: plan, modulos: [], estado, vigente_hasta: new Date(hoyLima().getTime() + diasVigencia * DIA) },
  });

beforeEach(async () => {
  // Cada prueba parte de Empresa A con sólo su condominio de cortesía (el de `sembrar`).
  await prisma.complejoHabitacional.deleteMany({ where: { empresa_id: d.empresaA.id, id: { not: d.complejoA.id } } });
  await prisma.planComercial.update({ where: { clave: 'gratis' }, data: { caracteristicas: [...CARACTERISTICAS_GRATIS] } });
  invalidarComercial();
});

describe('Gratis incluye un condominio por administradora', () => {
  it('con todos sus condominios en cortesía puede crear uno: nace en Gratis, sin suscripción de pago', async () => {
    const r = await crear(T.adminA, 'Nuevo Gratis Uno');
    assert.equal(r.status, 201, r.texto);
    const sus = await prisma.suscripcionCondominio.findUnique({ where: { complejo_id: r.body.id } });
    assert.equal(sus, null, 'sin fila de suscripción = Gratis');
  });

  it('con un condominio ya en Gratis responde 409 con el motivo y no crea nada', async () => {
    assert.equal((await crear(T.adminA, 'Nuevo Gratis Uno')).status, 201);
    const antes = (await condominiosDeA()).length;
    const r = await crear(T.adminA, 'Nuevo Gratis Dos');
    assert.equal(r.status, 409, r.texto);
    assert.deepEqual(r.body, { error: 'Gratis incluye un condominio. Para agregar otro, pasa a Pro o Administradora el que ya tienes.' });
    assert.equal((await condominiosDeA()).length, antes, 'no crea nada');
  });

  it('con el que ya tiene vigente en Pro sí puede crear otro, y ese nace en Gratis', async () => {
    const primero = await crear(T.adminA, 'Nuevo Gratis Uno');
    assert.equal(primero.status, 201);
    await ponerPlan(primero.body.id, 'pro', 30);
    const segundo = await crear(T.adminA, 'Nuevo Gratis Dos');
    assert.equal(segundo.status, 201, segundo.texto);
    assert.equal(await prisma.suscripcionCondominio.findUnique({ where: { complejo_id: segundo.body.id } }), null);
    // Ahora ese segundo está en Gratis: el límite vuelve a aplicar.
    assert.equal((await crear(T.adminA, 'Nuevo Gratis Tres')).status, 409);
  });

  it('la prueba de Pro vigente cuenta como Gratis: también frena (si no, al vencer quedarían dos gratis)', async () => {
    const primero = await crear(T.adminA, 'Nuevo Gratis Uno');
    await prisma.suscripcionCondominio.create({ data: { complejo_id: primero.body.id, plan_clave: 'pro', modulos: [], estado: 'activa', es_prueba: true, vigente_hasta: new Date(hoyLima().getTime() + 20 * DIA) } });
    const r = await crear(T.adminA, 'Nuevo Gratis Dos');
    assert.equal(r.status, 409, r.texto);
  });

  it('un Pro vencido pasada la gracia cuenta como Gratis: también frena', async () => {
    const primero = await crear(T.adminA, 'Nuevo Gratis Uno');
    await ponerPlan(primero.body.id, 'pro', -60, 'vencida');
    const r = await crear(T.adminA, 'Nuevo Gratis Dos');
    assert.equal(r.status, 409, r.texto);
  });

  it('un condominio de cortesía no cuenta como Gratis: la administradora puede crear otro', async () => {
    const r = await crear(T.adminA, 'Nuevo Gratis Uno');
    await ponerPlan(r.body.id, 'administradora', 30);
    assert.equal((await crear(T.adminA, 'Nuevo Gratis Dos')).status, 201);
  });

  it('el superadmin no tiene este límite: crea aunque la empresa ya tenga uno en Gratis', async () => {
    assert.equal((await crear(T.adminA, 'Nuevo Gratis Uno')).status, 201);
    const r = await crear(T.super, 'Nuevo Del Super', { empresa_id: d.empresaA.id });
    assert.equal(r.status, 201, r.texto);
  });

  it('no toca los condominios que ya existían: el de cortesía sigue igual', async () => {
    const antes = await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: d.complejoA.id } });
    assert.equal((await crear(T.adminA, 'Nuevo Gratis Uno')).status, 201);
    assert.equal((await crear(T.adminA, 'Nuevo Gratis Dos')).status, 409);
    assert.deepEqual(await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: d.complejoA.id } }), antes);
  });

  it('Mi plan y el endpoint dicen si puede agregar otro y, si no, por qué y cuál lo frena', async () => {
    const primero = await crear(T.adminA, 'Nuevo Gratis Uno');
    const r = await llamar(base, 'GET', '/api/comercial/puede-agregar-condominio', T.adminA);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.body, { puede: false, motivo: MENSAJE_GRATIS_UN_CONDOMINIO, gratis: { id: primero.body.id, nombre: 'Nuevo Gratis Uno' } });
    const miPlan = await llamar(base, 'GET', '/api/comercial/mi-plan', T.adminA);
    assert.equal(miPlan.status, 200, miPlan.texto);
    assert.equal(miPlan.body.puede_agregar_condominio.puede, false);
    assert.equal(miPlan.body.puede_agregar_condominio.motivo, MENSAJE_GRATIS_UN_CONDOMINIO);
  });

  it('la administradora de otra empresa no ve el condominio de A en su respuesta', async () => {
    assert.equal((await crear(T.adminA, 'Nuevo Gratis Uno')).status, 201);
    const r = await llamar(base, 'GET', '/api/comercial/puede-agregar-condominio', T.adminB);
    assert.equal(r.body.puede, true);
    assert.equal(r.body.gratis, null);
  });

  it('el seed crea Gratis con «1 condominio» entre sus viñetas (no lee lo que deja beforeEach)', async () => {
    await prisma.planComercial.deleteMany({ where: { clave: 'gratis' } });
    await sembrarCatalogoComercial(prisma);
    const g = await prisma.planComercial.findUniqueOrThrow({ where: { clave: 'gratis' } });
    assert.deepEqual(g.caracteristicas, CARACTERISTICAS_GRATIS);
  });

  it('la oferta cambia las viñetas de Gratis sólo si siguen como salieron antes', async () => {
    await prisma.planComercial.update({ where: { clave: 'gratis' }, data: { caracteristicas: [...CARACTERISTICAS_GRATIS_ANTERIORES] } });
    const informe = await ajustarOfertaGratisPro(prisma);
    assert.ok(informe.some((c) => c.clave === 'gratis' && c.cambios.includes('caracteristicas')));
    assert.deepEqual((await prisma.planComercial.findUniqueOrThrow({ where: { clave: 'gratis' } })).caracteristicas, CARACTERISTICAS_GRATIS);

    await prisma.planComercial.update({ where: { clave: 'gratis' }, data: { caracteristicas: ['Mi propia lista'] } });
    await ajustarOfertaGratisPro(prisma);
    assert.deepEqual((await prisma.planComercial.findUniqueOrThrow({ where: { clave: 'gratis' } })).caracteristicas, ['Mi propia lista'], 'lo editado a mano se respeta');
  });
});
