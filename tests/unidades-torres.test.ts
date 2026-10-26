// Torres: alta con pisos, torres planas, baja protegida y asignación de las unidades que aún no tienen torre.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB', string>;

const crearTorre = (token: string, extra: Record<string, unknown> = {}) =>
  llamar(base, 'POST', '/api/estructuras', token, { nombre: 'Torre 1', tipo: 'Torre', complejo_id: d.complejoA.id, ...extra });
const pisosDe = (estructura_id: number) => prisma.piso.findMany({ where: { estructura_id }, orderBy: { numero: 'asc' } });

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe') };
});

after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('torres: alta con sus pisos', () => {
  it('crear una torre con cantidad_pisos crea también los pisos (1, 2, 3…)', async () => {
    const r = await crearTorre(T.adminA, { nombre: 'Torre Norte', cantidad_pisos: 3 });
    assert.equal(r.status, 201, r.texto);
    const pisos = await pisosDe(r.body.id);
    assert.deepEqual(pisos.map(p => p.numero), [1, 2, 3]);
  });

  it('sin cantidad_pisos la torre se crea sin pisos', async () => {
    const r = await crearTorre(T.adminA, { nombre: 'Torre Sin Pisos' });
    assert.equal(r.status, 201, r.texto);
    assert.equal((await pisosDe(r.body.id)).length, 0);
  });

  it('editar agrega los pisos que faltan y no borra los que ya existen', async () => {
    const r = await crearTorre(T.adminA, { nombre: 'Torre Editada', cantidad_pisos: 2 });
    const ed = await llamar(base, 'PUT', `/api/estructuras/${r.body.id}`, T.adminA, { cantidad_pisos: 5 });
    assert.equal(ed.status, 200, ed.texto);
    assert.deepEqual((await pisosDe(r.body.id)).map(p => p.numero), [1, 2, 3, 4, 5]);
  });

  it('la lista trae el conteo de pisos y de unidades de cada torre', async () => {
    const t = await crearTorre(T.adminA, { nombre: 'Torre Contada', cantidad_pisos: 4 });
    await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: t.body.id } });
    const lista = await llamar(base, 'GET', `/api/estructuras?complejo_id=${d.complejoA.id}&pageSize=100`, T.adminA);
    const fila = lista.body.items.find((x: { id: number }) => x.id === t.body.id);
    assert.equal(fila.pisos_count, 4);
    assert.equal(fila.unidades_count, 1);
  });
});

describe('torres: son planas (no se anidan)', () => {
  it('crear una torre con padre_id se rechaza con un mensaje claro', async () => {
    const padre = await crearTorre(T.adminA, { nombre: 'Torre Padre' });
    const r = await crearTorre(T.adminA, { nombre: 'Torre Hija', padre_id: padre.body.id });
    assert.equal(r.status, 422, r.texto);
    assert.match(r.body.error, /torres planas/i);
  });

  it('editar una torre con padre_id también se rechaza', async () => {
    const padre = await crearTorre(T.adminA, { nombre: 'Torre Padre 2' });
    const r = await llamar(base, 'PUT', `/api/estructuras/${padre.body.id}`, T.adminA, { padre_id: padre.body.id });
    assert.equal(r.status, 422, r.texto);
    assert.match(r.body.error, /torres planas/i);
  });

  it('una torre no se cambia de condominio', async () => {
    const t = await crearTorre(T.adminA, { nombre: 'Torre Fija' });
    const r = await llamar(base, 'PUT', `/api/estructuras/${t.body.id}`, T.adminA, { complejo_id: d.complejoB.id });
    assert.equal(r.status, 422, r.texto);
    assert.match(r.body.error, /no se cambia de condominio/i);
  });
});

