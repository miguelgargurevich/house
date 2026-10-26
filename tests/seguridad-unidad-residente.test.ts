import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let adminA: string;
let unidadLibreA: number;
let unidadDeB: number;

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  adminA = await login(base, 'admin.a@test.pe');
  // Un mismo propietario con un departamento en A (administra A) y otro en B (administra B): lo alcanza A por su unidad.
  unidadDeB = (await prisma.unidad.create({ data: { codigo: 'B-201', tipo: 'Departamento', complejo_id: d.complejoB.id, empresa_id: d.empresaB.id, propietario_id: d.propietario1.id, estado: 'activa' } })).id;
  unidadLibreA = (await prisma.unidad.create({ data: { codigo: 'A-103', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estado: 'activa' } })).id;
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

const duenoDe = async (id: number) => (await prisma.unidad.findUniqueOrThrow({ where: { id } })).propietario_id;

describe('mover el departamento de un residente no toca las unidades de otra administradora', () => {
  it('PUT /api/usuarios/:id con unidad_id suelta sólo SUS unidades de A; la de B conserva a su propietario', async () => {
    const r = await llamar(base, 'PUT', `/api/usuarios/${d.propietario1.id}`, adminA, { unidad_id: unidadLibreA });
    assert.equal(r.status, 200, r.texto);
    assert.equal(await duenoDe(unidadLibreA), d.propietario1.id, 'toma el departamento nuevo de A');
    assert.equal(await duenoDe(d.unidadA1.id), null, 'suelta el departamento anterior de A (comportamiento de siempre)');
    assert.equal(await duenoDe(unidadDeB), d.propietario1.id, 'la unidad de la empresa B NO se toca desde A');
  });

  it('cambiar el rol de propietario a inquilino desde A tampoco reasigna la unidad de B', async () => {
    const r = await llamar(base, 'PUT', `/api/usuarios/${d.propietario1.id}`, adminA, { rol: 'inquilino' });
    assert.equal(r.status, 200, r.texto);
    const deB = await prisma.unidad.findUniqueOrThrow({ where: { id: unidadDeB } });
    assert.equal(deB.propietario_id, d.propietario1.id, 'sigue siendo el propietario de la unidad de B');
    assert.equal(deB.inquilino_id, null);
  });
});
