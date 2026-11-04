// Comunicados a «departamentos elegidos»: el aviso a cada vecino sale SÓLO a las personas de las unidades marcadas, y sólo ellas lo ven en su app.
// Todo con `fetch` falso (Resend y Evolution): nada sale a la red.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { iniciar, llamar, login, PASSWORD, prisma, sembrar, esperar, type Datos } from './helpers/app';
import { procesarCola, type DepsAvisos } from '../src/server/services/avisos';
import { destinatariosDe } from '../src/server/services/comunicados';

const ENV_OK: NodeJS.ProcessEnv = { RESEND_API_KEY: 're_CLAVE-FALSA-NO-REAL', MAIL_FROM: 'Casa <avisos@ejemplo.test>', EVOLUTION_URL: 'https://evo.ejemplo.test/', EVOLUTION_APIKEY: 'evo-CLAVE-FALSA-NO-REAL' };
/** Procesa la cola con `fetch` inyectado: nunca sale a la red. */
async function procesar() {
  const llamadas: { url: string; body: string }[] = [];
  const deps: DepsAvisos = {
    ahora: () => new Date(),
    esperar: async () => {},
    azar: () => 0,
    env: ENV_OK,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => { llamadas.push({ url: String(url), body: String(init?.body ?? '') }); return new Response('{}', { status: 200 }); }) as typeof fetch,
  };
  return { resumen: await procesarCola(deps), llamadas };
}

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let e1: { id: number };
let e2: { id: number };
let complejoA2: { id: number; empresa_id: number | null };
let U: Record<'A101' | 'A102' | 'A103' | 'A104' | 'A105' | 'A2' | 'B101', number>;
let V: Record<'v3' | 'v4' | 'v4b' | 'v5' | 'presi1' | 'presi2', number>;
let T: Record<'adminA' | 'adminB' | 'prop1' | 'prop2' | 'inq1' | 'v3' | 'v5' | 'presi1' | 'presi2' | 'mttoA', string>;

before(async () => {
  d = await sembrar();
  e1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
  e2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'Block', complejo_id: d.complejoA.id } });
  complejoA2 = await prisma.complejoHabitacional.create({ data: { nombre: 'Complejo A2', tipo: 'Edificio', empresa_id: d.empresaA.id } });
  await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: e1.id } }); // A-101: prop1 + inq1 (sin personas cargadas)
  await prisma.unidad.update({ where: { id: d.unidadA2.id }, data: { estructura_id: e2.id } }); // A-102: prop2
  const hash = await bcrypt.hash(PASSWORD, 4);
  const persona = (nombre: string, email: string, rol = 'propietario', extra: Record<string, unknown> = {}) =>
    prisma.usuario.create({ data: { nombre, email, rol, password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, ...extra } }).then((x) => x.id);
  const v3 = await persona('Vecino Tres', 'v3@test.pe');
  const v4 = await persona('Vecino Cuatro', 'v4@test.pe');
  const v4b = await persona('Familiar Cuatro', 'v4b@test.pe');
  const v5 = await persona('Vecino Cinco', 'v5@test.pe');
  const presi1 = await persona('Presidente 1', 'presi1@test.pe', 'propietario', { cargo_junta: 'presidente', estructura_id: e1.id });
  const presi2 = await persona('Presidente 2', 'presi2@test.pe', 'propietario', { cargo_junta: 'presidente', estructura_id: e2.id });
  V = { v3, v4, v4b, v5, presi1, presi2 };
  const unidad = (codigo: string, propietario_id: number, estructura_id: number | null, complejo: { id: number; empresa_id: number | null } = d.complejoA) =>
    prisma.unidad.create({ data: { codigo, tipo: 'Departamento', complejo_id: complejo.id, empresa_id: complejo.empresa_id, estructura_id, propietario_id, estado: 'activa' } }).then((x) => x.id);
  U = {
    A101: d.unidadA1.id,
    A102: d.unidadA2.id,
    A103: await unidad('A-103', v3, e1.id),
    A104: await unidad('A-104', v4, e1.id),
    A105: await unidad('A-105', v5, e1.id),
    A2: await unidad('X-1', d.propietario2.id, null, complejoA2),
    B101: d.unidadB1.id,
  };
  // A-104 ya tiene personas cargadas: sólo la que está marcada «Recibe comunicados» recibe (el familiar no).
  await prisma.personaUnidad.create({ data: { unidad_id: U.A104, empresa_id: d.empresaA.id, nombre: 'Vecino Cuatro', relacion: 'propietario', usuario_id: v4, recibe_comunicados: true, responsable_pago: true } });
  await prisma.personaUnidad.create({ data: { unidad_id: U.A104, empresa_id: d.empresaA.id, nombre: 'Familiar Cuatro', relacion: 'familiar', usuario_id: v4b, recibe_comunicados: false } });
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    prop1: await login(base, 'prop1@test.pe'),
    prop2: await login(base, 'prop2@test.pe'),
    inq1: await login(base, 'inq1@test.pe'),
    v3: await login(base, 'v3@test.pe'),
    v5: await login(base, 'v5@test.pe'),
    presi1: await login(base, 'presi1@test.pe'),
    presi2: await login(base, 'presi2@test.pe'),
    mttoA: await login(base, 'mtto.a@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.notificacion.deleteMany();
  await prisma.comunicado.deleteMany();
  await prisma.auditoria.deleteMany();
  await prisma.usuario.updateMany({ data: { aviso_email: true, aviso_whatsapp: false, telefono: null } });
  await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: null } });
});

