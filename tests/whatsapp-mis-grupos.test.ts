// «Mis grupos» de WhatsApp: traerlos UNA vez de Evolution, guardarlos, elegir a quién representa cada uno, pasar lo que ya estaba elegido en la ficha del
// block, publicar un comunicado sólo a los grupos marcados y el tope diario del número (que también cuenta los mensajes a grupos).
// Nada sale a la red: Evolution va con `fetch` falso.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { darCortesia, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { procesarCola, type DepsAvisos } from '../src/server/services/avisos';
import { contarEnviadasHoy, manana0800Lima } from '../src/server/services/avisos/cola';
import { canalesDeps } from '../src/server/services/canales/deps';
import { esperarEnviosAGrupos, type ResultadoGrupo } from '../src/server/services/canales/grupos';
import { MOTIVO_TOPE_DIARIO } from '../src/server/services/canales/uso';
import { obtenerConfiguracion } from '../src/server/services/comercial/configuracion';
import { invalidarComercial } from '../src/server/services/comercial/modulos';

const DIA = 86_400_000;
const NUMERO_A = '51999000111';
const G = (n: number) => `12036300000000${String(n).padStart(4, '0')}@g.us`;
const GB = '120363000000009999@g.us';
const HOY = new Date('2026-11-02T15:00:00Z'); // 10:00 en Lima

interface GrupoFalso { jid: string; nombre: string; size: number; participantes: string[] }
let mundo: { grupos: Record<string, GrupoFalso[]>; numeros: Record<string, string>; enviados: { jid: string; texto: string }[]; llamadas: string[]; caido: boolean; timeout: boolean; frenarLista: Promise<void> | null };
const tiempos: number[] = [];
const original = { fetch: canalesDeps.fetch, env: canalesDeps.env, esperar: canalesDeps.esperar, azar: canalesDeps.azar, ahora: canalesDeps.ahora };
const originalTimeout = AbortSignal.timeout;

const mundoNuevo = (): typeof mundo => ({
  grupos: {
    'inst-a': [
      { jid: G(1), nombre: 'Vecinos Block 1', size: 41, participantes: [NUMERO_A] },
      { jid: G(2), nombre: 'Vecinos Block 2', size: 38, participantes: [NUMERO_A] },
      { jid: G(3), nombre: 'Junta Block 1', size: 5, participantes: [NUMERO_A] },
      { jid: G(4), nombre: 'Todo el condominio', size: 120, participantes: [NUMERO_A] },
    ],
    'inst-b': [{ jid: GB, nombre: 'Block B vecinos', size: 20, participantes: ['51977000001'] }],
  },
  numeros: { 'inst-a': NUMERO_A, 'inst-b': '51977000001' },
  enviados: [],
  llamadas: [],
  caido: false,
  timeout: false,
  frenarLista: null,
});

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
const evolutionFalsa = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(url));
  if (mundo.caido) throw new Error('sin red https://evo.ejemplo.test apikey=evo-CLAVE-FALSA-NO-REAL');
  const [, , a, b] = u.pathname.split('/');
  const instancia = decodeURIComponent(b ?? '');
  if (u.pathname.startsWith('/instance/fetchInstances')) {
    mundo.llamadas.push('fetchInstances');
    const n = mundo.numeros[u.searchParams.get('instanceName') ?? ''];
    return json(n ? [{ ownerJid: `${n}@s.whatsapp.net` }] : []);
  }
  if (a === 'fetchAllGroups') {
    mundo.llamadas.push('fetchAllGroups');
    if (mundo.timeout) throw Object.assign(new Error('tiempo'), { name: 'TimeoutError' });
    if (mundo.frenarLista) await mundo.frenarLista;
    const propio = mundo.numeros[instancia];
    return json((mundo.grupos[instancia] ?? []).filter((g) => g.participantes.includes(propio!)).map((g) => ({ id: g.jid, subject: g.nombre, size: g.size })));
  }
  if (a === 'findGroupInfos') {
    mundo.llamadas.push('findGroupInfos');
    const g = (mundo.grupos[instancia] ?? []).find((x) => x.jid === u.searchParams.get('groupJid'));
    return g ? json({ id: g.jid, subject: g.nombre, participants: g.participantes.map((n) => ({ id: `${n}@s.whatsapp.net` })) }) : json({ error: 'no está' }, 404);
  }
  if (u.pathname.startsWith('/message/sendText/')) {
    mundo.llamadas.push('sendText');
    const cuerpo = JSON.parse(String(init?.body)) as { number: string; text: string };
    mundo.enviados.push({ jid: cuerpo.number, texto: cuerpo.text });
    return json({ ok: true });
  }
  throw new Error(`Llamada no prevista a Evolution: ${u.pathname}`);
}) as typeof fetch;

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let e1: { id: number }, e2: { id: number }, eB: { id: number };
let presi1: number;
let T: Record<'super' | 'adminA' | 'adminB' | 'adminSin' | 'prop1' | 'presi1', string>;

