import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { esperar, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { invalidarComercial } from '../src/server/services/comercial/modulos';
import { procesarCola, type DepsAvisos } from '../src/server/services/avisos';
import { MOTIVO_SIN_WHATSAPP } from '../src/server/services/avisos/cola';
import { encolarComunicado } from '../src/server/services/comunicados';
import { TIPOS, plantilla } from '../src/server/services/avisos/plantillas';

const ENV_OK: NodeJS.ProcessEnv = { RESEND_API_KEY: 're_CLAVE-FALSA-NO-REAL', MAIL_FROM: 'Casa <avisos@ejemplo.test>', EVOLUTION_URL: 'https://evo.ejemplo.test/', EVOLUTION_APIKEY: 'evo-CLAVE-FALSA-NO-REAL' };
/** Procesa la cola con `fetch` inyectado: nunca sale a la red. */
async function procesar() {
  const llamadas: { url: string; init: RequestInit }[] = [];
  const deps: DepsAvisos = {
    ahora: () => new Date(),
    env: ENV_OK,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => { llamadas.push({ url: String(url), init: init ?? {} }); return new Response('{}', { status: 200 }); }) as typeof fetch,
  };
  return { resumen: await procesarCola(deps), llamadas };
}

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let e1: { id: number };
let e2: { id: number };
let eB: { id: number };
let eA2: { id: number };
let complejoA2: { id: number };
type Clave = 'presi1' | 'tesor1' | 'presiTodo' | 'secre1' | 'vocal1' | 'presi2' | 'presiB' | 'presiPropio';
let ids: Record<Clave, number>;
let T: Record<'super' | 'adminA' | 'adminB' | 'adminSin' | 'prop1' | 'prop2' | 'propB' | 'inq1' | 'mttoA' | 'segA' | Clave, string>;

before(async () => {
  d = await sembrar();
  e1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
  e2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'Block', complejo_id: d.complejoA.id } });
  eB = await prisma.estructura.create({ data: { nombre: 'Block B', tipo: 'Block', complejo_id: d.complejoB.id } });
  // Otro condominio de la MISMA empresa A (para los proveedores compartidos de otras pruebas y para «block de otro condominio»).
  complejoA2 = await prisma.complejoHabitacional.create({ data: { nombre: 'Complejo A2', tipo: 'Edificio', empresa_id: d.empresaA.id } });
  eA2 = await prisma.estructura.create({ data: { nombre: 'Block A2', tipo: 'Block', complejo_id: complejoA2.id } });
  await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: e1.id } }); // prop1 (dueño) e inq1 (inquilino)
  await prisma.unidad.update({ where: { id: d.unidadA2.id }, data: { estructura_id: e2.id } }); // prop2
  await prisma.unidad.update({ where: { id: d.unidadB1.id }, data: { estructura_id: eB.id } }); // propB
  const hash = await bcrypt.hash(PASSWORD, 4);
  const junta = async (nombre: string, email: string, cargo: string, complejo: { id: number; empresa_id: number | null }, estructura_id: number | null) =>
    (await prisma.usuario.create({ data: { nombre, email, rol: 'propietario', password_hash: hash, empresa_id: complejo.empresa_id, complejo_id: complejo.id, cargo_junta: cargo, estructura_id } })).id;
  ids = {
    presi1: await junta('Presidente 1', 'presi1@test.pe', 'presidente', d.complejoA, e1.id),
    tesor1: await junta('Tesorero 1', 'tesor1@test.pe', 'tesorero', d.complejoA, e1.id),
    presiTodo: await junta('Presidente Todo', 'presitodo@test.pe', 'presidente', d.complejoA, null),
    secre1: await junta('Secretario 1', 'secre1@test.pe', 'secretario', d.complejoA, e1.id),
    vocal1: await junta('Vocal 1', 'vocal1@test.pe', 'vocal', d.complejoA, e1.id),
    presi2: await junta('Presidente 2', 'presi2@test.pe', 'presidente', d.complejoA, e2.id),
    presiB: await junta('Presidente B', 'presib@test.pe', 'presidente', d.complejoB, eB.id),
    presiPropio: await junta('Presidente con unidad', 'presipropio@test.pe', 'presidente', d.complejoA, e1.id),
  };
  await prisma.unidad.create({ data: { codigo: 'J-1', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: e1.id, propietario_id: ids.presiPropio, estado: 'activa' } });
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    super: await login(base, 'super@test.pe'),
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    adminSin: await login(base, 'admin.huerfano@test.pe'),
    prop1: await login(base, 'prop1@test.pe'),
    prop2: await login(base, 'prop2@test.pe'),
    propB: await login(base, 'propb@test.pe'),
    inq1: await login(base, 'inq1@test.pe'),
    mttoA: await login(base, 'mtto.a@test.pe'),
    segA: await login(base, 'seg.a@test.pe'),
    presi1: await login(base, 'presi1@test.pe'),
    tesor1: await login(base, 'tesor1@test.pe'),
    presiTodo: await login(base, 'presitodo@test.pe'),
    secre1: await login(base, 'secre1@test.pe'),
    vocal1: await login(base, 'vocal1@test.pe'),
    presi2: await login(base, 'presi2@test.pe'),
    presiB: await login(base, 'presib@test.pe'),
    presiPropio: await login(base, 'presipropio@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.notificacion.deleteMany();
  await prisma.comunicado.deleteMany();
  await prisma.usuario.updateMany({ data: { aviso_email: true, aviso_whatsapp: false, telefono: null } });
});