const llama = (t: string | null, metodo: string, ruta: string, cuerpo?: unknown) => llamar(base, metodo, ruta, t, cuerpo);
const nuevo = (extra: Record<string, unknown> = {}) => ({ titulo: 'Revisión de medidores', cuerpo: 'Mañana pasaremos a revisar tu medidor entre 9:00 y 12:00.', ...extra });
const aEnBlock1 = (unidades: number[], extra: Record<string, unknown> = {}) => nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, unidades, ...extra });
/** `usuario:canal` de todo lo encolado de comunicados, ordenado. */
const encolado = async () => (await prisma.notificacion.findMany({ where: { tipo: 'comunicado' }, select: { usuario_id: true, canal: true } })).map((n) => `${n.usuario_id}:${n.canal}`).sort();
const lista = (ids: number[], canales: string[]) => ids.flatMap((i) => canales.map((c) => `${i}:${c}`)).sort();
const titulosDe = async (t: string) => ((await llama(t, 'GET', '/api/me/comunicados')).body.items as { titulo: string }[]).map((i) => i.titulo).sort();
const conWhatsapp = (...ids: number[]) => prisma.usuario.updateMany({ where: { id: { in: ids } }, data: { aviso_whatsapp: true, telefono: '+51987000000' } });

describe('comunicados a departamentos elegidos: quién recibe', () => {
  it('sólo les llega a las personas de esas unidades, por correo y por WhatsApp; el resto del block, nada', async () => {
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: 'instancia-empresa-a' } });
    // Cada quien con su celular propio para reconocerlo en el envío.
    const celular = { [d.propietario1.id]: '+51987000001', [d.inquilino1.id]: '+51987000002', [V.v3]: '+51987000003', [V.v5]: '+51987000005', [d.propietario2.id]: '+51987000009' };
    for (const [id, tel] of Object.entries(celular)) await prisma.usuario.update({ where: { id: Number(id) }, data: { aviso_whatsapp: true, telefono: tel } });
    const r = await llama(T.adminA, 'POST', '/api/comunicados', aEnBlock1([U.A101, U.A103], { enviar_correo: true, enviar_whatsapp: true }));
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual(r.body.unidades, [U.A101, U.A103].sort((a, b) => a - b));
    // A-101 (sin personas: propietario e inquilino) y A-103: 3 personas × 2 canales. A-105 (mismo block) y A-102 (otro block): nada.
    assert.deepEqual(await encolado(), lista([d.propietario1.id, d.inquilino1.id, V.v3], ['email', 'whatsapp']));
    assert.equal(r.body.avisos_encolados, 6);
    // Y al procesar la cola sólo salen esos 6 (3 correos y 3 WhatsApp), con `fetch` falso.
    const p = await procesar();
    assert.equal(p.resumen.enviadas, 6, JSON.stringify(p.resumen));
    const wa = p.llamadas.filter((l) => l.url.includes('/message/sendText/')).map((l) => (JSON.parse(l.body) as { number: string }).number.replace(/\D/g, '')).sort();
    assert.deepEqual(wa, ['51987000001', '51987000002', '51987000003']);
    assert.equal(p.llamadas.filter((l) => l.url.includes('resend')).length, 3);
  });

  it('respeta «Recibe comunicados» (A-104: sólo la persona marcada) y las preferencias de cada quien', async () => {
    await prisma.usuario.update({ where: { id: d.propietario1.id }, data: { aviso_email: false } }); // prop1 no quiere correos
    await conWhatsapp(V.v4, V.v4b, d.inquilino1.id);
    const r = await llama(T.adminA, 'POST', '/api/comunicados', aEnBlock1([U.A101, U.A104], { enviar_correo: true, enviar_whatsapp: true }));
    assert.equal(r.status, 201, r.texto);
    // A-101: inq1 por correo y WhatsApp; prop1 sin correo y sin celular (nada). A-104: v4 por correo y WhatsApp; v4b (no marcada) nada.
    assert.deepEqual(await encolado(), lista([d.inquilino1.id, V.v4], ['email', 'whatsapp']));
  });

  it('sólo correo: no hay WhatsApp aunque tengan celular', async () => {
    await conWhatsapp(V.v3);
    await llama(T.adminA, 'POST', '/api/comunicados', aEnBlock1([U.A103], { enviar_correo: true }));
    assert.deepEqual(await encolado(), lista([V.v3], ['email']));
  });

  it('`destinatariosDe` acota por unidad y sin `unidades` sigue siendo todo el block', async () => {
    assert.deepEqual(await destinatariosDe({ complejo_id: d.complejoA.id, estructura_id: e1.id, unidades: [U.A103] }), [V.v3]);
    const todos = await destinatariosDe({ complejo_id: d.complejoA.id, estructura_id: e1.id });
    assert.deepEqual(todos, [d.propietario1.id, d.inquilino1.id, V.v3, V.v4, V.v5].sort((a, b) => a - b));
  });

  it('una lista vacía de departamentos es «todo el block»', async () => {
    const r = await llama(T.adminA, 'POST', '/api/comunicados', aEnBlock1([], { enviar_correo: true }));
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual(r.body.unidades, []);
    assert.deepEqual(await encolado(), lista([d.propietario1.id, d.inquilino1.id, V.v3, V.v4, V.v5], ['email']));
  });

  it('repetir el envío no duplica (idempotente por persona y canal)', async () => {
    const { encolarComunicado } = await import('../src/server/services/comunicados');
    const r = await llama(T.adminA, 'POST', '/api/comunicados', aEnBlock1([U.A103], { enviar_correo: true }));
    assert.equal(await encolarComunicado({ ...r.body, unidades: r.body.unidades }), 0);
    assert.equal((await encolado()).length, 1);
  });
});

