// Comunicados a la junta, al grupo de WhatsApp del block y (sólo si se marca) a cada vecino. Nada sale a la red: Evolution va con `fetch` falso.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { darCortesia, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { canalesDeps } from '../src/server/services/canales/deps';
import { esperarEnviosAGrupos, MAX_CUERPO_GRUPO, textoParaGrupo, type ResultadoGrupo } from '../src/server/services/canales/grupos';
import { MOTIVO_SIN_WHATSAPP } from '../src/server/services/avisos/cola';
import { MOTIVO_TOPE_WHATSAPP, reservarConsumo } from '../src/server/services/comercial/consumo';
import { invalidarComercial } from '../src/server/services/comercial/modulos';

const DIA = 86_400_000;
const NUMERO_A = '51999000111';
const G1 = '120363000000000001@g.us';
const G2 = '120363000000000002@g.us';
const G3 = '120363000000000003@g.us';
const GB = '120363000000000099@g.us';

interface GrupoFalso { jid: string; nombre: string; participantes: string[]; /** WhatsApp entrega identificadores internos (`…@lid`) en vez del número. */ lid?: boolean }
/** Lo que Evolution «tiene» en cada prueba: los grupos de cada instancia y las llamadas que le llegaron. */
let mundo: {
  grupos: Record<string, GrupoFalso[]>;
  numeros: Record<string, string | null>;
  enviados: { instancia: string; jid: string; texto: string }[];
  llamadas: string[];
  fallaSend: boolean;
  caido: boolean;
};
const pausas: number[] = [];
const original = { fetch: canalesDeps.fetch, env: canalesDeps.env, esperar: canalesDeps.esperar, azar: canalesDeps.azar };

const mundoNuevo = (): typeof mundo => ({
  grupos: {
    'inst-a': [
      { jid: G1, nombre: 'Vecinos Block 1', participantes: [NUMERO_A, '51988000001'] },
      { jid: G2, nombre: 'Vecinos Block 2', participantes: [NUMERO_A, '51988000002'] },
      { jid: G3, nombre: 'Administración y proveedores', participantes: [NUMERO_A] },
    ],
    'inst-b': [{ jid: GB, nombre: 'Block B vecinos', participantes: ['51977000001'] }],
  },
  numeros: { 'inst-a': NUMERO_A, 'inst-b': '51977000001' },
  enviados: [],
  llamadas: [],
  fallaSend: false,
  caido: false,
});

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
const evolutionFalsa = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(url));
  if (mundo.caido) throw new Error('sin red');
  const [, , a, b] = u.pathname.split('/'); // /group/fetchAllGroups/<instancia>
  const instancia = decodeURIComponent(b ?? '');
  if (u.pathname.startsWith('/instance/fetchInstances')) {
    mundo.llamadas.push('fetchInstances');
    const n = mundo.numeros[u.searchParams.get('instanceName') ?? ''];
    return json(n ? [{ ownerJid: `${n}@s.whatsapp.net` }] : []);
  }
  if (a === 'fetchAllGroups') {
    mundo.llamadas.push('fetchAllGroups');
    // Como WhatsApp: la lista sólo trae los grupos donde el número de la instancia sigue siendo participante.
    const propio = mundo.numeros[instancia];
    return json((mundo.grupos[instancia] ?? []).filter((g) => propio != null && g.participantes.includes(propio)).map((g) => ({ id: g.jid, subject: g.nombre, size: g.participantes.length })));
  }
  if (a === 'findGroupInfos') {
    mundo.llamadas.push('findGroupInfos');
    const g = (mundo.grupos[instancia] ?? []).find((x) => x.jid === u.searchParams.get('groupJid'));
    return g ? json({ id: g.jid, subject: g.nombre, participants: g.participantes.map((n, i) => (g.lid ? { id: `9${i}${n.slice(-6)}0001@lid` } : { id: `${n}@s.whatsapp.net` })) }) : json({ error: 'no está' }, 404);
  }
  if (u.pathname.startsWith('/message/sendText/')) {
    mundo.llamadas.push('sendText');
    if (mundo.fallaSend) return json({ error: 'boom' }, 500);
    const cuerpo = JSON.parse(String(init?.body)) as { number: string; text: string };
    mundo.enviados.push({ instancia: decodeURIComponent(u.pathname.split('/')[3] ?? ''), jid: cuerpo.number, texto: cuerpo.text });
    return json({ ok: true });
  }
  throw new Error(`Llamada no prevista a Evolution: ${u.pathname}`);
}) as typeof fetch;

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let e1: { id: number }, e2: { id: number }, e3: { id: number }, eB: { id: number };
type Clave = 'presi1' | 'tesor1' | 'secre1' | 'presi2' | 'presiCentral' | 'presiB';
let u: Record<Clave, number>;
let T: Record<'super' | 'adminA' | 'adminB' | 'adminSin' | 'prop1' | Clave, string>;

