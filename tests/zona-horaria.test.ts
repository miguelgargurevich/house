// Zona horaria por condominio (fase 4): el «hoy» de cada condominio es el de SU zona, no el de Lima.
// Datos: Complejo A (empresa A) y Complejo B (empresa B) de `sembrar()`. Cada bloque deja las zonas como las encontró.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1', string>;

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    super: await login(base, 'super@test.pe'),
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    prop1: await login(base, 'prop1@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('condominios: zona horaria', () => {
  beforeEach(async () => {
    await prisma.complejoHabitacional.deleteMany({ where: { nombre: { startsWith: 'Nuevo ' } } });
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { pais: 'PE' } });
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { zona_horaria: 'America/Lima' } });
  });

  it('los condominios que ya existen y los nuevos sin país nacen en America/Lima', async () => {
    const c = await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: d.complejoB.id } });
    assert.equal(c.zona_horaria, 'America/Lima');
    const r = await llamar(base, 'POST', '/api/complejos', T.adminA, { nombre: 'Nuevo Lima', tipo: 'Edificio' });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.zona_horaria, 'America/Lima');
  });

  it('sin zona, nace con la de su país (y con la del país de su empresa si no se dice país)', async () => {
    const mx = await llamar(base, 'POST', '/api/complejos', T.adminA, { nombre: 'Nuevo Mexico', tipo: 'Edificio', pais: 'MX' });
    assert.deepEqual([mx.body.pais, mx.body.moneda, mx.body.zona_horaria], ['MX', 'MXN', 'America/Mexico_City']);
    const es = await llamar(base, 'POST', '/api/complejos', T.adminA, { nombre: 'Nuevo Madrid', tipo: 'Edificio', pais: 'ES' });
    assert.equal(es.body.zona_horaria, 'Europe/Madrid');
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { pais: 'CL' } });
    const cl = await llamar(base, 'POST', '/api/complejos', T.adminA, { nombre: 'Nuevo Santiago', tipo: 'Edificio' });
    assert.deepEqual([cl.body.pais, cl.body.zona_horaria], ['CL', 'America/Santiago']);
  });

  it('con zona explícita manda sobre la del país (Cancún, en un condominio de México)', async () => {
    const r = await llamar(base, 'POST', '/api/complejos', T.adminA, { nombre: 'Nuevo Cancun', tipo: 'Edificio', pais: 'MX', zona_horaria: 'America/Cancun' });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.zona_horaria, 'America/Cancun');
  });

  it('una zona que Intl no conoce, un desfase suelto o un texto raro → 422 con el campo; no se guarda', async () => {
    for (const zona of ['America/Limaa', '+05:00', 'Lima', '', 'GMT+5', 'x'.repeat(80)]) {
      const r = await llamar(base, 'POST', '/api/complejos', T.adminA, { nombre: 'Nuevo Malo', tipo: 'Edificio', zona_horaria: zona });
      assert.equal(r.status, 422, `${JSON.stringify(zona)}: ${r.texto}`);
      assert.ok(r.body.campos?.zona_horaria, JSON.stringify(r.body));
    }
    const e = await llamar(base, 'PUT', `/api/complejos/${d.complejoA.id}`, T.adminA, { zona_horaria: 'Mars/Olympus' });
    assert.equal(e.status, 422, e.texto);
    assert.equal((await prisma.complejoHabitacional.count({ where: { nombre: 'Nuevo Malo' } })), 0);
    assert.equal((await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: d.complejoA.id } })).zona_horaria, 'America/Lima');
  });

  it('se edita en la ficha (aun con recibos emitidos: sólo mueve el día en que algo vence); otro tenant → 404', async () => {
    const ok = await llamar(base, 'PUT', `/api/complejos/${d.complejoA.id}`, T.adminA, { zona_horaria: 'America/Santiago' });
    assert.equal(ok.status, 200, ok.texto);
    assert.equal(ok.body.zona_horaria, 'America/Santiago');
    const lee = await llamar(base, 'GET', `/api/complejos/${d.complejoA.id}`, T.adminA);
    assert.equal(lee.body.zona_horaria, 'America/Santiago');
    const ajeno = await llamar(base, 'PUT', `/api/complejos/${d.complejoA.id}`, T.adminB, { zona_horaria: 'America/Lima' });
    assert.equal(ajeno.status, 404);
    assert.equal((await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: d.complejoA.id } })).zona_horaria, 'America/Santiago');
  });

  it('un residente no edita la zona (403)', async () => {
    const r = await llamar(base, 'PUT', `/api/complejos/${d.complejoA.id}`, T.prop1, { zona_horaria: 'Europe/Madrid' });
    assert.ok([403, 404].includes(r.status), r.texto);
    assert.equal((await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: d.complejoA.id } })).zona_horaria, 'America/Lima');
  });
});
