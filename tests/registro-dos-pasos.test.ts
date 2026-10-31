// Registro en DOS pasos. Paso 1 (`POST /api/publico/registro`, ver `comercial-registro.test.ts`): la cuenta. Paso 2 (`POST /api/comercial/primer-condominio`):
// la administradora que ya entró crea su primer condominio (+ contrato + suscripción con la prueba de Pro y el plazo de Gratis). Aquí: el paso 2, y que una
// administradora SIN condominio no rompa nada de la API.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { condominio, registrarYEntrar } from './helpers/registro';
import type { DepsAvisos } from '../src/server/services/avisos/canales';
import { comercialCorreo } from '../src/server/services/comercial/configuracion';
import { estadoEfectivo } from '../src/server/services/comercial/estado';
import { comercialDeps, invalidarComercial } from '../src/server/services/comercial/modulos';

interface Correo { para: string; asunto: string; cuerpo: string }
let enviados: Correo[] = [];
const depsFalsas = (): DepsAvisos => ({
  ahora: () => comercialDeps.ahora(),
  env: { RESEND_API_KEY: 're_falsa', MAIL_FROM: 'House <house@ejemplo.test>' },
  fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body));
    enviados.push({ para: b.to[0], asunto: b.subject, cuerpo: b.text });
    return new Response('{}', { status: 200 });
  }) as typeof fetch,
});
const depsOriginal = comercialCorreo.deps;

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
const DIA = 86_400_000;

before(async () => {
  d = await sembrar();
  comercialCorreo.deps = depsFalsas;
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, registroIp: 1000, registroCorreo: 1000 } }));
});
after(async () => { comercialCorreo.deps = depsOriginal; await cerrar(); await prisma.$disconnect(); });
beforeEach(async () => {
  enviados = [];
  await prisma.configuracionComercial.update({ where: { id: 1 }, data: { dias_prueba_pro: 30, dias_gratis: 90, correo_superadmin: 'miguel@house.test', registro_abierto: true } });
  invalidarComercial();
});
afterEach(() => { invalidarComercial(); });

const POST = '/api/comercial/primer-condominio';
const ids = (correo: string) => prisma.usuario.findUniqueOrThrow({ where: { email: correo }, select: { empresa_id: true, id: true } });

