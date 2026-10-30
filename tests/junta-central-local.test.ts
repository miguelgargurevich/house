// Junta central de prueba (`scripts/junta-central-local.ts`): sólo la base local «house», una junta central vigente con presidente y tesorero,
// idempotente, sin pisar a quien ya es miembro de otra junta ni de una junta central con otros miembros.
import './helpers/env';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { motivoSinBaseLocal, prepararJuntaCentral, COMPLEJO, PRESIDENTE, TESORERO, CLAVE_SEED } from '../scripts/junta-central-local';
import { PASSWORD, prisma, sembrar, type Datos } from './helpers/app';

let d: Datos;
let hash: string;

/** Condominio con el nombre del seed y dos propietarios de prueba: el presidente y el tesorero central. */
async function prepararCondominio(claveTesorero = PASSWORD) {
  await prisma.miembroJunta.deleteMany();
  await prisma.juntaDirectiva.deleteMany();
  await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { nombre: COMPLEJO } });
  const clave = await bcrypt.hash(claveTesorero, 4);
  for (const [email, nombre, codigo, password_hash] of [[PRESIDENTE, 'Teresa Neyra', 'C-101', hash], [TESORERO, 'Gustavo Cruz', 'C-102', clave]] as const) {
    const u = await prisma.usuario.create({ data: { nombre, email, telefono: '+51 987 654 321', rol: 'propietario', password_hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id } });
    await prisma.unidad.create({ data: { codigo, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, propietario_id: u.id, estado: 'activa' } });
  }
}

const centrales = () => prisma.juntaDirectiva.findMany({ where: { complejo_id: d.complejoA.id, estructura_id: null }, include: { miembros: true } });

before(async () => {
  hash = await bcrypt.hash(PASSWORD, 4);
});

beforeEach(async () => {
  d = await sembrar();
});

describe('junta central de prueba: sólo la base local «house»', () => {
  it('rechaza cualquier base que no sea «house» en localhost, sin ni siquiera intentar conectarse', () => {
    assert.match(motivoSinBaseLocal(undefined) ?? '', /no está definida/);
    assert.match(motivoSinBaseLocal('no-es-una-url') ?? '', /no es una URL válida/);
    assert.match(motivoSinBaseLocal('postgresql://postgres:house@localhost:5433/house_test_junta_central') ?? '', /Sólo corre contra la base local «house»/);
    assert.match(motivoSinBaseLocal('postgresql://postgres:house@servidor.example:5432/house') ?? '', /Sólo corre contra la base local/);
    assert.equal(motivoSinBaseLocal('postgresql://postgres:house@localhost:5433/house'), null);
    assert.equal(motivoSinBaseLocal('postgresql://postgres:house@127.0.0.1:5433/house'), null);
  });

  it('el script, ejecutado contra una base que no es «house», aborta con código 1 antes de tocar nada', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/junta-central-local.ts'], {
      env: { ...process.env, DATABASE_URL: 'postgresql://postgres:house@localhost:5433/house_test_junta_central' },
      encoding: 'utf8',
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Sólo corre contra la base local «house»/);
  });
});

describe('prepararJuntaCentral', () => {
  it('crea la junta central vigente con presidente y tesorero, y sincroniza sus cargos', async () => {
    await prepararCondominio(CLAVE_SEED);
    const r = await prepararJuntaCentral(prisma);

    assert.equal(r.creada, true);
    assert.equal(r.claveDelSeed, true, 'el tesorero central tiene la contraseña del seed');
    const [j] = await centrales();
    assert.ok(j);
    assert.equal(j.id, r.junta_id);
    assert.equal(j.estructura_id, null);
    assert.equal(j.hasta, null);
    assert.deepEqual(j.miembros.map((m) => m.cargo).sort(), ['presidente', 'tesorero']);

    const tesorero = await prisma.usuario.findUniqueOrThrow({ where: { email: TESORERO } });
    assert.equal(tesorero.cargo_junta, 'tesorero');
    assert.equal(tesorero.estructura_id, null);
    assert.equal(tesorero.complejo_id, d.complejoA.id);
    assert.deepEqual(r.miembros.map((m) => m.email), [PRESIDENTE, TESORERO]);
  });

  it('correrlo dos veces no duplica nada', async () => {
    await prepararCondominio();
    const primera = await prepararJuntaCentral(prisma);
    const segunda = await prepararJuntaCentral(prisma);

    assert.equal(segunda.creada, false);
    assert.equal(segunda.junta_id, primera.junta_id);
    assert.deepEqual(segunda.cambiados, []);
    assert.equal((await centrales()).length, 1);
    assert.equal(await prisma.miembroJunta.count({ where: { junta_id: primera.junta_id } }), 2);
  });

  it('no cambia la contraseña del tesorero: si no es la del seed, sólo lo informa', async () => {
    await prepararCondominio('otra-clave-1');
    const r = await prepararJuntaCentral(prisma);
    assert.equal(r.claveDelSeed, false);
    const cuenta = await prisma.usuario.findUniqueOrThrow({ where: { email: TESORERO }, omit: { password_hash: false } });
    assert.ok(cuenta.password_hash);
    assert.equal(await bcrypt.compare('otra-clave-1', cuenta.password_hash), true);
  });

  it('completa una junta central vigente que está vacía, sin crear otra', async () => {
    await prepararCondominio();
    const vacia = await prisma.juntaDirectiva.create({ data: { complejo_id: d.complejoA.id, estructura_id: null, desde: new Date(Date.UTC(2026, 9, 29)) } });
    const r = await prepararJuntaCentral(prisma);
    assert.equal(r.creada, false);
    assert.equal(r.junta_id, vacia.id);
    assert.equal((await centrales()).length, 1);
    assert.equal(await prisma.miembroJunta.count({ where: { junta_id: vacia.id } }), 2);
  });

  it('no pisa una junta central vigente que ya tiene otros miembros', async () => {
    await prepararCondominio();
    await prisma.juntaDirectiva.create({
      data: { complejo_id: d.complejoA.id, estructura_id: null, desde: new Date(Date.UTC(2026, 9, 29)), miembros: { create: [{ usuario_id: d.propietario2.id, cargo: 'presidente' }] } },
    });
    await assert.rejects(prepararJuntaCentral(prisma), /ya tiene miembros distintos/);
    assert.equal((await centrales()).length, 1);
    assert.equal(await prisma.miembroJunta.count({ where: { usuario: { email: TESORERO } } }), 0);
  });

  it('no mete al tesorero si ya es miembro de la junta vigente de un block', async () => {
    await prepararCondominio();
    const block = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
    const tesorero = await prisma.usuario.findUniqueOrThrow({ where: { email: TESORERO } });
    await prisma.juntaDirectiva.create({
      data: { complejo_id: d.complejoA.id, estructura_id: block.id, desde: new Date(Date.UTC(2026, 0, 1)), miembros: { create: [{ usuario_id: tesorero.id, cargo: 'tesorero' }] } },
    });
    await assert.rejects(prepararJuntaCentral(prisma), /ya es miembro de la junta vigente de Block 1/);
    assert.equal((await centrales()).length, 0, 'no se crea la junta central');
  });

  it('avisa si el condominio del seed no existe en la base', async () => {
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { nombre: 'Otro nombre' } });
    await assert.rejects(prepararJuntaCentral(prisma), /No existe «Condominio Los Libertadores de Surco»/);
  });
});