before(async () => {
  d = await sembrar();
  // La lista de antes del cambio (el recibo sale también directo por WhatsApp): estas pruebas son del mecanismo, no del defecto.
  await prisma.complejoHabitacional.updateMany({ data: { whatsapp_avisos: ["recibo_emitido", "vence_hoy", "vencido", "cierre_pendiente"] } });
  e1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
  e2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'Block', complejo_id: d.complejoA.id } });
  eB = await prisma.estructura.create({ data: { nombre: 'Block B', tipo: 'Block', complejo_id: d.complejoB.id } });
  const hash = await bcrypt.hash(PASSWORD, 4);
  presi1 = (await prisma.usuario.create({ data: { nombre: 'Presidente 1', email: 'presi1@test.pe', rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, cargo_junta: 'presidente', estructura_id: e1.id, telefono: '987654323', aviso_email: true, aviso_whatsapp: true } })).id;
  await prisma.juntaDirectiva.create({ data: { complejo_id: d.complejoA.id, estructura_id: e1.id, desde: new Date('2026-01-01'), miembros: { create: [{ usuario_id: presi1, cargo: 'presidente' }] } } });
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    super: await login(base, 'super@test.pe'),
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    adminSin: await login(base, 'admin.huerfano@test.pe'),
    prop1: await login(base, 'prop1@test.pe'),
    presi1: await login(base, 'presi1@test.pe'),
  };
  canalesDeps.env = { ...process.env, EVOLUTION_URL: 'https://evo.ejemplo.test', EVOLUTION_APIKEY: 'evo-CLAVE-FALSA-NO-REAL' };
  canalesDeps.fetch = evolutionFalsa;
  canalesDeps.esperar = async () => {};
  canalesDeps.azar = () => 0.5;
});
after(async () => {
  Object.assign(canalesDeps, original);
  AbortSignal.timeout = originalTimeout;
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  mundo = mundoNuevo();
  tiempos.length = 0;
  AbortSignal.timeout = originalTimeout;
  canalesDeps.ahora = original.ahora;
  await esperarEnviosAGrupos();
  await prisma.notificacion.deleteMany();
  await prisma.comunicado.deleteMany();
  await prisma.consumoMensual.deleteMany();
  await prisma.suscripcionCondominio.deleteMany();
  await darCortesia(d.complejoA.id, d.complejoB.id);
  await prisma.grupoWhatsapp.deleteMany();
  await prisma.envioGrupoWhatsapp.deleteMany();
  await prisma.estructura.updateMany({ data: { whatsapp_grupo_jid: null, whatsapp_grupo_nombre: null, whatsapp_grupo_aviso: null, whatsapp_grupo_aviso_at: null } });
  await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: 'inst-a' } });
  await prisma.empresaAdministradora.update({ where: { id: d.empresaB.id }, data: { whatsapp_instance: 'inst-b' } });
  await prisma.configuracionComercial.update({ where: { id: (await obtenerConfiguracion()).id }, data: { whatsapp_tope_diario: 200 } });
  await prisma.usuario.updateMany({ where: { id: { in: [d.propietario1.id, d.inquilino1.id, d.propietario2.id] } }, data: { aviso_email: true, aviso_whatsapp: true, telefono: '987654320' } });
  invalidarComercial();
});

const llama = (t: string | null, metodo: string, ruta: string, cuerpo?: unknown) => llamar(base, metodo, ruta, t, cuerpo);
const sincronizar = (t: string | null = T.adminA) => llama(t, 'POST', '/api/whatsapp/grupos/sincronizar');
const grupoDe = (jid: string) => prisma.grupoWhatsapp.findFirstOrThrow({ where: { jid } });
/** Un grupo guardado (como lo deja «Traer mis grupos»), ya en uso o no. */
const crear = (jid: string, nombre: string, extra: { en_uso?: boolean; destino?: string; estructura?: { id: number } | null; complejo_id?: number; empresa_id?: number; ya_no_esta?: boolean } = {}) =>
  prisma.grupoWhatsapp.create({ data: { empresa_id: extra.empresa_id ?? d.empresaA.id, jid, nombre, en_uso: extra.en_uso ?? false, destino: extra.destino ?? null, estructura_id: extra.estructura?.id ?? null, complejo_id: extra.en_uso ? (extra.complejo_id ?? d.complejoA.id) : null, ya_no_esta: extra.ya_no_esta ?? false, sincronizado_at: new Date() } });