const llama = (t: string | null, metodo: string, ruta: string, cuerpo?: unknown) => llamar(base, metodo, ruta, t, cuerpo);
const nuevo = (extra: Record<string, unknown> = {}) => ({ titulo: 'Corte de agua', cuerpo: 'El sábado de 9:00 a 13:00 no habrá agua por mantenimiento de la cisterna.', ...extra });
/** Crea por la API (comprueba el 201) y devuelve la respuesta. */
async function crear(token: string, cuerpo: Record<string, unknown>) {
  const r = await llama(token, 'POST', '/api/comunicados', cuerpo);
  assert.equal(r.status, 201, r.texto);
  return r.body as { id: number; estructura_id: number | null; complejo_id: number; avisos_encolados: number; origen: string; autor: { nombre: string } | null };
}
const titulos = (r: { body: { items: { titulo: string }[] } }) => r.body.items.map((i) => i.titulo);
const comunicadoDirecto = (extra: Record<string, unknown> = {}) =>
  prisma.comunicado.create({ data: { complejo_id: d.complejoA.id, estructura_id: null, titulo: 'T', cuerpo: 'C', autor_id: d.adminA.id, ...extra } });

describe('comunicados: quién puede gestionar', () => {
  it('sin sesión 401; residentes, personal, secretario y vocal reciben 403 en TODO', async () => {
    assert.equal((await llama(null, 'GET', '/api/comunicados')).status, 401);
    const c = await comunicadoDirecto();
    for (const t of ['prop1', 'inq1', 'mttoA', 'segA', 'secre1', 'vocal1'] as const) {
      assert.equal((await llama(T[t], 'GET', '/api/comunicados')).status, 403, `${t} lista`);
      assert.equal((await llama(T[t], 'GET', `/api/comunicados/${c.id}`)).status, 403, `${t} ver`);
      assert.equal((await llama(T[t], 'GET', '/api/comunicados/ambitos')).status, 403, `${t} ámbitos`);
      assert.equal((await llama(T[t], 'POST', '/api/comunicados', nuevo({ complejo_id: d.complejoA.id }))).status, 403, `${t} crear`);
      assert.equal((await llama(T[t], 'PUT', `/api/comunicados/${c.id}`, { titulo: 'x' })).status, 403, `${t} editar`);
      assert.equal((await llama(T[t], 'POST', `/api/comunicados/${c.id}/archivar`)).status, 403, `${t} archivar`);
    }
    assert.equal(await prisma.comunicado.count(), 1, 'nadie creó nada');
    assert.equal((await prisma.comunicado.findUniqueOrThrow({ where: { id: c.id } })).titulo, 'T');
  });

  it('un admin sin empresa no puede operar (403)', async () => {
    assert.equal((await llama(T.adminSin, 'GET', '/api/comunicados')).status, 403);
    assert.equal((await llama(T.adminSin, 'POST', '/api/comunicados', nuevo({ complejo_id: d.complejoA.id }))).status, 403);
  });

  it('el admin publica en SU condominio (todo o un block); queda el autor y el origen «administración»', async () => {
    const todo = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id }));
    assert.equal(todo.estructura_id, null);
    assert.equal(todo.origen, 'administracion');
    assert.equal(todo.autor?.nombre, 'Admin A');
    const block = await crear(T.adminA, nuevo({ titulo: 'Solo block 2', complejo_id: d.complejoA.id, estructura_id: e2.id }));
    assert.equal(block.estructura_id, e2.id);
    const fila = await prisma.comunicado.findUniqueOrThrow({ where: { id: todo.id } });
    assert.equal(fila.autor_id, d.adminA.id);
    assert.equal(fila.fijado, false);
    assert.equal(fila.enviar_correo, false);
    assert.equal(fila.archivado_at, null);
  });

  it('el admin de otra empresa: 404 al publicar, ver, editar y archivar; su lista no trae los de A', async () => {
    const c = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id }));
    assert.equal((await llama(T.adminB, 'POST', '/api/comunicados', nuevo({ complejo_id: d.complejoA.id }))).status, 404);
    assert.equal((await llama(T.adminB, 'GET', `/api/comunicados/${c.id}`)).status, 404);
    assert.equal((await llama(T.adminB, 'PUT', `/api/comunicados/${c.id}`, { titulo: 'robado' })).status, 404);
    assert.equal((await llama(T.adminB, 'PATCH', `/api/comunicados/${c.id}`, { titulo: 'robado' })).status, 404);
    assert.equal((await llama(T.adminB, 'POST', `/api/comunicados/${c.id}/archivar`)).status, 404);
    assert.deepEqual((await llama(T.adminB, 'GET', '/api/comunicados')).body.items, []);
    const fila = await prisma.comunicado.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(fila.titulo, 'Corte de agua');
    assert.equal(fila.archivado_at, null);
  });

  it('el block debe ser del condominio elegido (404) y el condominio es obligatorio para el admin (422)', async () => {
    assert.equal((await llama(T.adminA, 'POST', '/api/comunicados', nuevo({ complejo_id: d.complejoA.id, estructura_id: eB.id }))).status, 404, 'block de otro condominio');
    assert.equal((await llama(T.adminA, 'POST', '/api/comunicados', nuevo({ complejo_id: d.complejoA.id, estructura_id: eA2.id }))).status, 404, 'block de otro condominio de la misma empresa');
    assert.equal((await llama(T.adminA, 'POST', '/api/comunicados', nuevo({ complejo_id: d.complejoA.id, estructura_id: 999999 }))).status, 404);
    const r = await llama(T.adminA, 'POST', '/api/comunicados', nuevo());
    assert.equal(r.status, 422);
    assert.ok(r.body.campos.complejo_id);
    assert.equal(await prisma.comunicado.count(), 0);
  });

  it('el superadmin publica en cualquier condominio', async () => {
    await crear(T.super, nuevo({ complejo_id: d.complejoB.id }));
    assert.equal(await prisma.comunicado.count({ where: { complejo_id: d.complejoB.id } }), 1);
  });

  it('la junta con block: su block siempre; pedir «todo el condominio» (sin block o con null) queda FORZADO a su block; otro block u otro condominio, 404', async () => {
    const sin = await crear(T.presi1, nuevo());
    assert.equal(sin.estructura_id, e1.id);
    assert.equal(sin.complejo_id, d.complejoA.id);
    assert.equal(sin.origen, 'junta');
    const conNull = await crear(T.presi1, nuevo({ estructura_id: null }));
    assert.equal(conNull.estructura_id, e1.id, 'no puede publicar al condominio entero');
    const suyo = await crear(T.tesor1, nuevo({ estructura_id: e1.id }));
    assert.equal(suyo.estructura_id, e1.id);
    assert.equal((await llama(T.presi1, 'POST', '/api/comunicados', nuevo({ estructura_id: e2.id }))).status, 404, 'block ajeno');
    assert.equal((await llama(T.presi1, 'POST', '/api/comunicados', nuevo({ complejo_id: d.complejoB.id }))).status, 404, 'condominio ajeno');
    assert.equal((await llama(T.presi1, 'POST', '/api/comunicados', nuevo({ complejo_id: d.complejoA.id, estructura_id: eB.id }))).status, 404);
    assert.equal(await prisma.comunicado.count({ where: { estructura_id: null } }), 0, 'ninguno quedó para todo el condominio');
    assert.equal(await prisma.comunicado.count(), 3);
  });

  it('la junta sin block publica en todo su condominio o en cualquiera de sus blocks, pero no en otro condominio', async () => {
    assert.equal((await crear(T.presiTodo, nuevo())).estructura_id, null);
    assert.equal((await crear(T.presiTodo, nuevo({ estructura_id: e2.id }))).estructura_id, e2.id);
    assert.equal((await llama(T.presiTodo, 'POST', '/api/comunicados', nuevo({ estructura_id: eB.id }))).status, 404);
    assert.equal((await llama(T.presiTodo, 'POST', '/api/comunicados', nuevo({ complejo_id: d.complejoB.id }))).status, 404);
  });

  it('la junta sólo ve, edita y archiva los de su ámbito (puedeGestionar); lo de otro block, del condominio entero o de otro condominio es 404', async () => {
    const delBlock1 = await comunicadoDirecto({ titulo: 'Block 1', estructura_id: e1.id });
    const delBlock2 = await comunicadoDirecto({ titulo: 'Block 2', estructura_id: e2.id });
    const deTodos = await comunicadoDirecto({ titulo: 'Todo el condominio' });
    const deB = await prisma.comunicado.create({ data: { complejo_id: d.complejoB.id, estructura_id: eB.id, titulo: 'De B', cuerpo: 'x', autor_id: d.adminB.id } });
    assert.deepEqual(titulos(await llama(T.presi1, 'GET', '/api/comunicados')), ['Block 1']);
    assert.deepEqual(titulos(await llama(T.presi2, 'GET', '/api/comunicados')), ['Block 2']);
    assert.deepEqual(titulos(await llama(T.presiB, 'GET', '/api/comunicados')), ['De B']);
    assert.deepEqual(titulos(await llama(T.presiTodo, 'GET', '/api/comunicados')).sort(), ['Block 1', 'Block 2', 'Todo el condominio']);
    for (const ajeno of [delBlock2, deTodos, deB]) {
      assert.equal((await llama(T.presi1, 'GET', `/api/comunicados/${ajeno.id}`)).status, 404, 'ver');
      assert.equal((await llama(T.presi1, 'PUT', `/api/comunicados/${ajeno.id}`, { titulo: 'x' })).status, 404, 'editar');
      assert.equal((await llama(T.presi1, 'POST', `/api/comunicados/${ajeno.id}/archivar`)).status, 404, 'archivar');
    }
    assert.equal((await llama(T.presiB, 'PUT', `/api/comunicados/${delBlock1.id}`, { titulo: 'x' })).status, 404, 'junta de otro condominio');
    assert.equal((await llama(T.presi2, 'PUT', `/api/comunicados/${delBlock1.id}`, { titulo: 'x' })).status, 404, 'junta de otro block');
    assert.equal((await llama(T.presi1, 'PUT', `/api/comunicados/${delBlock1.id}`, { titulo: 'Block 1 editado' })).status, 200);
    assert.equal((await llama(T.tesor1, 'POST', `/api/comunicados/${delBlock1.id}/archivar`)).status, 200);
    assert.equal((await llama(T.presiTodo, 'PUT', `/api/comunicados/${delBlock2.id}`, { titulo: 'Block 2 editado' })).status, 200);
    assert.equal((await llama(T.presiTodo, 'PUT', `/api/comunicados/${deTodos.id}`, { titulo: 'Todos editado' })).status, 200);
    const titulosFinales = (await prisma.comunicado.findMany({ orderBy: { id: 'asc' } })).map((c) => c.titulo);
    assert.deepEqual(titulosFinales, ['Block 1 editado', 'Block 2 editado', 'Todos editado', 'De B'], 'lo ajeno no se tocó');
  });

  it('la lista del admin filtra por condominio y por alcance, trae fijados primero y esconde los archivados salvo que se pidan', async () => {
    const a = await comunicadoDirecto({ titulo: 'Viejo', created_at: new Date('2026-10-01T10:00:00Z') });
    await comunicadoDirecto({ titulo: 'Nuevo', created_at: new Date('2026-10-20T10:00:00Z') });
    await comunicadoDirecto({ titulo: 'Fijado viejo', fijado: true, created_at: new Date('2026-09-01T10:00:00Z') });
    await comunicadoDirecto({ titulo: 'Del block 1', estructura_id: e1.id });
    await comunicadoDirecto({ titulo: 'Archivado', archivado_at: new Date() });
    await prisma.comunicado.create({ data: { complejo_id: d.complejoB.id, titulo: 'De B', cuerpo: 'x' } });
    const r = await llama(T.adminA, 'GET', `/api/comunicados?complejo_id=${d.complejoA.id}`);
    assert.equal(r.body.items[0].titulo, 'Fijado viejo');
    assert.deepEqual(titulos(r).slice(1).filter((t) => t !== 'Del block 1'), ['Nuevo', 'Viejo']);
    assert.ok(!titulos(r).includes('Archivado') && !titulos(r).includes('De B'));
    assert.equal(r.body.total, 4);
    assert.deepEqual(titulos(await llama(T.adminA, 'GET', '/api/comunicados?estructura_id=ninguna')).sort(), ['Fijado viejo', 'Nuevo', 'Viejo']);
    assert.deepEqual(titulos(await llama(T.adminA, 'GET', `/api/comunicados?estructura_id=${e1.id}`)), ['Del block 1']);
    assert.deepEqual(titulos(await llama(T.adminA, 'GET', '/api/comunicados?archivados=true')), ['Archivado']);
    assert.deepEqual(titulos(await llama(T.adminA, 'GET', '/api/comunicados?q=nuev')), ['Nuevo']);
    assert.equal((await llama(T.adminA, 'GET', '/api/comunicados?pageSize=2')).body.items.length, 2);
    assert.equal((await llama(T.adminA, 'GET', `/api/comunicados/${a.id}`)).body.titulo, 'Viejo');
  });

  it('los ámbitos: el admin ve sus condominios con sus blocks; la junta de un block, sólo ese block y `fijo`', async () => {
    const a = (await llama(T.adminA, 'GET', '/api/comunicados/ambitos')).body;
    assert.deepEqual(a.complejos.map((c: { nombre: string }) => c.nombre).sort(), ['Complejo A', 'Complejo A2']);
    assert.equal(a.fijo, false);
    const j = (await llama(T.presi1, 'GET', '/api/comunicados/ambitos')).body;
    assert.equal(j.complejos.length, 1);
    assert.deepEqual(j.complejos[0].estructuras.map((e: { id: number }) => e.id), [e1.id]);
    assert.equal(j.fijo, true);
    const t = (await llama(T.presiTodo, 'GET', '/api/comunicados/ambitos')).body;
    assert.deepEqual(t.complejos[0].estructuras.map((e: { id: number }) => e.id).sort(), [e1.id, e2.id].sort());
    assert.equal(t.fijo, false);
  });

  it('valida: título y texto obligatorios y con tope, casillas booleanas; nada se guarda', async () => {
    const c = { complejo_id: d.complejoA.id };
    for (const malo of [{ titulo: '' }, { titulo: '   ' }, { titulo: 'x'.repeat(121) }, { cuerpo: '' }, { cuerpo: 'x'.repeat(4001) }, { enviar_correo: 'si' }, { fijado: 1 }]) {
      assert.equal((await llama(T.adminA, 'POST', '/api/comunicados', nuevo({ ...c, ...malo }))).status, 422, JSON.stringify(malo).slice(0, 40));
    }
    assert.equal((await llama(T.adminA, 'POST', '/api/comunicados', nuevo({ ...c, titulo: 'x'.repeat(120), cuerpo: 'y'.repeat(4000) }))).status, 201, 'justo en el tope');
    assert.equal(await prisma.comunicado.count(), 1);
    const sinCuerpo = await llama(T.adminA, 'POST', '/api/comunicados', { ...c, titulo: 'a' });
    assert.equal(sinCuerpo.status, 422);
    assert.ok(sinCuerpo.body.campos.cuerpo);
  });

  it('editar cambia título, texto y fijado, NO el condominio ni el alcance; uno archivado ya no se edita (409)', async () => {
    const c = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id }));
    const r = await llama(T.adminA, 'PUT', `/api/comunicados/${c.id}`, { titulo: 'Nuevo título', cuerpo: 'Nuevo texto', fijado: true, complejo_id: d.complejoB.id, estructura_id: e2.id });
    assert.equal(r.status, 200, r.texto);
    const fila = await prisma.comunicado.findUniqueOrThrow({ where: { id: c.id } });
    assert.deepEqual([fila.titulo, fila.cuerpo, fila.fijado, fila.complejo_id, fila.estructura_id], ['Nuevo título', 'Nuevo texto', true, d.complejoA.id, e1.id]);
    assert.equal((await llama(T.adminA, 'PATCH', `/api/comunicados/${c.id}`, { fijado: false })).status, 200);
    assert.equal((await llama(T.adminA, 'PUT', `/api/comunicados/${c.id}`, { titulo: '' })).status, 422);
    assert.equal((await llama(T.adminA, 'POST', `/api/comunicados/${c.id}/archivar`)).status, 200);
    assert.equal((await llama(T.adminA, 'PUT', `/api/comunicados/${c.id}`, { titulo: 'tarde' })).status, 409);
    assert.equal((await prisma.comunicado.findUniqueOrThrow({ where: { id: c.id } })).titulo, 'Nuevo título');
  });

  it('archivar guarda la fecha, es idempotente y no borra la fila', async () => {
    const c = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id }));
    const r1 = await llama(T.adminA, 'POST', `/api/comunicados/${c.id}/archivar`);
    assert.equal(r1.status, 200);
    const primera = (await prisma.comunicado.findUniqueOrThrow({ where: { id: c.id } })).archivado_at;
    assert.ok(primera);
    assert.equal((await llama(T.adminA, 'POST', `/api/comunicados/${c.id}/archivar`)).status, 200);
    assert.equal((await prisma.comunicado.findUniqueOrThrow({ where: { id: c.id } })).archivado_at?.getTime(), primera.getTime());
    assert.deepEqual((await llama(T.adminA, 'GET', '/api/comunicados')).body.items, []);
  });

  it('queda en la auditoría (crear, editar, archivar) sin guardar el texto del comunicado', async () => {
    const c = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id, cuerpo: 'TEXTO-SECRETO-DEL-CUERPO' }));
    await llama(T.adminA, 'PUT', `/api/comunicados/${c.id}`, { cuerpo: 'OTRO-TEXTO-SECRETO' });
    await llama(T.adminA, 'POST', `/api/comunicados/${c.id}/archivar`);
    const filas = await esperar(async () => {
      const f = await prisma.auditoria.findMany({ where: { entidad: 'comunicado', entidad_id: c.id }, orderBy: { id: 'asc' } });
      return f.length >= 3 ? f : null;
    });
    assert.deepEqual(filas.map((f) => f.accion), ['crear', 'editar', 'archivar']);
    assert.ok(filas.every((f) => f.usuario_id === d.adminA.id));
    assert.ok(!JSON.stringify(filas).includes('SECRETO'), 'el texto no va a la auditoría');
  });
});

