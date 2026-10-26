import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let admin: string;
let seq = 0;

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, loginCuenta: 100_000, password: 100_000 } }));
  admin = await login(base, 'admin.a@test.pe');
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

const crear = (password: unknown, extra: Record<string, unknown> = {}) =>
  llamar(base, 'POST', '/api/usuarios', admin, { nombre: 'Persona', email: `pol${++seq}@test.pe`, rol: 'inquilino', complejo_id: d.complejoA.id, password, ...extra });

describe('política de contraseñas (B-5)', () => {
  it('rechaza sin letra, sin número y contraseñas comunes (422 con mensaje en español)', async () => {
    for (const [pw, re] of [
      ['abcdefghij', /letra y un número/],
      ['1357924680', /letra y un número/],
      ['Password123', /común/],
      ['PASSWORD123', /común/],
      ['Qwerty123', /común/],
      ['Contraseña1', /común/],
      ['HOUSE123', /común/],
    ] as const) {
      const r = await crear(pw);
      assert.equal(r.status, 422, `${pw}: ${r.texto}`);
      assert.match(JSON.stringify(r.body), re, pw);
    }
  });

  it('acepta una contraseña razonable (con letra y número, no común)', async () => {
    assert.equal((await crear('Mirador2026x')).status, 201);
    assert.equal((await crear('prop1234')).status, 201, 'prop1234 sigue valiendo');
  });

  it('no puede ser igual al correo ni a su parte antes de la @ (sin mayúsculas)', async () => {
    const a = await crear('zeta2026ab', { email: 'zeta2026ab@test.pe' });
    assert.equal(a.status, 422);
    assert.match(JSON.stringify(a.body), /igual a tu correo/);
    const b = await crear('Maria.Lopez99@Test.pe', { email: 'maria.lopez99@test.pe' });
    assert.equal(b.status, 422);
    assert.equal((await crear('Otra.Clave99', { email: 'maria.lopez98@test.pe' })).status, 201);
  });

  it('también se aplica al editar un usuario (PUT) y al cambiar la propia (PUT /api/me/password)', async () => {
    const u = await crear('Mirador2026y');
    assert.equal((await llamar(base, 'PUT', `/api/usuarios/${u.body.id}`, admin, { password: 'qwerty123' })).status, 422);
    assert.equal((await llamar(base, 'PUT', `/api/usuarios/${u.body.id}`, admin, { password: 'Mirador2026z' })).status, 200);

    const t = await login(base, 'prop2@test.pe');
    for (const mala of ['sololetras', '12345678', 'admin123', 'prop2@test.pe', 'PROP2']) {
      const r = await llamar(base, 'PUT', '/api/me/password', t, { actual: PASSWORD, nueva: mala });
      assert.equal(r.status, 422, `${mala}: ${r.texto}`);
    }
    assert.equal((await llamar(base, 'PUT', '/api/me/password', t, { actual: PASSWORD, nueva: 'Nueva.Clave77' })).status, 200);
  });

  it('el login NO aplica la política: una cuenta existente con contraseña débil sigue entrando', async () => {
    await prisma.usuario.create({ data: { nombre: 'Antigua', email: 'antigua@test.pe', rol: 'inquilino', password_hash: await bcrypt.hash('12345678', 4) } });
    const r = await llamar(base, 'POST', '/api/auth/login', null, { email: 'antigua@test.pe', password: '12345678' });
    assert.equal(r.status, 200, r.texto);
  });
});
