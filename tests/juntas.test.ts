// Juntas directivas por block, con gestiones (periodos) e historial. La cuenta de la junta ES el medio de pago del block.
// `Usuario.cargo_junta`/`estructura_id` son el reflejo de la junta vigente: los permisos de la junta no cambian, sólo de dónde salen.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { hoyLima } from '../src/server/lib/fechas';

const DIA = 86_400_000;
/** «2026-10-29» desplazado `n` días respecto de hoy en Lima. */
const dia = (n: number) => new Date(hoyLima().getTime() + n * DIA).toISOString().slice(0, 10);

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let e1: { id: number };
let e2: { id: number };
let eB: { id: number };
let U: Record<string, number>;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1' | 'inq1', string>;

const llama = (t: string | null, metodo: string, ruta: string, cuerpo?: unknown) => llamar(base, metodo, ruta, t, cuerpo);
const sesion = (email: string) => login(base, email);
const banco = (extra: Record<string, unknown> = {}) => ({ tipo: 'banco', banco: 'BCP', tipo_cuenta: 'ahorros', numero_cuenta: '19412345678901', cci: '00219400123456789012', titular: 'Junta Block 1', ...extra });
const miembros = (...pares: [string, string][]) => pares.map(([u, cargo]) => ({ usuario_id: U[u], cargo }));