/** Los cuatro grupos de la prueba, ya en uso: vecinos del Block 1 y 2, junta del Block 1 y todo el condominio. */
async function enUso() {
  return {
    g1: await crear(G(1), 'Vecinos Block 1', { en_uso: true, destino: 'block', estructura: e1 }),
    g2: await crear(G(2), 'Vecinos Block 2', { en_uso: true, destino: 'block', estructura: e2 }),
    g3: await crear(G(3), 'Junta Block 1', { en_uso: true, destino: 'junta_block', estructura: e1 }),
    g4: await crear(G(4), 'Todo el condominio', { en_uso: true, destino: 'condominio' }),
  };
}
const nuevo = (extra: Record<string, unknown> = {}) => ({ titulo: 'Corte de agua', cuerpo: 'El sábado de 9:00 a 13:00 no habrá agua.', ...extra });
async function publicar(token: string, cuerpo: Record<string, unknown>) {
  const r = await llama(token, 'POST', '/api/comunicados', cuerpo);
  assert.equal(r.status, 201, r.texto);
  await esperarEnviosAGrupos();
  const c = await prisma.comunicado.findUniqueOrThrow({ where: { id: r.body.id } });
  return { id: r.body.id as number, grupos: (c.grupos_resultado ?? []) as unknown as ResultadoGrupo[] };
}

describe('Mis grupos: leer y traer', () => {
  it('GET lee de la base: NO llama a Evolution, no trae el JID y sólo muestra lo de la empresa', async () => {
    await enUso();
    await crear(GB, 'Block B vecinos', { empresa_id: d.empresaB.id });
    const r = await llama(T.adminA, 'GET', '/api/whatsapp/grupos');
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(mundo.llamadas, [], 'leer la lista no debe tocar Evolution');
    assert.equal(r.body.conectado, true);
    assert.deepEqual(r.body.grupos.map((g: { nombre: string }) => g.nombre), ['Junta Block 1', 'Todo el condominio', 'Vecinos Block 1', 'Vecinos Block 2']);
    assert.ok(!r.texto.includes('@g.us') && !r.texto.includes(GB));
    assert.deepEqual(r.body.condominios.map((c: { id: number }) => c.id), [d.complejoA.id], 'sólo los condominios de su empresa');
    assert.deepEqual(r.body.condominios[0].estructuras.map((e: { id: number }) => e.id), [e1.id, e2.id]);
  });

  it('«Traer mis grupos»: UNA llamada a Evolution con tope de 30 s, guarda nombre y miembros, y después GET sigue sin llamarla', async () => {
    AbortSignal.timeout = ((ms: number) => { tiempos.push(ms); return originalTimeout.call(AbortSignal, ms); }) as typeof AbortSignal.timeout;
    const r = await sincronizar();
    AbortSignal.timeout = originalTimeout;
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(mundo.llamadas, ['fetchAllGroups']);
    assert.ok(tiempos.includes(30_000), `tope amplio para la lista: ${tiempos.join(',')}`);
    assert.deepEqual(r.body.resumen, { nuevos: 4, actualizados: 0, ya_no_estan: 0, quitados: 0 });
    const g = r.body.grupos.find((x: { nombre: string }) => x.nombre === 'Vecinos Block 1');
    assert.deepEqual([g.miembros, g.en_uso, g.destino, g.ya_no_esta], [41, false, null, false]);
    assert.ok(g.sincronizado_at);
    assert.ok(!r.texto.includes('@g.us'));
    mundo.llamadas.length = 0;
    assert.equal((await llama(T.adminA, 'GET', '/api/whatsapp/grupos')).status, 200);
    assert.deepEqual(mundo.llamadas, []);
  });

  it('volver a traerlos actualiza nombre y miembros; el que ya no viene queda «ya no estás» (en uso: NO se borra) o sale de la lista (sin uso); si vuelve, se limpia', async () => {
    await sincronizar();
    const g1 = await grupoDe(G(1));
    await prisma.grupoWhatsapp.update({ where: { id: g1.id }, data: { en_uso: true, destino: 'block', complejo_id: d.complejoA.id, estructura_id: e1.id, aviso: 'El número ya no está en el grupo «x»' } });
    mundo.grupos['inst-a'] = [
      { jid: G(1), nombre: 'Vecinos Block 1 (nuevo nombre)', size: 44, participantes: [NUMERO_A] },
      { jid: G(5), nombre: 'Grupo nuevo', size: 9, participantes: [NUMERO_A] },
    ];
    const r = await sincronizar();
    assert.deepEqual(r.body.resumen, { nuevos: 1, actualizados: 1, ya_no_estan: 0, quitados: 3 });
    assert.deepEqual((await prisma.grupoWhatsapp.findMany({ orderBy: { jid: 'asc' } })).map((g) => g.jid), [G(1), G(5)]);
    const act = await grupoDe(G(1));
    assert.deepEqual([act.nombre, act.miembros, act.en_uso, act.destino, act.estructura_id], ['Vecinos Block 1 (nuevo nombre)', 44, true, 'block', e1.id], 'sigue en uso con su destino');
    // Lo sacan del grupo 1: queda marcado, NO se borra.
    mundo.grupos['inst-a'] = [{ jid: G(5), nombre: 'Grupo nuevo', size: 9, participantes: [NUMERO_A] }];
    const r2 = await sincronizar();
    assert.deepEqual(r2.body.resumen, { nuevos: 0, actualizados: 1, ya_no_estan: 1, quitados: 0 });
    const fuera = await grupoDe(G(1));
    assert.deepEqual([fuera.ya_no_esta, fuera.en_uso, fuera.destino], [true, true, 'block']);
    assert.equal(r2.body.grupos.find((g: { id: number }) => g.id === fuera.id).ya_no_esta, true);
    // Vuelve a entrar: se limpia la marca y el aviso viejo.
    mundo.grupos['inst-a'] = [{ jid: G(1), nombre: 'Vecinos Block 1', size: 40, participantes: [NUMERO_A] }];
    await sincronizar();
    const vuelve = await grupoDe(G(1));
    assert.deepEqual([vuelve.ya_no_esta, vuelve.aviso, vuelve.en_uso], [false, null, true]);
  });

  it('sin número conectado → 422 y ni una llamada; Evolution caído → 502 sin URL ni claves; lento → 504', async () => {
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: null } });
    assert.equal((await sincronizar()).status, 422);
    assert.deepEqual(mundo.llamadas, []);
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: 'inst-a' } });
    mundo.caido = true;
    const caido = await sincronizar();
    assert.equal(caido.status, 502);
    assert.doesNotMatch(caido.texto, /evo\.ejemplo|CLAVE-FALSA|apikey/i);
    mundo.caido = false;
    mundo.timeout = true;
    assert.equal((await sincronizar()).status, 504);
    assert.equal(await prisma.grupoWhatsapp.count(), 0, 'un fallo no deja la lista a medias');
  });

  it('dos «Traer mis grupos» a la vez de la misma empresa: la segunda es 409 y Evolution recibe UNA sola llamada', async () => {
    let soltar!: () => void;
    mundo.frenarLista = new Promise<void>((r) => { soltar = r; });
    const primera = sincronizar();
    await new Promise((r) => setTimeout(r, 150));
    const segunda = await sincronizar();
    assert.equal(segunda.status, 409, segunda.texto);
    soltar();
    assert.equal((await primera).status, 200);
    assert.equal(mundo.llamadas.filter((l) => l === 'fetchAllGroups').length, 1);
  });

  it('cada empresa trae y ve SÓLO sus grupos; el superadmin sin empresa, la junta y los vecinos no entran', async () => {
    await sincronizar(T.adminA);
    await sincronizar(T.adminB);
    const a = await llama(T.adminA, 'GET', '/api/whatsapp/grupos');
    const b = await llama(T.adminB, 'GET', '/api/whatsapp/grupos');
    assert.equal(a.body.grupos.length, 4);
    assert.deepEqual(b.body.grupos.map((g: { nombre: string }) => g.nombre), ['Block B vecinos']);
    assert.equal((await llama(T.super, 'GET', '/api/whatsapp/grupos')).status, 400);
    assert.equal((await llama(T.adminSin, 'GET', '/api/whatsapp/grupos')).status, 400, 'un admin sin empresa no tiene número que listar');
    for (const t of [T.presi1, T.prop1]) {
      assert.equal((await llama(t, 'GET', '/api/whatsapp/grupos')).status, 403);
      assert.equal((await sincronizar(t)).status, 403);
    }
    assert.equal((await llama(null, 'GET', '/api/whatsapp/grupos')).status, 401);
  });
});

