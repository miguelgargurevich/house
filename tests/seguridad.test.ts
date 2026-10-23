import { JWT_SECRET_PRUEBAS } from './helpers/env';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import { errorHandler } from '../src/server/middleware/error';
import { resolveJwtSecret } from '../src/server/config';
import { iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000 } }));
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('login', () => {
  it('devuelve token HS256 de 8h con el payload acordado y el usuario sin hash', async () => {
    const r = await llamar(base, 'POST', '/api/auth/login', null, { email: 'admin.a@test.pe', password: PASSWORD });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['token', 'user']);
    assert.deepEqual(r.body.user, { id: d.adminA.id, nombre: 'Admin A', email: 'admin.a@test.pe', rol: 'admin', empresa_id: d.empresaA.id, complejo_id: null });
    const { header, payload } = jwt.decode(r.body.token, { complete: true }) as { header: { alg: string }; payload: Record<string, number | string | null> };
    assert.equal(header.alg, 'HS256');
    assert.equal(Number(payload.exp) - Number(payload.iat), 8 * 3600);
    assert.deepEqual({ id: payload.id, email: payload.email, rol: payload.rol, empresa_id: payload.empresa_id, complejo_id: payload.complejo_id }, { id: d.adminA.id, email: 'admin.a@test.pe', rol: 'admin', empresa_id: d.empresaA.id, complejo_id: null });
    assert.ok(!/password|hash|\$2[aby]\$/i.test(r.texto));
  });

  it('rechaza contraseña errónea y usuario inexistente con el mismo mensaje (401)', async () => {
    const mala = await llamar(base, 'POST', '/api/auth/login', null, { email: 'admin.a@test.pe', password: 'incorrecta' });
    const fantasma = await llamar(base, 'POST', '/api/auth/login', null, { email: 'nadie@test.pe', password: 'incorrecta' });
    assert.equal(mala.status, 401);
    assert.equal(fantasma.status, 401);
    assert.deepEqual(mala.body, fantasma.body);
    assert.equal(mala.body.error, 'Credenciales inválidas');
  });

  it('un usuario inexistente tarda lo mismo que uno real (compara contra un hash de relleno)', async () => {
    const t0 = performance.now();
    await llamar(base, 'POST', '/api/auth/login', null, { email: 'fantasma.dos@test.pe', password: 'incorrecta' });
    const ms = performance.now() - t0;
    assert.ok(ms >= 50, `respondió en ${ms.toFixed(1)} ms: no hubo comparación bcrypt`);
  });

  it('valida el cuerpo del login (422) y ya no existen /auth/login ni /api/login', async () => {
    assert.equal((await llamar(base, 'POST', '/api/auth/login', null, { email: 'no-es-correo', password: 'x' })).status, 422);
    assert.equal((await llamar(base, 'POST', '/api/auth/login', null, {})).status, 422);
    assert.equal((await llamar(base, 'POST', '/auth/login', null, { email: 'admin.a@test.pe', password: PASSWORD })).status, 404);
    const vieja = await llamar(base, 'POST', '/api/login', null, { email: 'admin.a@test.pe', password: PASSWORD });
    assert.ok([401, 404].includes(vieja.status));
    assert.equal(vieja.body?.token, undefined);
  });

  it('limita a 10 intentos por IP+email en 15 min (el 11.º recibe 429) sin bloquear a otros correos', async () => {
    const correo = 'prop1@test.pe';
    for (let i = 0; i < 10; i++) {
      const r = await llamar(base, 'POST', '/api/auth/login', null, { email: correo, password: `mala-${i}` });
      assert.equal(r.status, 401, `intento ${i + 1}`);
    }
    const bloqueado = await llamar(base, 'POST', '/api/auth/login', null, { email: correo, password: PASSWORD });
    assert.equal(bloqueado.status, 429);
    assert.match(bloqueado.body.error, /intentos/i);
    const otro = await llamar(base, 'POST', '/api/auth/login', null, { email: 'prop2@test.pe', password: PASSWORD });
    assert.equal(otro.status, 200);
  });

  it('GET /api/auth/me devuelve el usuario actual sin password_hash', async () => {
    const token = await login(base, 'inq1@test.pe');
    const r = await llamar(base, 'GET', '/api/auth/me', token);
    assert.equal(r.status, 200);
    assert.equal(r.body.email, 'inq1@test.pe');
    assert.equal(r.body.rol, 'inquilino');
    assert.ok(!r.texto.includes('password_hash'));
  });
});

