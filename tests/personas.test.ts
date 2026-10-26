import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { esperar, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { crearContratosIniciales } from '../src/server/lib/contratosIniciales';
import { hoyLima } from '../src/server/lib/fechas';

const DIA = 86_400_000;
let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'mttoA' | 'seguridadA', string>;
let seq = 0;

const usuario = async (rol: string, extra: Record<string, unknown> = {}) => {
  const n = ++seq;
  return prisma.usuario.create({ data: { nombre: `${rol} ${n}`, email: `${rol}.${n}@personas.pe`, rol, password_hash: await bcrypt.hash(PASSWORD, 4), ...extra } });
};

/** Un condominio de la empresa con dos departamentos y un recibo vencido (150 por unidad) emitido por esa empresa. */
async function condominio(empresa_id: number, nombre = `Condominio ${++seq}`) {
  const complejo = await prisma.complejoHabitacional.create({ data: { nombre, tipo: 'Condominio', empresa_id } });
  const dueno1 = await usuario('propietario', { complejo_id: complejo.id });
  const dueno2 = await usuario('propietario', { complejo_id: complejo.id });
  const unidad = (codigo: string, propietario_id: number) => prisma.unidad.create({ data: { codigo, tipo: 'Departamento', complejo_id: complejo.id, empresa_id, propietario_id, estado: 'activa' } });
  const u1 = await unidad(`P${seq}-1`, dueno1.id);
  const u2 = await unidad(`P${seq}-2`, dueno2.id);
  const concepto = await prisma.concepto.create({ data: { nombre: 'Mantenimiento', empresa_id, tipo_monto: 'fijo' } });
  const hoy = hoyLima().getTime();
  const recibo = await prisma.recibo.create({ data: { empresa_id, complejo_id: complejo.id, mes: 8, anio: 2026, fecha_emision: new Date(hoy - 60 * DIA), fecha_vencimiento: new Date(hoy - 30 * DIA), estado: 'emitido' } });
  const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: concepto.id, monto: 150, orden: 1 } });
  for (const u of [u1, u2]) await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: u.id, monto: 150, estado_pago: 'pendiente' } });
  return { complejo, dueno1, dueno2, u1, u2, recibo };
}

