// Junta única: un condominio con UNA sola junta directiva (la de todo el condominio, sin ningún block con junta vigente).
// Se calcula en el servidor al leer, nunca se guarda: lo ven el usuario (login y /api/auth/me), la lista de juntas y «Mi junta» del vecino.
// Un condominio con juntas por block (Los Libertadores) NO es de junta única, y registrar una junta de block quita la condición sola.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { esJuntaUnicaDe } from '../src/server/lib/juntaUnica';
import { sincronizarCargos } from '../src/server/services/juntas';
import { darCortesia, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let unico: { id: number };
let cerrado: { id: number };
let torre: { id: number };
let blockA1: { id: number };
let blockA2: { id: number };
let U: Record<'tere' | 'pres' | 'vecino' | 'celia' | 'ana' | 'eva', number>;
let T: Record<'tere' | 'pres' | 'vecino' | 'celia' | 'ana' | 'admin', string>;

const desde = new Date('2026-01-01T00:00:00.000Z');
const llama = (t: string | null, metodo: string, ruta: string) => llamar(base, metodo, ruta, t);
const correoDe = (clave: string) => `${clave}@junta-unica.test`;
type Item = { ambito: { estructura: { nombre: string } | null }; junta: { miembros: { cargo: string }[] } | null; junta_unica: boolean };
const nombresDe = (items: Item[]) => items.map((i) => i.ambito.estructura?.nombre ?? 'central');

/** Un usuario propietario del condominio (con su unidad en el block indicado, si la hay). */
async function vecino(clave: string, nombre: string, complejoId: number, estructuraId: number | null, codigo?: string) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const u = await prisma.usuario.create({ data: { nombre, email: correoDe(clave), telefono: '+51 987 654 321', rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: complejoId } });
  if (codigo) await prisma.unidad.create({ data: { codigo, tipo: 'Departamento', complejo_id: complejoId, empresa_id: d.empresaA.id, estructura_id: estructuraId, propietario_id: u.id, estado: 'activa' } });
  return u.id;
}

/** Una junta (vigente salvo que se pida `hasta`) con sus miembros; luego se sincronizan los cargos como lo hace la administración. */
async function junta(complejoId: number, estructuraId: number | null, miembros: [number, string][], hasta: Date | null = null) {
  const j = await prisma.juntaDirectiva.create({
    data: { complejo_id: complejoId, estructura_id: estructuraId, desde, hasta, miembros: { create: miembros.map(([usuario_id, cargo]) => ({ usuario_id, cargo })) } },
  });
  await sincronizarCargos(complejoId, estructuraId);
  return j;
}

before(async () => {
  d = await sembrar();
  // El condominio de una sola junta: un edificio con una torre.
  unico = await prisma.complejoHabitacional.create({ data: { nombre: 'Edificio Las Gardenias', tipo: 'Edificio', empresa_id: d.empresaA.id } });
  await darCortesia(unico.id);
  torre = await prisma.estructura.create({ data: { nombre: 'Torre única', tipo: 'Torre', complejo_id: unico.id } });
  // Un condominio cuya única junta está cerrada (no vigente): no es de junta única.
  cerrado = await prisma.complejoHabitacional.create({ data: { nombre: 'Edificio Cerrado', tipo: 'Edificio', empresa_id: d.empresaA.id } });
  await darCortesia(cerrado.id);
  await prisma.juntaDirectiva.create({ data: { complejo_id: cerrado.id, estructura_id: null, desde, hasta: new Date('2026-06-30T00:00:00.000Z') } });
  // Los Libertadores en miniatura (complejo A de la siembra): dos blocks; luego se les pone junta por block y la Junta central.
  blockA1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
  blockA2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'Block', complejo_id: d.complejoA.id } });
  U = {
    tere: await vecino('tere', 'Tere Tesorera', unico.id, null, 'G-101'),
    pres: await vecino('pres', 'Pres Presidenta', unico.id, null, 'G-102'),
    vecino: await vecino('vecino', 'Vecino Sin Cargo', unico.id, torre.id, 'G-201'),
    celia: await vecino('celia', 'Celia Central', d.complejoA.id, null, 'A-901'),
    ana: await vecino('ana', 'Ana Block 1', d.complejoA.id, blockA1.id, 'A-101'),
    eva: await vecino('eva', 'Eva Block 2', d.complejoA.id, blockA2.id, 'A-201'),
  };
  // Junta única: presidenta y tesorera de la junta de todo el condominio.
  await junta(unico.id, null, [[U.pres, 'presidente'], [U.tere, 'tesorero']]);
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    tere: await login(base, correoDe('tere')),
    pres: await login(base, correoDe('pres')),
    vecino: await login(base, correoDe('vecino')),
    celia: await login(base, correoDe('celia')),
    ana: await login(base, correoDe('ana')),
    admin: await login(base, 'admin.a@test.pe'),
  };
});

after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('junta única: la sesión (login y /api/auth/me)', () => {
  it('el login dice junta_unica: true a la tesorera y al presidente de la junta de todo el condominio', async () => {
    for (const clave of ['tere', 'pres'] as const) {
      const r = await llamar(base, 'POST', '/api/auth/login', null, { email: correoDe(clave), password: PASSWORD });
      assert.equal(r.status, 200, r.texto);
      assert.equal((r.body as { user: { junta_unica: boolean } }).user.junta_unica, true, clave);
    }
  });

  it('/api/auth/me lo repite; sin cargo de junta el campo es false', async () => {
    assert.equal((await llama(T.tere, 'GET', '/api/auth/me')).body.junta_unica, true);
    assert.equal((await llama(T.vecino, 'GET', '/api/auth/me')).body.junta_unica, false);
  });
});