before(async () => {
  d = await sembrar();
  e1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
  e2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'Block', complejo_id: d.complejoA.id } });
  e3 = await prisma.estructura.create({ data: { nombre: 'Block 3', tipo: 'Block', complejo_id: d.complejoA.id } });
  eB = await prisma.estructura.create({ data: { nombre: 'Block B', tipo: 'Block', complejo_id: d.complejoB.id } });
  await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: e1.id } });
  await prisma.unidad.update({ where: { id: d.unidadA2.id }, data: { estructura_id: e2.id } });
  await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: 'inst-a' } });
  await prisma.empresaAdministradora.update({ where: { id: d.empresaB.id }, data: { whatsapp_instance: 'inst-b' } });
  const hash = await bcrypt.hash(PASSWORD, 4);
  const junta = async (nombre: string, email: string, cargo: string, complejo: { id: number; empresa_id: number | null }, estructura_id: number | null) =>
    (await prisma.usuario.create({ data: { nombre, email, rol: 'propietario', password_hash: hash, empresa_id: complejo.empresa_id, complejo_id: complejo.id, cargo_junta: cargo, estructura_id, telefono: '987654321', aviso_email: true, aviso_whatsapp: true } })).id;
  u = {
    presi1: await junta('Presidente 1', 'presi1@test.pe', 'presidente', d.complejoA, e1.id),
    tesor1: await junta('Tesorero 1', 'tesor1@test.pe', 'tesorero', d.complejoA, e1.id),
    secre1: await junta('Secretario 1', 'secre1@test.pe', 'secretario', d.complejoA, e1.id),
    presi2: await junta('Presidente 2', 'presi2@test.pe', 'presidente', d.complejoA, e2.id),
    presiCentral: await junta('Presidente Central', 'presicentral@test.pe', 'presidente', d.complejoA, null),
    presiB: await junta('Presidente B', 'presib@test.pe', 'presidente', d.complejoB, eB.id),
  };
  const gestion = async (complejo_id: number, estructura_id: number | null, miembros: [number, string][]) =>
    prisma.juntaDirectiva.create({ data: { complejo_id, estructura_id, desde: new Date('2026-01-01'), miembros: { create: miembros.map(([usuario_id, cargo]) => ({ usuario_id, cargo })) } } });
  await gestion(d.complejoA.id, e1.id, [[u.presi1, 'presidente'], [u.tesor1, 'tesorero'], [u.secre1, 'secretario']]);
  await gestion(d.complejoA.id, e2.id, [[u.presi2, 'presidente']]);
  await gestion(d.complejoA.id, null, [[u.presiCentral, 'presidente']]);
  // Una gestión ya terminada del Block 1: sus miembros NO reciben nada.
  const viejo = await prisma.usuario.create({ data: { nombre: 'Ex presidente', email: 'ex@test.pe', rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, telefono: '987654322', aviso_email: true, aviso_whatsapp: true } });
  await prisma.juntaDirectiva.create({ data: { complejo_id: d.complejoA.id, estructura_id: e1.id, desde: new Date('2024-01-01'), hasta: new Date('2025-12-31'), miembros: { create: [{ usuario_id: viejo.id, cargo: 'presidente' }] } } });
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    super: await login(base, 'super@test.pe'),
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    adminSin: await login(base, 'admin.huerfano@test.pe'),
    prop1: await login(base, 'prop1@test.pe'),
    presi1: await login(base, 'presi1@test.pe'),
    tesor1: await login(base, 'tesor1@test.pe'),
    secre1: await login(base, 'secre1@test.pe'),
    presi2: await login(base, 'presi2@test.pe'),
    presiCentral: await login(base, 'presicentral@test.pe'),
    presiB: await login(base, 'presib@test.pe'),
  };
  canalesDeps.env = { ...process.env, EVOLUTION_URL: 'https://evo.ejemplo.test', EVOLUTION_APIKEY: 'evo-CLAVE-FALSA-NO-REAL' };
  canalesDeps.fetch = evolutionFalsa;
  canalesDeps.esperar = async (ms) => { pausas.push(ms); };
  canalesDeps.azar = () => 0.5;
});
after(async () => {
  Object.assign(canalesDeps, original);
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  mundo = mundoNuevo();
  pausas.length = 0;
  await esperarEnviosAGrupos();
  await prisma.notificacion.deleteMany();
  await prisma.comunicado.deleteMany();
  await prisma.consumoMensual.deleteMany();
  await prisma.suscripcionCondominio.deleteMany();
  await darCortesia(d.complejoA.id, d.complejoB.id);
  await prisma.estructura.updateMany({ data: { whatsapp_grupo_jid: null, whatsapp_grupo_nombre: null, whatsapp_grupo_aviso: null, whatsapp_grupo_aviso_at: null } });
  await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: 'inst-a' } });
  await prisma.usuario.updateMany({ where: { id: { in: [d.propietario1.id, d.inquilino1.id, d.propietario2.id] } }, data: { aviso_email: true, aviso_whatsapp: true, telefono: '987654320' } });
});