before(async () => {
  d = await sembrar();
  e1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
  e2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'Block', complejo_id: d.complejoA.id } });
  eB = await prisma.estructura.create({ data: { nombre: 'Block B', tipo: 'Block', complejo_id: d.complejoB.id } });
  await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: e1.id } }); // prop1 (e inq1)
  await prisma.unidad.update({ where: { id: d.unidadA2.id }, data: { estructura_id: e2.id } }); // prop2
  await prisma.unidad.update({ where: { id: d.unidadB1.id }, data: { estructura_id: eB.id } }); // propB
  const hash = await bcrypt.hash(PASSWORD, 4);
  // Cuatro propietarios más en el block 1 y uno en el block 2 (cada uno con su departamento).
  const propietario = async (clave: string, nombre: string, codigo: string, estructura_id: number) => {
    const u = await prisma.usuario.create({ data: { nombre, email: `${clave}@test.pe`, telefono: '+51 987 654 321', rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id } });
    await prisma.unidad.create({ data: { codigo: codigo, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id, propietario_id: u.id, estado: 'activa' } });
    return u.id;
  };
  U = {
    prop1: d.propietario1.id, prop2: d.propietario2.id, propB: d.propietarioB.id, inq1: d.inquilino1.id,
    ana: await propietario('ana', 'Ana Presidenta', 'B01-201', e1.id),
    beto: await propietario('beto', 'Beto Tesorero', 'B01-202', e1.id),
    carla: await propietario('carla', 'Carla Secretaria', 'B01-203', e1.id),
    dario: await propietario('dario', 'Darío Vocal', 'B01-204', e1.id),
    eva: await propietario('eva', 'Eva del Block 2', 'B02-201', e2.id),
  };
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    super: await sesion('super@test.pe'), adminA: await sesion('admin.a@test.pe'), adminB: await sesion('admin.b@test.pe'),
    prop1: await sesion('prop1@test.pe'), inq1: await sesion('inq1@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

async function limpiar() {
  await prisma.medioPago.deleteMany();
  await prisma.juntaDirectiva.deleteMany(); // los miembros se van por cascada
  await prisma.usuario.updateMany({ data: { cargo_junta: null, estructura_id: null } });
  await prisma.estructura.updateMany({ data: { correo_vouchers: null } });
}

/** Registra la junta del block 1 desde hace 400 días (Ana presidenta, Beto tesorero, Carla secretaria, Darío vocal). */
async function juntaBlock1(extra: Record<string, unknown> = {}) {
  const r = await llama(T.adminA, 'POST', '/api/juntas', {
    complejo_id: d.complejoA.id, estructura_id: e1.id, desde: dia(-400), correo: 'junta.b1@ejemplo.test',
    miembros: miembros(['ana', 'presidente'], ['beto', 'tesorero'], ['carla', 'secretario'], ['dario', 'vocal']), ...extra,
  });
  assert.equal(r.status, 201, r.texto);
  return r.body as { id: number; miembros: { usuario_id: number; cargo: string }[]; medios: { id: number }[] };
}

describe('quién ve y quién cambia las juntas', () => {
  beforeEach(limpiar);

  it('sin sesión 401; residentes, propietario sin cargo, secretario y vocal → 403 (no ven la pantalla)', async () => {
    await juntaBlock1();
    assert.equal((await llama(null, 'GET', '/api/juntas')).status, 401);
    const tokens = [T.prop1, T.inq1, await sesion('carla@test.pe'), await sesion('dario@test.pe')];
    for (const t of tokens) {
      assert.equal((await llama(t, 'GET', '/api/juntas')).status, 403);
      assert.equal((await llama(t, 'GET', '/api/juntas/historial?complejo_id=1')).status, 403);
    }
  });

  it('la administración de OTRA empresa recibe 404 en todo (ver, editar, nueva gestión) y una lista vacía', async () => {
    const j = await juntaBlock1();
    assert.equal((await llama(T.adminB, 'GET', `/api/juntas/${j.id}`)).status, 404);
    assert.equal((await llama(T.adminB, 'PUT', `/api/juntas/${j.id}`, { correo: 'x@ejemplo.test' })).status, 404);
    assert.equal((await llama(T.adminB, 'POST', `/api/juntas/${j.id}/nueva-gestion`, { desde: dia(-1), miembros: [] })).status, 404);
    const lista = await llama(T.adminB, 'GET', '/api/juntas');
    assert.equal(lista.status, 200);
    assert.ok(lista.body.items.every((i: { complejo: { id: number } }) => i.complejo.id === d.complejoB.id));
    assert.equal((await llama(T.adminB, 'GET', `/api/juntas/historial?complejo_id=${d.complejoA.id}&estructura_id=${e1.id}`)).body.items.length, 0);
    // Registrar una junta en un condominio o block ajeno: 404, no 403
    assert.equal((await llama(T.adminB, 'POST', '/api/juntas', { complejo_id: d.complejoA.id, estructura_id: e1.id, desde: dia(-1) })).status, 404);
    assert.equal((await llama(T.adminA, 'POST', '/api/juntas', { complejo_id: d.complejoA.id, estructura_id: eB.id, desde: dia(-1) })).status, 404); // block de otro condominio
    assert.equal((await llama(T.adminB, 'GET', `/api/juntas/candidatos?complejo_id=${d.complejoA.id}`)).status, 404);
  });

  it('el presidente y el tesorero ven SU junta y editan su correo; la junta de otro block recibe 404', async () => {
    const j = await juntaBlock1();
    const eva = await llama(T.adminA, 'POST', '/api/juntas', { complejo_id: d.complejoA.id, estructura_id: e2.id, desde: dia(-30), miembros: miembros(['eva', 'presidente']) });
    assert.equal(eva.status, 201, eva.texto);
    const tAna = await sesion('ana@test.pe');
    const tBeto = await sesion('beto@test.pe');
    const tEva = await sesion('eva@test.pe');
    for (const t of [tAna, tBeto]) {
      const lista = await llama(t, 'GET', '/api/juntas');
      assert.equal(lista.status, 200);
      assert.deepEqual(lista.body.items.map((i: { estructura: { id: number } | null }) => i.estructura?.id), [e1.id]); // sólo su block
      assert.equal(lista.body.puede_gestionar, false);
      assert.equal((await llama(t, 'GET', `/api/juntas/${j.id}`)).status, 200);
    }
    const r = await llama(tAna, 'PUT', `/api/juntas/${j.id}`, { correo: 'nuevo.correo@ejemplo.test' });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.correo, 'nuevo.correo@ejemplo.test');
    assert.equal((await llama(tBeto, 'PUT', `/api/juntas/${j.id}`, { correo: '' })).body.correo, null);
    // Eva (presidenta del block 2) no ve ni toca la junta del block 1
    assert.equal((await llama(tEva, 'GET', `/api/juntas/${j.id}`)).status, 404);
    assert.equal((await llama(tEva, 'PUT', `/api/juntas/${j.id}`, { correo: 'intruso@ejemplo.test' })).status, 404);
    assert.equal((await llama(tEva, 'GET', `/api/juntas/historial?complejo_id=${d.complejoA.id}&estructura_id=${e1.id}`)).body.items.length, 0);
    assert.equal((await prisma.juntaDirectiva.findUniqueOrThrow({ where: { id: j.id } })).correo, null);
  });

  it('la junta NO cambia miembros ni notas, NO crea juntas ni gestiones nuevas, NO ve candidatos (403) y nada cambia', async () => {
    const j = await juntaBlock1();
    const tAna = await sesion('ana@test.pe');
    const tBeto = await sesion('beto@test.pe');
    for (const t of [tAna, tBeto]) {
      assert.equal((await llama(t, 'PUT', `/api/juntas/${j.id}`, { miembros: miembros(['ana', 'presidente']) })).status, 403);
      assert.equal((await llama(t, 'PUT', `/api/juntas/${j.id}`, { notas: 'cambio' })).status, 403);
      assert.equal((await llama(t, 'POST', `/api/juntas/${j.id}/nueva-gestion`, { desde: dia(-1), miembros: miembros(['ana', 'presidente']) })).status, 403);
      assert.equal((await llama(t, 'POST', '/api/juntas', { complejo_id: d.complejoA.id, estructura_id: e2.id, desde: dia(-1) })).status, 403);
      assert.equal((await llama(t, 'GET', `/api/juntas/candidatos?complejo_id=${d.complejoA.id}&estructura_id=${e1.id}`)).status, 403);
    }
    const despues = await prisma.juntaDirectiva.findUniqueOrThrow({ where: { id: j.id }, include: { miembros: true } });
    assert.equal(despues.hasta, null);
    assert.equal(despues.notas, null);
    assert.equal(despues.miembros.length, 4);
    assert.equal(await prisma.juntaDirectiva.count(), 1);
  });

  it('la junta de TODO el condominio ve los blocks de su condominio; la de un block no ve la del condominio', async () => {
    const condo = await llama(T.adminA, 'POST', '/api/juntas', { complejo_id: d.complejoA.id, desde: dia(-50), miembros: miembros(['prop2', 'presidente']) });
    assert.equal(condo.status, 201, condo.texto);
    await juntaBlock1();
    const tCondo = await sesion('prop2@test.pe');
    const lista = await llama(tCondo, 'GET', '/api/juntas');
    assert.deepEqual(lista.body.items.map((i: { estructura: { id: number } | null }) => i.estructura?.id ?? null), [e1.id, e2.id, null]);
    const tAna = await sesion('ana@test.pe');
    assert.equal((await llama(tAna, 'GET', `/api/juntas/${condo.body.id}`)).status, 404);
    assert.equal((await llama(tCondo, 'GET', `/api/juntas/${condo.body.id}`)).status, 200);
  });
});

