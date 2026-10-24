import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { limpiarEmpresaResidentes } from '../scripts/limpiar-empresa-residentes';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB', string>;

const crear = (token: string, extra: Record<string, unknown>) =>
  llamar(base, 'POST', '/api/usuarios', token, { nombre: 'Persona', email: `p${Math.random().toString(36).slice(2)}@test.pe`, password: 'ClaveSegura123', ...extra });
const enBd = (id: number) => prisma.usuario.findUniqueOrThrow({ where: { id } });

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe') };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('empresa: sólo para el personal', () => {
  it('un residente se guarda SIN empresa aunque se mande una (la propia, otra o ninguna); el personal queda con la del admin', async () => {
    for (const rol of ['propietario', 'inquilino']) {
      for (const empresa_id of [undefined, d.empresaA.id, d.empresaB.id]) {
        const r = await crear(T.adminA, { rol, complejo_id: d.complejoA.id, empresa_id });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.equal((await enBd(r.body.id)).empresa_id, null, `${rol} con empresa_id=${empresa_id}`);
        assert.equal(r.body.empresa_id, null);
      }
    }
    for (const rol of ['admin', 'mantenimiento', 'seguridad']) {
      const r = await crear(T.adminA, { rol, empresa_id: d.empresaB.id }); // el admin no elige empresa: es la suya
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal((await enBd(r.body.id)).empresa_id, d.empresaA.id, rol);
    }
  });

  it('el superadmin también: residente sin empresa; personal con la que elige', async () => {
    const res = await crear(T.super, { rol: 'inquilino', empresa_id: d.empresaB.id });
    assert.equal(res.status, 201);
    assert.equal((await enBd(res.body.id)).empresa_id, null);
    const per = await crear(T.super, { rol: 'seguridad', empresa_id: d.empresaB.id });
    assert.equal((await enBd(per.body.id)).empresa_id, d.empresaB.id);
    assert.equal((await crear(T.super, { rol: 'admin' })).status, 422, 'un administrador exige empresa');
  });

  it('al cambiar el rol a residente la empresa se limpia; de residente a personal toma la del admin', async () => {
    const p = await crear(T.adminA, { rol: 'seguridad' });
    assert.equal((await enBd(p.body.id)).empresa_id, d.empresaA.id);
    const aRes = await llamar(base, 'PUT', `/api/usuarios/${p.body.id}`, T.adminA, { rol: 'propietario', complejo_id: d.complejoA.id });
    assert.equal(aRes.status, 200, JSON.stringify(aRes.body));
    assert.equal((await enBd(p.body.id)).empresa_id, null);
    assert.equal((await llamar(base, 'PUT', `/api/usuarios/${p.body.id}`, T.adminA, { nombre: 'Sólo nombre', empresa_id: d.empresaA.id })).status, 200);
    assert.equal((await enBd(p.body.id)).empresa_id, null, 'editar a un residente no le devuelve la empresa');
    assert.equal((await llamar(base, 'PUT', `/api/usuarios/${p.body.id}`, T.adminA, { rol: 'mantenimiento' })).status, 200);
    assert.equal((await enBd(p.body.id)).empresa_id, d.empresaA.id);
  });

  it('un admin de la empresa A no puede asignar un residente a la empresa B (ni a un condominio de B)', async () => {
    const r = await crear(T.adminA, { rol: 'propietario', complejo_id: d.complejoA.id, empresa_id: d.empresaB.id });
    assert.equal((await enBd(r.body.id)).empresa_id, null, 'la empresa pedida se ignora: no queda en B');
    assert.equal((await crear(T.adminA, { rol: 'propietario', complejo_id: d.complejoB.id })).status, 422, 'condominio de otra empresa');
    assert.equal((await llamar(base, 'PUT', `/api/usuarios/${r.body.id}`, T.adminA, { complejo_id: d.complejoB.id })).status, 422);
    assert.equal((await llamar(base, 'PUT', `/api/usuarios/${d.propietarioB.id}`, T.adminA, { nombre: 'Robado' })).status, 404, 'un residente de B no se edita desde A');
    assert.equal((await crear(T.adminA, { rol: 'propietario' })).status, 422, 'sin condominio el residente sería inalcanzable');
  });

  it('el admin sigue viendo a sus residentes por sus unidades (con empresa_id null) y NO a los de otra empresa', async () => {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const residente = (email: string, extra: Record<string, unknown> = {}) => prisma.usuario.create({ data: { nombre: email, email, rol: 'propietario', password_hash: hash, empresa_id: null, complejo_id: null, ...extra } });
    const dueñoA = await residente('dueno.a@test.pe');
    const inquilinoA = await residente('inq.a@test.pe', { rol: 'inquilino' });
    const dueñoB = await residente('dueno.b@test.pe');
    const sinUnidades = await residente('sin.unidades@test.pe');
    await prisma.unidad.create({ data: { codigo: 'A-201', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, propietario_id: dueñoA.id, inquilino_id: inquilinoA.id, estado: 'activa' } });
    // unidad cuyo `empresa_id` es null pero cuyo condominio es de A: también cuenta
    const huerfana = await residente('dueno.huerfana@test.pe');
    await prisma.unidad.create({ data: { codigo: 'A-202', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: null, propietario_id: huerfana.id, estado: 'activa' } });
    await prisma.unidad.create({ data: { codigo: 'B-201', tipo: 'Departamento', complejo_id: d.complejoB.id, empresa_id: d.empresaB.id, propietario_id: dueñoB.id, estado: 'activa' } });

    const idsDe = async (token: string) => (await llamar(base, 'GET', '/api/usuarios?pageSize=100', token)).body.items.map((x: { id: number }) => x.id) as number[];
    const a = await idsDe(T.adminA);
    for (const u of [dueñoA, inquilinoA, huerfana]) assert.ok(a.includes(u.id), u.email);
    for (const u of [dueñoB, sinUnidades]) assert.ok(!a.includes(u.id), `A no debe ver a ${u.email}`);
    const b = await idsDe(T.adminB);
    assert.ok(b.includes(dueñoB.id));
    for (const u of [dueñoA, inquilinoA, huerfana, sinUnidades]) assert.ok(!b.includes(u.id), `B no debe ver a ${u.email}`);
    assert.equal((await llamar(base, 'GET', `/api/usuarios/${dueñoA.id}`, T.adminA)).status, 200);
    assert.equal((await llamar(base, 'GET', `/api/usuarios/${dueñoA.id}`, T.adminB)).status, 404);
    assert.equal((await llamar(base, 'PUT', `/api/usuarios/${dueñoB.id}`, T.adminA, { nombre: 'x' })).status, 404);
    assert.equal((await llamar(base, 'DELETE', `/api/usuarios/${dueñoB.id}`, T.adminA)).status, 404);
    assert.ok((await idsDe(T.super)).includes(sinUnidades.id));
  });

  it('en la lista, la empresa de un residente sale de sus unidades (puede ser más de una; ninguna si no tiene)', async () => {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const doble = await prisma.usuario.create({ data: { nombre: 'Doble', email: 'doble@test.pe', rol: 'propietario', password_hash: hash } });
    const ninguna = await prisma.usuario.create({ data: { nombre: 'Ninguna', email: 'ninguna@test.pe', rol: 'propietario', password_hash: hash, complejo_id: d.complejoA.id } });
    await prisma.unidad.create({ data: { codigo: 'A-301', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, propietario_id: doble.id, estado: 'activa' } });
    await prisma.unidad.create({ data: { codigo: 'B-301', tipo: 'Departamento', complejo_id: d.complejoB.id, empresa_id: d.empresaB.id, propietario_id: doble.id, estado: 'activa' } });
    const lista = (await llamar(base, 'GET', '/api/usuarios?pageSize=100', T.super)).body.items as { id: number; empresa: unknown; empresas_administradoras: { nombre: string }[] }[];
    const fila = (id: number) => lista.find((x) => x.id === id)!;
    assert.deepEqual(fila(doble.id).empresas_administradoras.map((e) => e.nombre).sort(), ['Empresa A', 'Empresa B']);
    assert.equal(fila(doble.id).empresa, null);
    assert.deepEqual(fila(ninguna.id).empresas_administradoras, []);
    assert.deepEqual(fila(d.adminA.id).empresas_administradoras, [], 'el personal no tiene lista derivada: usa su empresa');
    assert.equal((fila(d.adminA.id).empresa as { nombre: string }).nombre, 'Empresa A');
    // el admin A sólo ve su empresa en un residente compartido, porque sólo ve las unidades... (todas las suyas y las ajenas figuran en la fila)
    const deA = (await llamar(base, 'GET', '/api/usuarios?pageSize=100', T.adminA)).body.items as typeof lista;
    assert.ok(deA.some((x) => x.id === doble.id));
  });
});