describe('comunicados a departamentos elegidos: quién lo ve en su app', () => {
  it('lo ven sólo los vecinos de esas unidades; el de otra unidad del mismo block no; los de todo el block o el condominio se siguen viendo', async () => {
    const mk = async (titulo: string, cuerpo: Record<string, unknown>) => { const r = await llama(T.adminA, 'POST', '/api/comunicados', nuevo({ titulo, complejo_id: d.complejoA.id, ...cuerpo })); assert.equal(r.status, 201, r.texto); };
    await mk('Elegido A-101 y A-103', { estructura_id: e1.id, unidades: [U.A101, U.A103] });
    await mk('Todo el block 1', { estructura_id: e1.id });
    await mk('Todo el condominio', {});
    await mk('Elegido A-101 y A-102 (condominio)', { unidades: [U.A101, U.A102] });
    // prop1 e inq1 (A-101): los cuatro. v3 (A-103): el elegido, el del block 1 y el del condominio. v5 (A-105, mismo block, no elegido): sin los elegidos.
    assert.deepEqual(await titulosDe(T.prop1), ['Elegido A-101 y A-102 (condominio)', 'Elegido A-101 y A-103', 'Todo el block 1', 'Todo el condominio']);
    assert.deepEqual(await titulosDe(T.inq1), await titulosDe(T.prop1));
    assert.deepEqual(await titulosDe(T.v3), ['Elegido A-101 y A-103', 'Todo el block 1', 'Todo el condominio']);
    assert.deepEqual(await titulosDe(T.v5), ['Todo el block 1', 'Todo el condominio']);
    // prop2 (A-102, otro block): el elegido que lo incluye y el del condominio; nunca el del block 1.
    assert.deepEqual(await titulosDe(T.prop2), ['Elegido A-101 y A-102 (condominio)', 'Todo el condominio']);
  });

  it('un comunicado archivado de departamentos elegidos deja de verse', async () => {
    const r = await llama(T.adminA, 'POST', '/api/comunicados', aEnBlock1([U.A103]));
    assert.deepEqual(await titulosDe(T.v3), ['Revisión de medidores']);
    await llama(T.adminA, 'POST', `/api/comunicados/${r.body.id}/archivar`);
    assert.deepEqual(await titulosDe(T.v3), []);
  });
});