describe('Mis grupos: usar en Torre y a quién representa', () => {
  const put = (t: string | null, id: number, cuerpo: unknown) => llama(t, 'PUT', `/api/whatsapp/grupos/${id}`, cuerpo);

  it('se usa para los vecinos de un block, para la junta de un block o para todo el condominio, y apagarlo borra el destino', async () => {
    const g = await crear(G(1), 'Vecinos Block 1');
    const a = await put(T.adminA, g.id, { en_uso: true, destino: 'block', estructura_id: e1.id });
    assert.equal(a.status, 200, a.texto);
    assert.deepEqual([a.body.en_uso, a.body.destino, a.body.estructura_id, a.body.complejo_id], [true, 'block', e1.id, d.complejoA.id]);
    const b = await put(T.adminA, g.id, { en_uso: true, destino: 'junta_block', estructura_id: e2.id });
    assert.deepEqual([b.body.destino, b.body.estructura_id], ['junta_block', e2.id]);
    const c = await put(T.adminA, g.id, { en_uso: true, destino: 'condominio', complejo_id: d.complejoA.id, estructura_id: e1.id });
    assert.deepEqual([c.status, c.body.destino, c.body.estructura_id, c.body.complejo_id], [200, 'condominio', null, d.complejoA.id], 'un grupo de todo el condominio no se queda pegado a un block');
    const off = await put(T.adminA, g.id, { en_uso: false });
    assert.deepEqual([off.body.en_uso, off.body.destino, off.body.estructura_id, off.body.complejo_id], [false, null, null, null]);
  });

  it('un block, un condominio o un grupo de OTRA empresa → 404 y no se guarda nada', async () => {
    const g = await crear(G(1), 'Vecinos Block 1');
    const ajeno = await crear(GB, 'Block B vecinos', { empresa_id: d.empresaB.id });
    for (const cuerpo of [
      { en_uso: true, destino: 'block', estructura_id: eB.id },
      { en_uso: true, destino: 'junta_block', estructura_id: eB.id },
      { en_uso: true, destino: 'condominio', complejo_id: d.complejoB.id },
      { en_uso: true, destino: 'block', estructura_id: e1.id, complejo_id: d.complejoB.id },
      { en_uso: true, destino: 'block', estructura_id: 99999 },
    ]) {
      const r = await put(T.adminA, g.id, cuerpo);
      assert.equal(r.status, 404, `${JSON.stringify(cuerpo)}: ${r.texto}`);
    }
    assert.deepEqual([(await grupoDe(G(1))).en_uso, (await grupoDe(G(1))).destino, (await grupoDe(G(1))).estructura_id], [false, null, null]);
    assert.equal((await put(T.adminA, ajeno.id, { en_uso: true, destino: 'block', estructura_id: e1.id })).status, 404, 'el grupo de otra empresa tampoco se toca');
    assert.equal((await put(T.adminB, g.id, { en_uso: true, destino: 'block', estructura_id: eB.id })).status, 404);
    assert.equal((await grupoDe(GB)).en_uso, false);
  });

  it('faltan datos o sobran campos → 422; un grupo en el que ya no estás no se puede usar', async () => {
    const g = await crear(G(1), 'Vecinos Block 1');
    assert.equal((await put(T.adminA, g.id, { en_uso: true })).status, 422, 'sin destino');
    assert.equal((await put(T.adminA, g.id, { en_uso: true, destino: 'block' })).status, 422, 'block sin block');
    assert.equal((await put(T.adminA, g.id, { en_uso: true, destino: 'condominio' })).status, 422, 'condominio sin condominio');
    assert.equal((await put(T.adminA, g.id, { en_uso: true, destino: 'otro', estructura_id: e1.id })).status, 422);
    assert.equal((await put(T.adminA, g.id, { en_uso: 'sí' })).status, 422);
    assert.equal((await put(T.adminA, g.id, { en_uso: true, destino: 'block', estructura_id: e1.id, jid: G(2) })).status, 422, 'el JID no se acepta del cliente');
    await prisma.grupoWhatsapp.update({ where: { id: g.id }, data: { ya_no_esta: true } });
    const r = await put(T.adminA, g.id, { en_uso: true, destino: 'block', estructura_id: e1.id });
    assert.equal(r.status, 422, r.texto);
    assert.equal((await grupoDe(G(1))).en_uso, false);
  });

  it('con el condominio en solo lectura (plan Gratis vencido) → 409; la junta, los vecinos y sin sesión no lo cambian', async () => {
    const g = await crear(G(1), 'Vecinos Block 1');
    for (const t of [T.presi1, T.prop1]) assert.equal((await put(t, g.id, { en_uso: true, destino: 'block', estructura_id: e1.id })).status, 403);
    assert.equal((await put(null, g.id, { en_uso: true, destino: 'block', estructura_id: e1.id })).status, 401);
    await prisma.suscripcionCondominio.deleteMany({ where: { complejo_id: d.complejoA.id } });
    await prisma.suscripcionCondominio.create({ data: { complejo_id: d.complejoA.id, plan_clave: 'gratis', estado: 'gratis', gratis_hasta: new Date(Date.now() - 3 * DIA) } });
    invalidarComercial();
    const r = await put(T.adminA, g.id, { en_uso: true, destino: 'block', estructura_id: e1.id });
    assert.equal(r.status, 409, r.texto);
    assert.equal(r.body.code, 'SOLO_LECTURA');
    assert.equal((await grupoDe(G(1))).en_uso, false);
  });
});