describe('comunicados: lo que ve cada residente (GET /api/me/comunicados)', () => {
  it('un propietario y su inquilino ven los de todo el condominio y los de SU block; no los de otro block ni de otro condominio', async () => {
    await comunicadoDirecto({ titulo: 'Todo A' });
    await comunicadoDirecto({ titulo: 'Block 1', estructura_id: e1.id });
    await comunicadoDirecto({ titulo: 'Block 2', estructura_id: e2.id });
    await prisma.comunicado.create({ data: { complejo_id: d.complejoB.id, titulo: 'Todo B', cuerpo: 'x' } });
    await prisma.comunicado.create({ data: { complejo_id: d.complejoB.id, estructura_id: eB.id, titulo: 'Block B', cuerpo: 'x' } });
    await prisma.comunicado.create({ data: { complejo_id: complejoA2.id, titulo: 'Todo A2', cuerpo: 'x' } });
    const orden = (r: { body: { items: { titulo: string }[] } }) => titulos(r).sort();
    assert.deepEqual(orden(await llama(T.prop1, 'GET', '/api/me/comunicados')), ['Block 1', 'Todo A']);
    assert.deepEqual(orden(await llama(T.inq1, 'GET', '/api/me/comunicados')), ['Block 1', 'Todo A']);
    assert.deepEqual(orden(await llama(T.prop2, 'GET', '/api/me/comunicados')), ['Block 2', 'Todo A']);
    assert.deepEqual(orden(await llama(T.propB, 'GET', '/api/me/comunicados')), ['Block B', 'Todo B']);
  });

  it('quien tiene unidades en dos blocks ve los de ambos; sin unidades no ve ninguno', async () => {
    await comunicadoDirecto({ titulo: 'Block 1', estructura_id: e1.id });
    await comunicadoDirecto({ titulo: 'Block 2', estructura_id: e2.id });
    await comunicadoDirecto({ titulo: 'Todo A' });
    await prisma.unidad.create({ data: { codigo: 'A-201', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: e2.id, propietario_id: d.propietario1.id, estado: 'activa' } });
    assert.deepEqual(titulos(await llama(T.prop1, 'GET', '/api/me/comunicados')).sort(), ['Block 1', 'Block 2', 'Todo A']);
    await prisma.unidad.deleteMany({ where: { codigo: 'A-201' } });
    await prisma.unidad.updateMany({ where: { propietario_id: d.propietario2.id }, data: { propietario_id: null } });
    assert.deepEqual((await llama(T.prop2, 'GET', '/api/me/comunicados')).body.items, [], 'sin unidades, nada');
    await prisma.unidad.update({ where: { id: d.unidadA2.id }, data: { propietario_id: d.propietario2.id } });
  });

  it('los archivados no se ven; fijados primero y luego los más nuevos; paginado', async () => {
    await comunicadoDirecto({ titulo: 'Viejo', created_at: new Date('2026-10-01T10:00:00Z') });
    await comunicadoDirecto({ titulo: 'Reciente', created_at: new Date('2026-10-25T10:00:00Z') });
    await comunicadoDirecto({ titulo: 'Medio', created_at: new Date('2026-10-15T10:00:00Z') });
    await comunicadoDirecto({ titulo: 'Fijado antiguo', fijado: true, created_at: new Date('2026-08-01T10:00:00Z') });
    await comunicadoDirecto({ titulo: 'Archivado', archivado_at: new Date(), fijado: true });
    const r = await llama(T.prop1, 'GET', '/api/me/comunicados');
    assert.deepEqual(titulos(r), ['Fijado antiguo', 'Reciente', 'Medio', 'Viejo']);
    assert.equal(r.body.total, 4);
    const p2 = await llama(T.prop1, 'GET', '/api/me/comunicados?pageSize=2&page=2');
    assert.deepEqual(titulos(p2), ['Medio', 'Viejo']);
    assert.equal(p2.body.total, 4);
    assert.deepEqual(titulos(await llama(T.prop1, 'GET', '/api/me/comunicados?q=recien')), ['Reciente']);
  });

  it('archivar en la gestión lo saca de la vista del residente', async () => {
    const c = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id }));
    assert.equal((await llama(T.prop1, 'GET', '/api/me/comunicados')).body.total, 1);
    await llama(T.adminA, 'POST', `/api/comunicados/${c.id}/archivar`);
    assert.equal((await llama(T.prop1, 'GET', '/api/me/comunicados')).body.total, 0);
  });

  it('trae lo que se pinta (título, texto, alcance, fecha, de quién) y nada del autor ni de los avisos; el texto llega tal cual (sin HTML)', async () => {
    const c = await crear(T.presi1, nuevo({ titulo: 'Reunión', cuerpo: '<script>alert(1)</script>\nSegunda línea' }));
    const item = (await llama(T.prop1, 'GET', '/api/me/comunicados')).body.items[0];
    assert.deepEqual(Object.keys(item).sort(), ['complejo', 'created_at', 'cuerpo', 'estructura', 'fijado', 'id', 'origen', 'titulo']);
    assert.equal(item.id, c.id);
    assert.equal(item.cuerpo, '<script>alert(1)</script>\nSegunda línea');
    assert.equal(item.origen, 'junta');
    assert.equal(item.estructura.nombre, 'Block 1');
    assert.equal(item.complejo.nombre, 'Complejo A');
  });

  it('sólo propietarios e inquilinos usan /me/comunicados (admin, personal y sin sesión no)', async () => {
    assert.equal((await llama(null, 'GET', '/api/me/comunicados')).status, 401);
    for (const t of ['adminA', 'mttoA', 'segA'] as const) assert.equal((await llama(T[t], 'GET', '/api/me/comunicados')).status, 403, t);
  });

  it('un residente no puede crear, editar ni archivar (ni siquiera con un cuerpo válido)', async () => {
    const c = await comunicadoDirecto();
    assert.equal((await llama(T.prop1, 'POST', '/api/comunicados', nuevo({ complejo_id: d.complejoA.id }))).status, 403);
    assert.equal((await llama(T.inq1, 'PUT', `/api/comunicados/${c.id}`, { titulo: 'x' })).status, 403);
    assert.equal((await llama(T.prop1, 'POST', `/api/comunicados/${c.id}/archivar`)).status, 403);
    assert.equal(await prisma.comunicado.count(), 1);
  });
});