describe('torres: la baja se protege', () => {
  it('una torre con unidades no se puede borrar', async () => {
    const t = await crearTorre(T.adminA, { nombre: 'Torre Con Unidades' });
    await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: t.body.id } });
    const r = await llamar(base, 'DELETE', `/api/estructuras/${t.body.id}`, T.adminA);
    assert.equal(r.status, 422, r.texto);
    assert.match(r.body.error, /unidad/i);
    assert.ok(await prisma.estructura.findUnique({ where: { id: t.body.id } }), 'la torre sigue ahí');
  });

  it('una torre con un usuario de junta no se puede borrar y su alcance NO se amplía', async () => {
    const t = await crearTorre(T.adminA, { nombre: 'Torre De La Junta' });
    const hash = await bcrypt.hash(PASSWORD, 4);
    const presidente = await prisma.usuario.create({
      data: { nombre: 'Presidente', email: `presidente.${Date.now()}@test.pe`, rol: 'propietario', password_hash: hash, complejo_id: d.complejoA.id, estructura_id: t.body.id, cargo_junta: 'presidente' },
    });
    const tokenPresidente = await login(base, presidente.email);

    // Antes: la junta sólo alcanza su torre.
    const antes = await llamar(base, 'GET', '/api/medios-pago/ambitos', tokenPresidente);
    assert.equal(antes.status, 200, antes.texto);
    assert.equal(antes.body.fijo, true, 'la junta tiene una torre fija');
    assert.deepEqual(antes.body.complejos[0].estructuras.map((e: { id: number }) => e.id), [t.body.id]);

    const r = await llamar(base, 'DELETE', `/api/estructuras/${t.body.id}`, T.adminA);
    assert.equal(r.status, 422, r.texto);
    assert.match(r.body.error, /junta/i);

    // La torre sigue asignada: el alcance de la junta no se amplía en silencio.
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: presidente.id } })).estructura_id, t.body.id);
    const despues = await llamar(base, 'GET', '/api/medios-pago/ambitos', tokenPresidente);
    assert.equal(despues.body.fijo, true, 'sigue acotada a su torre');
    assert.deepEqual(despues.body.complejos[0].estructuras.map((e: { id: number }) => e.id), [t.body.id]);
  });

  it('una torre vacía sí se borra, y con ella sus pisos', async () => {
    const t = await crearTorre(T.adminA, { nombre: 'Torre Vacía', cantidad_pisos: 3 });
    const r = await llamar(base, 'DELETE', `/api/estructuras/${t.body.id}`, T.adminA);
    assert.equal(r.status, 204, r.texto);
    assert.equal(await prisma.estructura.count({ where: { id: t.body.id } }), 0);
    assert.equal(await prisma.piso.count({ where: { estructura_id: t.body.id } }), 0);
  });
});

describe('torres: asignar las unidades que no tienen torre', () => {
  it('mueve sólo las unidades sin torre y dice cuántas movió', async () => {
    const destino = await crearTorre(T.adminA, { nombre: 'Torre Destino' });
    const otra = await crearTorre(T.adminA, { nombre: 'Torre Con Una Unidad' });
    // A1 vuelve a estar sin torre; A2 ya tiene una.
    await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: null } });
    await prisma.unidad.update({ where: { id: d.unidadA2.id }, data: { estructura_id: otra.body.id } });
    // A1 y la unidad de B (de otro condominio) siguen sin torre.
    const r = await llamar(base, 'POST', `/api/estructuras/${destino.body.id}/asignar-unidades`, T.adminA);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.asignadas, 1, 'sólo A1 estaba sin torre');
    assert.equal((await prisma.unidad.findUniqueOrThrow({ where: { id: d.unidadA1.id } })).estructura_id, destino.body.id);
    assert.equal((await prisma.unidad.findUniqueOrThrow({ where: { id: d.unidadA2.id } })).estructura_id, otra.body.id, 'la que ya tenía torre no se movió');
    assert.equal((await prisma.unidad.findUniqueOrThrow({ where: { id: d.unidadB1.id } })).estructura_id, null, 'otra empresa no se toca');
  });

  it('si no hay unidades sin torre, dice que no movió ninguna', async () => {
    const t = await crearTorre(T.adminA, { nombre: 'Torre Sin Pendientes' });
    await prisma.unidad.updateMany({ where: { complejo_id: d.complejoA.id, estructura_id: null }, data: { estructura_id: t.body.id } });
    const r = await llamar(base, 'POST', `/api/estructuras/${t.body.id}/asignar-unidades`, T.adminA);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.asignadas, 0);
  });
});