describe('script limpiar-empresa-residentes', () => {
  it('pone empresa_id = null sólo a propietarios e inquilinos, cuenta, y es idempotente', async () => {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const mk = (rol: string, n: string) => prisma.usuario.create({ data: { nombre: n, email: `${n}@limpia.pe`, rol, password_hash: hash, empresa_id: d.empresaA.id } });
    const p = await mk('propietario', 'p1');
    const i = await mk('inquilino', 'i1');
    const a = await mk('admin', 'a1');
    const s = await mk('seguridad', 's1');
    const antes = await prisma.usuario.count({ where: { rol: { in: ['propietario', 'inquilino'] }, empresa_id: { not: null } } });
    assert.ok(antes >= 2);
    assert.equal(await limpiarEmpresaResidentes(prisma, true), antes, 'simular cuenta y no cambia');
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: p.id } })).empresa_id, d.empresaA.id);
    assert.equal(await limpiarEmpresaResidentes(prisma), antes);
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: p.id } })).empresa_id, null);
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: i.id } })).empresa_id, null);
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: a.id } })).empresa_id, d.empresaA.id, 'el personal no se toca');
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: s.id } })).empresa_id, d.empresaA.id);
    assert.equal(await limpiarEmpresaResidentes(prisma), 0, 'segunda corrida: nada que cambiar');
  });
});

