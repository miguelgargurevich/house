import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1' | 'inq1' | 'mttoA' | 'segA', string>;

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    super: await login(base, 'super@test.pe'),
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    prop1: await login(base, 'prop1@test.pe'),
    inq1: await login(base, 'inq1@test.pe'),
    mttoA: await login(base, 'mtto.a@test.pe'),
    segA: await login(base, 'seg.a@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

const RECURSOS = ['usuarios', 'empresas', 'complejos', 'pisos', 'estructuras', 'unidades', 'conceptos', 'recibos', 'pagos', 'recibo-conceptos', 'recibo-concepto-unidades', 'tareas', 'auditoria'];

describe('password_hash nunca sale', () => {
  it('ninguna respuesta GET del superadmin contiene password_hash ni un hash bcrypt (incluye relaciones)', async () => {
    const rutas = [...RECURSOS.map((r) => `/api/${r}?pageSize=100`), `/api/usuarios/${d.propietario1.id}`, `/api/unidades/${d.unidadA1.id}`, `/api/auth/me`, `/api/tareas/${d.tareaA.id}`, `/api/dashboard/resumen`, `/api/reportes/morosidad`];
    for (const ruta of rutas) {
      const r = await llamar(base, 'GET', ruta, T.super);
      assert.equal(r.status, 200, ruta);
      assert.ok(!/password_hash|\$2[aby]\$/.test(r.texto), `${ruta} filtra el hash`);
    }
  });

  it('tampoco en las respuestas de crear y editar usuarios, ni siquiera si el cliente envía password_hash', async () => {
    const c = await llamar(base, 'POST', '/api/usuarios', T.adminA, { nombre: 'Nuevo', email: 'nuevo@test.pe', rol: 'inquilino', password: 'ClaveSegura123', password_hash: 'inyectado', complejo_id: d.complejoA.id });
    assert.equal(c.status, 201);
    assert.ok(!/password_hash|\$2[aby]\$/.test(c.texto));
    const guardado = await prisma.usuario.findUnique({ where: { id: c.body.id }, omit: { password_hash: false } });
    assert.match(guardado!.password_hash!, /^\$2[aby]\$12\$/, 'bcrypt con cost 12');
    assert.notEqual(guardado!.password_hash, 'inyectado');
    const e = await llamar(base, 'PUT', `/api/usuarios/${c.body.id}`, T.adminA, { nombre: 'Nuevo Editado', password: 'OtraClave12345' });
    assert.equal(e.status, 200);
    assert.equal(e.body.nombre, 'Nuevo Editado');
    assert.ok(!/password_hash|\$2[aby]\$/.test(e.texto));
  });
});

describe('aislamiento entre empresas', () => {
  it('el admin A no ve ni edita ni borra datos de la empresa B (siempre 404)', async () => {
    const ajenos: [string, number][] = [
      ['usuarios', d.adminB.id], ['usuarios', d.propietarioB.id], ['empresas', d.empresaB.id], ['complejos', d.complejoB.id], ['unidades', d.unidadB1.id],
      ['conceptos', d.conceptoB.id], ['recibos', d.reciboB.id], ['recibo-concepto-unidades', d.cargoB1.id], ['tareas', d.tareaB.id],
    ];
    for (const [recurso, id] of ajenos) {
      assert.equal((await llamar(base, 'GET', `/api/${recurso}/${id}`, T.adminA)).status, 404, `GET ${recurso}/${id}`);
      assert.equal((await llamar(base, 'PUT', `/api/${recurso}/${id}`, T.adminA, {})).status, 404, `PUT ${recurso}/${id}`);
      // borrar empresas es del superadmin: el admin recibe 403 por permiso, no por tenant
      assert.equal((await llamar(base, 'DELETE', `/api/${recurso}/${id}`, T.adminA)).status, recurso === 'empresas' ? 403 : 404, `DELETE ${recurso}/${id}`);
    }
    assert.ok(await prisma.unidad.findUnique({ where: { id: d.unidadB1.id } }), 'la unidad de B sigue existiendo');
  });

  it('las listas del admin A sólo contienen filas de A', async () => {
    const u = await llamar(base, 'GET', '/api/unidades?pageSize=100', T.adminA);
    assert.deepEqual(u.body.items.map((x: { codigo: string }) => x.codigo).sort(), ['A-101', 'A-102']);
    const us = await llamar(base, 'GET', '/api/usuarios?pageSize=100', T.adminA);
    assert.ok(us.body.items.every((x: { rol: string; empresa_id: number | null }) => x.rol !== 'superadmin' && (x.empresa_id === d.empresaA.id || (['propietario', 'inquilino'].includes(x.rol) && x.empresa_id === null))), 'el personal es de la empresa; un residente puede no tener empresa propia');
    assert.ok(!us.body.items.some((x: { id: number }) => x.id === d.adminB.id));
    const e = await llamar(base, 'GET', '/api/empresas', T.adminA);
    assert.deepEqual(e.body.items.map((x: { id: number }) => x.id), [d.empresaA.id]);
    const r = await llamar(base, 'GET', '/api/recibos?pageSize=100', T.adminA);
    assert.ok(r.body.items.every((x: { empresa_id: number }) => x.empresa_id === d.empresaA.id));
    const todas = await llamar(base, 'GET', '/api/unidades?pageSize=100', T.super);
    assert.equal(todas.body.total, 3);
  });

  it('filtrar ?empresa_id= de otra empresa no filtra datos para un admin (sí para superadmin)', async () => {
    const admin = await llamar(base, 'GET', `/api/usuarios?empresa_id=${d.empresaB.id}`, T.adminA);
    assert.equal(admin.body.total, 0);
    const sup = await llamar(base, 'GET', `/api/usuarios?empresa_id=${d.empresaB.id}`, T.super);
    assert.ok(sup.body.total >= 2);
  });

  it('el admin no puede referenciar recursos de otra empresa al crear (422) y la empresa se fuerza a la suya', async () => {
    const u = await llamar(base, 'POST', '/api/unidades', T.adminA, { codigo: 'X-1', tipo: 'Departamento', complejo_id: d.complejoB.id });
    assert.equal(u.status, 422);
    const t = await llamar(base, 'POST', '/api/tareas', T.adminA, { titulo: 'Tarea cruzada', unidad_id: d.unidadB1.id });
    assert.equal(t.status, 422);
    const c = await llamar(base, 'POST', '/api/conceptos', T.adminA, { nombre: 'Concepto', empresa_id: d.empresaB.id });
    assert.equal(c.status, 201);
    assert.equal(c.body.empresa_id, d.empresaA.id);
    const us = await llamar(base, 'POST', '/api/usuarios', T.adminA, { nombre: 'Colado', email: 'colado@test.pe', rol: 'seguridad', password: 'ClaveSegura123', empresa_id: d.empresaB.id });
    assert.equal(us.status, 201);
    assert.equal(us.body.empresa_id, d.empresaA.id);
    const asignar = await llamar(base, 'PUT', `/api/unidades/${d.unidadA1.id}`, T.adminA, { propietario_id: d.propietarioB.id });
    assert.equal(asignar.status, 422);
  });

  it('el admin lee y edita SU empresa, pero no crea ni borra empresas', async () => {
    assert.equal((await llamar(base, 'GET', `/api/empresas/${d.empresaA.id}`, T.adminA)).status, 200);
    const put = await llamar(base, 'PUT', `/api/empresas/${d.empresaA.id}`, T.adminA, { nombre: 'Empresa A SAC' });
    assert.equal(put.status, 200);
    assert.equal(put.body.nombre, 'Empresa A SAC');
    assert.equal((await llamar(base, 'POST', '/api/empresas', T.adminA, { nombre: 'Nueva' })).status, 403);
    assert.equal((await llamar(base, 'DELETE', `/api/empresas/${d.empresaA.id}`, T.adminA)).status, 403);
    assert.equal((await llamar(base, 'POST', '/api/empresas', T.super, { nombre: 'Nueva' })).status, 201);
  });
});

describe('escalada de privilegios', () => {
  it('el admin no puede crear un superadmin', async () => {
    const r = await llamar(base, 'POST', '/api/usuarios', T.adminA, { nombre: 'Intruso', email: 'intruso@test.pe', rol: 'superadmin', password: 'ClaveSegura123' });
    assert.equal(r.status, 403);
    assert.equal(await prisma.usuario.count({ where: { email: 'intruso@test.pe' } }), 0);
  });

  it('el admin no puede ascender a nadie a superadmin ni editar a un superadmin', async () => {
    const asc = await llamar(base, 'PUT', `/api/usuarios/${d.propietario1.id}`, T.adminA, { rol: 'superadmin' });
    assert.equal(asc.status, 403);
    assert.equal((await prisma.usuario.findUnique({ where: { id: d.propietario1.id } }))!.rol, 'propietario');
    assert.equal((await llamar(base, 'PUT', `/api/usuarios/${d.superadmin.id}`, T.adminA, { nombre: 'Hackeado' })).status, 404);
  });

  it('el admin puede crear otro admin de SU empresa, pero uno de otra empresa queda en la suya', async () => {
    const r = await llamar(base, 'POST', '/api/usuarios', T.adminA, { nombre: 'Admin Dos', email: 'admin2@test.pe', rol: 'admin', password: 'ClaveSegura123', empresa_id: d.empresaB.id });
    assert.equal(r.status, 201);
    assert.equal(r.body.empresa_id, d.empresaA.id);
  });

  it('el superadmin sí puede crear superadmins; un admin sin empresa no se puede crear por error', async () => {
    const ok = await llamar(base, 'POST', '/api/usuarios', T.super, { nombre: 'Otro Super', email: 'super2@test.pe', rol: 'superadmin', password: 'ClaveSegura123' });
    assert.equal(ok.status, 201);
    const sinEmpresa = await llamar(base, 'POST', '/api/usuarios', T.super, { nombre: 'Admin sin empresa', email: 'sinempresa@test.pe', rol: 'admin', password: 'ClaveSegura123' });
    assert.equal(sinEmpresa.status, 422);
  });

  it('nadie se elimina a sí mismo', async () => {
    const r = await llamar(base, 'DELETE', `/api/usuarios/${d.adminA.id}`, T.adminA);
    assert.equal(r.status, 422);
  });
});

describe('matriz de permisos por rol', () => {
  it('propietario e inquilino no acceden a ningún CRUD general (403)', async () => {
    for (const token of [T.prop1, T.inq1]) {
      for (const r of RECURSOS) {
        assert.equal((await llamar(base, 'GET', `/api/${r}`, token)).status, 403, `GET /api/${r}`);
      }
      assert.equal((await llamar(base, 'POST', '/api/usuarios', token, { nombre: 'x' })).status, 403);
      assert.equal((await llamar(base, 'GET', '/api/reportes/morosidad', token)).status, 403);
    }
  });

  it('mantenimiento sólo ve sus tareas y las unidades de esas tareas; no escribe', async () => {
    const t = await llamar(base, 'GET', '/api/tareas', T.mttoA);
    assert.deepEqual(t.body.items.map((x: { id: number }) => x.id), [d.tareaA.id]);
    assert.equal((await llamar(base, 'GET', `/api/tareas/${d.tareaOtra.id}`, T.mttoA)).status, 404);
    const u = await llamar(base, 'GET', '/api/unidades', T.mttoA);
    assert.deepEqual(u.body.items.map((x: { codigo: string }) => x.codigo), ['A-101']);
    assert.equal((await llamar(base, 'GET', `/api/unidades/${d.unidadA2.id}`, T.mttoA)).status, 404);
    for (const r of ['usuarios', 'complejos', 'recibos', 'pagos', 'empresas']) assert.equal((await llamar(base, 'GET', `/api/${r}`, T.mttoA)).status, 403, r);
    assert.equal((await llamar(base, 'POST', '/api/tareas', T.mttoA, { titulo: 'x' })).status, 403);
    assert.equal((await llamar(base, 'PUT', `/api/unidades/${d.unidadA1.id}`, T.mttoA, { codigo: 'Z' })).status, 403);
  });

  it('seguridad sólo lee las unidades de su complejo y el resumen', async () => {
    const u = await llamar(base, 'GET', '/api/unidades', T.segA);
    assert.equal(u.body.total, 2);
    assert.ok(u.body.items.every((x: { complejo_id: number }) => x.complejo_id === d.complejoA.id));
    assert.equal((await llamar(base, 'GET', '/api/dashboard/resumen', T.segA)).status, 200);
    assert.equal((await llamar(base, 'POST', '/api/unidades', T.segA, { codigo: 'S', tipo: 'x', complejo_id: d.complejoA.id })).status, 403);
    for (const r of ['usuarios', 'pagos', 'recibos', 'tareas']) assert.equal((await llamar(base, 'GET', `/api/${r}`, T.segA)).status, 403, r);
  });

  it('/api/auditoria es sólo para superadmin', async () => {
    assert.equal((await llamar(base, 'GET', '/api/auditoria', T.adminA)).status, 403);
    assert.equal((await llamar(base, 'GET', '/api/auditoria', T.super)).status, 200);
    assert.equal((await llamar(base, 'POST', '/api/auditoria', T.super, {})).status, 404);
  });
});

describe('paginación y validación', () => {
  it('toda lista devuelve {items,total,page,pageSize} y respeta page/pageSize/q/orden', async () => {
    for (const r of RECURSOS) {
      const resp = await llamar(base, 'GET', `/api/${r}?page=1&pageSize=1`, T.super);
      assert.equal(resp.status, 200, r);
      assert.deepEqual(Object.keys(resp.body).sort(), ['items', 'page', 'pageSize', 'total'], r);
      assert.ok(resp.body.items.length <= 1);
    }
    const p1 = await llamar(base, 'GET', '/api/unidades?page=1&pageSize=2&orden=codigo:asc', T.super);
    const p2 = await llamar(base, 'GET', '/api/unidades?page=2&pageSize=2&orden=codigo:asc', T.super);
    assert.deepEqual(p1.body.items.map((x: { codigo: string }) => x.codigo), ['A-101', 'A-102']);
    assert.deepEqual(p2.body.items.map((x: { codigo: string }) => x.codigo), ['B-101']);
    assert.equal(p1.body.total, 3);
    const desc = await llamar(base, 'GET', '/api/unidades?orden=codigo:desc', T.super);
    assert.equal(desc.body.items[0].codigo, 'B-101');
    const q = await llamar(base, 'GET', '/api/unidades?q=a-10', T.super);
    assert.equal(q.body.total, 2);
    const filtro = await llamar(base, 'GET', `/api/unidades?complejo_id=${d.complejoB.id}`, T.super);
    assert.equal(filtro.body.total, 1);
  });

  it('pageSize máximo 100 y parámetros fuera de rango o con basura se rechazan (422)', async () => {
    for (const qs of ['pageSize=101', 'pageSize=0', 'page=0', 'page=abc', 'orden=password_hash:asc', 'orden=codigo:sideways', 'complejo_id=abc', 'complejo_id=-1', "complejo_id=1;DROP"]) {
      const r = await llamar(base, 'GET', `/api/unidades?${qs}`, T.super);
      assert.equal(r.status, 422, qs);
      assert.equal(typeof r.body.error, 'string');
    }
    assert.equal((await llamar(base, 'GET', '/api/unidades?pageSize=100', T.super)).status, 200);
  });

  it('los ids de ruta se validan: no numérico → 422', async () => {
    assert.equal((await llamar(base, 'GET', '/api/unidades/abc', T.super)).status, 422);
    assert.equal((await llamar(base, 'GET', '/api/unidades/99999999999', T.super)).status, 422);
    assert.equal((await llamar(base, 'DELETE', '/api/unidades/1.5', T.super)).status, 422);
    assert.equal((await llamar(base, 'GET', '/api/unidades/999999', T.super)).status, 404);
  });

  it('los POST/PUT validan el cuerpo con zod (422, mensaje en español, sin detalle interno)', async () => {
    const casos: [string, string, unknown][] = [
      ['POST', '/api/usuarios', { nombre: 'X', email: 'no-es-correo', rol: 'admin', password: 'ClaveSegura123' }],
      ['POST', '/api/usuarios', { nombre: 'X', email: 'x@test.pe', rol: 'dios', password: 'ClaveSegura123' }],
      ['POST', '/api/usuarios', { nombre: 'X', email: 'x@test.pe', rol: 'inquilino', password: 'corta' }],
      ['POST', '/api/usuarios', { nombre: '   ', email: 'x@test.pe', rol: 'inquilino', password: 'ClaveSegura123' }],
      ['POST', '/api/complejos', { nombre: 'Sin tipo' }],
      ['POST', '/api/unidades', { codigo: 'U', tipo: 'Dpto', complejo_id: 'uno' }],
      ['POST', '/api/conceptos', { nombre: 'C', tipo_monto: 'raro' }],
      ['POST', '/api/recibos', { complejo_id: d.complejoA.id, mes: 13, anio: 2026, fecha_emision: '2026-01-01', fecha_vencimiento: '2026-01-10' }],
      ['POST', '/api/recibos', { complejo_id: d.complejoA.id, mes: 1, anio: 2026, fecha_emision: '2026-01-10', fecha_vencimiento: '2026-01-01' }],
      ['POST', '/api/recibos', { complejo_id: d.complejoA.id, mes: 1, anio: 2026, fecha_emision: 'ayer', fecha_vencimiento: '2026-01-10' }],
      ['POST', '/api/recibos', { complejo_id: d.complejoA.id, mes: 1, anio: 2026, fecha_emision: '2026-01-01', fecha_vencimiento: '2026-01-10', conceptos: [{ concepto_id: d.conceptoA.id, monto: -5 }] }],
      ['POST', '/api/tareas', { titulo: 'T', estado: 'rara' }],
      ['PUT', `/api/usuarios/${d.inquilino1.id}`, { email: 'otra-cosa' }],
      ['POST', '/api/pagos', { recibo_concepto_unidad_id: d.cargoVencidoA1.id, monto: 'abc', metodo_pago: 'yape' }],
      ['POST', '/api/pagos', { recibo_concepto_unidad_id: d.cargoVencidoA1.id, monto: 10, metodo_pago: 'bitcoin' }],
    ];
    for (const [metodo, ruta, cuerpo] of casos) {
      const r = await llamar(base, metodo, ruta, T.adminA, cuerpo);
      assert.equal(r.status, 422, `${metodo} ${ruta} ${JSON.stringify(cuerpo)}`);
      assert.match(r.body.error, /^Datos inválidos/);
      assert.ok(!/prisma|invocation|stack/i.test(r.texto));
    }
  });

  it('perfil y contraseña: PUT /api/me valida y PUT /api/me/password exige la actual y mínimo 8', async () => {
    const perfil = await llamar(base, 'PUT', '/api/me', T.prop1, { nombre: 'Propietario Uno', telefono: '999888777' });
    assert.equal(perfil.status, 200);
    assert.equal(perfil.body.nombre, 'Propietario Uno');
    assert.equal(perfil.body.telefono, '+51 999 888 777'); // se guarda en formato internacional
    assert.ok(!perfil.texto.includes('password_hash'));
    assert.equal((await llamar(base, 'PUT', '/api/me', T.prop1, { nombre: '', telefono: '1' })).status, 422);
    assert.equal((await llamar(base, 'PUT', '/api/me/password', T.prop1, { actual: 'mala-actual', nueva: 'NuevaClave123' })).status, 400);
    assert.equal((await llamar(base, 'PUT', '/api/me/password', T.prop1, { actual: 'Passw0rd!123', nueva: 'corta' })).status, 422);
    const ok = await llamar(base, 'PUT', '/api/me/password', T.prop1, { actual: 'Passw0rd!123', nueva: 'NuevaClave123' });
    assert.equal(ok.status, 200);
    assert.equal((await llamar(base, 'POST', '/api/auth/login', null, { email: 'prop1@test.pe', password: 'NuevaClave123' })).status, 200);
    assert.equal((await llamar(base, 'POST', '/api/auth/login', null, { email: 'prop1@test.pe', password: 'Passw0rd!123' })).status, 401);
    await prisma.usuario.update({ where: { id: d.propietario1.id }, data: { password_hash: (await prisma.usuario.findUnique({ where: { id: d.propietario2.id }, omit: { password_hash: false } }))!.password_hash } });
  });
});