describe('registrar la junta: miembros, cargos y reflejo en el usuario', () => {
  beforeEach(limpiar);

  it('crea la junta con su miembros, departamento y correo; los cargos pasan al usuario y sus sesiones se cierran', async () => {
    const tAna = await sesion('ana@test.pe');
    const tProp1 = T.prop1; // no es miembro: su sesión sigue
    assert.equal((await llama(tAna, 'GET', '/api/medios-pago')).status, 403); // sin cargo aún
    const j = await juntaBlock1({ notas: 'Elegida en asamblea' });
    const r = await llama(T.adminA, 'GET', `/api/juntas/${j.id}`);
    assert.equal(r.body.desde, dia(-400));
    assert.equal(r.body.hasta, null);
    assert.equal(r.body.vigente, true);
    assert.equal(r.body.correo, 'junta.b1@ejemplo.test');
    assert.equal(r.body.notas, 'Elegida en asamblea');
    assert.deepEqual(r.body.miembros.map((m: { cargo: string }) => m.cargo), ['presidente', 'tesorero', 'secretario', 'vocal']);
    const ana = r.body.miembros[0];
    assert.equal(ana.nombre, 'Ana Presidenta');
    assert.equal(ana.email, 'ana@test.pe');
    assert.equal(ana.telefono, '+51 987 654 321');
    assert.deepEqual(ana.departamentos, ['B01-201']);
    // Reflejo en el usuario
    for (const [u, cargo] of [['ana', 'presidente'], ['beto', 'tesorero'], ['carla', 'secretario'], ['dario', 'vocal']] as const) {
      const x = await prisma.usuario.findUniqueOrThrow({ where: { id: U[u]! } });
      assert.equal(x.cargo_junta, cargo);
      assert.equal(x.estructura_id, e1.id);
    }
    assert.equal((await llama(tAna, 'GET', '/api/auth/me')).status, 401); // sesión cerrada
    assert.equal((await llama(tProp1, 'GET', '/api/auth/me')).status, 200); // quien no cambió de cargo sigue dentro
    const nueva = await sesion('ana@test.pe');
    const me = await llama(nueva, 'GET', '/api/auth/me');
    assert.equal(me.body.cargo_junta, 'presidente');
    assert.equal(me.body.estructura_id, e1.id);
    assert.equal((await llama(nueva, 'GET', '/api/medios-pago')).status, 200); // los permisos ya valen
  });

  it('un block sólo tiene una junta vigente (409) y la fecha no puede ser futura ni mal escrita (422)', async () => {
    await juntaBlock1();
    const dup = await llama(T.adminA, 'POST', '/api/juntas', { complejo_id: d.complejoA.id, estructura_id: e1.id, desde: dia(-10) });
    assert.equal(dup.status, 409, dup.texto);
    for (const desde of [dia(1), dia(30), '2026-13-45', '29/10/2026', 'hoy', '']) {
      const r = await llama(T.adminA, 'POST', '/api/juntas', { complejo_id: d.complejoA.id, estructura_id: e2.id, desde });
      assert.equal(r.status, 422, `${desde}: ${r.texto}`);
    }
    assert.equal(await prisma.juntaDirectiva.count({ where: { estructura_id: e2.id } }), 0);
    // Hoy sí vale
    assert.equal((await llama(T.adminA, 'POST', '/api/juntas', { complejo_id: d.complejoA.id, estructura_id: e2.id, desde: dia(0) })).status, 201);
  });

  it('un solo presidente y un solo tesorero; nadie repetido', async () => {
    const intento = (m: { usuario_id: number; cargo: string }[]) => llama(T.adminA, 'POST', '/api/juntas', { complejo_id: d.complejoA.id, estructura_id: e1.id, desde: dia(-5), miembros: m });
    const dosPresis = await intento(miembros(['ana', 'presidente'], ['beto', 'presidente']));
    assert.equal(dosPresis.status, 422, dosPresis.texto);
    assert.match(dosPresis.texto, /presidente/);
    assert.equal((await intento(miembros(['ana', 'tesorero'], ['beto', 'tesorero']))).status, 422);
    assert.equal((await intento(miembros(['ana', 'presidente'], ['ana', 'vocal']))).status, 422); // repetida
    assert.equal((await intento([{ usuario_id: U.ana!, cargo: 'jefe' }])).status, 422); // cargo inexistente
    // Varios secretarios y vocales sí
    assert.equal((await intento(miembros(['ana', 'presidente'], ['beto', 'secretario'], ['carla', 'secretario'], ['dario', 'vocal']))).status, 201);
    assert.equal(await prisma.juntaDirectiva.count(), 1);
  });

  it('un miembro debe ser propietario de una unidad de ESE block: otro block, inquilino, otro condominio o inexistente → 422', async () => {
    const intento = (m: unknown[]) => llama(T.adminA, 'POST', '/api/juntas', { complejo_id: d.complejoA.id, estructura_id: e1.id, desde: dia(-5), miembros: m });
    const malos: [string, number][] = [['Eva (propietaria del block 2)', U.eva!], ['un inquilino', U.inq1!], ['un propietario de otro condominio', U.propB!], ['un usuario inexistente', 987654]];
    for (const [que, id] of malos) {
      const r = await intento([{ usuario_id: id, cargo: 'vocal' }]);
      assert.equal(r.status, 422, `${que}: ${r.texto}`);
    }
    // Un administrador no es propietario
    const r = await intento([{ usuario_id: d.adminA.id, cargo: 'vocal' }]);
    assert.equal(r.status, 422, r.texto);
    assert.equal(await prisma.juntaDirectiva.count(), 0);
    assert.equal(await prisma.miembroJunta.count(), 0);
    // La junta de todo el condominio acepta a cualquier propietario del condominio
    const condo = await llama(T.adminA, 'POST', '/api/juntas', { complejo_id: d.complejoA.id, desde: dia(-5), miembros: miembros(['eva', 'presidente']) });
    assert.equal(condo.status, 201, condo.texto);
  });

  it('una persona no puede estar en dos juntas vigentes (el reflejo del usuario es uno solo)', async () => {
    await juntaBlock1();
    const r = await llama(T.adminA, 'POST', '/api/juntas', { complejo_id: d.complejoA.id, desde: dia(-5), miembros: miembros(['ana', 'presidente']) });
    assert.equal(r.status, 422, r.texto);
    assert.match(r.texto, /Block 1/);
  });

  it('los medios que el block ya tenía pasan a ser la cuenta de la junta; con `medio` se crea la cuenta; todo medio nuevo queda en la junta vigente', async () => {
    const previo = await prisma.medioPago.create({ data: { complejo_id: d.complejoA.id, estructura_id: e1.id, tipo: 'yape', celular: '+51 987 654 321', titular: 'Ana' } });
    const otroBlock = await prisma.medioPago.create({ data: { complejo_id: d.complejoA.id, estructura_id: e2.id, tipo: 'yape', celular: '+51 987 654 322', titular: 'Eva' } });
    const j = await juntaBlock1({ medio: banco() });
    assert.equal((await prisma.medioPago.findUniqueOrThrow({ where: { id: previo.id } })).junta_id, j.id);
    assert.equal((await prisma.medioPago.findUniqueOrThrow({ where: { id: otroBlock.id } })).junta_id, null);
    assert.equal(j.medios.length, 2);
    // Un medio nuevo por la API del block queda en la junta vigente; en un block sin junta queda suelto como siempre.
    const nuevo = await llama(T.adminA, 'POST', '/api/medios-pago', { ...banco({ titular: 'Otra cuenta' }), complejo_id: d.complejoA.id, estructura_id: e1.id });
    assert.equal(nuevo.status, 201, nuevo.texto);
    assert.equal(nuevo.body.junta.id, j.id);
    assert.equal((await prisma.medioPago.findUniqueOrThrow({ where: { id: nuevo.body.id } })).junta_id, j.id);
    const suelto = await llama(T.adminA, 'POST', '/api/medios-pago', { ...banco(), complejo_id: d.complejoA.id, estructura_id: e2.id });
    assert.equal(suelto.status, 201, suelto.texto);
    assert.equal(suelto.body.junta, null);
    // La junta (presidente) también agrega su cuenta a SU junta
    const tAna = await sesion('ana@test.pe');
    const deAna = await llama(tAna, 'POST', '/api/medios-pago', banco({ titular: 'Cuenta de Ana' }));
    assert.equal(deAna.status, 201, deAna.texto);
    assert.equal(deAna.body.junta.id, j.id);
  });
});

