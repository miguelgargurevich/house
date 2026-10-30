// «Proveedores» del vecino: GET /api/me/proveedores. El propietario y el inquilino ven SÓLO los proveedores ACTIVOS marcados «Visible para los
// vecinos» que atienden el condominio de SUS unidades, y de cada uno sólo la ficha de contacto: nunca notas, RUC, cuenta de pago ni ids.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1' | 'inq1' | 'propB' | 'sinUnidad' | 'mtto' | 'seg' | 'presi' | 'secre', string>;
let P: Record<'visible' | 'visible2' | 'oculto' | 'inactivo' | 'soloB' | 'compartido' | 'otraEmpresa' | 'soloA2', number>;
let complejoA2: { id: number };

const SECRETOS = ['NOTA-INTERNA-SECRETA', '20999999991', 'CUENTA-SECRETA-123', 'CCI-SECRETO-456', 'TITULAR-SECRETO'];
const llama = (t: string | null, ruta = '/api/me/proveedores') => llamar(base, 'GET', ruta, t);
type Ficha = Record<string, unknown>;
type Grupo = { rubro: string; proveedores: Ficha[] };
const grupos = (r: { body: unknown }) => (r.body as { items: Grupo[] }).items;
const razones = (r: { body: unknown }) => grupos(r).flatMap((g) => g.proveedores.map((p) => p.razon_social as string)).sort();