const llama = (t: string | null, metodo: string, ruta: string, cuerpo?: unknown) => llamar(base, metodo, ruta, t, cuerpo);
const poner = async (estructura: { id: number }, jid: string | null, nombre: string | null = null) =>
  prisma.estructura.update({ where: { id: estructura.id }, data: { whatsapp_grupo_jid: jid, whatsapp_grupo_nombre: nombre } });
const conGrupos = async () => { await poner(e1, G1, 'Vecinos Block 1'); await poner(e2, G2, 'Vecinos Block 2'); };
const nuevo = (extra: Record<string, unknown> = {}) => ({ titulo: 'Corte de agua', cuerpo: 'El sábado de 9:00 a 13:00 no habrá agua por mantenimiento de la cisterna.', ...extra });
/** Publica y espera a que terminen los envíos a grupos (corren después de responder). */
async function publicar(token: string, cuerpo: Record<string, unknown>) {
  const r = await llama(token, 'POST', '/api/comunicados', cuerpo);
  assert.equal(r.status, 201, r.texto);
  await esperarEnviosAGrupos();
  const c = await prisma.comunicado.findUniqueOrThrow({ where: { id: r.body.id } });
  return { respuesta: r.body as { id: number; avisos_encolados: number; grupos_resultado: ResultadoGrupo[] | null }, c, grupos: (c.grupos_resultado ?? []) as unknown as ResultadoGrupo[] };
}
const avisosDe = async (id: number) => prisma.notificacion.findMany({ where: { ref_entidad: 'comunicado', ref_id: id }, select: { usuario_id: true, canal: true } });
const usuariosAvisados = async (id: number) => [...new Set((await avisosDe(id)).map((n) => n.usuario_id))].sort((a, b) => a - b);
async function ponerPro(whatsapp: number | null) {
  await prisma.planComercial.update({ where: { clave: 'pro' }, data: { whatsapp_por_unidad_mes: whatsapp, unidades_minimas: null } });
  await prisma.suscripcionCondominio.deleteMany({ where: { complejo_id: d.complejoA.id } });
  await prisma.suscripcionCondominio.create({ data: { complejo_id: d.complejoA.id, plan_clave: 'pro', modulos: [], estado: 'activa', es_prueba: false, vigente_hasta: new Date(Date.now() + 60 * DIA) } });
  invalidarComercial();
}

describe('grupos de WhatsApp del block: la lista', () => {
  it('trae sólo los grupos de la instancia de la empresa de la torre, con el nombre que dice Evolution', async () => {
    const r = await llama(T.adminA, 'GET', `/api/estructuras/${e1.id}/grupos-whatsapp`);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.conectado, true);
    assert.deepEqual(r.body.grupos.map((g: { jid: string }) => g.jid).sort(), [G1, G2, G3].sort());
    assert.ok(!r.texto.includes(GB), 'ni rastro del grupo de la otra empresa');
    assert.equal(r.body.actual, null);
    assert.ok(mundo.llamadas.every((l) => l === 'fetchAllGroups'), 'sólo la lista, sin participantes');
  });

  it('otra empresa → 404 y nunca llega a Evolution; la junta y los vecinos → 403', async () => {
    assert.equal((await llama(T.adminB, 'GET', `/api/estructuras/${e1.id}/grupos-whatsapp`)).status, 404);
    assert.equal((await llama(T.adminSin, 'GET', `/api/estructuras/${e1.id}/grupos-whatsapp`)).status, 403, 'un admin sin empresa no entra');
    assert.deepEqual(mundo.llamadas, []);
    for (const t of ['presi1', 'tesor1', 'prop1'] as const) assert.equal((await llama(T[t], 'GET', `/api/estructuras/${e1.id}/grupos-whatsapp`)).status, 403, t);
    assert.equal((await llama(null, 'GET', `/api/estructuras/${e1.id}/grupos-whatsapp`)).status, 401);
  });

  it('el superadmin ve los de la empresa dueña de ESE block (no los de otra)', async () => {
    const r = await llama(T.super, 'GET', `/api/estructuras/${eB.id}/grupos-whatsapp`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.grupos.map((g: { jid: string }) => g.jid), [GB]);
  });

  it('sin número conectado: `conectado: false`, lista vacía y ni una llamada a Evolution', async () => {
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: null } });
    const r = await llama(T.adminA, 'GET', `/api/estructuras/${e1.id}/grupos-whatsapp`);
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.conectado, r.body.grupos], [false, []]);
    assert.deepEqual(mundo.llamadas, []);
  });

  it('Evolution caído: 502 con una frase corta, sin URL ni claves', async () => {
    mundo.caido = true;
    const r = await llama(T.adminA, 'GET', `/api/estructuras/${e1.id}/grupos-whatsapp`);
    assert.equal(r.status, 502);
    assert.doesNotMatch(r.texto, /evo\.ejemplo|CLAVE-FALSA|apikey/i);
  });
});