describe('Mis grupos: lo que ya estaba elegido en la ficha del block pasa solo', () => {
  const legado = (est: { id: number }, jid: string, nombre: string, aviso: string | null = null) =>
    prisma.estructura.update({ where: { id: est.id }, data: { whatsapp_grupo_jid: jid, whatsapp_grupo_nombre: nombre, whatsapp_grupo_aviso: aviso, whatsapp_grupo_aviso_at: aviso ? new Date() : null } });

  it('al leer «Mis grupos»: el grupo del block queda en uso (destino block), con su aviso, y la ficha vieja queda vacía', async () => {
    await legado(e1, G(1), 'Vecinos Block 1', 'El número ya no está en el grupo del Block 1');
    await legado(e2, G(2), 'Vecinos Block 2');
    const r = await llama(T.adminA, 'GET', '/api/whatsapp/grupos');
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(mundo.llamadas, []);
    const g1 = r.body.grupos.find((g: { nombre: string }) => g.nombre === 'Vecinos Block 1');
    assert.deepEqual([g1.en_uso, g1.destino, g1.estructura_id, g1.complejo_id, g1.aviso], [true, 'block', e1.id, d.complejoA.id, 'El número ya no está en el grupo del Block 1']);
    assert.equal(r.body.grupos.length, 2);
    for (const e of await prisma.estructura.findMany({ where: { id: { in: [e1.id, e2.id] } } })) assert.equal(e.whatsapp_grupo_jid, null, 'no quedan dos lugares que se contradigan');
  });

  it('es idempotente y NO revive un grupo que la administración apagó después', async () => {
    await legado(e1, G(1), 'Vecinos Block 1');
    await llama(T.adminA, 'GET', '/api/whatsapp/grupos');
    await llama(T.adminA, 'GET', '/api/whatsapp/grupos');
    assert.equal(await prisma.grupoWhatsapp.count(), 1);
    const g = await grupoDe(G(1));
    await llama(T.adminA, 'PUT', `/api/whatsapp/grupos/${g.id}`, { en_uso: false });
    await llama(T.adminA, 'GET', '/api/whatsapp/grupos');
    assert.equal((await grupoDe(G(1))).en_uso, false);
  });

  it('sin abrir la pantalla: el comunicado también lo encuentra (ámbitos y publicar) y escribe a ese grupo', async () => {
    await legado(e1, G(1), 'Vecinos Block 1');
    const amb = await llama(T.adminA, 'GET', '/api/comunicados/ambitos');
    assert.deepEqual(amb.body.complejos[0].grupos.map((g: { nombre: string }) => g.nombre), ['Vecinos Block 1']);
    await prisma.grupoWhatsapp.deleteMany();
    await legado(e1, G(1), 'Vecinos Block 1');
    const { grupos } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_grupo: true }));
    assert.equal(grupos[0]!.estado, 'enviado');
    assert.deepEqual(mundo.enviados.map((e) => e.jid), [G(1)]);
  });

  it('si «Traer mis grupos» llega antes que la lectura, lo elegido en la ficha manda y no se pierde (aunque el número ya no esté en el grupo)', async () => {
    await legado(e1, G(1), 'Vecinos Block 1');
    mundo.grupos['inst-a'] = [{ jid: G(2), nombre: 'Vecinos Block 2', size: 3, participantes: [NUMERO_A] }]; // el grupo 1 ya no viene
    const r = await sincronizar();
    assert.equal(r.status, 200, r.texto);
    const g = await grupoDe(G(1));
    assert.deepEqual([g.en_uso, g.destino, g.estructura_id, g.ya_no_esta], [true, 'block', e1.id, true], 'se conserva y queda marcado «ya no estás»');
  });
});