describe('editar la junta vigente (sin nueva gestión)', () => {
  beforeEach(limpiar);

  it('la administración agrega, quita y cambia de cargo; los cargos se reflejan y sólo cierran la sesión de quien cambió', async () => {
    const j = await juntaBlock1();
    const tAna = await sesion('ana@test.pe');
    const tBeto = await sesion('beto@test.pe');
    const tCarla = await sesion('carla@test.pe');
    const tDario = await sesion('dario@test.pe');
    // Ana sigue de presidenta; Beto pasa a vocal; Carla sale; Darío pasa a tesorero; nadie entra
    const r = await llama(T.adminA, 'PUT', `/api/juntas/${j.id}`, { miembros: miembros(['ana', 'presidente'], ['beto', 'vocal'], ['dario', 'tesorero']), notas: 'Cambio de tesorero' });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.body.miembros.map((m: { nombre: string; cargo: string }) => `${m.cargo}:${m.nombre}`), ['presidente:Ana Presidenta', 'tesorero:Darío Vocal', 'vocal:Beto Tesorero']);
    assert.equal(r.body.notas, 'Cambio de tesorero');
    const cargo = async (u: string) => (await prisma.usuario.findUniqueOrThrow({ where: { id: U[u]! } })).cargo_junta;
    assert.equal(await cargo('ana'), 'presidente');
    assert.equal(await cargo('beto'), 'vocal');
    assert.equal(await cargo('carla'), null); // salió: pierde el cargo
    assert.equal(await cargo('dario'), 'tesorero');
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: U.carla! } })).estructura_id, null);
    assert.equal((await llama(tAna, 'GET', '/api/auth/me')).status, 200); // no cambió: sigue dentro
    assert.equal((await llama(tBeto, 'GET', '/api/auth/me')).status, 401);
    assert.equal((await llama(tCarla, 'GET', '/api/auth/me')).status, 401);
    assert.equal((await llama(tDario, 'GET', '/api/auth/me')).status, 401);
    // Carla ya no ve nada y Darío, ahora tesorero, sí
    assert.equal((await llama(await sesion('carla@test.pe'), 'GET', '/api/juntas')).status, 403);
    assert.equal((await llama(await sesion('dario@test.pe'), 'GET', '/api/medios-pago')).status, 200);
    // Entra alguien nuevo y el que estaba en otra junta no
    assert.equal((await llama(T.adminA, 'PUT', `/api/juntas/${j.id}`, { miembros: miembros(['ana', 'presidente'], ['carla', 'secretario']) })).status, 200);
    assert.equal(await cargo('carla'), 'secretario');
    assert.equal(await cargo('dario'), null);
    assert.equal(await prisma.miembroJunta.count({ where: { junta_id: j.id } }), 2);
  });

  it('con miembros inválidos no cambia nada (todo o nada)', async () => {
    const j = await juntaBlock1();
    const r = await llama(T.adminA, 'PUT', `/api/juntas/${j.id}`, { correo: 'otro@ejemplo.test', miembros: miembros(['ana', 'presidente'], ['eva', 'vocal']) });
    assert.equal(r.status, 422, r.texto);
    const despues = await prisma.juntaDirectiva.findUniqueOrThrow({ where: { id: j.id }, include: { miembros: true } });
    assert.equal(despues.correo, 'junta.b1@ejemplo.test');
    assert.equal(despues.miembros.length, 4);
    assert.equal((await llama(T.adminA, 'PUT', `/api/juntas/${j.id}`, { correo: 'no-es-un-correo' })).status, 422);
  });

  it('una gestión cerrada es historia: no se edita (422)', async () => {
    const j = await juntaBlock1();
    const n = await llama(T.adminA, 'POST', `/api/juntas/${j.id}/nueva-gestion`, { desde: dia(-10), miembros: miembros(['ana', 'presidente']) });
    assert.equal(n.status, 201, n.texto);
    const r = await llama(T.adminA, 'PUT', `/api/juntas/${j.id}`, { correo: 'tarde@ejemplo.test' });
    assert.equal(r.status, 422, r.texto);
    assert.match(r.texto, /terminó/);
    assert.equal((await prisma.juntaDirectiva.findUniqueOrThrow({ where: { id: j.id } })).correo, 'junta.b1@ejemplo.test');
    assert.equal((await llama(T.adminA, 'PUT', `/api/juntas/${j.id}`, { miembros: [] })).status, 422);
  });
});