describe('paso 2: el primer condominio', () => {
  it('crea en una transacción condominio + contrato + suscripción de prueba de Pro con su plazo de Gratis, renombra la empresa, audita y avisa al superadmin', async () => {
    const t = await registrarYEntrar(base, 'p2a@casa.pe');
    const { empresa_id, id: usuarioId } = await ids('p2a@casa.pe');
    enviados = [];
    const r = await llamar(base, 'POST', POST, t, condominio());
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.empresa_id, empresa_id);
    const empresa = await prisma.empresaAdministradora.findUniqueOrThrow({ where: { id: empresa_id! } });
    assert.equal(empresa.nombre, 'Junta Los Pinos', 'reemplaza el nombre provisional');
    const c = await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: r.body.complejo_id } });
    assert.deepEqual([c.nombre, c.empresa_id], ['Condominio Los Pinos', empresa_id]);
    assert.equal(await prisma.contratoAdministracion.count({ where: { complejo_id: c.id, empresa_id: empresa_id!, fecha_fin: null } }), 1);
    const s = await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: c.id } });
    assert.equal(s.plan_clave, 'pro');
    assert.equal(s.estado, 'activa');
    assert.equal(s.es_prueba, true);
    assert.match(s.notas ?? '', /48 departamentos\. Prueba de Torre Pro de 30 días/);
    const hoy = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
    assert.ok(Math.abs(s.vigente_hasta!.getTime() - (hoy + 30 * DIA)) <= DIA, 'la prueba termina el día 30');
    assert.ok(Math.abs(s.gratis_hasta!.getTime() - (hoy + 90 * DIA)) <= DIA, 'Gratis termina el día 90');
    assert.ok(s.gratis_hasta! > s.vigente_hasta!, 'la prueba va dentro del plazo');
    const aud = await prisma.auditoria.findFirstOrThrow({ where: { accion: 'primer_condominio', usuario_id: usuarioId } });
    assert.equal(aud.entidad, 'complejo');
    assert.equal(aud.entidad_id, c.id);
    const aviso = enviados.filter((m) => m.para === 'miguel@house.test');
    assert.equal(aviso.length, 1);
    assert.equal(aviso[0]!.asunto, 'Nuevo condominio en Torre');
    assert.match(aviso[0]!.cuerpo, /Junta Los Pinos/);
    assert.match(aviso[0]!.cuerpo, /Condominio Los Pinos \(~48 departamentos\)/);
    assert.doesNotMatch(aviso[0]!.cuerpo, /Cl4ve-segura/);
  });

  it('con dias_prueba_pro = 0 nace en Gratis con su plazo; la regla es la misma de siempre (sin tope de departamentos)', async () => {
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { dias_prueba_pro: 0 } });
    invalidarComercial();
    const t = await registrarYEntrar(base, 'p2b@casa.pe');
    const r = await llamar(base, 'POST', POST, t, condominio({ unidades: 5000 }));
    assert.equal(r.status, 201, r.texto);
    const s = await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: r.body.complejo_id } });
    assert.deepEqual([s.plan_clave, s.estado, s.es_prueba, s.vigente_hasta], ['gratis', 'gratis', false, null]);
    assert.ok(s.gratis_hasta);
  });

  it('el estado efectivo del condominio recién creado es Pro en prueba y todavía no está en solo lectura', async () => {
    const t = await registrarYEntrar(base, 'p2c@casa.pe');
    const r = await llamar(base, 'POST', POST, t, condominio());
    const s = await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: r.body.complejo_id } });
    const planes = await prisma.planComercial.findMany({ select: { clave: true, modulos_incluidos: true } });
    const ef = estadoEfectivo(s, planes, { dias_gracia: 7, dias_aviso_vencimiento: 7 }, new Date());
    assert.deepEqual([ef.plan_clave, ef.en_prueba, ef.solo_lectura], ['pro', true, false]);
    assert.equal((await llamar(base, 'GET', '/api/comercial/mi-plan', t)).body.condominios.length, 1);
  });

  it('sólo el primero: un segundo envío da 409 y no cambia nada (ni el nombre de la empresa)', async () => {
    const t = await registrarYEntrar(base, 'p2d@casa.pe');
    const uno = await llamar(base, 'POST', POST, t, condominio());
    assert.equal(uno.status, 201, uno.texto);
    const dos = await llamar(base, 'POST', POST, t, condominio({ empresa: 'Otro nombre', condominio: 'Otro condominio' }));
    assert.equal(dos.status, 409, dos.texto);
    assert.match(dos.body.error, /ya tiene un condominio/);
    const { empresa_id } = await ids('p2d@casa.pe');
    assert.equal(await prisma.complejoHabitacional.count({ where: { empresa_id: empresa_id! } }), 1);
    assert.equal((await prisma.empresaAdministradora.findUniqueOrThrow({ where: { id: empresa_id! } })).nombre, 'Junta Los Pinos');
  });

  it('dos envíos simultáneos (doble clic): uno crea y el otro recibe 409; queda un solo condominio con una sola suscripción', async () => {
    const t = await registrarYEntrar(base, 'p2e@casa.pe');
    const rs = await Promise.all([1, 2, 3].map((i) => llamar(base, 'POST', POST, t, condominio({ condominio: `Condominio ${i}` }))));
    assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409, 409], JSON.stringify(rs.map((r) => r.texto)));
    const { empresa_id } = await ids('p2e@casa.pe');
    assert.equal(await prisma.complejoHabitacional.count({ where: { empresa_id: empresa_id! } }), 1);
    assert.equal(await prisma.suscripcionCondominio.count({ where: { complejo: { empresa_id: empresa_id! } } }), 1);
    assert.equal(await prisma.contratoAdministracion.count({ where: { empresa_id: empresa_id! } }), 1);
  });

  it('una administradora que ya tiene condominios (otra empresa) recibe 409 y su empresa no se toca; las demás empresas tampoco', async () => {
    const tB = await login(base, 'admin.b@test.pe');
    const antes = await prisma.empresaAdministradora.findMany({ orderBy: { id: 'asc' }, select: { id: true, nombre: true } });
    const nComplejos = await prisma.complejoHabitacional.count();
    const r = await llamar(base, 'POST', POST, tB, condominio({ empresa: 'Secuestrada', condominio: 'Intruso' }));
    assert.equal(r.status, 409, r.texto);
    assert.deepEqual(await prisma.empresaAdministradora.findMany({ orderBy: { id: 'asc' }, select: { id: true, nombre: true } }), antes);
    assert.equal(await prisma.complejoHabitacional.count(), nComplejos);
  });

  it('el paso 2 sólo toca la empresa de quien llama: no hay forma de pasar un empresa_id ajeno', async () => {
    const t = await registrarYEntrar(base, 'p2f@casa.pe');
    const r = await llamar(base, 'POST', POST, t, { ...condominio(), empresa_id: d.empresaA.id, complejo_id: d.complejoA.id });
    assert.equal(r.status, 201, r.texto);
    const { empresa_id } = await ids('p2f@casa.pe');
    assert.notEqual(empresa_id, d.empresaA.id);
    assert.equal(r.body.empresa_id, empresa_id);
    assert.equal((await prisma.empresaAdministradora.findUniqueOrThrow({ where: { id: d.empresaA.id } })).nombre, 'Empresa A');
    assert.equal(await prisma.complejoHabitacional.count({ where: { empresa_id: d.empresaA.id } }), 1);
  });

  it('otros roles: superadmin, propietario, personal y un admin sin empresa → 403; sin sesión → 401; no se crea nada', async () => {
    const nComplejos = await prisma.complejoHabitacional.count();
    for (const correo of ['super@test.pe', 'prop1@test.pe', 'inq1@test.pe', 'mtto.a@test.pe', 'seg.a@test.pe', 'admin.huerfano@test.pe']) {
      const r = await llamar(base, 'POST', POST, await login(base, correo), condominio());
      assert.equal(r.status, 403, `${correo} → ${r.status} ${r.texto}`);
    }
    assert.equal((await llamar(base, 'POST', POST, null, condominio())).status, 401);
    assert.equal(await prisma.complejoHabitacional.count(), nComplejos);
  });

  it('validación (zod): sin campos, vacíos, unidades fuera de 1–5000 o nombres larguísimos → 422 con `campos`, y no se crea ni se renombra nada', async () => {
    const t = await registrarYEntrar(base, 'p2g@casa.pe');
    const { empresa_id } = await ids('p2g@casa.pe');
    const casos: Record<string, unknown>[] = [
      { empresa: '' }, { condominio: '' }, { unidades: 0 }, { unidades: 5001 }, { unidades: 'muchos' }, { unidades: 1.5 },
      { empresa: 'e'.repeat(161) }, { condominio: 'c'.repeat(161) }, { empresa: 7 },
    ];
    const r0 = await llamar(base, 'POST', POST, t, {});
    assert.equal(r0.status, 422);
    assert.ok(r0.body.campos.empresa && r0.body.campos.condominio && r0.body.campos.unidades, JSON.stringify(r0.body));
    for (const c of casos) {
      const r = await llamar(base, 'POST', POST, t, condominio(c));
      assert.equal(r.status, 422, `${JSON.stringify(c)} → ${r.status}`);
    }
    assert.equal(await prisma.complejoHabitacional.count({ where: { empresa_id: empresa_id! } }), 0);
    assert.equal((await prisma.empresaAdministradora.findUniqueOrThrow({ where: { id: empresa_id! } })).nombre, 'Rosa Quispe');
  });
});