describe('autenticación obligatoria', () => {
  const lecturas = [
    '/api/usuarios', '/api/empresas', '/api/complejos', '/api/pisos', '/api/estructuras', '/api/unidades', '/api/conceptos', '/api/recibos', '/api/pagos',
    '/api/recibo-conceptos', '/api/recibo-concepto-unidades', '/api/tareas', '/api/auditoria', '/api/dashboard/resumen', '/api/reportes/morosidad',
    '/api/auth/me', '/api/me/unidades', '/api/me/cargos', '/api/me/pagos', '/api/usuarios/1', '/api/unidades/1', '/api/recibos/1',
  ];

  it('todos los GET sin token responden 401', async () => {
    for (const ruta of lecturas) {
      const r = await llamar(base, 'GET', ruta);
      assert.equal(r.status, 401, `GET ${ruta}`);
    }
  });

  it('POST/PUT/DELETE y /api/ai-chat sin token responden 401', async () => {
    assert.equal((await llamar(base, 'POST', '/api/ai-chat', null, { message: 'hola' })).status, 401);
    assert.equal((await llamar(base, 'POST', '/api/usuarios', null, {})).status, 401);
    assert.equal((await llamar(base, 'PUT', '/api/unidades/1', null, {})).status, 401);
    assert.equal((await llamar(base, 'DELETE', '/api/unidades/1')).status, 401);
    assert.equal((await llamar(base, 'POST', '/api/me/cargos/1/pagos', null, { metodo_pago: 'yape' })).status, 401);
  });

  it('rechaza tokens manipulados: firma ajena, alg none, vencido y de usuario eliminado', async () => {
    const payload = { id: d.adminA.id, email: 'admin.a@test.pe', rol: 'admin', empresa_id: d.empresaA.id, complejo_id: null };
    const ajeno = jwt.sign(payload, 'otro-secreto-distinto-de-treinta-y-dos-caracteres', { algorithm: 'HS256' });
    const sinFirma = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`;
    const vencido = jwt.sign(payload, JWT_SECRET_PRUEBAS, { algorithm: 'HS256', expiresIn: -10 });
    const hs512 = jwt.sign(payload, JWT_SECRET_PRUEBAS, { algorithm: 'HS512' });
    for (const [nombre, t] of [['firma ajena', ajeno], ['alg none', sinFirma], ['vencido', vencido], ['HS512', hs512], ['basura', 'abc.def.ghi']] as const) {
      assert.equal((await llamar(base, 'GET', '/api/auth/me', t)).status, 401, nombre);
    }
    const efimero = await prisma.usuario.create({ data: { nombre: 'Efímero', email: 'efimero@test.pe', rol: 'inquilino', password_hash: 'x' } });
    const tokenEfimero = jwt.sign({ id: efimero.id, email: efimero.email, rol: 'inquilino' }, JWT_SECRET_PRUEBAS, { algorithm: 'HS256', expiresIn: '1h' });
    assert.equal((await llamar(base, 'GET', '/api/auth/me', tokenEfimero)).status, 200);
    await prisma.usuario.delete({ where: { id: efimero.id } });
    assert.equal((await llamar(base, 'GET', '/api/auth/me', tokenEfimero)).status, 401);
  });

  it('el rol sale de la base y no del token: un token con rol inflado no da privilegios', async () => {
    const inflado = jwt.sign({ id: d.propietario1.id, email: 'prop1@test.pe', rol: 'superadmin' }, JWT_SECRET_PRUEBAS, { algorithm: 'HS256', expiresIn: '1h' });
    assert.equal((await llamar(base, 'GET', '/api/usuarios', inflado)).status, 403);
  });

  it('un admin sin empresa asignada no puede operar (no ve "todo lo huérfano")', async () => {
    const token = await login(base, 'admin.huerfano@test.pe');
    assert.equal((await llamar(base, 'GET', '/api/unidades', token)).status, 403);
    assert.equal((await llamar(base, 'GET', '/api/usuarios', token)).status, 403);
  });
});

describe('endurecimiento HTTP', () => {
  it('envía cabeceras de helmet y no anuncia Express', async () => {
    const r = await llamar(base, 'GET', '/api/auth/me');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(r.headers.get('content-security-policy'));
    assert.equal(r.headers.get('x-powered-by'), null);
  });

  it('CORS está desactivado por defecto', async () => {
    const r = await llamar(base, 'GET', '/api/auth/me', null, undefined, { origin: 'https://evil.example' });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  });

  it('CORS_ORIGIN habilita sólo los orígenes listados', async () => {
    process.env.CORS_ORIGIN = 'https://app.example, https://otra.example';
    const s = await iniciar();
    delete process.env.CORS_ORIGIN;
    try {
      const ok = await llamar(s.base, 'GET', '/api/auth/me', null, undefined, { origin: 'https://app.example' });
      assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.example');
      const mal = await llamar(s.base, 'GET', '/api/auth/me', null, undefined, { origin: 'https://evil.example' });
      assert.equal(mal.headers.get('access-control-allow-origin'), null);
    } finally {
      await s.cerrar();
    }
  });

  it('rechaza cuerpos mayores de 100 kb (413) y JSON mal formado (400)', async () => {
    const grande = await llamar(base, 'POST', '/api/auth/login', null, { email: 'a@b.pe', password: 'x'.repeat(150_000) });
    assert.equal(grande.status, 413);
    const roto = await llamar(base, 'POST', '/api/auth/login', null, '{"email": ');
    assert.equal(roto.status, 400);
  });

  it('confía en un salto de proxy (X-Forwarded-For identifica al cliente en el rate-limit)', async () => {
    const s = await iniciar({ rateLimits: { api: 2 } });
    try {
      const codigos = [];
      for (let i = 0; i < 3; i++) codigos.push((await llamar(s.base, 'GET', '/api/auth/me', null, undefined, { 'x-forwarded-for': '203.0.113.7' })).status);
      assert.deepEqual(codigos, [401, 401, 429]);
      // otra IP de cliente tiene su propio contador
      assert.equal((await llamar(s.base, 'GET', '/api/auth/me', null, undefined, { 'x-forwarded-for': '203.0.113.8' })).status, 401);
    } finally {
      await s.cerrar();
    }
  });

  it('/api/ai-chat se limita por usuario (20 por defecto; aquí 2)', async () => {
    const s = await iniciar({ rateLimits: { ai: 2, api: 100_000 } });
    try {
      const a = await login(s.base, 'admin.a@test.pe');
      const b = await login(s.base, 'admin.b@test.pe');
      const estados = [];
      for (let i = 0; i < 3; i++) estados.push((await llamar(s.base, 'POST', '/api/ai-chat', a, { message: 'hola' })).status);
      assert.equal(estados[2], 429);
      assert.notEqual(estados[0], 429);
      assert.notEqual((await llamar(s.base, 'POST', '/api/ai-chat', b, { message: 'hola' })).status, 429);
    } finally {
      await s.cerrar();
    }
  });

  it('/api-docs existe fuera de producción y desaparece en producción', async () => {
    const dev = await llamar(base, 'GET', '/api-docs/');
    assert.equal(dev.status, 200);
    const previo = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const s = await iniciar();
    process.env.NODE_ENV = previo;
    try {
      const prod = await llamar(s.base, 'GET', '/api-docs/');
      assert.equal(prod.status, 404);
    } finally {
      await s.cerrar();
    }
  });
});

describe('manejo de errores', () => {
  it('el error handler no filtra detalle ni stack en errores inesperados', async () => {
    const app = express();
    app.get('/boom', () => {
      throw new Error('detalle-interno-secreto postgres://usuario:clave@host/db');
    });
    app.use(errorHandler);
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    const puerto = (server.address() as { port: number }).port;
    const silenciar = console.error;
    console.error = () => {};
    try {
      const r = await llamar(`http://127.0.0.1:${puerto}`, 'GET', '/boom');
      assert.equal(r.status, 500);
      assert.deepEqual(r.body, { error: 'Error interno del servidor' });
      assert.ok(!/secreto|postgres|stack|at /i.test(r.texto));
    } finally {
      console.error = silenciar;
      server.close();
    }
  });

  it('un correo duplicado responde 409 genérico, sin detalle de Prisma', async () => {
    const token = await login(base, 'admin.a@test.pe');
    const r = await llamar(base, 'POST', '/api/usuarios', token, { nombre: 'Duplicado', email: 'prop1@test.pe', rol: 'inquilino', password: 'ClaveSegura123' });
    assert.equal(r.status, 409);
    assert.ok(!/prisma|unique|constraint/i.test(r.texto));
  });
});

describe('arranque', () => {
  const correr = (env: Record<string, string>) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', DATABASE_URL: process.env.DATABASE_URL ?? '', PORT: '0', ...env },
      encoding: 'utf8',
      timeout: 20_000,
    });

  it('en producción sin JWT_SECRET el proceso falla al arrancar con un mensaje claro', () => {
    const r = correr({ NODE_ENV: 'production' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /JWT_SECRET es obligatorio en producción/);
  });

  it('en producción con JWT_SECRET de menos de 32 caracteres también falla', () => {
    const r = correr({ NODE_ENV: 'production', JWT_SECRET: 'corto' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /32 caracteres/);
  });

  it('resolveJwtSecret: producción exige 32+, desarrollo genera uno aleatorio distinto por llamada (no "devsecret")', () => {
    const largo = 'x'.repeat(40);
    assert.equal(resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: largo }), largo);
    const silenciar = console.warn;
    console.warn = () => {};
    try {
      const a = resolveJwtSecret({ NODE_ENV: 'development' });
      const b = resolveJwtSecret({ NODE_ENV: 'development' });
      assert.notEqual(a, b);
      assert.ok(a.length >= 32);
      assert.notEqual(a, 'devsecret');
    } finally {
      console.warn = silenciar;
    }
  });
});