describe('nueva gestión', () => {
  beforeEach(limpiar);

  it('cierra la anterior el día antes de `desde`, abre la nueva y pasa los cargos; las sesiones de quien cambió se cierran', async () => {
    const j = await juntaBlock1({ medio: banco() });
    const tAna = await sesion('ana@test.pe');
    const tBeto = await sesion('beto@test.pe');
    const r = await llama(T.adminA, 'POST', `/api/juntas/${j.id}/nueva-gestion`, {
      desde: dia(-5), correo: 'nueva.junta@ejemplo.test', notas: 'Gestión 2', miembros: miembros(['carla', 'presidente'], ['dario', 'tesorero'], ['beto', 'vocal']),
    });
    assert.equal(r.status, 201, r.texto);
    assert.notEqual(r.body.id, j.id);
    assert.equal(r.body.desde, dia(-5));
    assert.equal(r.body.hasta, null);
    assert.equal(r.body.vigente, true);
    assert.equal(r.body.correo, 'nueva.junta@ejemplo.test');
    assert.deepEqual(r.body.miembros.map((m: { cargo: string }) => m.cargo), ['presidente', 'tesorero', 'vocal']);
    assert.equal(r.body.medios.length, 0); // sin `misma_cuenta` ni `medio`, la nueva gestión empieza sin cuenta
    const vieja = await prisma.juntaDirectiva.findUniqueOrThrow({ where: { id: j.id } });
    assert.equal(vieja.hasta?.toISOString().slice(0, 10), dia(-6)); // el día anterior
    assert.equal(vieja.desde.toISOString().slice(0, 10), dia(-400));
    assert.equal(await prisma.juntaDirectiva.count({ where: { estructura_id: e1.id, hasta: null } }), 1); // una sola vigente
    // Los cargos pasaron
    const cargo = async (u: string) => (await prisma.usuario.findUniqueOrThrow({ where: { id: U[u]! } })).cargo_junta;
    assert.equal(await cargo('ana'), null);
    assert.equal(await cargo('carla'), 'presidente');
    assert.equal(await cargo('dario'), 'tesorero');
    assert.equal(await cargo('beto'), 'vocal');
    assert.equal((await llama(tAna, 'GET', '/api/auth/me')).status, 401);
    assert.equal((await llama(tBeto, 'GET', '/api/auth/me')).status, 401);
    // La expresidenta ya no gestiona nada; la nueva sí
    assert.equal((await llama(await sesion('ana@test.pe'), 'GET', '/api/medios-pago')).status, 403);
    assert.equal((await llama(await sesion('carla@test.pe'), 'GET', '/api/medios-pago')).status, 200);
    assert.equal((await llama(await sesion('ana@test.pe'), 'GET', `/api/juntas/${j.id}`)).status, 403);
  });

  it('las cuentas de la gestión anterior pasan a inactivas: los vecinos ya no las ven; la nueva junta empieza sin cuenta', async () => {
    const j = await juntaBlock1({ medio: banco() });
    const cargo = await prisma.reciboConceptoUnidad.findFirstOrThrow({ where: { unidad_id: d.unidadA1.id } });
    const veVecino = async () => (await llama(T.prop1, 'GET', `/api/me/medios-pago?cargo_id=${cargo.id}`)).body as { numero_cuenta: string }[];
    assert.equal((await veVecino()).length, 1);
    const r = await llama(T.adminA, 'POST', `/api/juntas/${j.id}/nueva-gestion`, { desde: dia(-5), miembros: miembros(['carla', 'presidente']) });
    assert.equal(r.status, 201, r.texto);
    assert.equal((await veVecino()).length, 0);
    const viejos = await prisma.medioPago.findMany({ where: { junta_id: j.id } });
    assert.equal(viejos.length, 1); // el viejo queda en el historial
    assert.equal(viejos[0]!.activo, false);
  });

  it('con `misma_cuenta` se COPIA la cuenta (registro nuevo, con su QR) a la nueva junta y el viejo queda inactivo en el historial', async () => {
    const j = await juntaBlock1({ medio: banco() });
    const qr = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const viejo = j.medios[0]!;
    await prisma.medioPago.update({ where: { id: viejo.id }, data: { qr_nombre: 'qr.png', qr_tipo_mime: 'image/png', qr_datos: qr } });
    const r = await llama(T.adminA, 'POST', `/api/juntas/${j.id}/nueva-gestion`, { desde: dia(-5), miembros: miembros(['carla', 'presidente']), misma_cuenta: true });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.medios.length, 1);
    const copia = r.body.medios[0];
    assert.notEqual(copia.id, viejo.id);
    assert.equal(copia.activo, true);
    assert.equal(copia.numero_cuenta, '19412345678901');
    assert.equal(copia.titular, 'Junta Block 1');
    assert.equal(copia.tiene_qr, true);
    assert.equal(copia.junta_id, r.body.id);
    const enBase = await prisma.medioPago.findUniqueOrThrow({ where: { id: copia.id } });
    assert.ok(Buffer.from(enBase.qr_datos!).equals(qr));
    assert.equal(enBase.junta_id, r.body.id);
    const original = await prisma.medioPago.findUniqueOrThrow({ where: { id: viejo.id } });
    assert.equal(original.activo, false);
    assert.equal(original.junta_id, j.id);
    // Los vecinos ven la cuenta copiada (una sola vez)
    const cargo = await prisma.reciboConceptoUnidad.findFirstOrThrow({ where: { unidad_id: d.unidadA1.id } });
    const visibles = (await llama(T.prop1, 'GET', `/api/me/medios-pago?cargo_id=${cargo.id}`)).body;
    assert.equal(visibles.length, 1);
    assert.equal(visibles[0].id, copia.id);
  });

  it('con `medio` crea una cuenta nueva; `misma_cuenta` y `medio` a la vez → 422', async () => {
    const j = await juntaBlock1({ medio: banco() });
    const ambas = await llama(T.adminA, 'POST', `/api/juntas/${j.id}/nueva-gestion`, { desde: dia(-5), miembros: [], misma_cuenta: true, medio: banco() });
    assert.equal(ambas.status, 422, ambas.texto);
    assert.equal((await prisma.juntaDirectiva.findUniqueOrThrow({ where: { id: j.id } })).hasta, null); // nada cambió
    const r = await llama(T.adminA, 'POST', `/api/juntas/${j.id}/nueva-gestion`, { desde: dia(-5), miembros: [], medio: banco({ numero_cuenta: '00998877665544', titular: 'Junta nueva' }) });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.medios.length, 1);
    assert.equal(r.body.medios[0].titular, 'Junta nueva');
    assert.equal(r.body.medios[0].activo, true);
  });

  it('valida la fecha: no futura, posterior al inicio de la vigente; y los miembros', async () => {
    const j = await juntaBlock1();
    const intento = (cuerpo: Record<string, unknown>) => llama(T.adminA, 'POST', `/api/juntas/${j.id}/nueva-gestion`, { miembros: [], ...cuerpo });
    assert.equal((await intento({ desde: dia(1) })).status, 422); // futura
    assert.equal((await intento({ desde: dia(-400) })).status, 422); // igual al inicio de la vigente
    assert.equal((await intento({ desde: dia(-401) })).status, 422); // anterior
    assert.equal((await intento({ desde: 'ayer' })).status, 422);
    assert.equal((await intento({ desde: dia(-5), miembros: miembros(['ana', 'presidente'], ['beto', 'presidente']) })).status, 422); // dos presidentes
    assert.equal((await intento({ desde: dia(-5), miembros: miembros(['eva', 'presidente']) })).status, 422); // no es del block
    assert.equal((await intento({ desde: dia(-5), miembros: [{ usuario_id: U.inq1, cargo: 'vocal' }] })).status, 422); // inquilino
    // Nada cambió
    assert.equal(await prisma.juntaDirectiva.count(), 1);
    assert.equal((await prisma.juntaDirectiva.findUniqueOrThrow({ where: { id: j.id } })).hasta, null);
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: U.ana! } })).cargo_junta, 'presidente');
    // El día siguiente al inicio de la vigente es el más temprano posible: la vigente queda de un solo día
    const ok = await intento({ desde: dia(-399) });
    assert.equal(ok.status, 201, ok.texto);
    assert.equal((await prisma.juntaDirectiva.findUniqueOrThrow({ where: { id: j.id } })).hasta?.toISOString().slice(0, 10), dia(-400));
    // La vigente ahora es la nueva; sobre la vieja ya no se puede
    assert.equal((await llama(T.adminA, 'POST', `/api/juntas/${j.id}/nueva-gestion`, { desde: dia(-1), miembros: [] })).status, 422);
  });

  it('la cuenta de una gestión cerrada no se edita ni se reactiva ni se borra (422), y no sale en la lista de medios; el historial la conserva', async () => {
    const j = await juntaBlock1({ medio: banco() });
    const viejo = j.medios[0]!.id;
    const n = await llama(T.adminA, 'POST', `/api/juntas/${j.id}/nueva-gestion`, { desde: dia(-5), miembros: miembros(['carla', 'presidente']), misma_cuenta: true });
    assert.equal(n.status, 201, n.texto);
    assert.equal((await llama(T.adminA, 'PATCH', `/api/medios-pago/${viejo}`, { activo: true })).status, 422);
    assert.equal((await llama(T.adminA, 'PUT', `/api/medios-pago/${viejo}`, banco({ titular: 'Otro' }))).status, 422);
    assert.equal((await llama(T.adminA, 'DELETE', `/api/medios-pago/${viejo}`)).status, 422);
    assert.equal((await prisma.medioPago.findUniqueOrThrow({ where: { id: viejo } })).activo, false);
    const lista = await llama(T.adminA, 'GET', `/api/medios-pago?estructura_id=${e1.id}`);
    assert.deepEqual(lista.body.items.map((m: { id: number }) => m.id), [n.body.medios[0].id]);
    // Historial: la gestión anterior con sus miembros, correo y cuenta (sólo lectura)
    const h = await llama(T.adminA, 'GET', `/api/juntas/historial?complejo_id=${d.complejoA.id}&estructura_id=${e1.id}`);
    assert.equal(h.status, 200, h.texto);
    assert.equal(h.body.items.length, 1);
    assert.equal(h.body.items[0].id, j.id);
    assert.equal(h.body.items[0].hasta, dia(-6));
    assert.equal(h.body.items[0].vigente, false);
    assert.equal(h.body.items[0].correo, 'junta.b1@ejemplo.test');
    assert.equal(h.body.items[0].miembros.length, 4);
    assert.deepEqual(h.body.items[0].medios.map((m: { id: number }) => m.id), [viejo]);
  });

  it('un presidente actual ve el historial de SU block; el de otro block no', async () => {
    const j = await juntaBlock1();
    await llama(T.adminA, 'POST', `/api/juntas/${j.id}/nueva-gestion`, { desde: dia(-5), miembros: miembros(['ana', 'presidente']) });
    const eva = await llama(T.adminA, 'POST', '/api/juntas', { complejo_id: d.complejoA.id, estructura_id: e2.id, desde: dia(-30), miembros: miembros(['eva', 'presidente']) });
    assert.equal(eva.status, 201, eva.texto);
    const url = `/api/juntas/historial?complejo_id=${d.complejoA.id}&estructura_id=${e1.id}`;
    assert.equal((await llama(await sesion('ana@test.pe'), 'GET', url)).body.items.length, 1);
    assert.equal((await llama(await sesion('eva@test.pe'), 'GET', url)).body.items.length, 0);
    const lista = await llama(T.adminA, 'GET', '/api/juntas');
    const ficha = lista.body.items.find((i: { estructura: { id: number } | null }) => i.estructura?.id === e1.id);
    assert.equal(ficha.anteriores, 1);
    assert.equal(ficha.vigente.id !== j.id, true);
  });

  it('queda en la auditoría sin correos ni teléfonos', async () => {
    const j = await juntaBlock1();
    const antes = (await prisma.auditoria.aggregate({ _max: { id: true } }))._max.id ?? 0;
    const r = await llama(T.adminA, 'POST', `/api/juntas/${j.id}/nueva-gestion`, { desde: dia(-5), correo: 'secreto@ejemplo.test', miembros: miembros(['carla', 'presidente']) });
    assert.equal(r.status, 201, r.texto);
    const fila = await prisma.auditoria.findFirst({ where: { id: { gt: antes }, entidad: 'junta', accion: 'nueva_gestion' } });
    assert.ok(fila);
    assert.equal(fila.entidad_id, r.body.id);
    assert.doesNotMatch(JSON.stringify(fila.detalle), /secreto@|test\.pe|987/);
  });
});

