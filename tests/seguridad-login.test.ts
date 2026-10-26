import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { iniciar, llamar, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let reloj = Date.now();

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, loginCuenta: 10, ahora: () => reloj } }));
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

const ipN = (n: number) => ({ 'x-forwarded-for': `203.0.113.${n}` });
const intento = (email: string, password: string, n: number) => llamar(base, 'POST', '/api/auth/login', null, { email, password }, ipN(n));
const esperar = async <T>(f: () => Promise<T | null>): Promise<T> => {
  for (let i = 0; i < 40; i++) {
    const r = await f();
    if (r) return r;
    await new Promise((ok) => setTimeout(ok, 25));
  }
  throw new Error('no apareció a tiempo');
};

describe('bloqueo de login por cuenta (B-4)', () => {
  it('10 fallos desde IPs distintas bloquean la cuenta; el 11.º recibe el mismo 429 aunque la clave sea correcta', async () => {
    const correo = 'prop2@test.pe';
    for (let i = 0; i < 10; i++) assert.equal((await intento(correo, `mala-${i}`, i + 1)).status, 401, `intento ${i + 1}`);
    const bloqueado = await intento(correo, PASSWORD, 99);
    assert.equal(bloqueado.status, 429);
    assert.equal(bloqueado.body.error, 'Demasiados intentos de inicio de sesión, intenta de nuevo en 15 minutos');
    // otra cuenta no se ve afectada
    assert.equal((await intento('prop1@test.pe', PASSWORD, 99)).status, 200);
  });

  it('una cuenta inexistente se comporta igual: 401 ×10 y luego el mismo 429 (no revela si existe)', async () => {
    const correo = 'fantasma.cuenta@test.pe';
    for (let i = 0; i < 10; i++) assert.equal((await intento(correo, `mala-${i}`, i + 1)).status, 401);
    const bloqueado = await intento(correo, 'otra', 50);
    const real = await intento('prop2@test.pe', 'otra', 51); // bloqueada por el test anterior
    assert.equal(bloqueado.status, 429);
    assert.deepEqual(bloqueado.body, real.body);
  });

  it('pasados 15 min se desbloquea (reloj inyectado)', async () => {
    const correo = 'inq1@test.pe';
    for (let i = 0; i < 10; i++) await intento(correo, `mala-${i}`, i + 1);
    assert.equal((await intento(correo, PASSWORD, 60)).status, 429);
    reloj += 14 * 60_000;
    assert.equal((await intento(correo, PASSWORD, 61)).status, 429, 'a los 14 min sigue bloqueada');
    reloj += 2 * 60_000;
    assert.equal((await intento(correo, PASSWORD, 62)).status, 200, 'a los 16 min entra');
  });

  it('un login correcto limpia los fallos de esa cuenta (9 fallos + éxito + 9 fallos no bloquea)', async () => {
    const correo = 'mtto.a@test.pe';
    for (let i = 0; i < 9; i++) await intento(correo, `mala-${i}`, i + 1);
    assert.equal((await intento(correo, PASSWORD, 70)).status, 200);
    for (let i = 0; i < 9; i++) assert.equal((await intento(correo, `mala-${i}`, i + 20)).status, 401);
    assert.equal((await intento(correo, PASSWORD, 71)).status, 200);
  });

  it('los fallos viejos (>15 min) no cuentan', async () => {
    const correo = 'propb@test.pe';
    for (let i = 0; i < 9; i++) await intento(correo, `mala-${i}`, i + 1);
    reloj += 16 * 60_000;
    for (let i = 0; i < 9; i++) await intento(correo, `mala-${i}`, i + 30);
    assert.equal((await intento(correo, PASSWORD, 72)).status, 200);
  });
});

describe('login_fallido no guarda el correo tecleado (B-6)', () => {
  it('con una cuenta real guarda su id y ningún correo', async () => {
    await intento('mtto.a2@test.pe', 'mala', 80);
    const f = await esperar(() => prisma.auditoria.findFirst({ where: { accion: 'login_fallido', entidad_id: d.mantenimientoA2.id } }));
    assert.equal(f.usuario_id, f.entidad_id);
    assert.ok(!JSON.stringify(f).includes('mtto.a2'), 'el correo no está en la fila');
  });

  it('con un correo inexistente guarda sólo el correo enmascarado', async () => {
    await intento('maria.fantasma@dominio-raro.pe', 'mala', 81);
    const f = await esperar(() => prisma.auditoria.findFirst({ where: { accion: 'login_fallido', usuario_id: null }, orderBy: { id: 'desc' } }));
    assert.deepEqual(f.detalle, { email_enmascarado: 'm***@dominio-raro.pe' });
    assert.ok(!JSON.stringify(f).includes('maria.fantasma'));
  });
});
