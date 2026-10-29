import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { esperar, iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1' | 'prop2' | 'inq1' | 'mttoA' | 'mttoA2' | 'segA', string>;

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    super: await login(base, 'super@test.pe'),
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    prop1: await login(base, 'prop1@test.pe'),
    prop2: await login(base, 'prop2@test.pe'),
    inq1: await login(base, 'inq1@test.pe'),
    mttoA: await login(base, 'mtto.a@test.pe'),
    mttoA2: await login(base, 'mtto.a2@test.pe'),
    segA: await login(base, 'seg.a@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('residentes: /api/me/*', () => {
  it('el propietario lista sólo SUS cargos, con estado calculado, concepto, recibo, unidad y pagos', async () => {
    const r = await llamar(base, 'GET', '/api/me/cargos', T.prop1);
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 2);
    const porId = new Map<number, Record<string, any>>(r.body.items.map((c: { id: number }) => [c.id, c])); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.ok(!porId.has(d.cargoA2.id) && !porId.has(d.cargoB1.id), 'no ve cargos ajenos');
    const vencido = porId.get(d.cargoVencidoA1.id)!;
    const futuro = porId.get(d.cargoFuturoA1.id)!;
    assert.equal(vencido.estado, 'vencido');
    assert.equal(futuro.estado, 'pendiente');
    assert.equal(vencido.estado_pago, 'pendiente');
    assert.deepEqual(vencido.concepto, { nombre: 'Mantenimiento' });
    assert.equal(vencido.unidad.codigo, 'A-101');
    assert.deepEqual(Object.keys(vencido.recibo).sort(), ['anio', 'descripcion', 'estructura', 'fecha_vencimiento', 'id', 'mes']);
    assert.deepEqual(vencido.pagos, []);
    assert.equal(vencido.monto, '150');
  });

  it('filtra por estado=vencido|pendiente|pagado', async () => {
    const ids = async (estado: string) => (await llamar(base, 'GET', `/api/me/cargos?estado=${estado}`, T.prop1)).body.items.map((c: { id: number }) => c.id);
    assert.deepEqual(await ids('vencido'), [d.cargoVencidoA1.id]);
    assert.deepEqual(await ids('pendiente'), [d.cargoFuturoA1.id]);
    assert.deepEqual(await ids('pagado'), []);
    assert.equal((await llamar(base, 'GET', '/api/me/cargos?estado=raro', T.prop1)).status, 422);
  });

  it('un cargo ajeno responde 404 (no 403), también para inquilinos de otra unidad', async () => {
    assert.equal((await llamar(base, 'GET', `/api/me/cargos/${d.cargoA2.id}`, T.prop1)).status, 404);
    assert.equal((await llamar(base, 'GET', `/api/me/cargos/${d.cargoB1.id}`, T.prop1)).status, 404);
    assert.equal((await llamar(base, 'GET', `/api/me/cargos/${d.cargoVencidoA1.id}`, T.prop1)).status, 200);
    assert.equal((await llamar(base, 'GET', `/api/me/cargos/${d.cargoA2.id}`, T.inq1)).status, 404);
    assert.equal((await llamar(base, 'POST', `/api/me/cargos/${d.cargoA2.id}/pagos`, T.prop1, { metodo_pago: 'yape' })).status, 404);
    assert.equal((await prisma.reciboConceptoUnidad.findUnique({ where: { id: d.cargoA2.id } }))!.estado_pago, 'pendiente');
  });

  it('el inquilino ve la unidad que habita y sus cargos; /me/unidades trae el complejo', async () => {
    const u = await llamar(base, 'GET', '/api/me/unidades', T.inq1);
    assert.deepEqual(u.body.items.map((x: { codigo: string }) => x.codigo), ['A-101']);
    assert.equal(u.body.items[0].complejo.nombre, 'Complejo A');
    const p = await llamar(base, 'GET', '/api/me/unidades', T.prop1);
    assert.deepEqual(p.body.items.map((x: { codigo: string }) => x.codigo), ['A-101']);
    assert.equal((await llamar(base, 'GET', '/api/me/cargos', T.inq1)).body.total, 2);
    assert.equal((await llamar(base, 'GET', '/api/me/cargos', T.prop2)).body.total, 1);
  });

  it('pagar un cargo: registra el Pago por el monto, deja el cargo en revisión (sin fecha de pago), y no se puede pagar dos veces', async () => {
    const id = d.cargoFuturoA1.id;
    const r = await llamar(base, 'POST', `/api/me/cargos/${id}/pagos`, T.prop1, { metodo_pago: 'yape', referencia: 'OP-123', observaciones: 'desde la app' });
    assert.equal(r.status, 201);
    assert.equal(r.body.metodo_pago, 'yape');
    assert.equal(r.body.referencia, 'OP-123');
    assert.equal(r.body.monto, '200');
    assert.equal(r.body.estado_validacion, 'por_validar');
    assert.equal(r.body.cargo.estado, 'en_revision');
    const cargo = await prisma.reciboConceptoUnidad.findUnique({ where: { id }, include: { pagos: true } });
    assert.equal(cargo!.estado_pago, 'en_revision');
    assert.equal(cargo!.fecha_pago, null);
    assert.equal(cargo!.pagos.length, 1);
    assert.equal(cargo!.pagos[0].usuario_id, d.propietario1.id);
    assert.equal(String(cargo!.pagos[0].monto), '200');

    const otra = await llamar(base, 'POST', `/api/me/cargos/${id}/pagos`, T.prop1, { metodo_pago: 'efectivo' });
    assert.equal(otra.status, 409);
    const inquilino = await llamar(base, 'POST', `/api/me/cargos/${id}/pagos`, T.inq1, { metodo_pago: 'plin' });
    assert.equal(inquilino.status, 409);
    assert.equal(await prisma.pago.count({ where: { recibo_concepto_unidad_id: id } }), 1, 'sigue habiendo un solo pago');

    const pagos = await llamar(base, 'GET', '/api/me/pagos', T.prop1);
    assert.equal(pagos.body.total, 1);
    assert.equal(pagos.body.items[0].unidad.codigo, 'A-101');
    assert.equal((await llamar(base, 'GET', '/api/me/cargos?estado=pagado', T.prop1)).body.total, 0, 'en revisión todavía no es pagado');
    assert.equal((await llamar(base, 'GET', '/api/me/cargos?estado=en_revision', T.prop1)).body.total, 1);
  });

  it('dos pagos simultáneos del mismo cargo: exactamente uno entra (cierre atómico)', async () => {
    const id = d.cargoVencidoA1.id;
    const resultados = await Promise.all([T.prop1, T.inq1, T.prop1].map((t) => llamar(base, 'POST', `/api/me/cargos/${id}/pagos`, t, { metodo_pago: 'transferencia' })));
    const estados = resultados.map((r) => r.status).sort();
    assert.deepEqual(estados, [201, 409, 409]);
    assert.equal(await prisma.pago.count({ where: { recibo_concepto_unidad_id: id } }), 1);
  });

  it('valida el método de pago (422) y no acepta montos del cliente', async () => {
    const id = d.cargoA2.id;
    assert.equal((await llamar(base, 'POST', `/api/me/cargos/${id}/pagos`, T.prop2, { metodo_pago: 'bitcoin' })).status, 422);
    assert.equal((await llamar(base, 'POST', `/api/me/cargos/${id}/pagos`, T.prop2, {})).status, 422);
    const ok = await llamar(base, 'POST', `/api/me/cargos/${id}/pagos`, T.prop2, { metodo_pago: 'tarjeta', monto: 0.01 });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.monto, '150', 'el monto sale del cargo, no del cuerpo');
  });
});

describe('dashboard por rol', () => {
  it('admin: forma del resumen con sus números y sólo su empresa', async () => {
    const r = await llamar(base, 'GET', '/api/dashboard/resumen', T.adminB);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['cargos_pendientes_monto', 'cobrado_mes', 'cobrado_por_mes', 'estados', 'morosos', 'pagos_por_validar', 'palabra_estructura', 'por_torre', 'recibos_emitidos', 'recibos_total', 'tareas_abiertas', 'unidades_total']);
    assert.equal(r.body.recibos_emitidos, 1);
    assert.equal(r.body.cargos_pendientes_monto, '90.00');
    assert.equal(r.body.morosos, 1);
    assert.equal(r.body.unidades_total, 1);
    assert.equal(r.body.tareas_abiertas, 1);
    assert.deepEqual(r.body.estados, { pagado: 0, pendiente: 0, parcial: 0, vencido: 1, en_revision: 0 });
    assert.equal(r.body.cobrado_por_mes.length, 6);
    assert.match(r.body.cobrado_por_mes[5].mes, /^\d{4}-\d{2}$/);
    assert.deepEqual(Object.keys(r.body.cobrado_por_mes[0]).sort(), ['cobrado', 'emitido', 'mes']);
  });

  it('superadmin: global, con empresas_total y usuarios_total', async () => {
    const r = await llamar(base, 'GET', '/api/dashboard/resumen', T.super);
    assert.equal(r.body.empresas_total, 2);
    assert.equal(r.body.usuarios_total, 11);
    assert.equal(r.body.recibos_emitidos, 3);
    assert.equal(r.body.unidades_total, 3);
  });

  it('propietario: deuda, vencidos, próximo vencimiento y pagado del año', async () => {
    const r = await llamar(base, 'GET', '/api/dashboard/resumen', T.prop2);
    assert.deepEqual(Object.keys(r.body).sort(), ['deuda_total', 'en_revision', 'mantenimientos_en_revision', 'mantenimientos_vencidos', 'pagado_ano', 'proximo_mantenimiento', 'proximo_vencimiento', 'vencidos']);
    // prop2 pagó su único cargo en la prueba anterior, pero sigue en revisión: es «por cobrar», no moroso y no cuenta como pagado
    assert.equal(r.body.deuda_total, '150.00');
    assert.equal(r.body.en_revision, 1);
    assert.equal(r.body.vencidos, 0);
    assert.equal(r.body.proximo_vencimiento, null);
    assert.equal(r.body.proximo_mantenimiento, null);
    assert.equal(r.body.mantenimientos_vencidos, 0);
    assert.equal(r.body.mantenimientos_en_revision, 1, 'el mantenimiento en revisión (1 de 1 cargos)');
    assert.equal(r.body.pagado_ano, '0.00');
    const p1 = await llamar(base, 'GET', '/api/dashboard/resumen', T.prop1);
    assert.equal(p1.body.pagado_ano, '0.00', 'sus dos pagos siguen por validar');
    assert.equal(p1.body.en_revision, 2);
  });

  it('mantenimiento y seguridad reciben su propio resumen', async () => {
    const m = await llamar(base, 'GET', '/api/dashboard/resumen', T.mttoA);
    assert.deepEqual(m.body, { tareas_pendientes: 1, en_progreso: 0, completadas: 0 });
    const s = await llamar(base, 'GET', '/api/dashboard/resumen', T.segA);
    assert.deepEqual(s.body, { unidades_complejo: 2, complejo: { id: d.complejoA.id, nombre: 'Complejo A' } });
  });

  it('resumen de residente con deuda: próximo vencimiento apunta al cargo pendiente futuro', async () => {
    await prisma.pago.deleteMany({ where: { recibo_concepto_unidad_id: { in: [d.cargoFuturoA1.id, d.cargoVencidoA1.id] } } });
    await prisma.reciboConceptoUnidad.update({ where: { id: d.cargoFuturoA1.id }, data: { estado_pago: 'pendiente', fecha_pago: null } });
    await prisma.reciboConceptoUnidad.update({ where: { id: d.cargoVencidoA1.id }, data: { estado_pago: 'pendiente', fecha_pago: null } });
    const r = await llamar(base, 'GET', '/api/dashboard/resumen', T.inq1);
    assert.equal(r.body.deuda_total, '350.00');
    assert.equal(r.body.vencidos, 1);
    assert.equal(r.body.proximo_vencimiento.cargo_id, d.cargoFuturoA1.id);
    assert.equal(r.body.proximo_vencimiento.monto, '200.00');
    // a nivel mantenimiento: el recibo vencido es un mantenimiento vencido y el futuro es el próximo
    assert.equal(r.body.mantenimientos_vencidos, 1);
    assert.equal(r.body.proximo_mantenimiento.monto, '200.00');
    assert.equal(r.body.proximo_mantenimiento.recibo_id, d.reciboFuturoA.id);
    assert.equal(r.body.proximo_mantenimiento.titulo, 'Mantenimiento de octubre de 2026 · A-101');
  });
});

describe('recibos y cargos (admin)', () => {
  it('POST /api/recibos genera los conceptos y un cargo por cada unidad activa del complejo', async () => {
    await prisma.unidad.create({ data: { codigo: 'A-103', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estado: 'inactiva' } });
    const r = await llamar(base, 'POST', '/api/recibos', T.adminA, {
      complejo_id: d.complejoA.id, mes: 11, anio: 2026, fecha_emision: '2026-11-01', fecha_vencimiento: '2026-11-15', descripcion: 'Noviembre',
      conceptos: [{ concepto_id: d.conceptoA.id, monto: 120.5 }, { concepto_id: d.conceptoA.id, monto: '30', es_recargo: true }],
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.empresa_id, d.empresaA.id);
    assert.equal(r.body.estado, 'emitido');
    assert.equal(r.body.totales.monto, '301.00'); // 2 unidades activas × (120.50 + 30)
    assert.equal(r.body.totales.cobrado, '0.00');
    assert.equal(r.body.totales.pendiente, '301.00');
    assert.equal(await prisma.reciboConcepto.count({ where: { recibo_id: r.body.id } }), 2);
    assert.equal(await prisma.reciboConceptoUnidad.count({ where: { reciboConcepto: { recibo_id: r.body.id } } }), 4);

    const detalle = await llamar(base, 'GET', `/api/recibos/${r.body.id}`, T.adminA);
    assert.equal(detalle.status, 200);
    assert.equal(detalle.body.conceptos.length, 2);
    assert.equal(detalle.body.cargos.length, 4);
    assert.deepEqual(Object.keys(detalle.body.cargos[0]).sort(), ['concepto', 'estado', 'id', 'monto', 'unidad']);
    assert.deepEqual(detalle.body.cargos[0].unidad, { id: d.unidadA1.id, codigo: 'A-101', estructura: null });
    assert.equal(detalle.body.cargos[0].concepto.nombre, 'Mantenimiento');
    assert.equal(detalle.body.cargos[0].estado, 'pendiente');
    assert.equal(detalle.body.complejo.nombre, 'Complejo A');
  });

  it('un recibo no admite conceptos de otra empresa ni un complejo ajeno (422) y no deja datos a medias', async () => {
    const antes = await prisma.recibo.count();
    const cruzado = await llamar(base, 'POST', '/api/recibos', T.adminA, { complejo_id: d.complejoA.id, mes: 12, anio: 2026, fecha_emision: '2026-12-01', fecha_vencimiento: '2026-12-15', conceptos: [{ concepto_id: d.conceptoB.id, monto: 10 }] });
    assert.equal(cruzado.status, 422);
    const ajeno = await llamar(base, 'POST', '/api/recibos', T.adminA, { complejo_id: d.complejoB.id, mes: 12, anio: 2026, fecha_emision: '2026-12-01', fecha_vencimiento: '2026-12-15' });
    assert.equal(ajeno.status, 422);
    assert.equal(await prisma.recibo.count(), antes);
  });

  it('lista de recibos: complejo, totales calculados y estado', async () => {
    const r = await llamar(base, 'GET', `/api/recibos?complejo_id=${d.complejoA.id}&orden=mes:asc`, T.adminA);
    const agosto = r.body.items.find((x: { id: number }) => x.id === d.reciboVencidoA.id);
    assert.equal(agosto.complejo.nombre, 'Complejo A');
    assert.equal(agosto.estado, 'emitido');
    assert.equal(agosto.totales.monto, '300.00');
    assert.equal(agosto.totales.cobrado, '0.00', 'el pago de prop2 sigue por validar');
    assert.equal(agosto.totales.en_revision, '150.00');
    assert.equal(agosto.totales.pendiente, '300.00', 'lo que está en revisión sigue por cobrar');
    assert.equal(agosto.estado_cobranza, 'vencido');
  });

  it('cargos: filtro por estado y búsqueda por código de unidad; incluye unidad, concepto, recibo y estado', async () => {
    const v = await llamar(base, 'GET', '/api/recibo-concepto-unidades?estado=vencido', T.adminA);
    assert.ok(v.body.items.length >= 1 && v.body.items.every((c: { estado: string }) => c.estado === 'vencido'));
    const q = await llamar(base, 'GET', '/api/recibo-concepto-unidades?q=A-102', T.adminA);
    assert.ok(q.body.items.length >= 1 && q.body.items.every((c: { unidad: { codigo: string } }) => c.unidad.codigo === 'A-102'));
    const c = q.body.items[0];
    assert.deepEqual(Object.keys(c.recibo).sort(), ['anio', 'descripcion', 'estructura', 'fecha_vencimiento', 'id', 'mes']);
    assert.equal(c.concepto.nombre, 'Mantenimiento');
    assert.ok(!(await llamar(base, 'GET', '/api/recibo-concepto-unidades?pageSize=100', T.adminA)).body.items.some((x: { id: number }) => x.id === d.cargoB1.id));
  });

  it('pagos: incluyen unidad, concepto y usuario; filtro metodo_pago; un pago de admin cubre el cargo y borrarlo lo reabre', async () => {
    const lista = await llamar(base, 'GET', '/api/pagos?metodo_pago=tarjeta', T.adminA);
    assert.equal(lista.body.total, 1);
    assert.equal(lista.body.items[0].unidad.codigo, 'A-102');
    assert.equal(lista.body.items[0].concepto.nombre, 'Mantenimiento');
    assert.equal(lista.body.items[0].usuario.nombre, 'Propietario 2');

    const sobrante = await llamar(base, 'POST', '/api/pagos', T.adminA, { recibo_concepto_unidad_id: d.cargoFuturoA1.id, monto: 500, metodo_pago: 'efectivo' });
    assert.equal(sobrante.status, 422, 'excede el saldo');
    const ajeno = await llamar(base, 'POST', '/api/pagos', T.adminA, { recibo_concepto_unidad_id: d.cargoB1.id, monto: 10, metodo_pago: 'efectivo' });
    assert.equal(ajeno.status, 422);
    const ok = await llamar(base, 'POST', '/api/pagos', T.adminA, { recibo_concepto_unidad_id: d.cargoFuturoA1.id, monto: 200, metodo_pago: 'efectivo' });
    assert.equal(ok.status, 201);
    assert.equal((await prisma.reciboConceptoUnidad.findUnique({ where: { id: d.cargoFuturoA1.id } }))!.estado_pago, 'pagado');
    assert.equal((await llamar(base, 'DELETE', `/api/pagos/${ok.body.id}`, T.adminA)).status, 204);
    const reabierto = await prisma.reciboConceptoUnidad.findUnique({ where: { id: d.cargoFuturoA1.id } });
    assert.equal(reabierto!.estado_pago, 'pendiente');
    assert.equal(reabierto!.fecha_pago, null);
  });

  it('reporte de morosidad: unidades con deuda vencida, paginado, sólo de la empresa del admin', async () => {
    const r = await llamar(base, 'GET', '/api/reportes/morosidad', T.adminA);
    assert.equal(r.status, 200);
    const a101 = r.body.items.find((x: { unidad: { codigo: string } }) => x.unidad.codigo === 'A-101');
    assert.ok(a101);
    assert.deepEqual(Object.keys(a101).sort(), ['cargos_vencidos', 'complejo', 'deuda_total', 'dias_max_atraso', 'estructura', 'propietario', 'unidad']);
    assert.equal(a101.deuda_total, '150.00');
    assert.equal(a101.cargos_vencidos, 1);
    assert.equal(a101.dias_max_atraso, 30);
    assert.deepEqual(a101.propietario, { id: d.propietario1.id, nombre: 'Propietario 1' });
    assert.ok(!r.body.items.some((x: { unidad: { codigo: string } }) => x.unidad.codigo === 'B-101'));
    assert.deepEqual(Object.keys(r.body).sort(), ['items', 'page', 'pageSize', 'resumen', 'total']);
    const global = await llamar(base, 'GET', '/api/reportes/morosidad?orden=codigo:desc&pageSize=1', T.super);
    assert.equal(global.body.items.length, 1);
    assert.equal(global.body.items[0].unidad.codigo, 'B-101');
    assert.ok(global.body.total >= 2);
    assert.equal((await llamar(base, 'GET', '/api/reportes/morosidad?pageSize=500', T.adminA)).status, 422);
  });
});

describe('unidades e inquilinos', () => {
  it('las unidades incluyen propietario, inquilino y complejo; el admin asigna un inquilino de su empresa', async () => {
    const r = await llamar(base, 'GET', '/api/unidades?q=A-101', T.adminA);
    const u = r.body.items[0];
    assert.deepEqual(u.propietario, { id: d.propietario1.id, nombre: 'Propietario 1' });
    assert.deepEqual(u.inquilino, { id: d.inquilino1.id, nombre: 'Inquilino 1' });
    assert.deepEqual(u.complejo, { id: d.complejoA.id, nombre: 'Complejo A' });
    const mal = await llamar(base, 'PUT', `/api/unidades/${d.unidadA2.id}`, T.adminA, { inquilino_id: d.propietario1.id });
    assert.equal(mal.status, 422, 'un propietario no puede ser inquilino');
    const ok = await llamar(base, 'PUT', `/api/unidades/${d.unidadA2.id}`, T.adminA, { inquilino_id: d.inquilino1.id });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.inquilino.nombre, 'Inquilino 1');
  });

  it('el empresa_id de una unidad se deriva de su complejo aunque el cliente envíe otro', async () => {
    const r = await llamar(base, 'POST', '/api/unidades', T.super, { codigo: 'Z-1', tipo: 'Local', complejo_id: d.complejoB.id, empresa_id: d.empresaA.id });
    assert.equal(r.status, 201);
    assert.equal(r.body.empresa_id, d.empresaB.id);
  });
});

describe('tareas', () => {
  it('PATCH /api/tareas/:id/estado: mantenimiento cambia las SUYAS; las ajenas dan 404; estado inválido 422', async () => {
    const ok = await llamar(base, 'PATCH', `/api/tareas/${d.tareaA.id}/estado`, T.mttoA, { estado: 'en_progreso' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.estado, 'en_progreso');
    assert.equal(ok.body.fecha_cierre, null);
    const hecho = await llamar(base, 'PATCH', `/api/tareas/${d.tareaA.id}/estado`, T.mttoA, { estado: 'completada' });
    assert.equal(hecho.body.estado, 'completada');
    assert.ok(hecho.body.fecha_cierre);
    assert.equal((await llamar(base, 'PATCH', `/api/tareas/${d.tareaOtra.id}/estado`, T.mttoA, { estado: 'completada' })).status, 404);
    assert.equal((await prisma.tareaMantenimiento.findUnique({ where: { id: d.tareaOtra.id } }))!.estado, 'pendiente');
    assert.equal((await llamar(base, 'PATCH', `/api/tareas/${d.tareaA.id}/estado`, T.mttoA, { estado: 'en_proceso' })).status, 422);
    assert.equal((await llamar(base, 'PATCH', `/api/tareas/${d.tareaB.id}/estado`, T.adminA, { estado: 'completada' })).status, 404);
    assert.equal((await llamar(base, 'PATCH', `/api/tareas/${d.tareaA.id}/estado`, T.prop1, { estado: 'completada' })).status, 403);
  });

  it('el admin crea tareas (asignando a mantenimiento de su empresa) y filtra por estado y asignado', async () => {
    const r = await llamar(base, 'POST', '/api/tareas', T.adminA, { titulo: 'Cambiar focos', descripcion: 'Pasillo', unidad_id: d.unidadA1.id, asignado_id: d.mantenimientoA2.id });
    assert.equal(r.status, 201);
    assert.equal(r.body.estado, 'pendiente');
    assert.equal(r.body.asignado.nombre, 'Mantenimiento A2');
    assert.equal(r.body.unidad.codigo, 'A-101');
    const noMtto = await llamar(base, 'POST', '/api/tareas', T.adminA, { titulo: 'x', asignado_id: d.propietario1.id });
    assert.equal(noMtto.status, 422);
    const f = await llamar(base, 'GET', `/api/tareas?estado=pendiente&asignado_id=${d.mantenimientoA2.id}`, T.adminA);
    assert.equal(f.body.total, 2);
    assert.equal((await llamar(base, 'GET', '/api/tareas?estado=raro', T.adminA)).status, 422);
    assert.equal((await llamar(base, 'GET', '/api/tareas', T.mttoA2)).body.total, 2);
  });
});

describe('auditoría', () => {
  it('registra mutaciones exitosas con usuario, entidad, id e IP, sin guardar contraseñas', async () => {
    const r = await llamar(base, 'POST', '/api/usuarios', T.adminA, { nombre: 'Auditado', email: 'auditado@test.pe', rol: 'inquilino', password: 'ClaveSuperSecreta1', complejo_id: d.complejoA.id });
    assert.equal(r.status, 201);
    const fila = await esperar(() => prisma.auditoria.findFirst({ where: { entidad: 'usuario', accion: 'crear', entidad_id: r.body.id } }));
    assert.equal(fila.usuario_id, d.adminA.id);
    assert.ok(fila.ip);
    assert.ok(!JSON.stringify(fila).includes('ClaveSuperSecreta1'));
    assert.equal((fila.detalle as Record<string, unknown>).password, '[omitido]');

    const e = await llamar(base, 'PUT', `/api/usuarios/${r.body.id}`, T.adminA, { nombre: 'Auditado 2' });
    assert.equal(e.status, 200);
    await esperar(() => prisma.auditoria.findFirst({ where: { entidad: 'usuario', accion: 'editar', entidad_id: r.body.id } }));
    assert.equal((await llamar(base, 'DELETE', `/api/usuarios/${r.body.id}`, T.adminA)).status, 204);
    await esperar(() => prisma.auditoria.findFirst({ where: { entidad: 'usuario', accion: 'eliminar', entidad_id: r.body.id } }));
  });

  it('no registra lecturas ni mutaciones fallidas; sí logins correctos y fallidos (sin contraseña)', async () => {
    const antes = await prisma.auditoria.count();
    await llamar(base, 'GET', '/api/unidades', T.adminA);
    await llamar(base, 'POST', '/api/usuarios', T.adminA, { nombre: '' });
    await llamar(base, 'DELETE', `/api/unidades/${d.unidadB1.id}`, T.adminA);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(await prisma.auditoria.count(), antes);

    await llamar(base, 'POST', '/api/auth/login', null, { email: 'seg.a@test.pe', password: 'clave-equivocada-123' });
    const fallo = await esperar(() => prisma.auditoria.findFirst({ where: { accion: 'login_fallido', usuario_id: d.seguridadA.id } }));
    assert.equal(fallo.entidad_id, d.seguridadA.id);
    assert.equal(fallo.detalle, null, 'con cuenta real se guarda el id, no el correo tecleado');
    assert.ok(!JSON.stringify(fallo).includes('clave-equivocada'));
    assert.ok(await prisma.auditoria.findFirst({ where: { accion: 'login', usuario_id: d.adminA.id } }));
  });

  it('GET /api/auditoria (superadmin) pagina y filtra por entidad, accion y usuario_id', async () => {
    const todo = await llamar(base, 'GET', '/api/auditoria?pageSize=5', T.super);
    assert.equal(todo.status, 200);
    assert.ok(todo.body.total > 5);
    assert.equal(todo.body.items.length, 5);
    assert.equal(todo.body.pageSize, 5);
    const crear = await llamar(base, 'GET', '/api/auditoria?entidad=usuario&accion=crear', T.super);
    assert.ok(crear.body.total >= 1 && crear.body.items.every((x: { entidad: string; accion: string }) => x.entidad === 'usuario' && x.accion === 'crear'));
    const deAdmin = await llamar(base, 'GET', `/api/auditoria?usuario_id=${d.adminA.id}`, T.super);
    assert.ok(deAdmin.body.total >= 1 && deAdmin.body.items.every((x: { usuario_id: number }) => x.usuario_id === d.adminA.id));
    assert.equal((await llamar(base, 'GET', '/api/auditoria?usuario_id=abc', T.super)).status, 422);
    assert.ok(!JSON.stringify(todo.body).includes('password_hash'));
  });
});