describe('junta única: la lista de juntas y «Mi junta» del vecino', () => {
  it('GET /api/juntas marca el condominio como de junta única y trae su junta de todo el condominio', async () => {
    const r = await llama(T.tere, 'GET', `/api/juntas?complejo_id=${unico.id}`);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.body.complejos, [{ id: unico.id, nombre: 'Edificio Las Gardenias', junta_unica: true }]);
    const central = (r.body.items as { estructura: unknown; vigente: { miembros: { cargo: string }[] } | null }[]).find((i) => i.estructura === null);
    assert.deepEqual(central?.vigente?.miembros.map((m) => m.cargo), ['presidente', 'tesorero']);
  });

  it('el admin ve la marca de cada condominio: junta única el de una sola junta, y no el de juntas por block', async () => {
    const r = await llama(T.admin, 'GET', `/api/juntas?complejo_id=${cerrado.id}`);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.complejos[0].junta_unica, false, 'la junta del condominio está cerrada: no cuenta');
    const r2 = await llama(T.admin, 'GET', `/api/juntas?complejo_id=${d.complejoA.id}`);
    assert.equal(r2.body.complejos[0].junta_unica, false, 'el complejo A tiene juntas por block');
  });

  it('«Mi junta» del vecino: una sola junta (la de todo el condominio), sin el block «Sin junta»', async () => {
    const r = await llama(T.vecino, 'GET', '/api/me/juntas');
    assert.equal(r.status, 200, r.texto);
    const items = r.body.items as Item[];
    assert.deepEqual(nombresDe(items), ['central'], 'no debe salir el block «Torre única» (estaría «Sin junta»)');
    assert.equal(items[0]!.junta_unica, true);
    assert.deepEqual(items[0]!.junta!.miembros.map((m) => m.cargo), ['presidente', 'tesorero']);
  });
});

describe('fuera de junta única (Los Libertadores): nada cambia', () => {
  it('con junta por block y la Junta central, el vecino ve sus dos juntas y ninguna es de junta única', async () => {
    await junta(d.complejoA.id, blockA1.id, [[U.ana, 'presidente']]);
    await junta(d.complejoA.id, null, [[U.celia, 'presidente']]);
    // Dar un cargo cierra las sesiones de quien lo recibe (como en producción): ana entra de nuevo, ya como presidenta del Block 1.
    const anaConCargo = await login(base, correoDe('ana'));
    const items = (await llama(anaConCargo, 'GET', '/api/me/juntas')).body.items as Item[];
    assert.deepEqual(nombresDe(items), ['Block 1', 'central']);
    assert.ok(items.every((i) => i.junta_unica === false));
  });

  it('el presidente de la Junta central de un condominio con juntas por block no es de junta única', async () => {
    const r = await llamar(base, 'POST', '/api/auth/login', null, { email: correoDe('celia'), password: PASSWORD });
    assert.equal(r.status, 200, r.texto);
    assert.equal((r.body as { user: { junta_unica: boolean } }).user.junta_unica, false);
  });

  it('el presidente de un block tampoco lo es', async () => {
    await junta(d.complejoA.id, blockA2.id, [[U.eva, 'presidente']]);
    const r = await llamar(base, 'POST', '/api/auth/login', null, { email: correoDe('eva'), password: PASSWORD });
    assert.equal((r.body as { user: { junta_unica: boolean } }).user.junta_unica, false);
  });
});

describe('junta única: cambia sola cuando la junta de un block entra o sale', () => {
  it('registrar la junta de un block quita la condición en el usuario, en la lista y en «Mi junta» del vecino', async () => {
    assert.equal((await llama(T.tere, 'GET', '/api/auth/me')).body.junta_unica, true, 'antes del cambio, es de junta única');
    await prisma.juntaDirectiva.create({ data: { complejo_id: unico.id, estructura_id: torre.id, desde } });
    assert.equal((await llama(T.tere, 'GET', '/api/auth/me')).body.junta_unica, false, 'con junta de block ya no es única');
    assert.equal((await llama(T.tere, 'GET', `/api/juntas?complejo_id=${unico.id}`)).body.complejos[0].junta_unica, false);
    const items = (await llama(T.vecino, 'GET', '/api/me/juntas')).body.items as Item[];
    assert.deepEqual(nombresDe(items), ['Torre única', 'central']);
    assert.ok(items.every((i) => i.junta_unica === false));
  });

  it('cerrar esa junta de block devuelve la condición (nada se guardó como «de junta única»)', async () => {
    await prisma.juntaDirectiva.updateMany({ where: { complejo_id: unico.id, estructura_id: torre.id, hasta: null }, data: { hasta: new Date('2026-06-30T00:00:00.000Z') } });
    assert.equal((await llama(T.tere, 'GET', '/api/auth/me')).body.junta_unica, true);
    const items = (await llama(T.vecino, 'GET', '/api/me/juntas')).body.items as Item[];
    assert.deepEqual(nombresDe(items), ['central']);
    assert.equal(items[0]!.junta_unica, true);
  });
});

describe('la regla pura (lib/juntaUnica)', () => {
  it('sólo es de junta única con una junta vigente del condominio y ninguna de block', () => {
    assert.equal(esJuntaUnicaDe([]), false, 'sin juntas');
    assert.equal(esJuntaUnicaDe([{ estructura_id: null }]), true, 'sólo la del condominio');
    assert.equal(esJuntaUnicaDe([{ estructura_id: null }, { estructura_id: 7 }]), false, 'con una junta de block');
    assert.equal(esJuntaUnicaDe([{ estructura_id: 7 }]), false, 'sólo juntas de block');
    assert.equal(esJuntaUnicaDe([{ estructura_id: 7 }, { estructura_id: 8 }]), false, 'dos blocks con junta');
  });
});