describe('comunicados: envío por correo y WhatsApp', () => {
  const avisosDe = (comunicadoId: number) => prisma.notificacion.findMany({ where: { tipo: 'comunicado', ref_entidad: 'comunicado', ref_id: comunicadoId }, include: { usuario: { select: { email: true } } }, orderBy: [{ usuario_id: 'asc' }, { canal: 'asc' }] });
  const correos = (filas: { usuario: { email: string }; canal: string }[], canal = 'email') => filas.filter((f) => f.canal === canal).map((f) => f.usuario.email).sort();

  it('sin casillas no se encola nada (0 avisos)', async () => {
    const c = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id }));
    assert.equal(c.avisos_encolados, 0);
    assert.equal(await prisma.notificacion.count({ where: { tipo: 'comunicado' } }), 0);
  });

  it('por correo a todo el condominio: a cada propietario e inquilino de sus unidades (una vez cada uno) y la respuesta dice cuántos', async () => {
    const c = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id, enviar_correo: true }));
    const filas = await avisosDe(c.id);
    assert.deepEqual(correos(filas), ['inq1@test.pe', 'presipropio@test.pe', 'prop1@test.pe', 'prop2@test.pe']);
    assert.equal(c.avisos_encolados, 4);
    assert.equal(filas.length, 4, 'sólo correo');
    assert.ok(filas.every((f) => f.estado === 'pendiente' || f.estado === 'omitida' || f.estado === 'enviada' || f.estado === 'error'));
    const f = filas[0]!;
    assert.equal(f.asunto, 'Corte de agua', 'el asunto es el título');
    assert.match(f.cuerpo, /El sábado de 9:00 a 13:00 no habrá agua/);
    assert.match(f.cuerpo, /Complejo A/, 'lo firma el condominio');
    const fila = await prisma.comunicado.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(fila.enviar_correo, true);
    assert.equal(fila.enviar_whatsapp, false);
  });

  it('un comunicado de un block sólo avisa a los vecinos de ese block; el de la junta igual', async () => {
    const c = await crear(T.presi1, nuevo({ enviar_correo: true }));
    assert.deepEqual(correos(await avisosDe(c.id)), ['inq1@test.pe', 'presipropio@test.pe', 'prop1@test.pe']);
    const c2 = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e2.id, enviar_correo: true }));
    assert.deepEqual(correos(await avisosDe(c2.id)), ['prop2@test.pe']);
    assert.equal(c.avisos_encolados, 3);
  });

  it('respeta las preferencias: quien apagó el correo no lo recibe; WhatsApp sólo a quien lo activó y tiene celular', async () => {
    // prop1 tiene celular pero NO activó WhatsApp (y apagó el correo): no recibe nada.
    await prisma.usuario.update({ where: { id: d.propietario1.id }, data: { aviso_email: false, telefono: '+51911111111' } });
    await prisma.usuario.update({ where: { id: d.propietario2.id }, data: { aviso_whatsapp: true, telefono: '+51987654321' } });
    await prisma.usuario.update({ where: { id: d.inquilino1.id }, data: { aviso_whatsapp: true } }); // sin celular: no hay a dónde
    const c = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id, enviar_correo: true, enviar_whatsapp: true }));
    const filas = await avisosDe(c.id);
    assert.deepEqual(correos(filas), ['inq1@test.pe', 'presipropio@test.pe', 'prop2@test.pe'], 'prop1 apagó el correo');
    assert.deepEqual(correos(filas, 'whatsapp'), ['prop2@test.pe']);
    assert.equal(c.avisos_encolados, 4);
  });

  it('sólo WhatsApp: no se manda correo; sólo correo: no se manda WhatsApp aunque lo hayan activado', async () => {
    await prisma.usuario.updateMany({ data: { aviso_whatsapp: true, telefono: '+51987654321' } });
    const soloWa = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_whatsapp: true }));
    const filasWa = await avisosDe(soloWa.id);
    assert.ok(filasWa.length > 0 && filasWa.every((f) => f.canal === 'whatsapp'));
    const soloCorreo = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_correo: true }));
    const filasCorreo = await avisosDe(soloCorreo.id);
    assert.ok(filasCorreo.length > 0 && filasCorreo.every((f) => f.canal === 'email'));
  });

  it('quien es propietario de una unidad e inquilino de otra recibe UN solo aviso', async () => {
    await prisma.unidad.create({ data: { codigo: 'A-301', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: e1.id, propietario_id: d.propietario2.id, inquilino_id: d.inquilino1.id, estado: 'activa' } });
    const c = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e1.id, enviar_correo: true }));
    const filas = await avisosDe(c.id);
    assert.equal(filas.length, new Set(filas.map((f) => f.usuario_id)).size, 'uno por persona y canal');
    assert.ok(correos(filas).includes('prop2@test.pe'), 'prop2 también tiene una unidad en el block 1');
    await prisma.unidad.deleteMany({ where: { codigo: 'A-301' } });
  });

  it('editar NO reenvía (aunque pidan las casillas) y repetir el encolado no duplica', async () => {
    const c = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id, enviar_correo: true }));
    const antes = await prisma.notificacion.count({ where: { tipo: 'comunicado' } });
    assert.equal(antes, 4);
    const r = await llama(T.adminA, 'PUT', `/api/comunicados/${c.id}`, { titulo: 'Corte de agua (corregido)', enviar_correo: true, enviar_whatsapp: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.avisos_encolados, undefined);
    assert.equal(await prisma.notificacion.count({ where: { tipo: 'comunicado' } }), antes, 'editar no encola');
    const fila = await prisma.comunicado.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(fila.enviar_whatsapp, false, 'las casillas de enviar no cambian al editar');
    assert.equal(await encolarComunicado(fila), 0, 'volver a encolar no duplica');
    assert.equal(await prisma.notificacion.count({ where: { tipo: 'comunicado' } }), antes);
  });

  it('editar un comunicado creado SIN casillas no manda nada aunque el cuerpo traiga `enviar_correo`/`enviar_whatsapp`', async () => {
    await prisma.usuario.updateMany({ data: { aviso_whatsapp: true, telefono: '+51987654321' } });
    const c = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id }));
    assert.equal(c.avisos_encolados, 0);
    for (const metodo of ['PUT', 'PATCH'] as const) assert.equal((await llama(T.adminA, metodo, `/api/comunicados/${c.id}`, { titulo: 'Otra vez', enviar_correo: true, enviar_whatsapp: true })).status, 200);
    assert.equal(await prisma.notificacion.count({ where: { tipo: 'comunicado' } }), 0);
    const fila = await prisma.comunicado.findUniqueOrThrow({ where: { id: c.id } });
    assert.deepEqual([fila.enviar_correo, fila.enviar_whatsapp], [false, false]);
  });

  it('el aviso lleva el texto TAL CUAL se escribió al crear (editar después no lo cambia) y la pantalla de Avisos muestra el título como contexto', async () => {
    const c = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id, titulo: 'Asamblea', cuerpo: 'Será el jueves.', enviar_correo: true }));
    await llama(T.adminA, 'PUT', `/api/comunicados/${c.id}`, { cuerpo: 'Será el viernes.' });
    const [f] = await avisosDe(c.id);
    assert.match(f!.cuerpo, /Será el jueves\./);
    const lista = await llama(T.adminA, 'GET', '/api/notificaciones?tipo=comunicado');
    assert.equal(lista.status, 200, lista.texto);
    assert.equal(lista.body.items.length, 4);
    for (const it of lista.body.items) {
      assert.deepEqual(it.contexto?.comunicado, { id: c.id, titulo: 'Asamblea' });
      assert.equal(it.cuerpo, undefined, 'el cuerpo no viaja en el listado');
    }
  });

  it('el envío de WhatsApp sigue el módulo del plan y la instancia de la administradora del condominio; el correo sale aparte', async () => {
    await prisma.usuario.update({ where: { id: d.propietario2.id }, data: { aviso_whatsapp: true, telefono: '+51987654321' } });
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: 'instancia-empresa-a' } });
    const c = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id, estructura_id: e2.id, enviar_correo: true, enviar_whatsapp: true }));
    // Con el plan completo: sale por la instancia de la empresa A.
    const ok = await procesar();
    assert.equal(ok.resumen.enviadas, 2, JSON.stringify(ok.resumen));
    const wa = ok.llamadas.find((l) => l.url.includes('/message/sendText/'))!;
    assert.match(wa.url, /instancia-empresa-a$/);
    assert.match(JSON.parse(String(wa.init.body)).text, /El sábado de 9:00/);
    assert.ok(ok.llamadas.some((l) => l.url.includes('resend')), 'y el correo por Resend');
    // Sin el módulo de WhatsApp: el correo sale y el WhatsApp queda omitido con el motivo del plan.
    await prisma.notificacion.updateMany({ where: { tipo: 'comunicado' }, data: { estado: 'pendiente', intentos: 0, error: null, programada_para: new Date(0) } });
    await prisma.suscripcionCondominio.deleteMany({ where: { complejo_id: d.complejoA.id } });
    invalidarComercial();
    const sinPlan = await procesar();
    const wa2 = await prisma.notificacion.findFirstOrThrow({ where: { tipo: 'comunicado', canal: 'whatsapp', ref_id: c.id } });
    assert.equal(wa2.estado, 'omitida');
    assert.equal(wa2.error, MOTIVO_SIN_WHATSAPP);
    assert.equal(sinPlan.llamadas.some((l) => l.url.includes('/message/sendText/')), false);
    const mail = await prisma.notificacion.findFirstOrThrow({ where: { tipo: 'comunicado', canal: 'email', ref_id: c.id } });
    assert.equal(mail.estado, 'enviada');
    await prisma.suscripcionCondominio.create({ data: { complejo_id: d.complejoA.id, plan_clave: 'cortesia', modulos: ['ia_vouchers', 'whatsapp_avisos', 'asistente'], estado: 'activa' } });
    invalidarComercial();
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: null } });
  });

  it('en la auditoría de crear queda cuántos avisos se encolaron', async () => {
    const c = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id, enviar_correo: true }));
    const fila = await esperar(() => prisma.auditoria.findFirst({ where: { entidad: 'comunicado', entidad_id: c.id, accion: 'crear' } }));
    assert.equal((fila.detalle as { avisos_encolados: number }).avisos_encolados, 4);
  });
});