const cambiar = (token: string, complejoId: number, cuerpo: Record<string, unknown>) => llamar(base, 'POST', `/api/complejos/${complejoId}/administradora`, token, cuerpo);
const ids = async (token: string, ruta: string) => ((await llamar(base, 'GET', ruta, token)).body.items as { id: number }[]).map((x) => x.id);
const pagar = (token: string, reciboId: number, unidadId: number) => llamar(base, 'POST', `/api/recibos/${reciboId}/mantenimientos/${unidadId}/pagos`, token, { metodo_pago: 'efectivo' });
const vigentes = (complejo_id: number) => prisma.contratoAdministracion.count({ where: { complejo_id, fecha_fin: null } });

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    super: await login(base, 'super@test.pe'),
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    mttoA: await login(base, 'mtto.a@test.pe'),
    seguridadA: await login(base, 'seg.a@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('contrato de administración', () => {
  it('un condominio nuevo nace con su contrato vigente (admin y superadmin)', async () => {
    const r = await llamar(base, 'POST', '/api/complejos', T.adminA, { nombre: 'Nuevo A', tipo: 'Condominio' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const c = await prisma.contratoAdministracion.findMany({ where: { complejo_id: r.body.id } });
    assert.equal(c.length, 1);
    assert.equal(c[0]!.empresa_id, d.empresaA.id);
    assert.equal(c[0]!.fecha_fin, null);
    const s = await llamar(base, 'POST', '/api/complejos', T.super, { nombre: 'Nuevo B', tipo: 'Condominio', empresa_id: d.empresaB.id });
    assert.equal((await prisma.contratoAdministracion.findFirstOrThrow({ where: { complejo_id: s.body.id } })).empresa_id, d.empresaB.id);
  });

  it('la lista de condominios trae el contrato vigente y el historial lo ve sólo quien lo administra (ajeno → 404)', async () => {
    const x = await condominio(d.empresaA.id);
    await prisma.contratoAdministracion.create({ data: { complejo_id: x.complejo.id, empresa_id: d.empresaA.id, fecha_inicio: new Date('2025-01-01') } });
    const lista = (await llamar(base, 'GET', '/api/complejos?pageSize=100', T.adminA)).body.items as { id: number; contrato_vigente: { fecha_inicio: string } | null }[];
    assert.ok(lista.find((c) => c.id === x.complejo.id)!.contrato_vigente);
    const h = await llamar(base, 'GET', `/api/complejos/${x.complejo.id}/contratos`, T.adminA);
    assert.equal(h.status, 200);
    assert.equal(h.body.items[0].empresa.nombre, 'Empresa A');
    assert.equal((await llamar(base, 'GET', `/api/complejos/${x.complejo.id}/contratos`, T.adminB)).status, 404);
  });

  it('cambiar de administradora es sólo del superadmin; el admin recibe 403', async () => {
    const x = await condominio(d.empresaA.id);
    assert.equal((await cambiar(T.adminA, x.complejo.id, { empresa_id: d.empresaB.id })).status, 403);
    assert.equal((await cambiar(T.adminB, x.complejo.id, { empresa_id: d.empresaB.id })).status, 403);
    assert.equal((await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: x.complejo.id } })).empresa_id, d.empresaA.id);
  });

  it('el cambio es atómico: cierra el vigente, abre el nuevo y mueve complejo y unidades; el historial lo muestra', async () => {
    const x = await condominio(d.empresaA.id);
    await prisma.contratoAdministracion.create({ data: { complejo_id: x.complejo.id, empresa_id: d.empresaA.id, fecha_inicio: new Date('2025-01-01') } });
    const r = await cambiar(T.super, x.complejo.id, { empresa_id: d.empresaB.id, fecha_inicio: '2026-09-01', observaciones: 'Nuevo contrato' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(await vigentes(x.complejo.id), 1, 'un solo vigente');
    const contratos = await prisma.contratoAdministracion.findMany({ where: { complejo_id: x.complejo.id }, orderBy: { id: 'asc' } });
    assert.equal(contratos.length, 2);
    assert.equal(contratos[0]!.fecha_fin?.toISOString().slice(0, 10), '2026-09-01');
    assert.equal(contratos[1]!.empresa_id, d.empresaB.id);
    assert.equal(contratos[1]!.fecha_fin, null);
    assert.equal(contratos[1]!.observaciones, 'Nuevo contrato');
    assert.equal((await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: x.complejo.id } })).empresa_id, d.empresaB.id);
    for (const u of [x.u1, x.u2]) assert.equal((await prisma.unidad.findUniqueOrThrow({ where: { id: u.id } })).empresa_id, d.empresaB.id);
    const h = await llamar(base, 'GET', `/api/complejos/${x.complejo.id}/contratos`, T.adminB);
    assert.deepEqual(h.body.items.map((c: { empresa: { nombre: string }; fecha_fin: string | null }) => [c.empresa.nombre, c.fecha_fin === null]), [['Empresa B', true], ['Empresa A', false]]);
  });

  it('no hay dos vigentes: la misma empresa → 409, fecha anterior al contrato → 422, empresa inexistente → 422, condominio inexistente → 404', async () => {
    const x = await condominio(d.empresaA.id);
    await prisma.contratoAdministracion.create({ data: { complejo_id: x.complejo.id, empresa_id: d.empresaA.id, fecha_inicio: new Date('2025-06-01') } });
    assert.equal((await cambiar(T.super, x.complejo.id, { empresa_id: d.empresaA.id })).status, 409);
    assert.equal((await cambiar(T.super, x.complejo.id, { empresa_id: d.empresaB.id, fecha_inicio: '2025-01-01' })).status, 422);
    assert.equal((await cambiar(T.super, x.complejo.id, { empresa_id: 999999 })).status, 422);
    assert.equal((await cambiar(T.super, 999999, { empresa_id: d.empresaB.id })).status, 404);
    assert.equal(await vigentes(x.complejo.id), 1);
    assert.equal((await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: x.complejo.id } })).empresa_id, d.empresaA.id, 'nada cambió');
  });

  it('dos cambios simultáneos al mismo destino: uno gana, el otro 409, y queda un solo vigente', async () => {
    const x = await condominio(d.empresaA.id);
    const [a, b] = await Promise.all([cambiar(T.super, x.complejo.id, { empresa_id: d.empresaB.id }), cambiar(T.super, x.complejo.id, { empresa_id: d.empresaB.id })]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    assert.equal(await vigentes(x.complejo.id), 1);
  });

  it('cambios simultáneos a destinos distintos: se serializan y siempre queda un vigente que coincide con la empresa del condominio', async () => {
    const x = await condominio(d.empresaA.id);
    const otra = await prisma.empresaAdministradora.create({ data: { nombre: 'Empresa C' } });
    const rs = await Promise.all([cambiar(T.super, x.complejo.id, { empresa_id: d.empresaB.id }), cambiar(T.super, x.complejo.id, { empresa_id: otra.id })]);
    assert.deepEqual(rs.map((r) => r.status), [201, 201]);
    assert.equal(await vigentes(x.complejo.id), 1);
    const vig = await prisma.contratoAdministracion.findFirstOrThrow({ where: { complejo_id: x.complejo.id, fecha_fin: null } });
    assert.equal(vig.empresa_id, (await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: x.complejo.id } })).empresa_id);
  });

  it('editar el condominio no cambia la administradora (422); mandar la misma sí se acepta', async () => {
    const x = await condominio(d.empresaA.id);
    assert.equal((await llamar(base, 'PUT', `/api/complejos/${x.complejo.id}`, T.super, { empresa_id: d.empresaB.id })).status, 422);
    assert.equal((await llamar(base, 'PUT', `/api/complejos/${x.complejo.id}`, T.super, { nombre: 'Renombrado', empresa_id: d.empresaA.id })).status, 200);
    assert.equal((await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: x.complejo.id } })).empresa_id, d.empresaA.id);
  });

  it('qué ve cada una: la nueva ve condominio, unidades y residentes; la anterior los pierde; el personal destinado ahí queda liberado y sin sesión', async () => {
    const x = await condominio(d.empresaA.id);
    const guardia = await usuario('seguridad', { empresa_id: d.empresaA.id, complejo_id: x.complejo.id });
    const tokenGuardia = await login(base, guardia.email);
    assert.equal((await llamar(base, 'GET', '/api/unidades', tokenGuardia)).status, 200, 'antes del cambio ve sus unidades');
    assert.ok((await ids(T.adminA, '/api/complejos?pageSize=100')).includes(x.complejo.id));

    assert.equal((await cambiar(T.super, x.complejo.id, { empresa_id: d.empresaB.id })).status, 201);

    // la nueva
    assert.ok((await ids(T.adminB, '/api/complejos?pageSize=100')).includes(x.complejo.id));
    assert.deepEqual((await ids(T.adminB, '/api/unidades?pageSize=100')).filter((i) => [x.u1.id, x.u2.id].includes(i)).sort(), [x.u1.id, x.u2.id].sort());
    const resB = await ids(T.adminB, '/api/usuarios?tipo=residente&pageSize=100');
    for (const r of [x.dueno1, x.dueno2]) assert.ok(resB.includes(r.id), 'la nueva ve a los residentes');
    assert.equal((await llamar(base, 'GET', `/api/usuarios/${x.dueno1.id}`, T.adminB)).status, 200);
    // la anterior
    assert.ok(!(await ids(T.adminA, '/api/complejos?pageSize=100')).includes(x.complejo.id));
    assert.equal((await llamar(base, 'GET', `/api/complejos/${x.complejo.id}`, T.adminA)).status, 404);
    assert.equal((await ids(T.adminA, '/api/unidades?pageSize=100')).some((i) => [x.u1.id, x.u2.id].includes(i)), false);
    const resA = await ids(T.adminA, '/api/usuarios?tipo=residente&pageSize=100');
    for (const r of [x.dueno1, x.dueno2]) assert.ok(!resA.includes(r.id), 'la anterior ya no ve a los residentes');
    assert.equal((await llamar(base, 'GET', `/api/usuarios/${x.dueno1.id}`, T.adminA)).status, 404);
    // el personal es de su empresa, no del condominio
    assert.ok((await ids(T.adminA, '/api/usuarios?tipo=personal&pageSize=100')).includes(guardia.id), 'sigue siendo personal de la empresa A');
    assert.ok(!(await ids(T.adminB, '/api/usuarios?tipo=personal&pageSize=100')).includes(guardia.id));
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: guardia.id } })).complejo_id, null, 'liberado del condominio');
    assert.equal((await llamar(base, 'GET', '/api/unidades', tokenGuardia)).status, 401, 'su sesión se cerró: el alcance cambió');
    assert.equal((await llamar(base, 'GET', '/api/unidades', await login(base, guardia.email))).status, 403, 'sin condominio no ve unidades');
  });

  it('lo histórico: el recibo emitido por la anterior sigue visible para ella en consulta; la nueva lo ve y cobra mientras tenga deuda; pagado, ya no le llega', async () => {
    const x = await condominio(d.empresaA.id);
    assert.equal((await cambiar(T.super, x.complejo.id, { empresa_id: d.empresaB.id })).status, 201);
    const rec = await prisma.recibo.findUniqueOrThrow({ where: { id: x.recibo.id } });
    assert.equal(rec.empresa_id, d.empresaA.id, 'el recibo conserva la empresa que lo emitió');

    // la anterior: lo ve (consulta) pero no lo modifica ni cobra
    assert.equal((await llamar(base, 'GET', `/api/recibos/${x.recibo.id}`, T.adminA)).status, 200);
    assert.ok((await ids(T.adminA, '/api/recibos?pageSize=100')).includes(x.recibo.id));
    assert.equal((await llamar(base, 'PUT', `/api/recibos/${x.recibo.id}`, T.adminA, { descripcion: 'cambio' })).status, 404);
    assert.equal((await llamar(base, 'DELETE', `/api/recibos/${x.recibo.id}`, T.adminA)).status, 404);
    assert.equal((await pagar(T.adminA, x.recibo.id, x.u1.id)).status, 404, 'cobrar ya no es suyo');
    const cargo = await prisma.reciboConceptoUnidad.findFirstOrThrow({ where: { unidad_id: x.u1.id } });
    assert.equal((await llamar(base, 'POST', '/api/pagos', T.adminA, { recibo_concepto_unidad_id: cargo.id, monto: 150, metodo_pago: 'efectivo' })).status, 422, 'registrar un pago suelto tampoco');
    assert.equal((await llamar(base, 'PUT', `/api/recibo-concepto-unidades/${cargo.id}`, T.adminA, { observaciones: 'x' })).status, 404);
    const periodosA = (await llamar(base, 'GET', '/api/recibos/periodos', T.adminA)).body.items as { id: number }[];
    assert.ok(!periodosA.some((p) => p.id === x.recibo.id), 'no aparece entre los periodos donde cobrar');

    // la nueva: ve la deuda y la cobra
    assert.ok((await ids(T.adminB, '/api/recibos?pageSize=100')).includes(x.recibo.id), 'la deuda pendiente es suya');
    assert.equal((await llamar(base, 'GET', `/api/recibos/${x.recibo.id}`, T.adminB)).status, 200);
    assert.ok((await ids(T.adminB, '/api/recibo-concepto-unidades?pageSize=100')).includes(cargo.id));
    assert.equal((await pagar(T.adminB, x.recibo.id, x.u1.id)).status, 201);
    assert.ok((await ids(T.adminB, '/api/recibos?pageSize=100')).includes(x.recibo.id), 'queda una unidad por cobrar');
    assert.equal((await pagar(T.adminB, x.recibo.id, x.u2.id)).status, 201);
    assert.equal((await llamar(base, 'GET', `/api/recibos/${x.recibo.id}`, T.adminB)).status, 404, 'todo cobrado: es historia de la anterior');
    // la anterior conserva su registro completo
    assert.equal((await llamar(base, 'GET', `/api/recibos/${x.recibo.id}`, T.adminA)).status, 200);
    const pagosA = (await llamar(base, 'GET', '/api/pagos?pageSize=100', T.adminA)).body.items as { recibo: { id: number } | null }[];
    assert.ok(pagosA.some((p) => p.recibo?.id === x.recibo.id), 've en consulta los pagos de su recibo');
  });

  it('un recibo nuevo después del cambio lo emite la nueva empresa y la anterior no lo ve', async () => {
    const x = await condominio(d.empresaA.id);
    await cambiar(T.super, x.complejo.id, { empresa_id: d.empresaB.id });
    const concepto = await prisma.concepto.create({ data: { nombre: 'Agua', empresa_id: d.empresaB.id, tipo_monto: 'fijo' } });
    const r = await llamar(base, 'POST', '/api/recibos', T.adminB, {
      complejo_id: x.complejo.id, mes: 11, anio: 2026, fecha_emision: '2026-11-01', fecha_vencimiento: '2026-11-20', conceptos: [{ concepto_id: concepto.id, monto: 80 }],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await prisma.recibo.findUniqueOrThrow({ where: { id: r.body.id } })).empresa_id, d.empresaB.id);
    assert.equal((await llamar(base, 'GET', `/api/recibos/${r.body.id}`, T.adminA)).status, 404);
    assert.equal((await llamar(base, 'POST', '/api/recibos', T.adminA, { complejo_id: x.complejo.id, mes: 12, anio: 2026, fecha_emision: '2026-12-01', fecha_vencimiento: '2026-12-20', conceptos: [] })).status, 422);
  });

  it('las tareas ligadas al condominio siguen a la empresa vigente', async () => {
    const x = await condominio(d.empresaA.id);
    const t = await prisma.tareaMantenimiento.create({ data: { titulo: 'Tarea del condominio', unidad_id: x.u1.id } });
    assert.ok((await ids(T.adminA, '/api/tareas?pageSize=100')).includes(t.id));
    await cambiar(T.super, x.complejo.id, { empresa_id: d.empresaB.id });
    assert.ok(!(await ids(T.adminA, '/api/tareas?pageSize=100')).includes(t.id));
    assert.ok((await ids(T.adminB, '/api/tareas?pageSize=100')).includes(t.id));
  });

  it('crearContratosIniciales: da contrato vigente a quien no lo tiene, simula sin cambiar y es idempotente', async () => {
    const x = await condominio(d.empresaA.id);
    const sinEmpresa = await prisma.complejoHabitacional.create({ data: { nombre: 'Sin empresa', tipo: 'Condominio' } });
    assert.equal(await prisma.contratoAdministracion.count({ where: { complejo_id: x.complejo.id } }), 0);
    const pendientes = await crearContratosIniciales(prisma, true);
    assert.ok(pendientes >= 1);
    assert.equal(await prisma.contratoAdministracion.count({ where: { complejo_id: x.complejo.id } }), 0, 'simular no cambia nada');
    assert.equal(await crearContratosIniciales(prisma), pendientes);
    const c = await prisma.contratoAdministracion.findFirstOrThrow({ where: { complejo_id: x.complejo.id } });
    assert.equal(c.empresa_id, d.empresaA.id);
    assert.equal(c.fecha_fin, null);
    assert.equal(c.fecha_inicio.getTime(), (await prisma.recibo.findUniqueOrThrow({ where: { id: x.recibo.id } })).fecha_emision.getTime(), 'inicio = primer recibo');
    assert.equal(await prisma.contratoAdministracion.count({ where: { complejo_id: sinEmpresa.id } }), 0, 'sin empresa no hay contrato');
    assert.equal(await crearContratosIniciales(prisma), 0, 'segunda corrida: nada que cambiar');
  });

  it('un condominio sin contrato registrado (datos anteriores) también se puede cambiar: el contrato previo se reconstruye', async () => {
    const x = await condominio(d.empresaA.id);
    assert.equal((await cambiar(T.super, x.complejo.id, { empresa_id: d.empresaB.id })).status, 201);
    const cs = await prisma.contratoAdministracion.findMany({ where: { complejo_id: x.complejo.id }, orderBy: { id: 'asc' } });
    assert.deepEqual(cs.map((c) => [c.empresa_id, c.fecha_fin !== null]), [[d.empresaA.id, true], [d.empresaB.id, false]]);
  });
});

