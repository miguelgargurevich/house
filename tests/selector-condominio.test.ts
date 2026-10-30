// Selector de condominio de la barra superior: la API que lo alimenta (`/api/complejos/selector`) y los listados que lo reciben como
// `complejo_id`. Regla de oro: el condominio pedido sólo ACOTA, nunca reemplaza el alcance de la empresa (uno ajeno no devuelve nada).
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'adminHuerfano' | 'prop1' | 'mttoA', string>;
/** Segundo condominio de la Empresa A: con él se prueba filtrar DENTRO de la misma empresa. */
let complejoA2: { id: number };
let unidadA2: { id: number };
let tareaA2: { id: number };
let tareaSinUnidadA2: { id: number };
let tareaSinUnidadA: { id: number };

const get = (token: string, ruta: string) => llamar(base, 'GET', ruta, token);
const ids = async (token: string, ruta: string) => ((await get(token, ruta)).body.items as { id: number }[]).map(x => x.id).sort((a, b) => a - b);

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  const hash = await bcrypt.hash(PASSWORD, 4);
  complejoA2 = await prisma.complejoHabitacional.create({ data: { nombre: 'Complejo A2', tipo: 'Edificio', empresa_id: d.empresaA.id } });
  const propA2 = await prisma.usuario.create({ data: { nombre: 'Propietario A2', email: 'prop.a2@test.pe', rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: complejoA2.id } });
  unidadA2 = await prisma.unidad.create({ data: { codigo: 'A2-201', tipo: 'Departamento', complejo_id: complejoA2.id, empresa_id: d.empresaA.id, propietario_id: propA2.id, estado: 'activa' } });
  tareaA2 = await prisma.tareaMantenimiento.create({ data: { titulo: 'Tarea de A2', unidad_id: unidadA2.id, creado_por_id: d.adminA.id } });
  // Sin unidad: pertenecen al condominio donde trabaja su responsable.
  const tecnicoA2 = await prisma.usuario.create({ data: { nombre: 'Técnico A2', email: 'tec.a2@test.pe', rol: 'mantenimiento', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: complejoA2.id } });
  tareaSinUnidadA2 = await prisma.tareaMantenimiento.create({ data: { titulo: 'Limpiar tanque de A2', asignado_id: tecnicoA2.id, creado_por_id: d.adminA.id } });
  tareaSinUnidadA = await prisma.tareaMantenimiento.create({ data: { titulo: 'Sin dueño', creado_por_id: d.adminA.id } });
  T = {
    super: await login(base, 'super@test.pe'),
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    adminHuerfano: await login(base, 'admin.huerfano@test.pe'),
    prop1: await login(base, 'prop1@test.pe'),
    mttoA: await login(base, 'mtto.a@test.pe'),
  };
});

after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('GET /api/complejos/selector: los condominios del alcance, ligeros y sin paginar', () => {
  it('la administradora ve SÓLO los de su empresa (con la empresa y ordenados); el de otra empresa no aparece', async () => {
    const r = await get(T.adminA, '/api/complejos/selector');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.items.map((c: { nombre: string }) => c.nombre), ['Complejo A', 'Complejo A2']);
    assert.deepEqual(r.body.items[0], { id: d.complejoA.id, nombre: 'Complejo A', empresa: { id: d.empresaA.id, nombre: 'Empresa A' } });
    assert.equal(r.body.total, 2);
    const b = await get(T.adminB, '/api/complejos/selector');
    assert.deepEqual(b.body.items.map((c: { id: number }) => c.id), [d.complejoB.id]);
  });

  it('el superadmin ve todos, con su empresa para agruparlos (por empresa y luego por nombre)', async () => {
    const r = await get(T.super, '/api/complejos/selector');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.items.map((c: { nombre: string; empresa: { nombre: string } }) => `${c.empresa.nombre} · ${c.nombre}`), ['Empresa A · Complejo A', 'Empresa A · Complejo A2', 'Empresa B · Complejo B']);
  });

  it('sólo la administración: un propietario, el personal y quien no inició sesión no lo piden', async () => {
    assert.equal((await get(T.prop1, '/api/complejos/selector')).status, 403);
    assert.equal((await get(T.mttoA, '/api/complejos/selector')).status, 403);
    assert.equal((await llamar(base, 'GET', '/api/complejos/selector', null)).status, 401);
  });

  it('un admin sin empresa no recibe «todos»: 403 (nunca el catálogo entero)', async () => {
    assert.equal((await get(T.adminHuerfano, '/api/complejos/selector')).status, 403);
  });

  it('no se confunde con /api/complejos/:id (es una ruta propia) y no devuelve campos de más', async () => {
    const r = await get(T.adminA, '/api/complejos/selector');
    assert.deepEqual(Object.keys(r.body.items[0]).sort(), ['empresa', 'id', 'nombre']);
    assert.equal((await get(T.adminA, `/api/complejos/${d.complejoB.id}`)).status, 404);
  });
});