describe('comunicados a departamentos elegidos: límites del alcance', () => {
  const nada = async () => {
    assert.equal(await prisma.comunicado.count(), 0, 'no se creó el comunicado');
    assert.equal(await prisma.notificacion.count(), 0, 'no se encoló nada');
  };

  it('un departamento de otra empresa, de otro condominio o inexistente es 404 y no se envía nada (aunque otros sean válidos)', async () => {
    for (const [nombre, unidades] of [['otra empresa', [U.A101, U.B101]], ['otro condominio de la misma empresa', [U.A101, U.A2]], ['inexistente', [U.A101, 999_999]], ['de otro block', [U.A101, U.A102]]] as const) {
      const r = await llama(T.adminA, 'POST', '/api/comunicados', aEnBlock1([...unidades], { enviar_correo: true }));
      assert.equal(r.status, 404, `${nombre}: ${r.texto}`);
      await nada();
    }
  });

  it('otra empresa no puede publicar en este condominio (404), ni con departamentos', async () => {
    const r = await llama(T.adminB, 'POST', '/api/comunicados', aEnBlock1([U.A101], { enviar_correo: true }));
    assert.equal(r.status, 404, r.texto);
    await nada();
  });

  it('con departamentos no se combina con la junta ni con los grupos (422, nada creado)', async () => {
    for (const extra of [{ enviar_junta: true }, { enviar_grupo: true }, { grupos: [1] }]) {
      const r = await llama(T.adminA, 'POST', '/api/comunicados', aEnBlock1([U.A101], extra));
      assert.equal(r.status, 422, JSON.stringify(extra) + r.texto);
    }
    await nada();
  });

  it('valida la lista: no enteros y más de 500 → 422', async () => {
    assert.equal((await llama(T.adminA, 'POST', '/api/comunicados', aEnBlock1(['a'] as unknown as number[]))).status, 422);
    assert.equal((await llama(T.adminA, 'POST', '/api/comunicados', aEnBlock1(Array.from({ length: 501 }, (_, i) => i + 1)))).status, 422);
    await nada();
  });

  it('la junta de un block elige departamentos de SU block; uno de otro block es 404 y no sale nada', async () => {
    const ok = await llama(T.presi1, 'POST', '/api/comunicados', nuevo({ unidades: [U.A101, U.A105], enviar_correo: true }));
    assert.equal(ok.status, 201, ok.texto);
    assert.equal(ok.body.estructura_id, e1.id, 'forzado a su block');
    assert.deepEqual(await encolado(), lista([d.propietario1.id, d.inquilino1.id, V.v5], ['email']));
    await prisma.notificacion.deleteMany();
    await prisma.comunicado.deleteMany();
    // Una unidad del block 2 (aunque no pida otro block): 404.
    const ajena = await llama(T.presi1, 'POST', '/api/comunicados', nuevo({ unidades: [U.A101, U.A102], enviar_correo: true }));
    assert.equal(ajena.status, 404, ajena.texto);
    // Pidiendo el block 2 directamente: 404 (ya no es su block).
    const otroBlock = await llama(T.presi1, 'POST', '/api/comunicados', nuevo({ estructura_id: e2.id, unidades: [U.A102], enviar_correo: true }));
    assert.equal(otroBlock.status, 404, otroBlock.texto);
    await nada();
    // Y con departamentos la junta tampoco escribe «a la junta».
    assert.equal((await llama(T.presi1, 'POST', '/api/comunicados', nuevo({ unidades: [U.A101], enviar_junta: true }))).status, 422);
  });

  it('personal y residentes siguen sin acceso (403) a la lista de departamentos y a crear', async () => {
    for (const t of ['prop1', 'inq1', 'mttoA'] as const) {
      assert.equal((await llama(T[t], 'GET', `/api/comunicados/departamentos?complejo_id=${d.complejoA.id}`)).status, 403, t);
      assert.equal((await llama(T[t], 'POST', '/api/comunicados', aEnBlock1([U.A101]))).status, 403, t);
    }
  });
});