describe('el usuario ya no lleva el cargo a mano', () => {
  beforeEach(limpiar);

  it('quien deja de ser propietario sale de la junta vigente y pierde el cargo; el resto de la junta sigue', async () => {
    const j = await juntaBlock1();
    const r = await llama(T.adminA, 'PUT', `/api/usuarios/${U.beto}`, { rol: 'inquilino' });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.cargo_junta, null);
    assert.equal(await prisma.miembroJunta.count({ where: { junta_id: j.id, usuario_id: U.beto } }), 0);
    assert.equal(await prisma.miembroJunta.count({ where: { junta_id: j.id } }), 3);
    // Una edición posterior de la junta no le devuelve el cargo
    await llama(T.adminA, 'PUT', `/api/juntas/${j.id}`, { correo: 'otra@ejemplo.test' });
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: U.beto! } })).cargo_junta, null);
    // Deja a Beto como estaba: propietario de su departamento
    await prisma.usuario.update({ where: { id: U.beto! }, data: { rol: 'propietario' } });
    await prisma.unidad.updateMany({ where: { inquilino_id: U.beto }, data: { inquilino_id: null, propietario_id: U.beto } });
  });

  it('la torre con juntas registradas no se puede borrar (se perdería el historial)', async () => {
    const extra = await prisma.estructura.create({ data: { nombre: 'Block 9', tipo: 'Block', complejo_id: d.complejoA.id } });
    const r = await llama(T.adminA, 'POST', '/api/juntas', { complejo_id: d.complejoA.id, estructura_id: extra.id, desde: dia(-5) });
    assert.equal(r.status, 201, r.texto);
    const del = await llama(T.adminA, 'DELETE', `/api/estructuras/${extra.id}`);
    assert.equal(del.status, 422, del.texto);
    assert.match(del.texto, /juntas directivas/);
    assert.equal(await prisma.juntaDirectiva.count({ where: { estructura_id: extra.id } }), 1);
    await prisma.juntaDirectiva.deleteMany({ where: { estructura_id: extra.id } });
    await prisma.estructura.delete({ where: { id: extra.id } }); // no deja el block de más a las otras pruebas
  });
});