describe('/api/tareas?complejo_id: filtra por condominio sin salirse del alcance de la empresa', () => {
  it('por unidad: el condominio pedido trae sólo sus tareas; sin filtro, todas las de la empresa', async () => {
    assert.deepEqual(await ids(T.adminA, `/api/tareas?complejo_id=${d.complejoA.id}`), [d.tareaA.id, d.tareaOtra.id].sort((a, b) => a - b));
    assert.deepEqual(await ids(T.adminA, `/api/tareas?complejo_id=${complejoA2.id}`), [tareaA2.id, tareaSinUnidadA2.id].sort((a, b) => a - b));
    const todas = await ids(T.adminA, '/api/tareas');
    for (const t of [d.tareaA, d.tareaOtra, tareaA2, tareaSinUnidadA2, tareaSinUnidadA]) assert.ok(todas.includes(t.id), `tarea ${t.id}`);
    assert.ok(!todas.includes(d.tareaB.id), 'la tarea de otra empresa nunca');
  });

  it('una tarea sin unidad cuenta en el condominio de su responsable; la que no es de ninguno sólo sale con «Todos»', async () => {
    const enA2 = await ids(T.adminA, `/api/tareas?complejo_id=${complejoA2.id}`);
    assert.ok(enA2.includes(tareaSinUnidadA2.id));
    assert.ok(!(await ids(T.adminA, `/api/tareas?complejo_id=${d.complejoA.id}`)).includes(tareaSinUnidadA2.id));
    for (const c of [d.complejoA.id, complejoA2.id]) assert.ok(!(await ids(T.adminA, `/api/tareas?complejo_id=${c}`)).includes(tareaSinUnidadA.id));
  });

  it('un condominio de OTRA empresa no devuelve nada (el filtro acota, no reemplaza el alcance)', async () => {
    const r = await get(T.adminA, `/api/tareas?complejo_id=${d.complejoB.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 0);
    assert.deepEqual(await ids(T.adminB, `/api/tareas?complejo_id=${d.complejoA.id}`), []);
    assert.deepEqual(await ids(T.adminB, `/api/tareas?complejo_id=${d.complejoB.id}`), [d.tareaB.id]);
  });

  it('combina con los demás filtros y valida la entrada (zod → 422)', async () => {
    assert.deepEqual(await ids(T.adminA, `/api/tareas?complejo_id=${d.complejoA.id}&estado=completada`), []);
    assert.equal((await get(T.adminA, '/api/tareas?complejo_id=abc')).status, 422);
    assert.equal((await get(T.adminA, '/api/tareas?complejo_id=0')).status, 422);
  });

  it('el personal de mantenimiento sigue viendo sólo SUS tareas, pida el condominio que pida', async () => {
    assert.deepEqual(await ids(T.mttoA, '/api/tareas'), [d.tareaA.id]);
    assert.deepEqual(await ids(T.mttoA, `/api/tareas?complejo_id=${complejoA2.id}`), []);
    assert.deepEqual(await ids(T.mttoA, `/api/tareas?complejo_id=${d.complejoB.id}`), []);
  });
});

describe('/api/recibos/periodos?complejo_id: los periodos donde registrar un pago, del condominio elegido', () => {
  it('filtra por condominio dentro de la empresa y uno ajeno no devuelve nada', async () => {
    const reciboA2 = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: complejoA2.id, mes: 9, anio: 2026, fecha_emision: new Date('2026-09-01'), fecha_vencimiento: new Date('2026-09-15'), estado: 'emitido' } });
    const sin = await ids(T.adminA, '/api/recibos/periodos');
    assert.ok(sin.includes(reciboA2.id) && sin.includes(d.reciboVencidoA.id));
    assert.deepEqual(await ids(T.adminA, `/api/recibos/periodos?complejo_id=${complejoA2.id}`), [reciboA2.id]);
    assert.deepEqual(await ids(T.adminA, `/api/recibos/periodos?complejo_id=${d.complejoA.id}`), [d.reciboVencidoA.id, d.reciboFuturoA.id].sort((a, b) => a - b));
    assert.deepEqual(await ids(T.adminA, `/api/recibos/periodos?complejo_id=${d.complejoB.id}`), [], 'el condominio de otra empresa no devuelve sus periodos');
    assert.equal((await get(T.adminA, '/api/recibos/periodos?complejo_id=xx')).status, 422);
  });
});

describe('/api/notificaciones/resumen sigue al condominio y al block, igual que la lista', () => {
  it('las cifras cuadran con la lista filtrada y un condominio ajeno da todo en cero', async () => {
    const aviso = (usuario_id: number, estado: string) => prisma.notificacion.create({ data: { usuario_id, canal: 'correo', tipo: 'recibo_emitido', estado, asunto: 'Aviso', cuerpo: 'x', programada_para: new Date() } });
    await aviso(d.propietario1.id, 'enviada');
    await aviso(d.propietario1.id, 'error');
    await aviso(d.propietario2.id, 'enviada');
    const propA2 = await prisma.usuario.findFirstOrThrow({ where: { email: 'prop.a2@test.pe' } });
    await aviso(propA2.id, 'pendiente');
    await aviso(d.propietarioB.id, 'enviada');
    const resumen = async (q: string) => (await get(T.adminA, `/api/notificaciones/resumen${q}`)).body;
    assert.deepEqual(await resumen(''), { pendiente: 1, enviada: 2, error: 1, omitida: 0 }, 'sin filtro: la empresa A, nunca el aviso de B');
    assert.deepEqual(await resumen(`?complejo_id=${d.complejoA.id}`), { pendiente: 0, enviada: 2, error: 1, omitida: 0 });
    assert.deepEqual(await resumen(`?complejo_id=${complejoA2.id}`), { pendiente: 1, enviada: 0, error: 0, omitida: 0 });
    assert.deepEqual(await resumen(`?complejo_id=${d.complejoB.id}`), { pendiente: 0, enviada: 0, error: 0, omitida: 0 }, 'el condominio de otra empresa no suma nada');
    // La lista y las cifras dicen lo mismo.
    for (const c of [d.complejoA.id, complejoA2.id, d.complejoB.id]) {
      const lista = (await get(T.adminA, `/api/notificaciones?complejo_id=${c}&pageSize=100`)).body;
      const cifras = await resumen(`?complejo_id=${c}`);
      assert.equal(lista.total, Object.values(cifras).reduce((a: number, b) => a + (b as number), 0), `condominio ${c}`);
    }
    assert.equal((await get(T.adminA, '/api/notificaciones/resumen?complejo_id=zz')).status, 422);
  });
});

describe('barrido: todo listado que recibe el condominio de la barra lo aplica y NO deja ver otra empresa', () => {
  const RUTAS = [
    '/api/recibos', '/api/pagos', '/api/unidades', '/api/reportes/morosidad', '/api/medios-pago', '/api/comunicados', '/api/proveedores',
    '/api/usuarios?tipo=residente', '/api/notificaciones', '/api/estructuras', '/api/tareas', '/api/recibos/periodos',
  ];
  const sep = (r: string) => (r.includes('?') ? '&' : '?');

  it('con el condominio de OTRA empresa, la administradora recibe una lista vacía (200), nunca los datos ajenos', async () => {
    for (const ruta of RUTAS) {
      const r = await get(T.adminA, `${ruta}${sep(ruta)}complejo_id=${d.complejoB.id}`);
      assert.equal(r.status, 200, ruta);
      assert.deepEqual(r.body.items, [], ruta);
    }
  });

  it('y con el condominio propio sí trae datos (el filtro no vacía todo)', async () => {
    for (const ruta of ['/api/recibos', '/api/unidades', '/api/reportes/morosidad', '/api/usuarios?tipo=residente', '/api/tareas', '/api/recibos/periodos']) {
      const r = await get(T.adminA, `${ruta}${sep(ruta)}complejo_id=${d.complejoA.id}`);
      assert.equal(r.status, 200, ruta);
      assert.ok(r.body.items.length > 0, ruta);
    }
  });

  it('el Resumen (dashboard) con un condominio ajeno cuenta cero unidades y cero morosos', async () => {
    const r = await get(T.adminA, `/api/dashboard/resumen?complejo_id=${d.complejoB.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.unidades_total, 0);
    assert.equal(r.body.morosos, 0);
    const propio = await get(T.adminA, `/api/dashboard/resumen?complejo_id=${d.complejoA.id}`);
    assert.equal(propio.body.unidades_total, 2);
  });

  it('las juntas con un condominio ajeno no listan ninguno (ni su nombre)', async () => {
    const r = await get(T.adminA, `/api/juntas?complejo_id=${d.complejoB.id}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.items, []);
    assert.deepEqual(r.body.complejos, []);
  });

  it('el superadmin sí puede pedir cualquier condominio de la plataforma', async () => {
    assert.deepEqual(await ids(T.super, `/api/tareas?complejo_id=${d.complejoB.id}`), [d.tareaB.id]);
    assert.ok((await ids(T.super, `/api/unidades?complejo_id=${d.complejoB.id}`)).includes(d.unidadB1.id));
  });
});