describe('grupos de WhatsApp del block: elegir', () => {
  const put = (t: string | null, est: { id: number }, jid: unknown) => llama(t, 'PUT', `/api/estructuras/${est.id}/grupo-whatsapp`, { jid });

  it('guarda el grupo de la lista con el nombre de Evolution, y se puede cambiar y quitar', async () => {
    const r = await put(T.adminA, e1, G1);
    assert.equal(r.status, 200, r.texto);
    const e = await prisma.estructura.findUniqueOrThrow({ where: { id: e1.id } });
    assert.deepEqual([e.whatsapp_grupo_jid, e.whatsapp_grupo_nombre], [G1, 'Vecinos Block 1']);
    assert.equal((await put(T.adminA, e1, G3)).status, 200);
    assert.equal((await prisma.estructura.findUniqueOrThrow({ where: { id: e1.id } })).whatsapp_grupo_nombre, 'Administración y proveedores');
    assert.equal((await put(T.adminA, e1, null)).status, 200);
    const sin = await prisma.estructura.findUniqueOrThrow({ where: { id: e1.id } });
    assert.deepEqual([sin.whatsapp_grupo_jid, sin.whatsapp_grupo_nombre], [null, null]);
  });

  it('un JID de OTRA instancia → 422 y no se guarda', async () => {
    const r = await put(T.adminA, e1, GB);
    assert.equal(r.status, 422, r.texto);
    assert.ok(r.body.campos?.jid);
    assert.equal((await prisma.estructura.findUniqueOrThrow({ where: { id: e1.id } })).whatsapp_grupo_jid, null);
  });

  it('un JID escrito a mano (bien formado pero que no está en la lista) o mal formado → 422', async () => {
    for (const jid of ['120363999999999999@g.us', '51999000111@s.whatsapp.net', 'hola', '', 123]) {
      const r = await put(T.adminA, e1, jid);
      assert.equal(r.status, 422, `${String(jid)}: ${r.texto}`);
    }
    assert.equal((await put(T.adminA, e1, undefined)).status, 422);
    assert.equal((await llama(T.adminA, 'PUT', `/api/estructuras/${e1.id}/grupo-whatsapp`, { jid: G1, nombre: 'Lo escribí yo' })).status, 422, 'el nombre no se acepta del cliente');
    assert.equal((await prisma.estructura.findUniqueOrThrow({ where: { id: e1.id } })).whatsapp_grupo_jid, null);
  });

  it('otra empresa → 404; la junta, los vecinos y sin sesión no lo cambian', async () => {
    assert.equal((await put(T.adminB, e1, G1)).status, 404);
    assert.equal((await put(T.presi1, e1, G1)).status, 403);
    assert.equal((await put(T.prop1, e1, G1)).status, 403);
    assert.equal((await put(null, e1, G1)).status, 401);
    assert.equal((await prisma.estructura.findUniqueOrThrow({ where: { id: e1.id } })).whatsapp_grupo_jid, null);
  });

  it('el mismo grupo no puede ser de dos blocks', async () => {
    await put(T.adminA, e1, G1);
    const r = await put(T.adminA, e2, G1);
    assert.equal(r.status, 422, r.texto);
    assert.equal((await prisma.estructura.findUniqueOrThrow({ where: { id: e2.id } })).whatsapp_grupo_jid, null);
  });

  it('sin número conectado no se puede elegir; Evolution caído → 502', async () => {
    mundo.caido = true;
    assert.equal((await put(T.adminA, e1, G1)).status, 502);
    mundo.caido = false;
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: null } });
    assert.equal((await put(T.adminA, e1, G1)).status, 422);
  });

  it('con el condominio en solo lectura (plan Gratis vencido) elegir el grupo → 409 y no se guarda', async () => {
    await prisma.suscripcionCondominio.deleteMany({ where: { complejo_id: d.complejoA.id } });
    await prisma.suscripcionCondominio.create({ data: { complejo_id: d.complejoA.id, plan_clave: 'gratis', estado: 'gratis', gratis_hasta: new Date(Date.now() - 3 * DIA) } }); // 3 días: con 1 día, de 19:00 a 24:00 de Lima (ya otro día en UTC) aún no vencía
    invalidarComercial();
    const r = await put(T.adminA, e1, G1);
    assert.equal(r.status, 409, r.texto);
    assert.equal(r.body.code, 'SOLO_LECTURA');
    assert.equal((await prisma.estructura.findUniqueOrThrow({ where: { id: e1.id } })).whatsapp_grupo_jid, null);
  });

  it('quitar el grupo borra también el aviso del último envío; el crud genérico NO acepta el JID', async () => {
    await prisma.estructura.update({ where: { id: e1.id }, data: { whatsapp_grupo_jid: G1, whatsapp_grupo_nombre: 'Vecinos Block 1', whatsapp_grupo_aviso: 'El número ya no está en el grupo del Block 1' } });
    assert.equal((await put(T.adminA, e1, null)).status, 200);
    assert.equal((await prisma.estructura.findUniqueOrThrow({ where: { id: e1.id } })).whatsapp_grupo_aviso, null);
    const r = await llama(T.adminA, 'PUT', `/api/estructuras/${e1.id}`, { nombre: 'Block 1', whatsapp_grupo_jid: G2 });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await prisma.estructura.findUniqueOrThrow({ where: { id: e1.id } })).whatsapp_grupo_jid, null);
  });
});