describe('limpieza y jardinería: personal con sus tareas y sin cobranza', () => {
  let limpieza: Awaited<ReturnType<typeof usuario>>;
  let jardin: Awaited<ReturnType<typeof usuario>>;
  let tL: number;
  let tJ: number;
  let L: string;
  let J: string;

  before(async () => {
    limpieza = await usuario('limpieza', { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id });
    jardin = await usuario('jardineria', { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id });
    tL = (await prisma.tareaMantenimiento.create({ data: { titulo: 'Limpiar hall', unidad_id: d.unidadA1.id, asignado_id: limpieza.id, creado_por_id: d.adminA.id } })).id;
    tJ = (await prisma.tareaMantenimiento.create({ data: { titulo: 'Podar jardín', asignado_id: jardin.id, creado_por_id: d.adminA.id } })).id;
    L = await login(base, limpieza.email);
    J = await login(base, jardin.email);
  });

  it('cada uno ve sólo sus tareas (no las de mantenimiento ni las del otro)', async () => {
    assert.deepEqual(await ids(L, '/api/tareas'), [tL]);
    assert.deepEqual(await ids(J, '/api/tareas'), [tJ]);
    assert.equal((await llamar(base, 'GET', `/api/tareas/${d.tareaA.id}`, L)).status, 404);
    assert.equal((await llamar(base, 'GET', `/api/tareas/${tJ}`, L)).status, 404);
  });

  it('cambia el estado de SUS tareas; las ajenas → 404; no crea ni borra tareas', async () => {
    assert.equal((await llamar(base, 'PATCH', `/api/tareas/${tL}/estado`, L, { estado: 'en_progreso' })).status, 200);
    assert.equal((await prisma.tareaMantenimiento.findUniqueOrThrow({ where: { id: tL } })).estado, 'en_progreso');
    assert.equal((await llamar(base, 'PATCH', `/api/tareas/${tJ}/estado`, L, { estado: 'completada' })).status, 404);
    assert.equal((await llamar(base, 'PATCH', `/api/tareas/${d.tareaA.id}/estado`, J, { estado: 'completada' })).status, 404);
    assert.equal((await llamar(base, 'POST', '/api/tareas', L, { titulo: 'x' })).status, 403);
    assert.equal((await llamar(base, 'DELETE', `/api/tareas/${tL}`, L)).status, 403);
    assert.equal((await llamar(base, 'PUT', `/api/tareas/${tL}`, J, { titulo: 'x' })).status, 403);
  });

  it('ve sólo las unidades de sus tareas y su resumen de tareas', async () => {
    assert.deepEqual(await ids(L, '/api/unidades'), [d.unidadA1.id]);
    assert.deepEqual(await ids(J, '/api/unidades'), [], 'su tarea no tiene unidad');
    const r = await llamar(base, 'GET', '/api/dashboard/resumen', L);
    assert.equal(r.status, 200);
    assert.equal(r.body.en_progreso, 1);
    assert.equal((await llamar(base, 'GET', '/api/dashboard/resumen', J)).body.tareas_pendientes, 1);
  });

  it('nada de cobranza, personas ni administración: 403', async () => {
    for (const token of [L, J]) {
      for (const ruta of ['/api/recibos', '/api/pagos', '/api/recibo-concepto-unidades', '/api/recibo-conceptos', '/api/conceptos', '/api/usuarios', '/api/complejos', '/api/empresas', '/api/proveedores', '/api/medios-pago', '/api/reportes/morosidad', '/api/notificaciones', '/api/auditoria']) {
        assert.equal((await llamar(base, 'GET', ruta, token)).status, 403, ruta);
      }
      assert.equal((await llamar(base, 'POST', `/api/recibos/${d.reciboVencidoA.id}/mantenimientos/${d.unidadA1.id}/pagos`, token, { metodo_pago: 'efectivo' })).status, 403);
    }
  });

  it('un admin los crea y los asigna a tareas; el de otra empresa no puede ni verlos ni asignarlos', async () => {
    const r = await llamar(base, 'POST', '/api/usuarios', T.adminA, { nombre: 'Nuevo limpieza', email: 'nuevo.limpieza@personas.pe', password: 'ClaveSegura123', rol: 'limpieza', complejo_id: d.complejoA.id });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: r.body.id } })).empresa_id, d.empresaA.id);
    const t = await llamar(base, 'POST', '/api/tareas', T.adminA, { titulo: 'Limpiar escaleras', asignado_id: r.body.id });
    assert.equal(t.status, 201, JSON.stringify(t.body));
    assert.equal(t.body.asignado.rol, 'limpieza');
    assert.equal((await llamar(base, 'POST', '/api/tareas', T.adminB, { titulo: 'Robo', asignado_id: r.body.id })).status, 422, 'personal de otra empresa');
    assert.equal((await llamar(base, 'GET', `/api/usuarios/${r.body.id}`, T.adminB)).status, 404);
    assert.equal((await llamar(base, 'POST', '/api/tareas', T.adminA, { titulo: 'a seguridad', asignado_id: d.seguridadA.id })).status, 422, 'seguridad no recibe tareas');
  });

  it('el personal de otro condominio no ve unidades ajenas (la unidad B-101 nunca aparece)', async () => {
    for (const token of [L, J]) assert.ok(!(await ids(token, '/api/unidades?pageSize=100')).includes(d.unidadB1.id));
    assert.equal((await llamar(base, 'GET', `/api/unidades/${d.unidadB1.id}`, L)).status, 404);
  });
});

