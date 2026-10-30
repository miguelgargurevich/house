import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar } from './helpers/app';
import { TOPE_API_ANONIMO, TOPE_API_USUARIO } from '../src/server/middleware/rateLimit';

const ME = '/api/auth/me';
const MENSAJE = 'Demasiadas solicitudes, intenta de nuevo en unos minutos';

before(async () => {
  await sembrar();
});
after(async () => {
  await prisma.$disconnect();
});

/** `n` GET de /api/auth/me con la sesión dada (o anónimas); devuelve los códigos. */
async function pedir(base: string, n: number, sesion: string | null) {
  const codigos: number[] = [];
  for (let i = 0; i < n; i++) codigos.push((await llamar(base, 'GET', ME, sesion)).status);
  return codigos;
}

describe('límite general de la API: por usuario con sesión, por IP sin ella', () => {
  it('los topes por defecto: 300 anónimos por IP y 3000 por usuario', () => {
    assert.equal(TOPE_API_ANONIMO, 300);
    assert.equal(TOPE_API_USUARIO, 3000);
  });

  it('301 solicitudes autenticadas de UN usuario no reciben 429 (el tope anónimo de 300 por IP no las cuenta)', async () => {
    const s = await iniciar({ rateLimits: { api: 300, apiUsuario: 400 } });
    try {
      const a = await login(s.base, 'admin.a@test.pe');
      const codigos = await pedir(s.base, 301, a);
      assert.equal(codigos.filter((c) => c === 200).length, 301);
    } finally {
      await s.cerrar();
    }
  });

  it('dos usuarios desde la MISMA IP no se bloquean entre sí: uno agota su cupo y el otro sigue', async () => {
    const s = await iniciar({ rateLimits: { api: 100_000, apiUsuario: 3 } });
    try {
      const a = await login(s.base, 'admin.a@test.pe');
      const b = await login(s.base, 'admin.b@test.pe');
      assert.deepEqual(await pedir(s.base, 4, a), [200, 200, 200, 429]);
      // B comparte IP (127.0.0.1) con A, que ya está bloqueado: B tiene su propio cupo.
      assert.deepEqual(await pedir(s.base, 4, b), [200, 200, 200, 429]);
      // y A sigue bloqueado sin que B le devuelva nada
      assert.equal((await llamar(s.base, 'GET', ME, a)).status, 429);
    } finally {
      await s.cerrar();
    }
  });

  it('el usuario que agota SU cupo recibe 429 con el mensaje corto', async () => {
    const s = await iniciar({ rateLimits: { api: 100_000, apiUsuario: 2 } });
    try {
      const a = await login(s.base, 'admin.a@test.pe');
      const codigos = await pedir(s.base, 3, a);
      assert.deepEqual(codigos, [200, 200, 429]);
      const r = await llamar(s.base, 'GET', ME, a);
      assert.equal(r.status, 429);
      assert.deepEqual(r.body, { error: MENSAJE });
    } finally {
      await s.cerrar();
    }
  });

  it('lo anónimo sigue limitado por IP: sin sesión una ruta protegida da 401 y al agotar el cupo, 429', async () => {
    const s = await iniciar({ rateLimits: { api: 2, apiUsuario: 100_000 } });
    try {
      assert.deepEqual(await pedir(s.base, 3, null), [401, 401, 429]);
    } finally {
      await s.cerrar();
    }
  });

  it('una cookie inválida cuenta como anónima (401 y luego 429)', async () => {
    const s = await iniciar({ rateLimits: { api: 2, apiUsuario: 100_000 } });
    try {
      const falsa = 'x'.repeat(43) + '.' + 'y'.repeat(43);
      assert.deepEqual(await pedir(s.base, 3, falsa), [401, 401, 429]);
    } finally {
      await s.cerrar();
    }
  });

  it('los tramos públicos (/health, /publico) cuentan por IP', async () => {
    const s = await iniciar({ rateLimits: { api: 2, apiUsuario: 100_000 } });
    try {
      const codigos: number[] = [];
      for (let i = 0; i < 3; i++) codigos.push((await llamar(s.base, 'GET', '/api/health')).status);
      assert.deepEqual(codigos, [200, 200, 429]);
    } finally {
      await s.cerrar();
    }
    const p = await iniciar({ rateLimits: { api: 2, apiUsuario: 100_000, verificacion: 100_000 } });
    try {
      const codigos: number[] = [];
      for (let i = 0; i < 3; i++) codigos.push((await llamar(p.base, 'GET', '/api/publico/planes')).status);
      assert.equal(codigos[2], 429);
      assert.notEqual(codigos[1], 429);
    } finally {
      await p.cerrar();
    }
  });

  it('lo autenticado NO gasta el cupo anónimo: con 10 solicitudes de sesión, lo anónimo conserva todo su cupo', async () => {
    const s = await iniciar({ rateLimits: { api: 3, apiUsuario: 100_000 } });
    try {
      const a = await login(s.base, 'admin.a@test.pe'); // el login es un tramo público: 1 del cupo anónimo
      assert.equal((await pedir(s.base, 10, a)).filter((c) => c === 200).length, 10);
      assert.deepEqual(await pedir(s.base, 3, null), [401, 401, 429]);
    } finally {
      await s.cerrar();
    }
  });

  it('agotar lo anónimo de una IP no saca de la app a quien ya tiene sesión (mismo wifi)', async () => {
    const s = await iniciar({ rateLimits: { api: 2, apiUsuario: 100_000 } });
    try {
      const a = await login(s.base, 'admin.a@test.pe'); // 1 del cupo anónimo
      assert.equal((await llamar(s.base, 'GET', '/api/health')).status, 200); // 2
      assert.equal((await llamar(s.base, 'GET', '/api/health')).status, 429); // agotado
      assert.deepEqual(await pedir(s.base, 5, a), [200, 200, 200, 200, 200]);
    } finally {
      await s.cerrar();
    }
  });

  it('el login conserva su propio límite (IP+correo), distinto del general', async () => {
    const s = await iniciar({ rateLimits: { api: 100_000, apiUsuario: 100_000, login: 2, loginCuenta: 100 } });
    try {
      const intentos: number[] = [];
      for (let i = 0; i < 3; i++) intentos.push((await llamar(s.base, 'POST', '/api/auth/login', null, { email: 'admin.a@test.pe', password: 'incorrecta' })).status);
      assert.deepEqual(intentos, [401, 401, 429]);
    } finally {
      await s.cerrar();
    }
  });
});