describe('comunicado: sólo a los grupos que se marcan', () => {
  it('con `grupos` envía EXACTAMENTE a esos (aunque haya otros del block en uso) y guarda lo elegido en el comunicado, sin JID', async () => {
    const { g1, g3 } = await enUso();
    const { id, grupos } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, grupos: [g3.id] }));
    assert.deepEqual(mundo.enviados.map((e) => e.jid), [G(3)], 'sólo el grupo de la junta; el de los vecinos NO');
    assert.deepEqual(grupos.map((g) => [g.grupo_id, g.nombre, g.estado]), [[g3.id, 'Junta Block 1', 'enviado']]);
    assert.ok(!JSON.stringify(grupos).includes('@g.us'));
    const c = await prisma.comunicado.findUniqueOrThrow({ where: { id } });
    assert.equal(c.enviar_grupo, true, 'pedir grupos da por hecho enviar_grupo');
    assert.notEqual(g1.id, g3.id);
  });

  it('marcar varios: salen todos y sólo ellos, con pausa entre uno y otro', async () => {
    const { g1, g2, g4 } = await enUso();
    const { grupos } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, grupos: [g1.id, g4.id] }));
    assert.deepEqual(mundo.enviados.map((e) => e.jid).sort(), [G(1), G(4)].sort());
    assert.deepEqual(grupos.map((g) => g.estado), ['enviado', 'enviado']);
    assert.ok(!mundo.enviados.some((e) => e.jid === G(2)));
    assert.notEqual(g2.id, g1.id);
  });

  it('`enviar_grupo: true` sin elegir marca lo mismo que la pantalla: para un block, los vecinos de ESE block (no su junta ni otros); para todo el condominio, los de cada block y los del condominio (no las juntas)', async () => {
    await enUso();
    await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_grupo: true }));
    assert.deepEqual(mundo.enviados.map((e) => e.jid), [G(1)]);
    mundo.enviados.length = 0;
    await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, enviar_grupo: true }));
    assert.deepEqual(mundo.enviados.map((e) => e.jid).sort(), [G(1), G(2), G(4)].sort());
  });

  it('un grupo apagado, de otro condominio o de otra empresa → 404 y no se publica ni se escribe nada', async () => {
    const { g1 } = await enUso();
    const apagado = await crear(G(7), 'Apagado');
    const deB = await crear(GB, 'Block B vecinos', { en_uso: true, destino: 'block', estructura: eB, empresa_id: d.empresaB.id, complejo_id: d.complejoB.id });
    const fuera = await crear(G(8), 'Ya no estás', { en_uso: true, destino: 'block', estructura: e1, ya_no_esta: true });
    for (const grupos of [[apagado.id], [deB.id], [fuera.id], [g1.id, deB.id], [99999]]) {
      const r = await llama(T.adminA, 'POST', '/api/comunicados', nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, grupos }));
      assert.equal(r.status, 404, `${grupos.join(',')}: ${r.texto}`);
    }
    // El administrador de B no puede usar el grupo de A en su condominio.
    assert.equal((await llama(T.adminB, 'POST', '/api/comunicados', nuevo({ complejo_id: d.complejoB.id, grupos: [g1.id] }))).status, 404);
    assert.equal(await prisma.comunicado.count(), 0);
    assert.equal(mundo.enviados.length, 0);
  });

  it('sin ningún grupo en uso o con `grupos` vacío → 422 y no se publica', async () => {
    const vacio = await llama(T.adminA, 'POST', '/api/comunicados', nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_grupo: true }));
    assert.equal(vacio.status, 422, vacio.texto);
    await enUso();
    const conVacia = await llama(T.adminA, 'POST', '/api/comunicados', nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_grupo: true, grupos: [] }));
    assert.equal(conVacia.status, 422, conVacia.texto);
    assert.equal(await prisma.comunicado.count(), 0);
  });

  it('la junta de un block ve y elige SÓLO los grupos de su block (vecinos y su junta); los de otro block, los del condominio o de otra empresa → 404', async () => {
    const { g1, g2, g3, g4 } = await enUso();
    const { grupos } = await publicar(T.presi1, nuevo({ grupos: [g1.id, g3.id] }));
    assert.deepEqual(mundo.enviados.map((e) => e.jid).sort(), [G(1), G(3)].sort());
    assert.equal(grupos.length, 2);
    for (const otro of [g2.id, g4.id]) {
      const r = await llama(T.presi1, 'POST', '/api/comunicados', nuevo({ grupos: [otro] }));
      assert.equal(r.status, 404, r.texto);
    }
    const amb = await llama(T.presi1, 'GET', '/api/comunicados/ambitos');
    assert.deepEqual(amb.body.complejos[0].grupos.map((g: { id: number }) => g.id).sort(), [g1.id, g3.id].sort());
    assert.equal(mundo.enviados.length, 2);
  });
});