describe('comunicados: envíos por comunicado y filtros de /api/notificaciones', () => {
  const envios = (r: { body: { items: { id: number; envios?: { total: number } }[] } }, id: number) => r.body.items.find((i) => i.id === id)?.envios;

  it('cada comunicado trae sus envíos por estado; uno sólo en pantalla trae todo en 0', async () => {
    const con = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id, enviar_correo: true }));
    const sin = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id, titulo: 'Sólo en pantalla' }));
    const filas = await prisma.notificacion.findMany({ where: { ref_entidad: 'comunicado', ref_id: con.id }, orderBy: { id: 'asc' } });
    assert.equal(filas.length, 4);
    await prisma.notificacion.update({ where: { id: filas[0]!.id }, data: { estado: 'enviada' } });
    await prisma.notificacion.update({ where: { id: filas[1]!.id }, data: { estado: 'error' } });
    await prisma.notificacion.update({ where: { id: filas[2]!.id }, data: { estado: 'omitida' } });
    const r = await llama(T.adminA, 'GET', `/api/comunicados?complejo_id=${d.complejoA.id}`);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(envios(r, con.id), { total: 4, pendiente: 1, enviada: 1, error: 1, omitida: 1 });
    assert.deepEqual(envios(r, sin.id), { total: 0, pendiente: 0, enviada: 0, error: 0, omitida: 0 });
  });

  it('el conteo sólo cuenta lo que quien mira alcanza: un aviso de ese comunicado a un vecino de otro condominio no suma', async () => {
    const c = await crear(T.presi1, nuevo({ enviar_correo: true })); // block 1: inq1, presipropio y prop1
    await prisma.notificacion.create({ data: { usuario_id: d.propietarioB.id, canal: 'email', tipo: 'comunicado', asunto: 'x', cuerpo: 'x', estado: 'enviada', ref_entidad: 'comunicado', ref_id: c.id } });
    assert.equal(envios(await llama(T.presi1, 'GET', '/api/comunicados'), c.id)?.total, 3);
    assert.equal(envios(await llama(T.adminA, 'GET', '/api/comunicados'), c.id)?.total, 3);
    assert.equal(envios(await llama(T.super, 'GET', '/api/comunicados'), c.id)?.total, 4);
  });

  it('?comunicado_id= trae sólo los envíos de ese comunicado, y la cifra igual; uno ajeno o de otro condominio no trae nada', async () => {
    const a = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id, enviar_correo: true }));
    const b = await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id, titulo: 'Del block 1', estructura_id: e1.id, enviar_correo: true }));
    const lista = await llama(T.adminA, 'GET', `/api/notificaciones?comunicado_id=${b.id}&pageSize=100`);
    assert.equal(lista.status, 200, lista.texto);
    assert.equal(lista.body.total, 3);
    assert.ok(lista.body.items.every((i: { contexto: { comunicado: { id: number } } }) => i.contexto.comunicado.id === b.id));
    assert.deepEqual((await llama(T.adminA, 'GET', `/api/notificaciones/resumen?comunicado_id=${b.id}`)).body, { pendiente: 3, enviada: 0, error: 0, omitida: 0 });
    assert.equal((await llama(T.adminA, 'GET', `/api/notificaciones?comunicado_id=${a.id}`)).body.total, 4);
    const deB = await crear(T.adminB, nuevo({ complejo_id: d.complejoB.id, enviar_correo: true }));
    assert.equal((await llama(T.adminA, 'GET', `/api/notificaciones?comunicado_id=${deB.id}`)).body.total, 0);
    // La junta de un block sólo ve los envíos de SUS vecinos de un comunicado de todo el condominio (3 de 4).
    assert.equal((await llama(T.presi1, 'GET', `/api/notificaciones?comunicado_id=${a.id}`)).body.total, 3);
    assert.equal((await llama(T.adminA, 'GET', '/api/notificaciones?comunicado_id=999999')).body.total, 0);
  });

  it('el filtro de tipo también mueve la cifra: el resumen de «recibo» no cuenta los de comunicado', async () => {
    await crear(T.adminA, nuevo({ complejo_id: d.complejoA.id, enviar_correo: true }));
    assert.deepEqual((await llama(T.adminA, 'GET', '/api/notificaciones/resumen?tipo=recibo_emitido')).body, { pendiente: 0, enviada: 0, error: 0, omitida: 0 });
    assert.deepEqual((await llama(T.adminA, 'GET', '/api/notificaciones/resumen?tipo=comunicado')).body, { pendiente: 4, enviada: 0, error: 0, omitida: 0 });
    assert.equal((await llama(T.adminA, 'GET', '/api/notificaciones/resumen?tipo=inventado')).status, 422);
  });
});

describe('comunicados: la plantilla del aviso', () => {
  const datos = { nombre: 'María Elena Quispe', periodo: '', monto: '', vencimiento: '', titulo: 'Corte de agua', texto: 'Línea 1\nLínea 2 <b>tal cual</b>', condominio: 'Los Libertadores' };
  it('el asunto es el título; el cuerpo trae el saludo, el texto tal cual, el enlace y la firma del condominio; nada de recibos', () => {
    assert.ok(TIPOS.includes('comunicado'));
    const { asunto, cuerpo } = plantilla('comunicado', datos);
    assert.equal(asunto, 'Corte de agua');
    assert.match(cuerpo, /^Hola María,\n\nLínea 1\nLínea 2 <b>tal cual<\/b>\n\n/);
    assert.match(cuerpo, /https:\/\/house\.gargurevich\.dev/);
    assert.match(cuerpo, /— Administración de Los Libertadores$/);
    assert.doesNotMatch(cuerpo, /Quispe|undefined|NaN|S\/|vence/);
  });
});