describe('candidatos y lista', () => {
  beforeEach(limpiar);

  it('los candidatos son los propietarios del block, con su departamento y la junta donde ya están', async () => {
    const j = await juntaBlock1();
    const r = await llama(T.adminA, 'GET', `/api/juntas/candidatos?complejo_id=${d.complejoA.id}&estructura_id=${e1.id}`);
    assert.equal(r.status, 200, r.texto);
    const nombres = r.body.items.map((c: { nombre: string }) => c.nombre);
    assert.ok(nombres.includes('Ana Presidenta') && nombres.includes('Propietario 1'));
    assert.ok(!nombres.includes('Eva del Block 2') && !nombres.includes('Inquilino 1') && !nombres.includes('Propietario B'));
    const ana = r.body.items.find((c: { nombre: string }) => c.nombre === 'Ana Presidenta');
    assert.deepEqual(ana.departamentos, ['B01-201']);
    assert.equal(ana.junta_vigente_id, j.id);
    assert.equal(r.body.items.find((c: { nombre: string }) => c.nombre === 'Propietario 1').junta_vigente_id, null);
  });

  it('la lista trae una ficha por block (con o sin junta) y la del condominio sólo si existe', async () => {
    await juntaBlock1();
    const r = await llama(T.adminA, 'GET', `/api/juntas?complejo_id=${d.complejoA.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.puede_gestionar, true);
    assert.deepEqual(r.body.items.map((i: { estructura: { nombre: string } | null }) => i.estructura?.nombre), ['Block 1', 'Block 2']);
    assert.equal(r.body.items[0].vigente.miembros.length, 4);
    assert.equal(r.body.items[1].vigente, null);
    assert.deepEqual(r.body.complejos, [{ id: d.complejoA.id, nombre: 'Complejo A' }]);
  });
});