before(async () => {
  d = await sembrar();
  complejoA2 = await prisma.complejoHabitacional.create({ data: { nombre: 'Complejo A2', tipo: 'Edificio', empresa_id: d.empresaA.id } });
  const hash = await bcrypt.hash(PASSWORD, 4);
  await prisma.usuario.create({ data: { nombre: 'Sin unidad', email: 'sinunidad@test.pe', rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id } });
  const mk = (nombre: string, cargo: string) => prisma.usuario.create({ data: { nombre, email: `${nombre.toLowerCase()}@test.pe`, rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, cargo_junta: cargo } });
  await mk('Presi', 'presidente');
  await mk('Secre', 'secretario');

  const prov = (razon_social: string, rubro: string, empresa_id: number, complejos: number[], extra: Record<string, unknown> = {}) =>
    prisma.proveedor.create({
      data: {
        razon_social, rubro, empresa_id, contacto_nombre: `Contacto de ${razon_social}`, telefono: '+51 987 654 321', email: `${razon_social.toLowerCase().replace(/\W+/g, '')}@prov.pe`,
        notas: SECRETOS[0], ruc: SECRETOS[1], cuenta_banco: 'BCP', cuenta_numero: SECRETOS[2], cuenta_cci: SECRETOS[3], cuenta_titular: SECRETOS[4],
        visible_vecinos: true, complejos: { create: complejos.map((complejo_id) => ({ complejo_id })) }, ...extra,
      },
      select: { id: true },
    });
  P = {
    visible: (await prov('Ascensores Alfa', 'ascensores', d.empresaA.id, [d.complejoA.id])).id,
    visible2: (await prov('Gasfitero Beta', 'gasfiteria', d.empresaA.id, [d.complejoA.id])).id,
    oculto: (await prov('Oculto Gamma', 'gasfiteria', d.empresaA.id, [d.complejoA.id], { visible_vecinos: false })).id,
    inactivo: (await prov('Inactivo Delta', 'pintura', d.empresaA.id, [d.complejoA.id], { activo: false })).id,
    soloB: (await prov('Solo B Epsilon', 'ascensores', d.empresaB.id, [d.complejoB.id])).id,
    compartido: (await prov('Compartido Zeta', 'electricidad', d.empresaA.id, [d.complejoA.id, complejoA2.id])).id,
    otraEmpresa: (await prov('Otra Empresa Eta', 'limpieza', d.empresaB.id, [d.complejoB.id], { visible_vecinos: false })).id,
    soloA2: (await prov('Solo A2 Theta', 'seguridad', d.empresaA.id, [complejoA2.id])).id,
  };
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  const sesion = (email: string) => login(base, email);
  T = {
    super: await sesion('super@test.pe'), adminA: await sesion('admin.a@test.pe'), adminB: await sesion('admin.b@test.pe'), prop1: await sesion('prop1@test.pe'),
    inq1: await sesion('inq1@test.pe'), propB: await sesion('propb@test.pe'), sinUnidad: await sesion('sinunidad@test.pe'), mtto: await sesion('mtto.a@test.pe'),
    seg: await sesion('seg.a@test.pe'), presi: await sesion('presi@test.pe'), secre: await sesion('secre@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('GET /api/me/proveedores: quién ve qué', () => {
  it('el propietario ve SÓLO los activos y marcados de su condominio (incluido el compartido con otro condominio)', async () => {
    const r = await llama(T.prop1);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(razones(r), ['Ascensores Alfa', 'Compartido Zeta', 'Gasfitero Beta']);
  });

  it('el inquilino ve lo mismo que el propietario de su unidad', async () => {
    const r = await llama(T.inq1);
    assert.equal(r.status, 200);
    assert.deepEqual(razones(r), ['Ascensores Alfa', 'Compartido Zeta', 'Gasfitero Beta']);
  });

  it('un proveedor NO marcado («Visible para los vecinos» apagado) no sale, aunque esté activo y atienda su condominio', async () => {
    assert.ok(!razones(await llama(T.prop1)).includes('Oculto Gamma'));
  });

  it('un proveedor inactivo no sale, aunque esté marcado', async () => {
    assert.ok(!razones(await llama(T.prop1)).includes('Inactivo Delta'));
  });

  it('sólo los de SU condominio: nunca los que atienden otro condominio, ni los de otra empresa', async () => {
    const mio = razones(await llama(T.prop1));
    for (const ajeno of ['Solo B Epsilon', 'Otra Empresa Eta', 'Solo A2 Theta']) assert.ok(!mio.includes(ajeno), ajeno);
    assert.deepEqual(razones(await llama(T.propB)), ['Solo B Epsilon']);
  });

  it('un residente sin unidades recibe la lista vacía (no los proveedores de todos)', async () => {
    const r = await llama(T.sinUnidad);
    assert.equal(r.status, 200);
    assert.deepEqual(grupos(r), []);
  });

  it('la junta (presidente o secretario) ve lo mismo que un vecino: es propietario', async () => {
    for (const t of [T.presi, T.secre]) assert.equal((await llama(t)).status, 200);
  });
});

describe('GET /api/me/proveedores: forma y datos', () => {
  it('agrupa por rubro (en el orden del catálogo) y ordena por razón social', async () => {
    const g = grupos(await llama(T.prop1));
    assert.deepEqual(g.map((x) => x.rubro), ['ascensores', 'gasfiteria', 'electricidad']);
    assert.deepEqual(g[0]!.proveedores.map((p) => p.razon_social), ['Ascensores Alfa']);
  });

  it('cada ficha trae SÓLO razón social, contacto, teléfono y correo (el rubro va en el grupo)', async () => {
    for (const g of grupos(await llama(T.prop1))) {
      for (const p of g.proveedores) assert.deepEqual(Object.keys(p).sort(), ['contacto_nombre', 'email', 'razon_social', 'telefono']);
    }
    const alfa = grupos(await llama(T.prop1)).flatMap((g) => g.proveedores).find((p) => p.razon_social === 'Ascensores Alfa')!;
    assert.equal(alfa.contacto_nombre, 'Contacto de Ascensores Alfa');
    assert.equal(alfa.telefono, '+51 987 654 321');
    assert.equal(alfa.email, 'ascensoresalfa@prov.pe');
  });

  it('NUNCA aparece nada interno en el texto de la respuesta: notas, RUC, cuenta de pago, ids, empresa ni condominios', async () => {
    for (const t of [T.prop1, T.inq1]) {
      const texto = JSON.stringify((await llama(t)).body);
      for (const s of SECRETOS) assert.ok(!texto.includes(s), `se coló ${s}`);
      for (const clave of ['notas', 'ruc', 'cuenta_', 'empresa', 'complejo', 'tareas', '"id"', 'activo', 'visible_vecinos']) assert.ok(!texto.includes(clave), `se coló la clave ${clave}`);
    }
  });
});

describe('GET /api/me/proveedores: puertas', () => {
  it('sin sesión: 401', async () => {
    assert.equal((await llama(null)).status, 401);
  });

  it('administración, superadmin y personal: 403 (no tienen unidades propias)', async () => {
    for (const t of [T.super, T.adminA, T.adminB, T.mtto, T.seg]) assert.equal((await llama(t)).status, 403);
  });

  it('el vecino no abre la API de gestión de proveedores (donde sí están las notas y el RUC)', async () => {
    for (const t of [T.prop1, T.inq1]) assert.equal((await llama(t, '/api/proveedores')).status, 403);
  });
});

describe('«Visible para los vecinos»: quién lo cambia y cómo queda', () => {
  const visibles = async () => razones(await llama(T.prop1));

  it('al crear queda apagado por defecto y no lo ve ningún vecino', async () => {
    const r = await llamar(base, 'POST', '/api/proveedores', T.adminA, { razon_social: 'Nuevo Iota', rubro: 'pintura', complejo_ids: [d.complejoA.id] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.visible_vecinos, false);
    assert.ok(!(await visibles()).includes('Nuevo Iota'));
    await prisma.proveedor.delete({ where: { id: r.body.id } });
  });

  it('la administración lo prende y lo apaga: el vecino lo ve y deja de verlo; queda en la auditoría', async () => {
    const antes = await prisma.auditoria.count({ where: { entidad: 'proveedor', entidad_id: P.oculto } });
    const on = await llamar(base, 'PUT', `/api/proveedores/${P.oculto}`, T.adminA, { visible_vecinos: true });
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.equal(on.body.visible_vecinos, true);
    assert.ok((await visibles()).includes('Oculto Gamma'));
    const off = await llamar(base, 'PUT', `/api/proveedores/${P.oculto}`, T.adminA, { visible_vecinos: false });
    assert.equal(off.body.visible_vecinos, false);
    assert.ok(!(await visibles()).includes('Oculto Gamma'));
    await new Promise((r) => setTimeout(r, 200)); // la auditoría se escribe tras responder
    const filas = await prisma.auditoria.findMany({ where: { entidad: 'proveedor', entidad_id: P.oculto }, orderBy: { id: 'asc' } });
    assert.equal(filas.length - antes, 2);
    assert.deepEqual(filas.slice(-2).map((f) => (f.detalle as { visible_vecinos: boolean }).visible_vecinos), [true, false]);
  });

  it('rechaza un valor que no es verdadero/falso (422) y no lo cambia', async () => {
    const r = await llamar(base, 'PUT', `/api/proveedores/${P.oculto}`, T.adminA, { visible_vecinos: 'si' });
    assert.equal(r.status, 422);
    assert.ok(!(await visibles()).includes('Oculto Gamma'));
  });

  it('la administración de otra empresa no lo cambia (404)', async () => {
    assert.equal((await llamar(base, 'PUT', `/api/proveedores/${P.oculto}`, T.adminB, { visible_vecinos: true })).status, 404);
    assert.ok(!(await visibles()).includes('Oculto Gamma'));
  });

  it('la lista de la administración trae el campo para pintar el interruptor', async () => {
    const r = await llamar(base, 'GET', '/api/proveedores?pageSize=100', T.adminA);
    const por = new Map((r.body.items as { id: number; visible_vecinos: boolean }[]).map((p) => [p.id, p.visible_vecinos]));
    assert.equal(por.get(P.visible), true);
    assert.equal(por.get(P.oculto), false);
  });

  it('la junta (presidente) lo cambia en un proveedor que atiende sólo a su condominio; el secretario no', async () => {
    const mio = (await prisma.proveedor.create({ data: { razon_social: 'De la junta Kappa', rubro: 'otros', empresa_id: d.empresaA.id, complejos: { create: [{ complejo_id: d.complejoA.id }] } }, select: { id: true } })).id;
    assert.equal((await llamar(base, 'PUT', `/api/proveedores/${mio}`, T.secre, { visible_vecinos: true })).status, 403);
    assert.ok(!(await visibles()).includes('De la junta Kappa'));
    const r = await llamar(base, 'PUT', `/api/proveedores/${mio}`, T.presi, { visible_vecinos: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok((await visibles()).includes('De la junta Kappa'));
    // Uno compartido con otro condominio sólo lo cambia la administración.
    assert.equal((await llamar(base, 'PUT', `/api/proveedores/${P.compartido}`, T.presi, { visible_vecinos: false })).status, 403);
    assert.ok((await visibles()).includes('Compartido Zeta'));
    await prisma.proveedor.delete({ where: { id: mio } });
  });
});