describe('comunicado al grupo del block y a la junta', () => {
  it('a un block con grupo: UN envío a su JID y la junta de ESE block (3 personas, correo y WhatsApp); nadie más', async () => {
    await conGrupos();
    const { respuesta, grupos, c } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_junta: true, enviar_grupo: true }));
    assert.equal(mundo.enviados.length, 1);
    assert.deepEqual([mundo.enviados[0]!.instancia, mundo.enviados[0]!.jid], ['inst-a', G1]);
    assert.match(mundo.enviados[0]!.texto, /Corte de agua/);
    assert.match(mundo.enviados[0]!.texto, /https:\/\/torrecondominios\.com/);
    assert.deepEqual(grupos.map((g) => [g.estructura_id, g.estado]), [[e1.id, 'enviado']]);
    assert.deepEqual([c.enviar_junta, c.enviar_grupo], [true, true]);
    assert.deepEqual(await usuariosAvisados(respuesta.id), [u.presi1, u.tesor1, u.secre1].sort((a, b) => a - b));
    assert.equal(respuesta.avisos_encolados, 6, '3 personas × (correo + WhatsApp)');
    const canales = new Set((await avisosDe(respuesta.id)).map((n) => n.canal));
    assert.deepEqual([...canales].sort(), ['email', 'whatsapp']);
  });

  it('la validación (findGroupInfos) va ANTES del envío', async () => {
    await conGrupos();
    await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_grupo: true }));
    assert.ok(mundo.llamadas.indexOf('findGroupInfos') >= 0 && mundo.llamadas.indexOf('findGroupInfos') < mundo.llamadas.indexOf('sendText'), mundo.llamadas.join(' > '));
  });

  it('para todo el condominio: un envío por block CON grupo (el Block 3 sin grupo no recibe), con pausa entre grupos, y la junta de todos los blocks más la central', async () => {
    await conGrupos();
    const { respuesta, grupos } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, enviar_junta: true, enviar_grupo: true }));
    assert.deepEqual(mundo.enviados.map((e) => e.jid).sort(), [G1, G2].sort());
    assert.deepEqual(grupos.map((g) => g.estado), ['enviado', 'enviado']);
    assert.equal(pausas.length, 1, 'pausa sólo ENTRE grupos, no antes del primero');
    assert.deepEqual(await usuariosAvisados(respuesta.id), [u.presi1, u.tesor1, u.secre1, u.presi2, u.presiCentral].sort((a, b) => a - b));
  });

  it('un comunicado del condominio NO llega a la junta de otro condominio ni a las gestiones ya terminadas', async () => {
    await conGrupos();
    const { respuesta } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, enviar_junta: true }));
    const ids = await usuariosAvisados(respuesta.id);
    assert.ok(!ids.includes(u.presiB));
    const ex = await prisma.usuario.findFirstOrThrow({ where: { email: 'ex@test.pe' } });
    assert.ok(!ids.includes(ex.id), 'el ex presidente no recibe nada');
    assert.equal(mundo.enviados.length, 0, 'sin enviar_grupo no se escribe a ningún grupo');
  });

  it('número fuera del grupo: NO envía, deja el motivo en el comunicado y en la ficha del block, y no gasta cuota', async () => {
    await ponerPro(5);
    await conGrupos();
    mundo.grupos['inst-a']![0]!.participantes = ['51988000001']; // el número ya no está en el Block 1
    const { grupos } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_grupo: true }));
    assert.equal(mundo.enviados.length, 0);
    assert.equal(grupos[0]!.estado, 'fallo');
    assert.equal(grupos[0]!.motivo, 'El número ya no está en el grupo del Block 1');
    const e = await prisma.estructura.findUniqueOrThrow({ where: { id: e1.id } });
    assert.equal(e.whatsapp_grupo_aviso, 'El número ya no está en el grupo del Block 1');
    assert.ok(e.whatsapp_grupo_aviso_at);
    assert.equal(await prisma.consumoMensual.count({ where: { complejo_id: d.complejoA.id } }), 0, 'lo que no se envía no gasta cuota');
  });

  it('WhatsApp con identificadores internos (@lid): el propio número no se reconoce entre los participantes, pero el grupo sigue en su lista → envía', async () => {
    await ponerPro(5);
    await conGrupos();
    mundo.grupos['inst-a']![0]!.lid = true; // como Evolution 2.3.7 en producción: participantes «…@lid», sin número
    const { grupos } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_grupo: true }));
    assert.equal(grupos[0]!.estado, 'enviado', grupos[0]!.motivo ?? '');
    assert.equal(mundo.enviados.length, 1);
    assert.equal(mundo.enviados[0]!.jid, G1);
  });

  it('si lo sacaron y Evolution ya no devuelve el grupo (404) y tampoco está en su lista: «ya no está»; si la lista sí lo tiene: «no se pudo comprobar» y no escribe', async () => {
    await conGrupos();
    const lista = mundo.grupos['inst-a']!;
    mundo.grupos['inst-a'] = lista.filter((g) => g.jid !== G1);
    const a = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_grupo: true }));
    assert.equal(a.grupos[0]!.motivo, 'El número ya no está en el grupo del Block 1');
    assert.equal(mundo.enviados.length, 0);
    // Evolution contesta con error al pedir los participantes pero el grupo sigue en la lista: no se sabe → no se escribe, y sin alarma en la ficha.
    mundo.grupos['inst-a'] = lista;
    const original = mundo.llamadas;
    canalesDeps.fetch = (async (url: string | URL | Request, init?: RequestInit) => (String(url).includes('findGroupInfos') ? json({}, 500) : evolutionFalsa(url, init))) as typeof fetch;
    await prisma.estructura.update({ where: { id: e1.id }, data: { whatsapp_grupo_aviso: null } });
    const b = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_grupo: true }));
    canalesDeps.fetch = evolutionFalsa;
    assert.match(b.grupos[0]!.motivo ?? '', /^No se pudo comprobar el grupo del Block 1/);
    assert.equal(mundo.enviados.length, 0);
    assert.equal((await prisma.estructura.findUniqueOrThrow({ where: { id: e1.id } })).whatsapp_grupo_aviso, null);
    assert.ok(original);
  });

  it('no se puede confirmar el número de la instancia: no escribe', async () => {
    await conGrupos();
    mundo.numeros['inst-a'] = null;
    const { grupos } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_grupo: true }));
    assert.equal(mundo.enviados.length, 0);
    assert.match(grupos[0]!.motivo ?? '', /No se pudo comprobar el grupo del Block 1/);
  });

  it('Evolution trae el número en `phoneNumber` (id tipo LID): también cuenta como participante', async () => {
    await conGrupos();
    canalesDeps.fetch = (async (url: string | URL | Request, init?: RequestInit) => (String(url).includes('findGroupInfos')
      ? json({ id: G1, participants: [{ id: '99887766@lid', phoneNumber: `${NUMERO_A}@s.whatsapp.net` }] })
      : evolutionFalsa(url, init))) as typeof fetch;
    const { grupos } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_grupo: true }));
    canalesDeps.fetch = evolutionFalsa;
    assert.equal(grupos[0]!.estado, 'enviado');
  });

  it('un envío exitoso limpia el aviso que había quedado en la ficha del block', async () => {
    await conGrupos();
    await prisma.estructura.update({ where: { id: e1.id }, data: { whatsapp_grupo_aviso: 'El número ya no está en el grupo del Block 1', whatsapp_grupo_aviso_at: new Date() } });
    await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_grupo: true }));
    const e = await prisma.estructura.findUniqueOrThrow({ where: { id: e1.id } });
    assert.deepEqual([e.whatsapp_grupo_aviso, e.whatsapp_grupo_aviso_at], [null, null]);
  });

  it('Evolution responde error al enviar: queda `fallo` con motivo corto (sin URL ni claves) y el aviso en la ficha', async () => {
    await conGrupos();
    mundo.fallaSend = true;
    const { grupos } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_grupo: true }));
    assert.equal(grupos[0]!.estado, 'fallo');
    assert.match(grupos[0]!.motivo ?? '', /No se pudo escribir en el grupo del Block 1/);
    assert.doesNotMatch(JSON.stringify(grupos), /evo\.ejemplo|CLAVE-FALSA/);
    assert.match((await prisma.estructura.findUniqueOrThrow({ where: { id: e1.id } })).whatsapp_grupo_aviso ?? '', /No se pudo escribir/);
  });

  it('un fallo en un block no frena a los demás', async () => {
    await conGrupos();
    mundo.grupos['inst-a']![0]!.participantes = [];
    const { grupos } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, enviar_grupo: true }));
    assert.deepEqual(grupos.map((g) => [g.estructura_id, g.estado]), [[e1.id, 'fallo'], [e2.id, 'enviado']]);
    assert.deepEqual(mundo.enviados.map((e) => e.jid), [G2]);
    assert.equal(pausas.length, 0, 'no hubo envío previo: no hay pausa');
  });

  it('pedir el grupo donde no hay ninguno → 422 y no se publica nada', async () => {
    await conGrupos();
    const sin = await llama(T.adminA, 'POST', '/api/comunicados', nuevo({ complejo_id: d.complejoA.id, estructura_id: e3.id, enviar_grupo: true }));
    assert.equal(sin.status, 422, sin.texto);
    assert.ok(sin.body.campos?.enviar_grupo);
    const otro = await llama(T.adminB, 'POST', '/api/comunicados', nuevo({ complejo_id: d.complejoB.id, enviar_grupo: true }));
    assert.equal(otro.status, 422, otro.texto);
    assert.equal(await prisma.comunicado.count(), 0);
    assert.equal(mundo.enviados.length, 0);
  });

  it('el administrador de otra empresa no puede mandar al grupo de un block ajeno (404) y el JID de un block ajeno nunca sale', async () => {
    await conGrupos();
    const r = await llama(T.adminB, 'POST', '/api/comunicados', nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_grupo: true }));
    assert.equal(r.status, 404);
    assert.equal(mundo.enviados.length, 0);
  });

  it('la junta del block publica para SU block y escribe al grupo de ese block; no puede apuntar al de otro', async () => {
    await conGrupos();
    const { grupos, respuesta } = await publicar(T.presi1, nuevo({ enviar_junta: true, enviar_grupo: true }));
    assert.deepEqual(mundo.enviados.map((e) => e.jid), [G1]);
    assert.equal(grupos[0]!.estado, 'enviado');
    assert.deepEqual(await usuariosAvisados(respuesta.id), [u.presi1, u.tesor1, u.secre1].sort((a, b) => a - b));
    const ajeno = await llama(T.presi1, 'POST', '/api/comunicados', nuevo({ estructura_id: e2.id, enviar_grupo: true }));
    assert.equal(ajeno.status, 404);
    assert.equal(mundo.enviados.length, 1);
  });

  it('la junta ve el nombre del grupo del block pero NO su JID (ámbitos)', async () => {
    await conGrupos();
    const r = await llama(T.presi1, 'GET', '/api/comunicados/ambitos');
    assert.equal(r.status, 200);
    const b = r.body.complejos[0].estructuras[0];
    assert.equal(b.whatsapp_grupo_nombre, 'Vecinos Block 1');
    assert.ok(!r.texto.includes(G1));
    const a = await llama(T.adminA, 'GET', '/api/comunicados/ambitos');
    assert.equal(a.body.complejos[0].estructuras.find((x: { id: number }) => x.id === e3.id).whatsapp_grupo_nombre, null);
  });

  it('el listado trae el resultado de los grupos', async () => {
    await conGrupos();
    await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_grupo: true }));
    const r = await llama(T.adminA, 'GET', '/api/comunicados');
    assert.equal(r.body.items[0].grupos_resultado[0].estado, 'enviado');
    assert.equal(r.body.items[0].enviar_grupo, true);
  });
});

