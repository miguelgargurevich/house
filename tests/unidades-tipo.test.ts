// Tipo de unidad: el servidor guarda la clave en minúscula y sin tilde, y rechaza lo que no está en la lista.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let adminA: string;

const crear = (tipo: unknown, codigo: string) =>
  llamar(base, 'POST', '/api/unidades', adminA, { codigo, tipo, complejo_id: d.complejoA.id });
const tipoEnBase = async (id: number) => (await prisma.unidad.findUniqueOrThrow({ where: { id } })).tipo;

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  adminA = await login(base, 'admin.a@test.pe');
});

after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('tipo de unidad: se guarda en minúscula y sin tilde', () => {
  it('crear con «Departamento» (la etiqueta) guarda departamento', async () => {
    const r = await crear('Departamento', 'TIPO-1');
    assert.equal(r.status, 201, r.texto);
    assert.equal(await tipoEnBase(r.body.id), 'departamento');
  });

  it('crear con «Depósito» guarda deposito (sin tilde)', async () => {
    const r = await crear('Depósito', 'TIPO-2');
    assert.equal(r.status, 201, r.texto);
    assert.equal(await tipoEnBase(r.body.id), 'deposito');
  });

  it('crear con mayúsculas y espacios («  CASA ») guarda casa', async () => {
    const r = await crear('  CASA ', 'TIPO-3');
    assert.equal(r.status, 201, r.texto);
    assert.equal(await tipoEnBase(r.body.id), 'casa');
  });

  it('editar a «Estacionamiento» guarda estacionamiento', async () => {
    const r = await crear('local', 'TIPO-4');
    const ed = await llamar(base, 'PUT', `/api/unidades/${r.body.id}`, adminA, { tipo: 'Estacionamiento' });
    assert.equal(ed.status, 200, ed.texto);
    assert.equal(await tipoEnBase(r.body.id), 'estacionamiento');
  });
});

describe('tipo de unidad: lo que no está en la lista se rechaza', () => {
  it('crear con «Oficina» responde 422 con el mensaje en español y no guarda nada', async () => {
    const antes = await prisma.unidad.count();
    const r = await crear('Oficina', 'TIPO-5');
    assert.equal(r.status, 422, r.texto);
    assert.match(r.body.campos.tipo, /Tipo inválido/);
    assert.equal(await prisma.unidad.count(), antes);
  });

  it('editar a un tipo fuera de la lista responde 422 y deja el tipo anterior', async () => {
    const r = await crear('casa', 'TIPO-6');
    const ed = await llamar(base, 'PUT', `/api/unidades/${r.body.id}`, adminA, { tipo: 'Bodega' });
    assert.equal(ed.status, 422, ed.texto);
    assert.ok(ed.body.campos.tipo);
    assert.equal(await tipoEnBase(r.body.id), 'casa');
  });
});
