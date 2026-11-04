// «Manual y videos» en el menú de la cuenta (Miguel, 4-nov: «el manual está disponible en la aplicación también?»): la dirección vive en la base,
// la lee cualquier usuario con sesión, la cambia sólo el superadmin, y el enlace abre la sección del rol.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar } from './helpers/app';
import { anclaDelManual, enlaceDelManual } from '../src/app/manual';

let base: string;
let cerrar: () => Promise<void>;
let T: Record<'super' | 'adminA', string>;

before(async () => {
  await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe') };
});
after(async () => { await cerrar(); await prisma.$disconnect(); });

describe('GET /api/comercial/manual', () => {
  it('con sesión devuelve la dirección de la base (por defecto, la publicada); sin sesión, 401', async () => {
    const r = await llamar(base, 'GET', '/api/comercial/manual', T.adminA);
    assert.equal(r.status, 200);
    assert.match(r.body.url, /^https:\/\/.+\.html$/);
    assert.equal((await llamar(base, 'GET', '/api/comercial/manual', null)).status, 401);
  });

  it('sólo el superadmin la cambia; vacío = null (la opción desaparece); sin https → 422', async () => {
    assert.equal((await llamar(base, 'PUT', '/api/comercial/configuracion', T.adminA, { url_manual: 'https://x.test/m.html' })).status, 403);
    assert.equal((await llamar(base, 'PUT', '/api/comercial/configuracion', T.super, { url_manual: 'http://x.test/m.html' })).status, 422);
    assert.equal((await llamar(base, 'PUT', '/api/comercial/configuracion', T.super, { url_manual: 'https://x.test/m.html' })).status, 200);
    assert.equal((await llamar(base, 'GET', '/api/comercial/manual', T.adminA)).body.url, 'https://x.test/m.html');
    assert.equal((await llamar(base, 'PUT', '/api/comercial/configuracion', T.super, { url_manual: '' })).status, 200);
    assert.equal((await llamar(base, 'GET', '/api/comercial/manual', T.adminA)).body.url, null);
  });
});

describe('el enlace abre la sección del rol', () => {
  const u = (rol: string, extra: Record<string, unknown> = {}) => ({ rol, cargo_junta: null, estructura_id: null, junta_unica: false, ...extra }) as Parameters<typeof anclaDelManual>[0];
  it('administradora, vecinos, personal, junta del block, Junta central y superadmin', () => {
    assert.equal(anclaDelManual(u('admin')), 'rol-admin');
    assert.equal(anclaDelManual(u('propietario')), 'rol-propietario');
    assert.equal(anclaDelManual(u('inquilino')), 'rol-inquilino');
    assert.equal(anclaDelManual(u('limpieza')), 'rol-limpieza');
    assert.equal(anclaDelManual(u('propietario', { cargo_junta: 'tesorero', estructura_id: 3 })), 'rol-junta');
    assert.equal(anclaDelManual(u('propietario', { cargo_junta: 'presidente' })), 'rol-junta_central');
    assert.equal(anclaDelManual(u('propietario', { cargo_junta: 'presidente', junta_unica: true })), 'rol-junta');
    assert.equal(anclaDelManual(u('superadmin')), '');
    assert.equal(enlaceDelManual('https://x.test/m.html#viejo', u('admin')), 'https://x.test/m.html#rol-admin');
  });

  it('el manual publica esas anclas y el menú muestra la opción sólo si hay dirección', () => {
    const script = readFileSync('scripts/marketing/manual-con-videos.py', 'utf8');
    assert.match(script, /rol-\{r\}/);
    const menu = readFileSync('src/app/MenuUsuario.tsx', 'utf8');
    assert.match(menu, /manual\.data\?\.url && \(/);
    assert.match(menu, /target="_blank" rel="noopener noreferrer"/);
    assert.match(menu, /Manual y videos/);
  });
});