describe('tope diario del número: los mensajes a grupos cuentan', () => {
  const ponerTope = async (n: number | null) => prisma.configuracionComercial.update({ where: { id: (await obtenerConfiguracion()).id }, data: { whatsapp_tope_diario: n } });

  it('cada grupo enviado suma al tope del día; al llegar al tope el siguiente queda «pendiente» con su motivo, sin enviarse', async () => {
    const { g1, g2, g4 } = await enUso();
    await ponerTope(2);
    const { id, grupos } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, grupos: [g1.id, g2.id, g4.id] }));
    assert.deepEqual(grupos.map((g) => g.estado), ['enviado', 'enviado', 'pendiente']);
    assert.equal(grupos[2]!.motivo, MOTIVO_TOPE_DIARIO);
    assert.equal(mundo.enviados.length, 2);
    assert.equal(await contarEnviadasHoy('inst-a', canalesDeps.ahora()), 2, 'los grupos entran en la cuenta del número');
    assert.equal(await prisma.envioGrupoWhatsapp.count({ where: { instancia: 'inst-a', estado: 'enviado', comunicado_id: id } }), 2);
    assert.equal(await prisma.envioGrupoWhatsapp.count({ where: { estado: 'fallo' } }), 0, 'quedar pendiente no es un fallo');
  });

  it('con el tope ya lleno por avisos 1-a-1: no se envía ningún grupo y ni siquiera se le pregunta a Evolution', async () => {
    const { g1 } = await enUso();
    await ponerTope(1);
    await prisma.notificacion.create({ data: { usuario_id: d.propietario1.id, canal: 'whatsapp', tipo: 'recibo_emitido', asunto: 'a', cuerpo: 'b', estado: 'enviada', enviada_at: new Date(), whatsapp_instancia: 'inst-a', ref_entidad: 'recibo', ref_id: d.reciboVencidoA.id } });
    const { grupos } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, grupos: [g1.id] }));
    assert.deepEqual([grupos[0]!.estado, grupos[0]!.motivo], ['pendiente', MOTIVO_TOPE_DIARIO]);
    assert.deepEqual(mundo.llamadas, []);
    assert.equal(await prisma.consumoMensual.count(), 0, 'lo pendiente no gasta cuota mensual');
  });

  it('sin tope (null o 0) los grupos salen todos', async () => {
    const { g1, g2, g4 } = await enUso();
    for (const sin of [null, 0]) {
      await ponerTope(sin);
      mundo.enviados.length = 0;
      await prisma.comunicado.deleteMany();
      await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, grupos: [g1.id, g2.id, g4.id] }));
      assert.equal(mundo.enviados.length, 3, `tope ${sin}`);
    }
  });

  it('los grupos llenan el tope y un aviso 1-a-1 de la cola queda para mañana a las 08:00 (Lima), sin intento', async () => {
    const { g1, g2 } = await enUso();
    await ponerTope(2);
    canalesDeps.ahora = () => HOY;
    await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, grupos: [g1.id, g2.id] }));
    const n = await prisma.notificacion.create({ data: { usuario_id: d.propietario1.id, canal: 'whatsapp', tipo: 'recibo_emitido', asunto: 'a', cuerpo: 'Cuerpo', estado: 'pendiente', programada_para: new Date(HOY.getTime() - 60_000), ref_entidad: 'recibo', ref_id: d.reciboVencidoA.id } });
    const llamadas: string[] = [];
    const deps: DepsAvisos = { ahora: () => HOY, env: { EVOLUTION_URL: 'https://evo.ejemplo.test', EVOLUTION_APIKEY: 'k', RESEND_API_KEY: 'r', MAIL_FROM: 'a@b.test' }, fetch: (async (u: string | URL | Request) => { llamadas.push(String(u)); return new Response('{}'); }) as typeof fetch, esperar: async () => {}, azar: () => 0 };
    await procesarCola(deps);
    const despues = await prisma.notificacion.findUniqueOrThrow({ where: { id: n.id } });
    assert.equal(despues.estado, 'pendiente');
    assert.equal(despues.intentos, 0);
    assert.equal(despues.programada_para.getTime(), manana0800Lima(HOY).getTime());
    assert.deepEqual(llamadas.filter((l) => l.includes('sendText')), [], 'el tope lo llenaron los grupos: nada más sale hoy');
  });

  it('al día siguiente «reintentar» envía los grupos pendientes y deja el resultado; sin pendientes → 409; otra empresa → 404; la junta de otro block no lo toca', async () => {
    const { g1, g2, g4 } = await enUso();
    await ponerTope(1);
    canalesDeps.ahora = () => HOY;
    const { id } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, grupos: [g1.id, g2.id, g4.id] }));
    assert.equal(mundo.enviados.length, 1);
    assert.equal((await llama(T.adminB, 'POST', `/api/comunicados/${id}/reintentar-grupos`)).status, 404);
    assert.equal((await llama(T.presi1, 'POST', `/api/comunicados/${id}/reintentar-grupos`)).status, 404, 'es un comunicado del condominio: la junta de un block no lo gestiona');
    // Hoy sigue lleno: reintentar no envía nada y los deja pendientes.
    assert.equal((await llama(T.adminA, 'POST', `/api/comunicados/${id}/reintentar-grupos`)).status, 202);
    await esperarEnviosAGrupos();
    assert.equal(mundo.enviados.length, 1);
    // Mañana hay cupo para uno (tope 1): sale el siguiente, el otro sigue pendiente.
    canalesDeps.ahora = () => new Date(HOY.getTime() + DIA);
    const r = await llama(T.adminA, 'POST', `/api/comunicados/${id}/reintentar-grupos`);
    assert.deepEqual([r.status, r.body.pendientes], [202, 2]);
    await esperarEnviosAGrupos();
    assert.equal(mundo.enviados.length, 2);
    const filas = (await prisma.comunicado.findUniqueOrThrow({ where: { id } })).grupos_resultado as unknown as ResultadoGrupo[];
    assert.deepEqual(filas.map((f) => f.estado), ['enviado', 'enviado', 'pendiente']);
    await ponerTope(null);
    await llama(T.adminA, 'POST', `/api/comunicados/${id}/reintentar-grupos`);
    await esperarEnviosAGrupos();
    assert.equal(mundo.enviados.length, 3);
    assert.equal((await llama(T.adminA, 'POST', `/api/comunicados/${id}/reintentar-grupos`)).status, 409, 'ya no queda nada pendiente');
  });
});
