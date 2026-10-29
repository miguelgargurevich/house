// scripts/migrar-juntas.ts: pasa lo que ya existe (cargos, correo del block, medios) a juntas vigentes. En seco por defecto, idempotente y sólo contra bases locales.
import './helpers/env';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { after, before, beforeEach, describe, it } from 'node:test';
import { prisma, sembrar, type Datos } from './helpers/app';
import { esBaseLocal, migrarJuntas } from '../scripts/migrar-juntas';

let d: Datos;
let e1: { id: number };
let e2: { id: number };
/** Un «hoy» fijo: 15 de octubre de 2026 (mediodía en Lima). */
const AHORA = new Date('2026-10-15T17:00:00Z');

before(async () => {
  d = await sembrar();
  e1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id, correo_vouchers: 'block1@ejemplo.test' } });
  e2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'Block', complejo_id: d.complejoA.id } });
  await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: e1.id } });
  await prisma.unidad.update({ where: { id: d.unidadA2.id }, data: { estructura_id: e2.id } });
});
after(async () => { await prisma.$disconnect(); });

async function limpiar() {
  await prisma.medioPago.deleteMany();
  await prisma.juntaDirectiva.deleteMany();
  await prisma.usuario.updateMany({ data: { cargo_junta: null, estructura_id: null } });
  await prisma.estructura.update({ where: { id: e1.id }, data: { correo_vouchers: 'block1@ejemplo.test' } });
}
const cargo = (id: number, cargo_junta: string, estructura_id: number | null) => prisma.usuario.update({ where: { id }, data: { cargo_junta, estructura_id } });
const medio = (estructura_id: number | null, extra: Record<string, unknown> = {}) =>
  prisma.medioPago.create({ data: { complejo_id: d.complejoA.id, estructura_id, tipo: 'yape', celular: '+51 987 654 321', titular: 'Junta', ...extra } });