describe('comunicado: cada vecino por WhatsApp sólo si se marca', () => {
  it('sin marcarlo (aunque pidas grupo y junta) no se encola ningún WhatsApp a los vecinos', async () => {
    await conGrupos();
    const { respuesta } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_junta: true, enviar_grupo: true }));
    const ids = await usuariosAvisados(respuesta.id);
    assert.ok(!ids.includes(d.propietario1.id) && !ids.includes(d.inquilino1.id), 'los vecinos del Block 1 no reciben nada');
    assert.equal(await prisma.notificacion.count({ where: { ref_entidad: 'comunicado', canal: 'whatsapp', usuario_id: { in: [d.propietario1.id, d.inquilino1.id] } } }), 0);
  });

  it('por defecto (sin ninguna casilla) la API sólo publica en pantalla: ni vecinos, ni junta, ni grupo', async () => {
    await conGrupos();
    const { respuesta, c } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id }));
    assert.equal(respuesta.avisos_encolados, 0);
    assert.equal(await prisma.notificacion.count(), 0);
    assert.equal(mundo.enviados.length, 0);
    assert.deepEqual([c.enviar_correo, c.enviar_whatsapp, c.enviar_junta, c.enviar_grupo, c.grupos_resultado], [false, false, false, false, null]);
  });

  it('marcándolo, cada vecino con WhatsApp activo recibe el suyo 1-a-1 (como hoy), y no se manda al grupo', async () => {
    await conGrupos();
    const { respuesta } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_whatsapp: true }));
    const filas = await avisosDe(respuesta.id);
    assert.deepEqual(filas.map((f) => f.canal), ['whatsapp', 'whatsapp']);
    assert.deepEqual(await usuariosAvisados(respuesta.id), [d.propietario1.id, d.inquilino1.id].sort((a, b) => a - b));
    assert.equal(mundo.enviados.length, 0);
  });

  it('un miembro de la junta que también es vecino y está en las dos listas recibe un solo aviso por canal', async () => {
    await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { propietario_id: u.presi1 } });
    try {
      const { respuesta } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_correo: true, enviar_junta: true }));
      const suyos = (await avisosDe(respuesta.id)).filter((n) => n.usuario_id === u.presi1);
      assert.deepEqual(suyos.map((n) => n.canal).sort(), ['email', 'whatsapp']);
    } finally {
      await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { propietario_id: d.propietario1.id } });
    }
  });
});

