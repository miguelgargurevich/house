// `estructura_nombre` en el login y en `/api/auth/me`: sólo el nombre del block del cargo (el rótulo del menú).
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'tesoreroBlock' | 'tesoreroCentral' | 'presidenteSinNombre' | 'sinBlock', string>;

before(async () => {
  d = await sembrar();
  const block1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
  const blockSinNombre = await prisma.estructura.create({ data: { nombre: null, tipo: 'Block', complejo_id: d.complejoA.id } });
  const hash = bcrypt.hashSync(PASSWORD, 4);
  const propietario = (email: string, extra: Record<string, unknown>) =>
    prisma.usuario.create({ data: { nombre: email, email, rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, ...extra } });
  await propietario('tesorero.block@test.pe', { cargo_junta: 'tesorero', estructura_id: block1.id });
  await propietario('tesorero.central@test.pe', { cargo_junta: 'tesorero', estructura_id: null });
  await propietario('presidente.sin.nombre@test.pe', { cargo_junta: 'presidente', estructura_id: blockSinNombre.id });
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, password: 100_000 } }));
  T = {
    tesoreroBlock: await login(base, 'tesorero.block@test.pe'),
    tesoreroCentral: await login(base, 'tesorero.central@test.pe'),
    presidenteSinNombre: await login(base, 'presidente.sin.nombre@test.pe'),
    sinBlock: await login(base, 'prop1@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

const me = (token: string) => llamar(base, 'GET', '/api/auth/me', token);
const loginCrudo = (email: string) => llamar(base, 'POST', '/api/auth/login', null, { email, password: PASSWORD });

describe('estructura_nombre en /api/auth/me', () => {
  it('tesorero de un block: el nombre del block', async () => {
    const r = await me(T.tesoreroBlock);
    assert.equal(r.status, 200);
    assert.equal(r.body.cargo_junta, 'tesorero');
    assert.equal(r.body.estructura_nombre, 'Block 1');
  });

  it('tesorero de la Junta central (sin block): null', async () => {
    const r = await me(T.tesoreroCentral);
    assert.equal(r.body.cargo_junta, 'tesorero');
    assert.equal(r.body.estructura_id, null);
    assert.equal(r.body.estructura_nombre, null);
  });

  it('presidente de un block sin nombre: null', async () => {
    const r = await me(T.presidenteSinNombre);
    assert.equal(r.body.cargo_junta, 'presidente');
    assert.equal(r.body.estructura_nombre, null);
  });

  it('propietario sin cargo ni block: null', async () => {
    const r = await me(T.sinBlock);
    assert.equal(r.body.cargo_junta, null);
    assert.equal(r.body.estructura_nombre, null);
  });

  it('sólo suma el nombre: no sale el objeto de la torre ni el hash de la contraseña', async () => {
    const r = await me(T.tesoreroBlock);
    assert.equal(r.body.estructura, undefined);
    assert.equal(r.body.password_hash, undefined);
    assert.equal(r.body.email, 'tesorero.block@test.pe');
  });
});

describe('estructura_nombre en el login', () => {
  it('tesorero de un block: el nombre del block en `user`', async () => {
    const r = await loginCrudo('tesorero.block@test.pe');
    assert.equal(r.status, 200);
    assert.equal(r.body.user.estructura_nombre, 'Block 1');
    assert.equal(r.body.user.estructura, undefined);
    assert.equal(r.body.user.password_hash, undefined);
  });

  it('tesorero de la Junta central: null', async () => {
    const r = await loginCrudo('tesorero.central@test.pe');
    assert.equal(r.body.user.estructura_nombre, null);
  });

  it('propietario sin block: null', async () => {
    const r = await loginCrudo('prop1@test.pe');
    assert.equal(r.body.user.estructura_nombre, null);
  });
});