describe('proveedores: directorio de la administradora', () => {
  const crear = (token: string, extra: Record<string, unknown> = {}) =>
    llamar(base, 'POST', '/api/proveedores', token, { razon_social: `Proveedor ${++seq}`, rubro: 'ascensores', ...extra });

  it('CRUD con zod: crea con condominios, edita, filtra por rubro/estado/condominio y borra', async () => {
    const r = await crear(T.adminA, { ruc: '20123456789', contacto_nombre: 'Luis', telefono: '987654321', email: 'ventas@asc.pe', complejo_ids: [d.complejoA.id], notas: 'Contrato anual' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.empresa_id, d.empresaA.id);
    assert.equal(r.body.activo, true);
    assert.deepEqual(r.body.complejos, [{ id: d.complejoA.id, nombre: 'Complejo A' }]);
    const id = r.body.id as number;
    const e = await llamar(base, 'PUT', `/api/proveedores/${id}`, T.adminA, { rubro: 'gasfiteria', activo: false, complejo_ids: [] });
    assert.equal(e.status, 200, JSON.stringify(e.body));
    assert.equal(e.body.rubro, 'gasfiteria');
    assert.equal(e.body.activo, false);
    assert.deepEqual(e.body.complejos, []);
    assert.ok((await ids(T.adminA, '/api/proveedores?rubro=gasfiteria&pageSize=100')).includes(id));
    assert.ok(!(await ids(T.adminA, '/api/proveedores?rubro=ascensores&pageSize=100')).includes(id));
    assert.ok(!(await ids(T.adminA, '/api/proveedores?activo=true&pageSize=100')).includes(id));
    assert.ok((await ids(T.adminA, '/api/proveedores?activo=false&pageSize=100')).includes(id));
    await llamar(base, 'PUT', `/api/proveedores/${id}`, T.adminA, { complejo_ids: [d.complejoA.id] });
    assert.ok((await ids(T.adminA, `/api/proveedores?complejo_id=${d.complejoA.id}&pageSize=100`)).includes(id));
    assert.equal((await llamar(base, 'DELETE', `/api/proveedores/${id}`, T.adminA)).status, 204);
    assert.equal((await llamar(base, 'GET', `/api/proveedores/${id}`, T.adminA)).status, 404);
  });

  it('valida: rubro, RUC, correo y razón social; condominio de otra empresa o inexistente → 422', async () => {
    assert.equal((await crear(T.adminA, { rubro: 'magia' })).status, 422);
    assert.equal((await crear(T.adminA, { ruc: '123' })).status, 422);
    assert.equal((await crear(T.adminA, { email: 'no-es-correo' })).status, 422);
    assert.equal((await crear(T.adminA, { razon_social: '' })).status, 422);
    assert.equal((await crear(T.adminA, { complejo_ids: [d.complejoB.id] })).status, 422, 'condominio de otra empresa');
    assert.equal((await crear(T.adminA, { complejo_ids: [999999] })).status, 422);
    assert.equal((await crear(T.adminA, { ruc: '' })).status, 201, 'RUC vacío = sin RUC');
  });

  it('cada administradora ve sólo los suyos; los ajenos dan 404 al leer, editar y borrar', async () => {
    const mio = (await crear(T.adminA)).body.id as number;
    const ajeno = (await crear(T.adminB)).body.id as number;
    assert.ok((await ids(T.adminA, '/api/proveedores?pageSize=100')).includes(mio));
    assert.ok(!(await ids(T.adminA, '/api/proveedores?pageSize=100')).includes(ajeno));
    assert.equal((await llamar(base, 'GET', `/api/proveedores/${ajeno}`, T.adminA)).status, 404);
    assert.equal((await llamar(base, 'PUT', `/api/proveedores/${ajeno}`, T.adminA, { notas: 'x' })).status, 404);
    assert.equal((await llamar(base, 'DELETE', `/api/proveedores/${ajeno}`, T.adminA)).status, 404);
    const todos = await ids(T.super, '/api/proveedores?pageSize=100');
    assert.ok(todos.includes(mio) && todos.includes(ajeno), 'el superadmin ve todos');
  });

  it('el personal no accede al directorio (403) y la empresa del proveedor no se cambia por PUT', async () => {
    assert.equal((await llamar(base, 'GET', '/api/proveedores', T.mttoA)).status, 403);
    assert.equal((await llamar(base, 'GET', '/api/proveedores', T.seguridadA)).status, 403);
    assert.equal((await llamar(base, 'POST', '/api/proveedores', T.mttoA, { razon_social: 'x', rubro: 'otros' })).status, 403);
    const id = (await crear(T.adminA)).body.id as number;
    await llamar(base, 'PUT', `/api/proveedores/${id}`, T.adminA, { empresa_id: d.empresaB.id, notas: 'intento' });
    assert.equal((await prisma.proveedor.findUniqueOrThrow({ where: { id } })).empresa_id, d.empresaA.id);
  });

  it('el superadmin crea eligiendo la empresa (obligatoria) y sus condominios deben ser de ella', async () => {
    assert.equal((await llamar(base, 'POST', '/api/proveedores', T.super, { razon_social: 'Sin empresa', rubro: 'otros' })).status, 422);
    const r = await llamar(base, 'POST', '/api/proveedores', T.super, { razon_social: 'De B', rubro: 'pintura', empresa_id: d.empresaB.id, complejo_ids: [d.complejoB.id] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.empresa_id, d.empresaB.id);
    assert.equal((await llamar(base, 'POST', '/api/proveedores', T.super, { razon_social: 'Cruzado', rubro: 'pintura', empresa_id: d.empresaB.id, complejo_ids: [d.complejoA.id] })).status, 422);
  });

  it('se asigna a una tarea (en lugar de una persona) y se muestra; no ambos; sólo propios y activos', async () => {
    const p = (await crear(T.adminA, { rubro: 'pintura' })).body.id as number;
    const t = await llamar(base, 'POST', '/api/tareas', T.adminA, { titulo: 'Pintar fachada', proveedor_id: p });
    assert.equal(t.status, 201, JSON.stringify(t.body));
    assert.equal(t.body.proveedor.id, p);
    assert.equal(t.body.proveedor.rubro, 'pintura');
    assert.equal(t.body.asignado, null);
    assert.ok((await ids(T.adminA, `/api/tareas?proveedor_id=${p}`)).includes(t.body.id));
    // ambos → 422
    assert.equal((await llamar(base, 'POST', '/api/tareas', T.adminA, { titulo: 'Doble', proveedor_id: p, asignado_id: d.mantenimientoA.id })).status, 422);
    // asignar a una persona suelta al proveedor, y viceversa
    const aPersona = await llamar(base, 'PUT', `/api/tareas/${t.body.id}`, T.adminA, { asignado_id: d.mantenimientoA.id });
    assert.equal(aPersona.status, 200);
    assert.equal(aPersona.body.proveedor, null);
    assert.equal(aPersona.body.asignado.id, d.mantenimientoA.id);
    const aProv = await llamar(base, 'PUT', `/api/tareas/${t.body.id}`, T.adminA, { proveedor_id: p });
    assert.equal(aProv.body.asignado, null);
    assert.equal(aProv.body.proveedor.id, p);
    // ajeno o inactivo → 422
    const ajeno = (await crear(T.adminB)).body.id as number;
    assert.equal((await llamar(base, 'POST', '/api/tareas', T.adminA, { titulo: 'Ajeno', proveedor_id: ajeno })).status, 422);
    const inactivo = (await crear(T.adminA, { activo: false })).body.id as number;
    assert.equal((await llamar(base, 'POST', '/api/tareas', T.adminA, { titulo: 'Inactivo', proveedor_id: inactivo })).status, 422);
    // la tarea con proveedor la ve su administradora y no la ajena
    assert.ok(!(await ids(T.adminB, '/api/tareas?pageSize=100')).includes(t.body.id));
    // quitar el proveedor
    const sin = await llamar(base, 'PUT', `/api/tareas/${t.body.id}`, T.adminA, { proveedor_id: null, asignado_id: null });
    assert.equal(sin.body.proveedor, null);
    // borrar el proveedor deja la tarea sin asignar (no la borra)
    await llamar(base, 'PUT', `/api/tareas/${t.body.id}`, T.adminA, { proveedor_id: p });
    assert.equal((await llamar(base, 'DELETE', `/api/proveedores/${p}`, T.adminA)).status, 204);
    assert.equal((await prisma.tareaMantenimiento.findUniqueOrThrow({ where: { id: t.body.id } })).proveedor_id, null);
  });

  it('crear un proveedor queda en la auditoría', async () => {
    const r = await crear(T.adminA, { notas: 'confidencial' });
    const fila = await esperar(() => prisma.auditoria.findFirst({ where: { entidad: 'proveedor', entidad_id: r.body.id } }));
    assert.equal(fila.accion, 'crear');
    assert.equal(fila.entidad, 'proveedor');
  });
});

describe('residentes y personal: listados separados', () => {
  let c1: number;
  let b1: number;
  let b2: number;
  let moroso: { id: number };
  let alDia: { id: number };
  let inquilinoB2: { id: number };

  before(async () => {
    const x = await condominio(d.empresaA.id, 'Torres del Sol');
    c1 = x.complejo.id;
    b1 = (await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: c1 } })).id;
    b2 = (await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'Block', complejo_id: c1 } })).id;
    await prisma.unidad.update({ where: { id: x.u1.id }, data: { estructura_id: b1 } }); // moroso (cargo vencido)
    await prisma.unidad.update({ where: { id: x.u2.id }, data: { estructura_id: b1 } });
    moroso = x.dueno1;
    alDia = await usuario('propietario', { complejo_id: c1 });
    inquilinoB2 = await usuario('inquilino', { complejo_id: c1 });
    await prisma.unidad.create({ data: { codigo: 'T-201', tipo: 'Departamento', complejo_id: c1, empresa_id: d.empresaA.id, estructura_id: b2, propietario_id: alDia.id, inquilino_id: inquilinoB2.id, estado: 'activa' } });
    // pagó lo suyo: el cargo del recibo vencido no existe para T-201 (no tiene cargos) → al día
  });

  it('tipo=residente sólo propietarios e inquilinos; tipo=personal sólo el personal de la empresa; sin mezclar', async () => {
    const res = (await llamar(base, 'GET', '/api/usuarios?tipo=residente&pageSize=100', T.adminA)).body.items as { id: number; rol: string; empresa?: unknown }[];
    assert.ok(res.length > 0 && res.every((u) => u.rol === 'propietario' || u.rol === 'inquilino'));
    const per = (await llamar(base, 'GET', '/api/usuarios?tipo=personal&pageSize=100', T.adminA)).body.items as { id: number; rol: string }[];
    assert.ok(per.length > 0 && per.every((u) => ['admin', 'seguridad', 'mantenimiento', 'limpieza', 'jardineria'].includes(u.rol)));
    assert.ok(per.some((u) => u.id === d.mantenimientoA.id));
    // el personal de la empresa B no aparece
    assert.ok(!per.some((u) => u.id === d.adminB.id));
    assert.equal((await llamar(base, 'GET', '/api/usuarios?tipo=superadmin', T.adminA)).body.items.length, 0, 'el admin nunca ve superadmins');
    const sup = (await llamar(base, 'GET', '/api/usuarios?tipo=superadmin', T.super)).body.items as { rol: string }[];
    assert.ok(sup.length === 1 && sup[0]!.rol === 'superadmin');
    assert.equal((await llamar(base, 'GET', '/api/usuarios?tipo=otra', T.adminA)).status, 422);
  });

  it('filtra por condominio, por block y por mora; la fila trae sus unidades (condominio · block · departamento) y la mora', async () => {
    const deC = (await llamar(base, 'GET', `/api/usuarios?tipo=residente&complejo_id=${c1}&pageSize=100`, T.adminA)).body.items as { id: number; moroso: boolean; unidades: { codigo: string; complejo: { nombre: string }; estructura: { nombre: string } | null }[] }[];
    const idsC = deC.map((u) => u.id);
    for (const u of [moroso, alDia, inquilinoB2]) assert.ok(idsC.includes(u.id));
    assert.ok(!idsC.includes(d.propietario1.id), 'otro condominio');
    const fila = (id: number) => deC.find((u) => u.id === id)!;
    assert.equal(fila(moroso.id).unidades[0]!.complejo.nombre, 'Torres del Sol');
    assert.equal(fila(moroso.id).unidades[0]!.estructura?.nombre, 'Block 1');
    assert.equal(fila(alDia.id).unidades[0]!.codigo, 'T-201');
    assert.equal(fila(moroso.id).moroso, true);
    assert.equal(fila(alDia.id).moroso, false);
    // block
    const deB2 = await ids(T.adminA, `/api/usuarios?tipo=residente&complejo_id=${c1}&estructura_id=${b2}&pageSize=100`);
    assert.deepEqual(deB2.sort(), [alDia.id, inquilinoB2.id].sort(), 'propietario e inquilino de la unidad del block 2');
    assert.ok(!deB2.includes(moroso.id));
    // mora
    const morosos = await ids(T.adminA, `/api/usuarios?tipo=residente&complejo_id=${c1}&estado=moroso&pageSize=100`);
    assert.ok(morosos.includes(moroso.id) && !morosos.includes(alDia.id));
    const alDiaIds = await ids(T.adminA, `/api/usuarios?tipo=residente&complejo_id=${c1}&estado=al_dia&pageSize=100`);
    assert.ok(alDiaIds.includes(alDia.id) && !alDiaIds.includes(moroso.id));
    assert.equal((await llamar(base, 'GET', '/api/usuarios?estado=rara', T.adminA)).status, 422);
    // el admin de otra empresa no ve nada de ese condominio aunque lo pida
    assert.deepEqual(await ids(T.adminB, `/api/usuarios?tipo=residente&complejo_id=${c1}&pageSize=100`), []);
  });

  it('un residente se guarda sin empresa y la lista no inventa una', async () => {
    const lista = (await llamar(base, 'GET', `/api/usuarios?tipo=residente&complejo_id=${c1}&pageSize=100`, T.adminA)).body.items as Record<string, unknown>[];
    for (const u of lista) {
      assert.equal(u.empresa_id, null);
      assert.ok(!('empresas_administradoras' in u));
    }
  });

  it('crear un residente con su departamento: queda como propietario o inquilino de esa unidad; ocupada, ajena o de otro condominio → 422', async () => {
    const libre = await prisma.unidad.create({ data: { codigo: 'T-301', tipo: 'Departamento', complejo_id: c1, empresa_id: d.empresaA.id, estado: 'activa' } });
    const alta = (extra: Record<string, unknown>, token = T.adminA) =>
      llamar(base, 'POST', '/api/usuarios', token, { nombre: 'Nuevo Vecino', email: `vecino${++seq}@personas.pe`, password: 'ClaveSegura123', complejo_id: c1, ...extra });
    const p = await alta({ rol: 'propietario', unidad_id: libre.id });
    assert.equal(p.status, 201, JSON.stringify(p.body));
    assert.equal((await prisma.unidad.findUniqueOrThrow({ where: { id: libre.id } })).propietario_id, p.body.id);
    assert.equal(p.body.empresa_id, null);
    assert.equal((await alta({ rol: 'propietario', unidad_id: libre.id })).status, 422, 'ya tiene propietario');
    const i = await alta({ rol: 'inquilino', unidad_id: libre.id });
    assert.equal(i.status, 201, JSON.stringify(i.body));
    assert.equal((await prisma.unidad.findUniqueOrThrow({ where: { id: libre.id } })).inquilino_id, i.body.id);
    assert.equal((await alta({ rol: 'inquilino', unidad_id: libre.id })).status, 422, 'ya tiene inquilino');
    assert.equal((await alta({ rol: 'propietario', unidad_id: d.unidadB1.id })).status, 422, 'unidad de otro condominio/empresa');
    const otraU = await prisma.unidad.create({ data: { codigo: 'T-302', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estado: 'activa' } });
    assert.equal((await alta({ rol: 'propietario', unidad_id: otraU.id })).status, 422, 'no es del condominio elegido');
    assert.equal((await alta({ rol: 'seguridad', unidad_id: libre.id })).status, 422, 'el personal no tiene departamento');
    assert.equal((await alta({ rol: 'propietario', unidad_id: 999999 })).status, 422);
  });

  it('editar el departamento de un residente: suelta el anterior, toma el nuevo y quitarlo lo deja sin departamento', async () => {
    const libre1 = await prisma.unidad.create({ data: { codigo: 'T-401', tipo: 'Departamento', complejo_id: c1, empresa_id: d.empresaA.id, estado: 'activa' } });
    const libre2 = await prisma.unidad.create({ data: { codigo: 'T-402', tipo: 'Departamento', complejo_id: c1, empresa_id: d.empresaA.id, estado: 'activa' } });
    const alta = await llamar(base, 'POST', '/api/usuarios', T.adminA, { nombre: 'Vecino Editable', email: `editable${++seq}@personas.pe`, password: 'ClaveSegura123', rol: 'propietario', complejo_id: c1, unidad_id: libre1.id });
    assert.equal(alta.status, 201, JSON.stringify(alta.body));
    const id = alta.body.id as number;

    const cambio = await llamar(base, 'PUT', `/api/usuarios/${id}`, T.adminA, { unidad_id: libre2.id });
    assert.equal(cambio.status, 200, JSON.stringify(cambio.body));
    assert.equal((await prisma.unidad.findUniqueOrThrow({ where: { id: libre1.id } })).propietario_id, null, 'suelta el departamento anterior');
    assert.equal((await prisma.unidad.findUniqueOrThrow({ where: { id: libre2.id } })).propietario_id, id, 'toma el nuevo');

    const deC = (await llamar(base, 'GET', `/api/usuarios?tipo=residente&complejo_id=${c1}&pageSize=100`, T.adminA)).body.items as { id: number; unidades: { codigo: string }[] }[];
    assert.equal(deC.find((u) => u.id === id)!.unidades[0]!.codigo, 'T-402', 'la lista muestra el departamento nuevo');

    const quitar = await llamar(base, 'PUT', `/api/usuarios/${id}`, T.adminA, { unidad_id: null });
    assert.equal(quitar.status, 200, JSON.stringify(quitar.body));
    assert.equal((await prisma.unidad.findUniqueOrThrow({ where: { id: libre2.id } })).propietario_id, null, 'lo deja sin departamento');
    const despues = (await llamar(base, 'GET', `/api/usuarios?tipo=residente&complejo_id=${c1}&pageSize=100`, T.adminA)).body.items as { id: number; unidades: { codigo: string }[] }[];
    assert.deepEqual(despues.find((u) => u.id === id)!.unidades, [], 'ya no tiene departamento');
  });

  it('cambiar de rol (propietario ↔ inquilino) deja el departamento con el nuevo rol', async () => {
    const libre = await prisma.unidad.create({ data: { codigo: 'T-403', tipo: 'Departamento', complejo_id: c1, empresa_id: d.empresaA.id, estado: 'activa' } });
    const alta = await llamar(base, 'POST', '/api/usuarios', T.adminA, { nombre: 'Vecino Que Cambia', email: `cambia${++seq}@personas.pe`, password: 'ClaveSegura123', rol: 'propietario', complejo_id: c1, unidad_id: libre.id });
    assert.equal(alta.status, 201, JSON.stringify(alta.body));
    const id = alta.body.id as number;

    const cambio = await llamar(base, 'PUT', `/api/usuarios/${id}`, T.adminA, { rol: 'inquilino' });
    assert.equal(cambio.status, 200, JSON.stringify(cambio.body));
    const unidad = await prisma.unidad.findUniqueOrThrow({ where: { id: libre.id } });
    assert.equal(unidad.propietario_id, null, 'ya no es propietario');
    assert.equal(unidad.inquilino_id, id, 'pasa a inquilino del mismo departamento');
  });

  it('personal: se crea con la empresa del admin y, opcionalmente, el condominio donde trabaja (de su empresa)', async () => {
    const r = await llamar(base, 'POST', '/api/usuarios', T.adminA, { nombre: 'Jardinero', email: 'jardinero@personas.pe', password: 'ClaveSegura123', rol: 'jardineria', complejo_id: c1 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.empresa_id, d.empresaA.id);
    assert.equal(r.body.complejo.nombre, 'Torres del Sol');
    assert.equal((await llamar(base, 'POST', '/api/usuarios', T.adminA, { nombre: 'Jardinero 2', email: 'jardinero2@personas.pe', password: 'ClaveSegura123', rol: 'jardineria', complejo_id: d.complejoB.id })).status, 422, 'condominio de otra empresa');
    const sinCondominio = await llamar(base, 'POST', '/api/usuarios', T.adminA, { nombre: 'Rotativo', email: 'rotativo@personas.pe', password: 'ClaveSegura123', rol: 'limpieza' });
    assert.equal(sinCondominio.status, 201, 'el condominio del personal es opcional');
  });
});