describe('unidades: la torre viaja en la lista y filtra', () => {
  it('la lista trae la estructura de cada unidad', async () => {
    const t = await crearTorre(T.adminA, { nombre: 'Torre Visible' });
    await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: t.body.id } });
    const r = await llamar(base, 'GET', '/api/unidades?pageSize=100', T.adminA);
    const fila = r.body.items.find((u: { id: number }) => u.id === d.unidadA1.id);
    assert.deepEqual(fila.estructura, { id: t.body.id, nombre: 'Torre Visible' });
  });

  it('el filtro estructura_id acota la lista', async () => {
    const t1 = await crearTorre(T.adminA, { nombre: 'Torre Filtro 1' });
    const t2 = await crearTorre(T.adminA, { nombre: 'Torre Filtro 2' });
    await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: t1.body.id } });
    await prisma.unidad.update({ where: { id: d.unidadA2.id }, data: { estructura_id: t2.body.id } });
    const r = await llamar(base, 'GET', `/api/unidades?estructura_id=${t1.body.id}&pageSize=100`, T.adminA);
    assert.equal(r.body.total, 1);
    assert.equal(r.body.items[0].id, d.unidadA1.id);
    const vacio = await llamar(base, 'GET', '/api/unidades?estructura_id=999999&pageSize=100', T.adminA);
    assert.equal(vacio.body.total, 0);
  });

  it('el filtro por estructura y el de condominio se combinan', async () => {
    const t = await crearTorre(T.adminA, { nombre: 'Torre Del Complejo A' });
    await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: t.body.id } });
    const r = await llamar(base, 'GET', `/api/unidades?complejo_id=${d.complejoB.id}&estructura_id=${t.body.id}&pageSize=100`, T.adminA);
    assert.equal(r.body.total, 0, 'la torre de A no devuelve unidades de B');
  });
});

describe('alcance: una torre de otra empresa es 404', () => {
  it('el admin de B no ve ni toca las torres de A', async () => {
    const t = await crearTorre(T.adminA, { nombre: 'Torre Privada de A' });
    assert.equal((await llamar(base, 'GET', `/api/estructuras/${t.body.id}`, T.adminB)).status, 404);
    assert.equal((await llamar(base, 'DELETE', `/api/estructuras/${t.body.id}`, T.adminB)).status, 404);
    assert.equal((await llamar(base, 'PUT', `/api/estructuras/${t.body.id}`, T.adminB, { nombre: 'Robada' })).status, 404);
    const lista = await llamar(base, 'GET', '/api/estructuras?pageSize=100', T.adminB);
    assert.equal(lista.body.total, 0);
  });

  it('crear una torre en un condominio de otra empresa se rechaza', async () => {
    const r = await llamar(base, 'POST', '/api/estructuras', T.adminB, { nombre: 'Invasora', tipo: 'Torre', complejo_id: d.complejoA.id });
    assert.equal(r.status, 422, r.texto);
  });
});

describe('condominios: filtro por empresa', () => {
  it('el filtro empresa_id acota la lista', async () => {
    const r = await llamar(base, 'GET', `/api/complejos?empresa_id=${d.empresaA.id}&pageSize=100`, T.adminA);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.total, 1);
    assert.equal(r.body.items[0].id, d.complejoA.id);
  });

  it('un admin no puede pedir los condominios de otra empresa', async () => {
    const r = await llamar(base, 'GET', `/api/complejos?empresa_id=${d.empresaB.id}&pageSize=100`, T.adminA);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.total, 0, 'el alcance manda sobre el filtro');
  });

  it('el superadmin filtra por empresa', async () => {
    const r = await llamar(base, 'GET', `/api/complejos?empresa_id=${d.empresaB.id}&pageSize=100`, T.super);
    assert.equal(r.body.total, 1);
    assert.equal(r.body.items[0].id, d.complejoB.id);
  });

  it('un condominio de otra empresa es 404 (no 403)', async () => {
    assert.equal((await llamar(base, 'GET', `/api/complejos/${d.complejoB.id}`, T.adminA)).status, 404);
  });
});