describe('comunicados a departamentos elegidos: la lista para elegir y lo que se guarda', () => {
  it('GET /departamentos: código y titular, por código, dentro del alcance; la junta de un block sólo ve el suyo', async () => {
    const r = await llama(T.adminA, 'GET', `/api/comunicados/departamentos?complejo_id=${d.complejoA.id}&estructura_id=${e1.id}`);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.body.items.map((x: { codigo: string }) => x.codigo), ['A-101', 'A-103', 'A-104', 'A-105']);
    assert.equal(r.body.items[1].titular, 'Vecino Tres');
    assert.equal(r.body.truncado, false);
    // Todo el condominio: incluye el block 2.
    const todo = await llama(T.adminA, 'GET', `/api/comunicados/departamentos?complejo_id=${d.complejoA.id}`);
    assert.deepEqual(todo.body.items.map((x: { codigo: string }) => x.codigo), ['A-101', 'A-102', 'A-103', 'A-104', 'A-105']);
    // La junta del block 1: sólo su block, pida lo que pida.
    for (const ruta of ['/api/comunicados/departamentos', `/api/comunicados/departamentos?estructura_id=${e1.id}`]) {
      const j = await llama(T.presi1, 'GET', ruta);
      assert.deepEqual(j.body.items.map((x: { codigo: string }) => x.codigo), ['A-101', 'A-103', 'A-104', 'A-105'], ruta);
    }
    assert.equal((await llama(T.presi1, 'GET', `/api/comunicados/departamentos?estructura_id=${e2.id}`)).status, 404);
    // Otra empresa: 404, no revela qué hay.
    assert.equal((await llama(T.adminB, 'GET', `/api/comunicados/departamentos?complejo_id=${d.complejoA.id}`)).status, 404);
  });

  it('la lista de comunicados del admin dice qué departamentos eligió; editar no cambia los elegidos ni reenvía', async () => {
    const c = await llama(T.adminA, 'POST', '/api/comunicados', aEnBlock1([U.A103, U.A101], { enviar_correo: true }));
    const antes = (await encolado()).length;
    const e = await llama(T.adminA, 'PUT', `/api/comunicados/${c.body.id}`, { titulo: 'Otro título', unidades: [U.A105] });
    assert.equal(e.status, 200, e.texto);
    assert.deepEqual(e.body.unidades, [U.A101, U.A103].sort((a, b) => a - b), 'los elegidos no se mueven');
    assert.equal((await encolado()).length, antes, 'editar nunca reenvía');
    const l = await llama(T.adminA, 'GET', '/api/comunicados');
    assert.deepEqual(l.body.items[0].departamentos.map((x: { codigo: string }) => x.codigo).sort(), ['A-101', 'A-103']);
  });

  it('la auditoría guarda cantidades e ids de departamento, nunca nombres, correos ni celulares', async () => {
    const c = await llama(T.adminA, 'POST', '/api/comunicados', aEnBlock1([U.A103, U.A101], { enviar_correo: true }));
    const fila = await esperar(() => prisma.auditoria.findFirst({ where: { entidad: 'comunicado', entidad_id: c.body.id } }));
    const det = fila.detalle as Record<string, unknown>;
    assert.equal(det.departamentos, 2);
    assert.deepEqual(det.departamentos_ids, [U.A101, U.A103].sort((a, b) => a - b));
    assert.equal(det.avisos_encolados, 3);
    const texto = JSON.stringify(det);
    for (const privado of ['v3@test', 'prop1@test', 'Vecino Tres', '+51', 'Mañana pasaremos']) assert.ok(!texto.includes(privado), `la auditoría no debe llevar «${privado}»`);
  });
});