describe('una administradora sin condominios no rompe la API', () => {
  it('el Resumen, el selector, Mi plan y las listas responden 200 y vacíos', async () => {
    const t = await registrarYEntrar(base, 'vacia@casa.pe');
    const resumen = await llamar(base, 'GET', '/api/dashboard/resumen', t);
    assert.equal(resumen.status, 200, resumen.texto);
    assert.equal(resumen.body.unidades_total, 0);
    assert.equal(resumen.body.recibos_emitidos, 0);
    assert.equal(resumen.body.morosos, 0);
    const selector = await llamar(base, 'GET', '/api/complejos/selector', t);
    assert.equal(selector.status, 200, selector.texto);
    assert.deepEqual(selector.body.items, []);
    for (const ruta of ['/api/comercial/mi-plan', '/api/comercial/estado-operativo', '/api/comercial/puede-agregar-condominio', '/api/complejos', '/api/unidades', '/api/recibos', '/api/pagos', '/api/auth/me']) {
      const r = await llamar(base, 'GET', ruta, t);
      assert.equal(r.status, 200, `${ruta} → ${r.status} ${r.texto}`);
    }
    assert.equal((await llamar(base, 'GET', '/api/comercial/puede-agregar-condominio', t)).body.puede, true);
    assert.deepEqual((await llamar(base, 'GET', '/api/complejos', t)).body.items, []);
  });
});
