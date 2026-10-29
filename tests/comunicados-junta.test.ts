// La junta (presidente/tesorero) también maneja Proveedores y ve Avisos, acotada a su ámbito. Secretario y vocal no.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { esperar, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let e1: { id: number };
let e2: { id: number };
let eB: { id: number };
let complejoA2: { id: number };
let P: Record<'propio' | 'compartido' | 'deA2' | 'deB', number>;
type Clave = 'presi1' | 'tesor1' | 'presiTodo' | 'secre1' | 'vocal1' | 'presi2' | 'presiB';
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1' | 'inq1' | Clave, string>;

before(async () => {
  d = await sembrar();
  e1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
  e2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'Block', complejo_id: d.complejoA.id } });
  eB = await prisma.estructura.create({ data: { nombre: 'Block B', tipo: 'Block', complejo_id: d.complejoB.id } });
  complejoA2 = await prisma.complejoHabitacional.create({ data: { nombre: 'Complejo A2', tipo: 'Edificio', empresa_id: d.empresaA.id } });
  await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: e1.id } }); // prop1 e inq1
  await prisma.unidad.update({ where: { id: d.unidadA2.id }, data: { estructura_id: e2.id } }); // prop2
  await prisma.unidad.update({ where: { id: d.unidadB1.id }, data: { estructura_id: eB.id } }); // propB
  const hash = await bcrypt.hash(PASSWORD, 4);
  const junta = (nombre: string, email: string, cargo: string, complejo: { id: number; empresa_id: number | null }, estructura_id: number | null) =>
    prisma.usuario.create({ data: { nombre, email, rol: 'propietario', password_hash: hash, empresa_id: complejo.empresa_id, complejo_id: complejo.id, cargo_junta: cargo, estructura_id } });
  await junta('Presidente 1', 'presi1@test.pe', 'presidente', d.complejoA, e1.id);
  await junta('Tesorero 1', 'tesor1@test.pe', 'tesorero', d.complejoA, e1.id);
  await junta('Presidente Todo', 'presitodo@test.pe', 'presidente', d.complejoA, null);
  await junta('Secretario 1', 'secre1@test.pe', 'secretario', d.complejoA, e1.id);
  await junta('Vocal 1', 'vocal1@test.pe', 'vocal', d.complejoA, e1.id);
  await junta('Presidente 2', 'presi2@test.pe', 'presidente', d.complejoA, e2.id);
  await junta('Presidente B', 'presib@test.pe', 'presidente', d.complejoB, eB.id);
  const prov = (empresa_id: number, razon_social: string, complejos: number[]) =>
    prisma.proveedor.create({ data: { empresa_id, razon_social, rubro: 'ascensores', complejos: { create: complejos.map((complejo_id) => ({ complejo_id })) } } }).then((p) => p.id);
  P = {
    propio: await prov(d.empresaA.id, 'Ascensores Propios SAC', [d.complejoA.id]),
    compartido: await prov(d.empresaA.id, 'Gasfitería Compartida', [d.complejoA.id, complejoA2.id]),
    deA2: await prov(d.empresaA.id, 'Pintura del Otro Condominio', [complejoA2.id]),
    deB: await prov(d.empresaB.id, 'Proveedor de la Empresa B', [d.complejoB.id]),
  };
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    super: await login(base, 'super@test.pe'),
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    prop1: await login(base, 'prop1@test.pe'),
    inq1: await login(base, 'inq1@test.pe'),
    presi1: await login(base, 'presi1@test.pe'),
    tesor1: await login(base, 'tesor1@test.pe'),
    presiTodo: await login(base, 'presitodo@test.pe'),
    secre1: await login(base, 'secre1@test.pe'),
    vocal1: await login(base, 'vocal1@test.pe'),
    presi2: await login(base, 'presi2@test.pe'),
    presiB: await login(base, 'presib@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

const llama = (t: string | null, metodo: string, ruta: string, cuerpo?: unknown) => llamar(base, metodo, ruta, t, cuerpo);
const razones = (r: { body: { items: { razon_social: string }[] } }) => r.body.items.map((i) => i.razon_social).sort();
const proveedorNuevo = (extra: Record<string, unknown> = {}) => ({ razon_social: 'Cerrajería Rápida', rubro: 'cerrajeria', telefono: '987654321', ...extra });

describe('junta: Proveedores', () => {
  beforeEach(async () => {
    // Deja los cuatro de `before` y borra los que crean las pruebas.
    await prisma.proveedor.deleteMany({ where: { id: { notIn: Object.values(P) } } });
    await prisma.proveedor.update({ where: { id: P.propio }, data: { razon_social: 'Ascensores Propios SAC', activo: true, telefono: null } });
    await prisma.proveedor.update({ where: { id: P.compartido }, data: { razon_social: 'Gasfitería Compartida', activo: true } });
  });

  it('presidente y tesorero listan los vinculados a SU condominio (exclusivos y compartidos), también los de un block ajeno de su condominio; nunca los de otros condominios', async () => {
    for (const t of ['presi1', 'tesor1', 'presiTodo', 'presi2'] as const) {
      assert.deepEqual(razones(await llama(T[t], 'GET', '/api/proveedores')), ['Ascensores Propios SAC', 'Gasfitería Compartida'], t);
    }
    assert.deepEqual(razones(await llama(T.presiB, 'GET', '/api/proveedores')), ['Proveedor de la Empresa B']);
    for (const id of [P.deA2, P.deB]) assert.equal((await llama(T.presi1, 'GET', `/api/proveedores/${id}`)).status, 404, 'otro condominio = 404');
    assert.equal((await llama(T.presi1, 'GET', `/api/proveedores/${P.propio}`)).status, 200);
    assert.equal((await llama(T.presi1, 'GET', `/api/proveedores?complejo_id=${complejoA2.id}`)).body.total, 2, 'pedir otro condominio por filtro no le abre nada');
  });

  it('del compartido sólo ve SU condominio (no el nombre de los demás) y viene marcado `compartido`', async () => {
    const lista = (await llama(T.presi1, 'GET', '/api/proveedores')).body.items as { razon_social: string; compartido: boolean; complejos: { id: number; nombre: string }[] }[];
    const comp = lista.find((p) => p.razon_social === 'Gasfitería Compartida')!;
    assert.equal(comp.compartido, true);
    assert.deepEqual(comp.complejos.map((c) => c.id), [d.complejoA.id]);
    const propio = lista.find((p) => p.razon_social === 'Ascensores Propios SAC')!;
    assert.equal(propio.compartido, false);
    const detalle = (await llama(T.presi1, 'GET', `/api/proveedores/${P.compartido}`)).body;
    assert.ok(!JSON.stringify(detalle).includes('Complejo A2'), 'no se revela el otro condominio');
  });

  it('secretario, vocal y los residentes: 403 en todo', async () => {
    for (const t of ['secre1', 'vocal1', 'prop1', 'inq1'] as const) {
      assert.equal((await llama(T[t], 'GET', '/api/proveedores')).status, 403, `${t} lista`);
      assert.equal((await llama(T[t], 'GET', `/api/proveedores/${P.propio}`)).status, 403, `${t} ver`);
      assert.equal((await llama(T[t], 'POST', '/api/proveedores', proveedorNuevo())).status, 403, `${t} crear`);
      assert.equal((await llama(T[t], 'PUT', `/api/proveedores/${P.propio}`, { activo: false })).status, 403, `${t} editar`);
      assert.equal((await llama(T[t], 'DELETE', `/api/proveedores/${P.propio}`)).status, 403, `${t} eliminar`);
    }
    assert.equal((await prisma.proveedor.findUniqueOrThrow({ where: { id: P.propio } })).activo, true);
    assert.equal(await prisma.proveedor.count({ where: { razon_social: 'Cerrajería Rápida' } }), 0);
  });

  it('crea: queda en la empresa administradora del condominio y vinculado SÓLO a su condominio', async () => {
    const r = await llama(T.presi1, 'POST', '/api/proveedores', proveedorNuevo());
    assert.equal(r.status, 201, r.texto);
    const fila = await prisma.proveedor.findUniqueOrThrow({ where: { id: r.body.id }, include: { complejos: true } });
    assert.equal(fila.empresa_id, d.empresaA.id);
    assert.deepEqual(fila.complejos.map((c) => c.complejo_id), [d.complejoA.id]);
    assert.equal(r.body.compartido, false);
    // La administración lo ve en su lista (es de su empresa) y la junta de otro condominio, no.
    assert.ok(razones(await llama(T.adminA, 'GET', '/api/proveedores')).includes('Cerrajería Rápida'));
    assert.ok(!razones(await llama(T.presiB, 'GET', '/api/proveedores')).includes('Cerrajería Rápida'));
    // Nombrar su propio condominio está bien; cualquier otro (aunque sea de la misma empresa) o `empresa_id` ajeno no cambia nada.
    const ok = await llama(T.tesor1, 'POST', '/api/proveedores', proveedorNuevo({ razon_social: 'Con su condominio', complejo_ids: [d.complejoA.id], empresa_id: d.empresaB.id }));
    assert.equal(ok.status, 201, ok.texto);
    const f2 = await prisma.proveedor.findUniqueOrThrow({ where: { id: ok.body.id }, include: { complejos: true } });
    assert.equal(f2.empresa_id, d.empresaA.id, 'el `empresa_id` que mande no cuenta');
    assert.deepEqual(f2.complejos.map((c) => c.complejo_id), [d.complejoA.id]);
  });

  it('no puede vincular el proveedor a otros condominios (422) y la validación de siempre se mantiene', async () => {
    for (const ids of [[complejoA2.id], [d.complejoA.id, complejoA2.id], [d.complejoB.id]]) {
      assert.equal((await llama(T.presi1, 'POST', '/api/proveedores', proveedorNuevo({ razon_social: 'Colado', complejo_ids: ids }))).status, 422, JSON.stringify(ids));
    }
    assert.equal(await prisma.proveedor.count({ where: { razon_social: 'Colado' } }), 0);
    assert.equal((await llama(T.presi1, 'POST', '/api/proveedores', proveedorNuevo({ razon_social: '' }))).status, 422);
    assert.equal((await llama(T.presi1, 'POST', '/api/proveedores', proveedorNuevo({ ruc: '123' }))).status, 422);
  });

  it('edita y desactiva los que atienden SÓLO a su condominio; los vínculos no se mueven', async () => {
    const r = await llama(T.presi1, 'PUT', `/api/proveedores/${P.propio}`, { telefono: '999888777', activo: false });
    assert.equal(r.status, 200, r.texto);
    const fila = await prisma.proveedor.findUniqueOrThrow({ where: { id: P.propio }, include: { complejos: true } });
    assert.equal(fila.activo, false);
    assert.match(fila.telefono ?? '', /999 888 777/);
    assert.equal((await llama(T.tesor1, 'PATCH', `/api/proveedores/${P.propio}`, { activo: true })).status, 200);
    assert.equal((await llama(T.presi1, 'PUT', `/api/proveedores/${P.propio}`, { complejo_ids: [d.complejoA.id] })).status, 200);
    assert.equal((await llama(T.presi1, 'PUT', `/api/proveedores/${P.propio}`, { complejo_ids: [complejoA2.id] })).status, 422, 'no lo reparte a otros condominios');
    assert.equal((await llama(T.presi1, 'PUT', `/api/proveedores/${P.propio}`, { complejo_ids: [] })).status, 200);
    assert.deepEqual((await prisma.proveedorComplejo.findMany({ where: { proveedor_id: P.propio } })).map((c) => c.complejo_id), [d.complejoA.id], 'sigue vinculado a su condominio');
    assert.equal((await prisma.proveedor.findUniqueOrThrow({ where: { id: P.propio } })).empresa_id, d.empresaA.id);
  });

  it('el compartido con otros condominios es de sólo lectura: 403 al editar, desactivar o eliminar (y no cambia)', async () => {
    for (const metodo of ['PUT', 'PATCH'] as const) {
      const r = await llama(T.presi1, metodo, `/api/proveedores/${P.compartido}`, { razon_social: 'Cambiado', activo: false });
      assert.equal(r.status, 403, `${metodo}: ${r.texto}`);
    }
    assert.equal((await llama(T.presiTodo, 'PUT', `/api/proveedores/${P.compartido}`, { activo: false })).status, 403);
    assert.equal((await llama(T.presi1, 'DELETE', `/api/proveedores/${P.compartido}`)).status, 403);
    const fila = await prisma.proveedor.findUniqueOrThrow({ where: { id: P.compartido }, include: { complejos: true } });
    assert.equal(fila.razon_social, 'Gasfitería Compartida');
    assert.equal(fila.activo, true);
    assert.equal(fila.complejos.length, 2, 'sus vínculos siguen intactos');
    // La administración sí lo cambia.
    assert.equal((await llama(T.adminA, 'PUT', `/api/proveedores/${P.compartido}`, { razon_social: 'Gasfitería (admin)' })).status, 200);
  });

  it('la junta no elimina (ni siquiera los suyos: se desactivan) y no toca lo de otro condominio (404)', async () => {
    const r = await llama(T.presi1, 'DELETE', `/api/proveedores/${P.propio}`);
    assert.equal(r.status, 403);
    assert.equal(await prisma.proveedor.count({ where: { id: P.propio } }), 1);
    for (const id of [P.deA2, P.deB]) {
      assert.equal((await llama(T.presi1, 'PUT', `/api/proveedores/${id}`, { activo: false })).status, 404, `PUT ${id}`);
      assert.equal((await llama(T.presi1, 'DELETE', `/api/proveedores/${id}`)).status, 404, `DELETE ${id}`);
    }
    assert.equal((await llama(T.presiB, 'PUT', `/api/proveedores/${P.propio}`, { activo: false })).status, 404, 'la junta de otro condominio');
    assert.equal((await prisma.proveedor.findUniqueOrThrow({ where: { id: P.deA2 } })).activo, true);
    assert.equal((await prisma.proveedor.findUniqueOrThrow({ where: { id: P.deB } })).activo, true);
  });

  it('un proveedor creado por la junta que luego comparte la administración pasa a sólo lectura para ella', async () => {
    const r = await llama(T.presi1, 'POST', '/api/proveedores', proveedorNuevo({ razon_social: 'Se comparte luego' }));
    assert.equal(r.status, 201);
    assert.equal((await llama(T.adminA, 'PUT', `/api/proveedores/${r.body.id}`, { complejo_ids: [d.complejoA.id, complejoA2.id] })).status, 200);
    assert.equal((await llama(T.presi1, 'PUT', `/api/proveedores/${r.body.id}`, { activo: false })).status, 403);
    assert.equal((await llama(T.presi1, 'GET', `/api/proveedores/${r.body.id}`)).body.compartido, true);
  });

  it('la administración sigue igual: lista los suyos con todos sus condominios, crea, edita y elimina; la otra empresa no ve los de A', async () => {
    const lista = (await llama(T.adminA, 'GET', '/api/proveedores')).body.items as { razon_social: string; complejos: { nombre: string }[]; compartido?: boolean }[];
    assert.deepEqual(lista.map((p) => p.razon_social).sort(), ['Ascensores Propios SAC', 'Gasfitería Compartida', 'Pintura del Otro Condominio']);
    assert.deepEqual(lista.find((p) => p.razon_social === 'Gasfitería Compartida')!.complejos.map((c) => c.nombre).sort(), ['Complejo A', 'Complejo A2']);
    assert.equal(lista[0]!.compartido, undefined);
    assert.deepEqual(razones(await llama(T.adminB, 'GET', '/api/proveedores')), ['Proveedor de la Empresa B']);
    const c = await llama(T.adminA, 'POST', '/api/proveedores', proveedorNuevo({ razon_social: 'Nuevo admin', complejo_ids: [d.complejoA.id, complejoA2.id] }));
    assert.equal(c.status, 201, c.texto);
    assert.equal((await llama(T.adminA, 'DELETE', `/api/proveedores/${c.body.id}`)).status, 204);
    assert.equal((await llama(T.adminB, 'PUT', `/api/proveedores/${P.propio}`, { activo: false })).status, 404);
    assert.equal((await llama(T.super, 'GET', '/api/proveedores')).body.total, 4);
  });

  it('crear y editar como junta quedan en la auditoría a nombre de quien los hizo', async () => {
    const r = await llama(T.presi1, 'POST', '/api/proveedores', proveedorNuevo({ razon_social: 'Auditado' }));
    const presi = await prisma.usuario.findUniqueOrThrow({ where: { email: 'presi1@test.pe' } });
    const fila = await esperar(() => prisma.auditoria.findFirst({ where: { entidad: 'proveedor', accion: 'crear', entidad_id: r.body.id } }));
    assert.equal(fila.usuario_id, presi.id);
  });
});

describe('junta: Avisos', () => {
  let aviso: Record<'prop1' | 'inq1' | 'prop2' | 'propB', number>;
  beforeEach(async () => {
    await prisma.notificacion.deleteMany();
    const nueva = async (usuario_id: number, estado: string, extra: Record<string, unknown> = {}) =>
      (await prisma.notificacion.create({ data: { usuario_id, canal: 'email', tipo: 'recibo_emitido', asunto: 'Tu recibo', cuerpo: 'CUERPO-PRIVADO', estado, ...extra } })).id;
    aviso = {
      prop1: await nueva(d.propietario1.id, 'error', { error: 'falló', intentos: 3 }),
      inq1: await nueva(d.inquilino1.id, 'enviada'),
      prop2: await nueva(d.propietario2.id, 'error', { error: 'falló', intentos: 3 }),
      propB: await nueva(d.propietarioB.id, 'omitida', { error: 'Sin celular' }),
    };
  });
  const ids = (r: { body: { items: { id: number }[] } }) => r.body.items.map((i) => i.id).sort((a, b) => a - b);
  const todos = (...xs: number[]) => xs.sort((a, b) => a - b);

  it('la junta de un block ve los avisos de los residentes de SU block (dueños e inquilinos) y nada más', async () => {
    const r = await llama(T.presi1, 'GET', '/api/notificaciones');
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(ids(r), todos(aviso.prop1, aviso.inq1));
    assert.deepEqual(ids(await llama(T.tesor1, 'GET', '/api/notificaciones')), todos(aviso.prop1, aviso.inq1));
    assert.deepEqual(ids(await llama(T.presi2, 'GET', '/api/notificaciones')), todos(aviso.prop2));
    assert.deepEqual(ids(await llama(T.presiB, 'GET', '/api/notificaciones')), todos(aviso.propB));
  });

  it('la junta sin block ve los de todo su condominio; ninguna ve los de otro condominio', async () => {
    assert.deepEqual(ids(await llama(T.presiTodo, 'GET', '/api/notificaciones')), todos(aviso.prop1, aviso.inq1, aviso.prop2));
    assert.ok(!ids(await llama(T.presiTodo, 'GET', '/api/notificaciones')).includes(aviso.propB));
    // Aunque pida el condominio o el block ajeno por filtro, no aparece nada fuera de su ámbito.
    assert.deepEqual((await llama(T.presi1, 'GET', `/api/notificaciones?complejo_id=${d.complejoB.id}`)).body.items, []);
    assert.deepEqual((await llama(T.presi1, 'GET', `/api/notificaciones?estructura_id=${e2.id}`)).body.items, []);
  });

  it('no se filtra el texto de los avisos ni se pueden pedir por id de otro ámbito', async () => {
    const lista = await llama(T.presi1, 'GET', '/api/notificaciones');
    assert.ok(!lista.texto.includes('CUERPO-PRIVADO'));
    assert.equal((await llama(T.presi1, 'GET', `/api/notificaciones/${aviso.prop2}`)).status, 404);
    assert.equal((await llama(T.presi1, 'GET', `/api/notificaciones/${aviso.propB}`)).status, 404);
    assert.equal((await llama(T.presi1, 'GET', `/api/notificaciones/${aviso.prop1}`)).status, 200);
  });

  it('el resumen cuenta sólo los de su ámbito', async () => {
    assert.deepEqual((await llama(T.presi1, 'GET', '/api/notificaciones/resumen')).body, { pendiente: 0, enviada: 1, error: 1, omitida: 0 });
    assert.deepEqual((await llama(T.presiTodo, 'GET', '/api/notificaciones/resumen')).body, { pendiente: 0, enviada: 1, error: 2, omitida: 0 });
    assert.deepEqual((await llama(T.presiB, 'GET', '/api/notificaciones/resumen')).body, { pendiente: 0, enviada: 0, error: 0, omitida: 1 });
  });

  it('puede reintentar un aviso fallido de su ámbito; uno ajeno es 404 y no cambia', async () => {
    const ok = await llama(T.presi1, 'POST', `/api/notificaciones/${aviso.prop1}/reenviar`);
    assert.equal(ok.status, 200, ok.texto);
    assert.equal((await prisma.notificacion.findUniqueOrThrow({ where: { id: aviso.prop1 } })).estado, 'pendiente');
    assert.equal((await llama(T.presi1, 'POST', `/api/notificaciones/${aviso.prop2}/reenviar`)).status, 404);
    assert.equal((await llama(T.presi1, 'POST', `/api/notificaciones/${aviso.propB}/reenviar`)).status, 404);
    assert.equal((await prisma.notificacion.findUniqueOrThrow({ where: { id: aviso.prop2 } })).estado, 'error');
    assert.equal((await prisma.notificacion.findUniqueOrThrow({ where: { id: aviso.propB } })).estado, 'omitida');
  });

  it('no configura canales: /canales es sólo de la administración (403 para la junta)', async () => {
    assert.equal((await llama(T.presi1, 'GET', '/api/notificaciones/canales')).status, 403);
    assert.equal((await llama(T.presiTodo, 'GET', '/api/notificaciones/canales')).status, 403);
    assert.equal((await llama(T.adminA, 'GET', '/api/notificaciones/canales')).status, 200);
  });

  it('secretario, vocal y los residentes: 403 en todo', async () => {
    for (const t of ['secre1', 'vocal1', 'prop1', 'inq1'] as const) {
      for (const ruta of ['/api/notificaciones', '/api/notificaciones/resumen', '/api/notificaciones/canales']) assert.equal((await llama(T[t], 'GET', ruta)).status, 403, `${t} ${ruta}`);
      assert.equal((await llama(T[t], 'POST', `/api/notificaciones/${aviso.prop1}/reenviar`)).status, 403, `${t} reenviar`);
    }
    assert.equal((await prisma.notificacion.findUniqueOrThrow({ where: { id: aviso.prop1 } })).estado, 'error');
  });

  it('la administración sigue viendo los de su empresa (y no los de otra)', async () => {
    assert.deepEqual(ids(await llama(T.adminA, 'GET', '/api/notificaciones')), todos(aviso.prop1, aviso.inq1, aviso.prop2));
    assert.deepEqual(ids(await llama(T.adminB, 'GET', '/api/notificaciones')), todos(aviso.propB));
    assert.equal((await llama(T.super, 'GET', '/api/notificaciones')).body.total, 4);
  });
});