describe('comunicado al grupo: cuota mensual, plan y texto', () => {
  it('cada envío a un grupo reserva 1 de la cuota mensual del condominio', async () => {
    await ponerPro(5); // 2 unidades × 5
    await conGrupos();
    await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, enviar_grupo: true }));
    assert.equal(mundo.enviados.length, 2);
    const fila = await prisma.consumoMensual.findFirstOrThrow({ where: { complejo_id: d.complejoA.id, recurso: 'whatsapp' } });
    assert.equal(fila.cantidad, 2, '1 por grupo');
  });

  it('cuota agotada: no envía y lo dice', async () => {
    await ponerPro(1); // tope 2
    for (let i = 0; i < 2; i++) await reservarConsumo(d.complejoA.id, 'whatsapp');
    await conGrupos();
    const { grupos } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_grupo: true }));
    assert.equal(mundo.enviados.length, 0);
    assert.deepEqual([grupos[0]!.estado, grupos[0]!.motivo], ['fallo', MOTIVO_TOPE_WHATSAPP]);
    assert.equal((await prisma.consumoMensual.findFirstOrThrow({ where: { complejo_id: d.complejoA.id, recurso: 'whatsapp' } })).cantidad, 2, 'no pasa del tope');
    assert.equal((await prisma.estructura.findUniqueOrThrow({ where: { id: e1.id } })).whatsapp_grupo_aviso, null, 'la cuota no es un problema del grupo');
  });

  it('la cuota se acaba a mitad de camino: sale a uno y el otro queda con el motivo', async () => {
    await ponerPro(1); // tope 2
    await reservarConsumo(d.complejoA.id, 'whatsapp'); // queda 1
    await conGrupos();
    const { grupos } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, enviar_grupo: true }));
    assert.deepEqual(grupos.map((g) => g.estado), ['enviado', 'fallo']);
    assert.equal(grupos[1]!.motivo, MOTIVO_TOPE_WHATSAPP);
    assert.equal(mundo.enviados.length, 1);
  });

  it('plan sin «Avisos por WhatsApp»: no envía y lo dice', async () => {
    await conGrupos();
    await prisma.suscripcionCondominio.deleteMany({ where: { complejo_id: d.complejoA.id } }); // sin suscripción = Gratis, sin el módulo
    invalidarComercial();
    const { grupos } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_grupo: true }));
    assert.equal(mundo.enviados.length, 0);
    assert.equal(grupos[0]!.motivo, MOTIVO_SIN_WHATSAPP);
  });

  it('sin número conectado al publicar: no envía y lo dice', async () => {
    await conGrupos();
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: null } });
    const { grupos } = await publicar(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_grupo: true }));
    assert.equal(mundo.enviados.length, 0);
    assert.match(grupos[0]!.motivo ?? '', /WhatsApp no está conectado/);
  });

  it('el texto lleva título, cuerpo recortado y el enlace; sin asteriscos del título ni nada personal', () => {
    const largo = 'Aviso importante. '.repeat(100);
    const t = textoParaGrupo({ titulo: '*Corte* de agua', cuerpo: largo }, 'Los Pinos');
    assert.match(t, /^\*Corte de agua\*\n\n/);
    assert.ok(t.includes('…'), 'el cuerpo largo se recorta');
    assert.ok(t.length < MAX_CUERPO_GRUPO + 200);
    assert.match(t, /https:\/\/torrecondominios\.com/);
    assert.match(t, /Administración de Los Pinos/);
    const corto = textoParaGrupo({ titulo: 'Reunión', cuerpo: 'El jueves a las 7 pm.' }, 'Los Pinos');
    assert.ok(corto.includes('El jueves a las 7 pm.') && !corto.includes('…'));
  });
});