describe('condominios: conteo de unidades y de blocks', () => {
  it('la lista trae unidades_count y blocks_count por condominio', async () => {
    const c = await prisma.complejoHabitacional.create({ data: { nombre: 'Con blocks', tipo: 'condominio', empresa_id: d.empresaA.id } });
    const b1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'block', complejo_id: c.id } });
    await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'block', complejo_id: c.id } });
    for (const n of [1, 2, 3]) await prisma.unidad.create({ data: { codigo: `C-${n}`, tipo: 'departamento', complejo_id: c.id, empresa_id: d.empresaA.id, estructura_id: b1.id, estado: 'activa' } });
    const r = await llamar(base, 'GET', '/api/complejos?pageSize=100', T.adminA);
    const fila = (nombre: string) => r.body.items.find((x: { nombre: string }) => x.nombre === nombre);
    assert.equal(fila('Con blocks').unidades_count, 3);
    assert.equal(fila('Con blocks').blocks_count, 2);
    assert.equal(fila('Complejo A').unidades_count, await prisma.unidad.count({ where: { complejo_id: d.complejoA.id } }));
    assert.equal(fila('Complejo A').blocks_count, 0);
    assert.equal(r.body.items.length, 2, 'sólo los de su empresa');
    const uno = await llamar(base, 'GET', `/api/complejos/${c.id}`, T.adminA);
    assert.equal(uno.body.unidades_count, 3);
  });
});