describe('migrar-juntas', () => {
  beforeEach(limpiar);

  it('en seco informa lo que haría y NO escribe nada', async () => {
    await cargo(d.propietario1.id, 'presidente', e1.id);
    await medio(e1.id);
    const i = await migrarJuntas(prisma, { ahora: AHORA });
    assert.equal(i.creadas.length, 1);
    assert.equal(i.creadas[0]!.block, 'Block 1');
    assert.equal(i.creadas[0]!.correo, 'block1@ejemplo.test');
    assert.deepEqual(i.creadas[0]!.miembros.map((m) => m.cargo), ['presidente']);
    assert.equal(i.creadas[0]!.medios, 1);
    assert.equal(await prisma.juntaDirectiva.count(), 0);
    assert.equal(await prisma.miembroJunta.count(), 0);
    assert.equal((await prisma.medioPago.findFirstOrThrow()).junta_id, null);
  });

  it('al aplicar crea la junta vigente con sus miembros, el correo y los medios activos; y no cambia el usuario ni el correo del block', async () => {
    await cargo(d.propietario1.id, 'presidente', e1.id);
    const activo = await medio(e1.id);
    const inactivo = await medio(e1.id, { activo: false });
    const deOtroBlock = await medio(e2.id);
    const i = await migrarJuntas(prisma, { aplicar: true, ahora: AHORA });
    assert.deepEqual(i.creadas.map((j) => j.block).sort(), ['Block 1', 'Block 2']);
    const j = await prisma.juntaDirectiva.findFirstOrThrow({ where: { estructura_id: e1.id }, include: { miembros: true } });
    assert.equal(j.hasta, null);
    assert.equal(j.correo, 'block1@ejemplo.test');
    assert.deepEqual(j.miembros.map((m) => [m.usuario_id, m.cargo]), [[d.propietario1.id, 'presidente']]);
    assert.equal((await prisma.medioPago.findUniqueOrThrow({ where: { id: activo.id } })).junta_id, j.id);
    assert.equal((await prisma.medioPago.findUniqueOrThrow({ where: { id: inactivo.id } })).junta_id, null); // sólo los activos
    const otra = await prisma.juntaDirectiva.findFirstOrThrow({ where: { estructura_id: e2.id } });
    assert.equal((await prisma.medioPago.findUniqueOrThrow({ where: { id: deOtroBlock.id } })).junta_id, otra.id);
    // Nada del usuario ni del correo del block cambia
    const u = await prisma.usuario.findUniqueOrThrow({ where: { id: d.propietario1.id } });
    assert.deepEqual([u.cargo_junta, u.estructura_id], ['presidente', e1.id]);
    assert.equal((await prisma.estructura.findUniqueOrThrow({ where: { id: e1.id } })).correo_vouchers, 'block1@ejemplo.test');
  });

  it('es idempotente: una segunda corrida no cambia nada', async () => {
    await cargo(d.propietario1.id, 'tesorero', e1.id);
    await medio(e1.id);
    await migrarJuntas(prisma, { aplicar: true, ahora: AHORA });
    const antes = { juntas: await prisma.juntaDirectiva.count(), miembros: await prisma.miembroJunta.count() };
    const i = await migrarJuntas(prisma, { aplicar: true, ahora: AHORA });
    assert.equal(i.creadas.length, 0);
    assert.equal(i.ya_tenian, 1); // el block 1 (el 2 y el condominio no tienen nada que migrar)
    assert.deepEqual({ juntas: await prisma.juntaDirectiva.count(), miembros: await prisma.miembroJunta.count() }, antes);
  });

  it('desde = 1 de enero del año actual, o el día del medio más antiguo si es posterior', async () => {
    await cargo(d.propietario1.id, 'presidente', e1.id);
    await medio(e1.id, { created_at: new Date('2025-03-01T15:00:00Z') }); // anterior al 1 de enero: manda el 1 de enero
    await medio(e2.id, { created_at: new Date('2026-06-10T15:00:00Z') }); // posterior: manda el día del medio
    await migrarJuntas(prisma, { aplicar: true, ahora: AHORA });
    const desde = async (estructura_id: number) => (await prisma.juntaDirectiva.findFirstOrThrow({ where: { estructura_id } })).desde.toISOString().slice(0, 10);
    assert.equal(await desde(e1.id), '2026-01-01');
    assert.equal(await desde(e2.id), '2026-06-10');
  });

  it('la junta de todo el condominio sale de quien tiene cargo sin block y de los medios sin block', async () => {
    await cargo(d.propietario2.id, 'presidente', null);
    await medio(null);
    const i = await migrarJuntas(prisma, { aplicar: true, ahora: AHORA });
    const condo = i.creadas.find((j) => j.estructura_id == null);
    assert.ok(condo);
    assert.equal(condo.medios, 1);
    assert.equal(condo.miembros.length, 1);
  });

  it('un block con dos presidentes es ambiguo: NO se toca y se informa; un cargo de alguien que no es propietario se ignora', async () => {
    await cargo(d.propietario1.id, 'presidente', e1.id);
    await prisma.usuario.update({ where: { id: d.propietario2.id }, data: { cargo_junta: 'presidente', estructura_id: e1.id } });
    await prisma.usuario.update({ where: { id: d.inquilino1.id }, data: { cargo_junta: 'vocal', estructura_id: e2.id } });
    const i = await migrarJuntas(prisma, { aplicar: true, ahora: AHORA });
    assert.deepEqual(i.ambiguos.map((a) => [a.estructura_id, a.motivo]), [[e1.id, 'más de un presidente']]);
    assert.equal(await prisma.juntaDirectiva.count({ where: { estructura_id: e1.id } }), 0);
    assert.deepEqual(i.ignorados.map((x) => x.usuario_id), [d.inquilino1.id]);
    assert.equal(await prisma.miembroJunta.count({ where: { usuario_id: d.inquilino1.id } }), 0);
  });

  it('un miembro sin unidad en su ámbito pasa igual (conserva sus permisos) pero se informa', async () => {
    await cargo(d.propietario1.id, 'vocal', e2.id); // vive en el block 1, tiene cargo en el 2
    const i = await migrarJuntas(prisma, { aplicar: true, ahora: AHORA });
    assert.deepEqual(i.sin_unidad.map((x) => [x.usuario_id, x.estructura_id]), [[d.propietario1.id, e2.id]]);
    assert.equal(await prisma.miembroJunta.count({ where: { usuario_id: d.propietario1.id } }), 1);
  });
});

describe('migrar-juntas: seguridad de la base', () => {
  it('sólo localhost / 127.0.0.1 cuentan como base local', () => {
    assert.equal(esBaseLocal('postgresql://postgres:house@localhost:5433/house'), true);
    assert.equal(esBaseLocal('postgresql://postgres:house@127.0.0.1:5433/house'), true);
    assert.equal(esBaseLocal('postgresql://u:p@db.produccion.example.com:5432/house'), false);
    assert.equal(esBaseLocal('postgresql://u:p@localhost.evil.com:5432/house'), false);
    assert.equal(esBaseLocal(undefined), false);
    assert.equal(esBaseLocal('no es una url'), false);
  });

  it('el comando se niega con una base no local (código 1, sin tocar nada) y exige --produccion', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrar-juntas.ts', '--aplicar'], {
      env: { ...process.env, DATABASE_URL: 'postgresql://u:p@db.produccion.example.com:5432/house' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /no es local/);
    assert.match(r.stderr, /--produccion/);
  });
});
