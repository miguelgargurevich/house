// Solo lectura al terminar el periodo gratis: el BACKEND es la fuente de verdad. Cada acción que crea trabajo responde 409 `SOLO_LECTURA`; todo lo que lee,
// Mi plan, el perfil y lo del superadmin siguen funcionando; pagar un plan de pago levanta el bloqueo; otro tenant da 404, no 409.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { cabecerasDeSesion, iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { pagarCargo, pagarComoResidente } from './helpers/pagoResidente';
import { invalidarComercial } from '../src/server/services/comercial/modulos';
import { MENSAJE_SOLO_LECTURA, MENSAJE_SOLO_LECTURA_VECINO } from '../src/server/services/comercial/operativo';
import { hoyLima } from '../src/server/lib/fechas';

const DIA = 86_400_000;
const HOY = () => hoyLima().getTime();
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('solo-lectura')]);

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1' | 'inq1', string>;
let ids: { rc: number; estructura: number; pago: number; comunicado: number; notificacion: number; egreso: number };

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'), prop1: await login(base, 'prop1@test.pe'), inq1: await login(base, 'inq1@test.pe') };
  const rc = await prisma.reciboConcepto.findFirstOrThrow({ where: { recibo_id: d.reciboVencidoA.id } });
  const estructura = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
  const pago = await prisma.pago.create({ data: { recibo_concepto_unidad_id: d.cargoA2.id, monto: 150, metodo_pago: 'yape', estado_validacion: 'por_validar', usuario_id: d.propietario2.id } });
  const comunicado = await prisma.comunicado.create({ data: { complejo_id: d.complejoA.id, titulo: 'Aviso', cuerpo: 'Texto del aviso del condominio.', autor_id: d.adminA.id } });
  const notificacion = await prisma.notificacion.create({ data: { usuario_id: d.propietario1.id, canal: 'correo', tipo: 'por_vencer', asunto: 'a', cuerpo: 'b', estado: 'error', ref_entidad: 'recibo', ref_id: d.reciboVencidoA.id } });
  const egreso = await prisma.egresoBlock.create({ data: { estructura_id: estructura.id, complejo_id: d.complejoA.id, mes: 8, anio: 2026, linea: 'administradora', destino: 'administradora', facturado: 100, monto_pagado: 100, fecha_pago: new Date('2026-09-02') } as never });
  ids = { rc: rc.id, estructura: estructura.id, pago: pago.id, comunicado: comunicado.id, notificacion: notificacion.id, egreso: egreso.id };
});
after(async () => { await cerrar(); await prisma.$disconnect(); });

/** El condominio A terminó su periodo gratis ayer (solo lectura); el B sigue en cortesía. */
const enSoloLectura = async () => {
  await prisma.suscripcionCondominio.upsert({
    where: { complejo_id: d.complejoA.id },
    create: { complejo_id: d.complejoA.id, plan_clave: 'gratis', estado: 'gratis', gratis_hasta: new Date(HOY() - DIA) },
    update: { plan_clave: 'gratis', modulos: [], estado: 'gratis', es_prueba: false, vigente_hasta: null, solicitud_plan: null, solicitud_modulos: [], gratis_hasta: new Date(HOY() - DIA) },
  });
  invalidarComercial();
};
beforeEach(enSoloLectura);
afterEach(() => invalidarComercial());

const api = (t: string | null, m: string, ruta: string, cuerpo?: unknown) => llamar(base, m, ruta, t, cuerpo);
const crudo = (metodo: string, ruta: string, token: string, cuerpo: Buffer, tipo = 'image/png') =>
  fetch(base + ruta, { method: metodo, headers: { ...cabecerasDeSesion(token), 'content-type': tipo, 'x-nombre-archivo': 'v.png' }, body: new Uint8Array(cuerpo) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const formulario = (ruta: string, token: string, campos: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, v);
  return fetch(base + ruta, { method: 'POST', headers: cabecerasDeSesion(token), body: fd }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
};
/** 409 con el código y el mensaje de siempre (el de la administración, o el del vecino). */
const bloqueada = (r: { status: number; body: { error?: string; code?: string } | null }, mensaje = MENSAJE_SOLO_LECTURA) => {
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.deepEqual([r.body?.error, r.body?.code], [mensaje, 'SOLO_LECTURA']);
};
const lectura = (m: number, extra: Record<string, unknown> = {}) => ({ unidad_id: d.unidadA1.id, fecha_anterior: '2026-09-01', lectura_anterior: '100', fecha_actual: '2026-10-01', lectura_actual: String(100 + m), factor: '1', ...extra });

describe('el mensaje', () => {
  it('es el pedido por Miguel, palabra por palabra', () => {
    assert.equal(MENSAJE_SOLO_LECTURA, 'Este condominio está en solo lectura: terminó su periodo gratis. Pásalo a Torre Pro desde Mi plan para seguir registrando.');
  });
});

describe('solo lectura: la administración no registra nada nuevo (409)', () => {
  const emision = { complejo_id: 0, mes: 12, anio: 2026, fecha_emision: iso(HOY()), fecha_vencimiento: iso(HOY() + 20 * DIA), conceptos: [] as unknown[] };

  it('recibos: emitir, importar el Excel, editar y borrar', async () => {
    bloqueada(await api(T.adminA, 'POST', '/api/recibos', { ...emision, complejo_id: d.complejoA.id, conceptos: [{ concepto_id: d.conceptoA.id, monto: 100 }] }));
    bloqueada(await formulario('/api/recibos/excel', T.adminA, { complejo_id: String(d.complejoA.id) }));
    bloqueada(await api(T.adminA, 'PUT', `/api/recibos/${d.reciboFuturoA.id}`, { descripcion: 'otra' }));
    bloqueada(await api(T.adminA, 'DELETE', `/api/recibos/${d.reciboFuturoA.id}`));
    assert.equal(await prisma.recibo.count({ where: { id: d.reciboFuturoA.id } }), 1, 'no se borró nada');
  });

  it('conceptos del recibo y cargos por departamento', async () => {
    bloqueada(await api(T.adminA, 'POST', '/api/recibo-conceptos', { recibo_id: d.reciboFuturoA.id, concepto_id: d.conceptoA.id, monto: 10 }));
    bloqueada(await api(T.adminA, 'PUT', `/api/recibo-conceptos/${ids.rc}`, { monto: 11 }));
    bloqueada(await api(T.adminA, 'POST', '/api/recibo-concepto-unidades', { recibo_concepto_id: ids.rc, unidad_id: d.unidadA2.id, monto: 12 }));
    bloqueada(await api(T.adminA, 'PUT', `/api/recibo-concepto-unidades/${d.cargoA2.id}`, { monto: 13 }));
    bloqueada(await api(T.adminA, 'DELETE', `/api/recibo-concepto-unidades/${d.cargoA2.id}`));
  });

  it('lecturas de agua: guardar, importar, quitar, foto del contómetro y fecha de corte', async () => {
    const r = d.reciboVencidoA.id;
    bloqueada(await api(T.adminA, 'PUT', `/api/recibos/${r}/agua`, { lecturas: [lectura(10)] }));
    bloqueada(await formulario(`/api/recibos/${r}/agua/excel`, T.adminA, {}));
    bloqueada(await api(T.adminA, 'DELETE', `/api/recibos/${r}/agua/${d.unidadA1.id}`));
    bloqueada(await crudo('PUT', `/api/recibos/${r}/agua/${d.unidadA1.id}/foto`, T.adminA, PNG));
    bloqueada(await api(T.adminA, 'DELETE', `/api/recibos/${r}/agua/${d.unidadA1.id}/foto`));
    bloqueada(await api(T.adminA, 'PUT', `/api/recibos/${r}/datos`, { fecha_corte_agua: '2026-11-10' }));
  });

  it('pagos: registrarlos (admin), el del mantenimiento, editar y borrar', async () => {
    bloqueada(await api(T.adminA, 'POST', '/api/pagos', { recibo_concepto_unidad_id: d.cargoVencidoA1.id, monto: 50, metodo_pago: 'efectivo' }));
    bloqueada(await api(T.adminA, 'POST', `/api/recibos/${d.reciboVencidoA.id}/mantenimientos/${d.unidadA1.id}/pagos`, { metodo_pago: 'efectivo' }));
    bloqueada(await api(T.adminA, 'PUT', `/api/pagos/${ids.pago}`, { referencia: 'X' }));
    bloqueada(await api(T.adminA, 'DELETE', `/api/pagos/${ids.pago}`));
    bloqueada(await api(T.adminA, 'POST', `/api/recibos/${d.reciboVencidoA.id}/mantenimientos/${d.unidadA1.id}/quitar-multa`, { motivo: 'Acuerdo con la junta' }));
    assert.equal(await prisma.pago.count({ where: { recibo_concepto_unidad_id: d.cargoVencidoA1.id } }), 0, 'no se registró ningún pago');
  });

  it('pagos de la junta: la junta tampoco registra (el mensaje la manda con su administración)', async () => {
    await prisma.usuario.update({ where: { id: d.propietario1.id }, data: { cargo_junta: 'presidente' } });
    try {
      bloqueada(await api(T.prop1, 'POST', `/api/recibos/${d.reciboVencidoA.id}/mantenimientos/${d.unidadA1.id}/pagos`, { metodo_pago: 'efectivo' }), MENSAJE_SOLO_LECTURA_VECINO);
      bloqueada(await api(T.prop1, 'PUT', `/api/recibos/${d.reciboVencidoA.id}/agua`, { lecturas: [lectura(10)] }), MENSAJE_SOLO_LECTURA_VECINO);
      bloqueada(await api(T.prop1, 'POST', '/api/comunicados', { titulo: 'Corte', cuerpo: 'Texto del comunicado de la junta.' }), MENSAJE_SOLO_LECTURA_VECINO);
    } finally {
      await prisma.usuario.update({ where: { id: d.propietario1.id }, data: { cargo_junta: null } });
    }
  });

  it('comprobantes: subir, validar o rechazar, la conformidad y la evaluación', async () => {
    bloqueada(await crudo('POST', `/api/pagos/${ids.pago}/comprobante`, T.adminA, PNG));
    bloqueada(await api(T.adminA, 'PATCH', `/api/pagos/${ids.pago}/validacion`, { estado: 'validado' }));
    bloqueada(await api(T.adminA, 'PATCH', `/api/pagos/${ids.pago}/validacion`, { estado: 'rechazado', motivo: 'Borroso' }));
    bloqueada(await api(T.adminA, 'POST', `/api/pagos/${ids.pago}/evaluacion`));
    assert.equal((await prisma.pago.findUniqueOrThrow({ where: { id: ids.pago } })).estado_validacion, 'por_validar', 'el pago sigue como estaba');
  });

  it('comunicados y avisos: crear, editar, archivar y reenviar un aviso', async () => {
    bloqueada(await api(T.adminA, 'POST', '/api/comunicados', { complejo_id: d.complejoA.id, titulo: 'Corte de agua', cuerpo: 'El sábado de 9:00 a 13:00 no habrá agua.' }));
    bloqueada(await api(T.adminA, 'PUT', `/api/comunicados/${ids.comunicado}`, { titulo: 'Otro título' }));
    bloqueada(await api(T.adminA, 'POST', `/api/comunicados/${ids.comunicado}/archivar`));
    bloqueada(await api(T.adminA, 'POST', `/api/recibos/${d.reciboVencidoA.id}/avisar`));
    bloqueada(await api(T.adminA, 'POST', `/api/notificaciones/${ids.notificacion}/reenviar`));
    assert.equal((await prisma.comunicado.findUniqueOrThrow({ where: { id: ids.comunicado } })).archivado_at, null);
    assert.equal((await prisma.notificacion.findUniqueOrThrow({ where: { id: ids.notificacion } })).estado, 'error', 'no se reencoló');
  });

  it('cierres: pago de una línea, quitarlo, conformidad y movimientos de la Junta central', async () => {
    bloqueada(await api(T.adminA, 'POST', `/api/cierres/block/${ids.estructura}/lineas`, { mes: 8, anio: 2026, linea: 'central', fecha_pago: '2026-10-02' }));
    bloqueada(await api(T.adminA, 'DELETE', `/api/cierres/lineas/${ids.egreso}`));
    bloqueada(await api(T.adminA, 'PUT', `/api/cierres/lineas/${ids.egreso}/conformidad`));
    bloqueada(await api(T.adminA, 'POST', `/api/cierres/central/movimientos?complejo_id=${d.complejoA.id}`, { tipo: 'egreso', categoria: 'otro', monto: 10, fecha: '2026-10-02', descripcion: 'Pintura' }));
    assert.equal(await prisma.egresoBlock.count({ where: { id: ids.egreso } }), 1, 'no se borró nada');
  });

  it('unidades, blocks, pisos, conceptos y proveedores: crear (y editar lo que ya hay)', async () => {
    bloqueada(await api(T.adminA, 'POST', '/api/unidades', { codigo: 'A-999', tipo: 'Departamento', complejo_id: d.complejoA.id }));
    bloqueada(await api(T.adminA, 'PUT', `/api/unidades/${d.unidadA2.id}`, { descripcion: 'x' }));
    bloqueada(await api(T.adminA, 'POST', '/api/estructuras', { nombre: 'Block 9', tipo: 'Block', complejo_id: d.complejoA.id }));
    bloqueada(await api(T.adminA, 'POST', `/api/estructuras/${ids.estructura}/asignar-unidades`));
    bloqueada(await api(T.adminA, 'POST', '/api/pisos', { estructura_id: ids.estructura, numero: 3 }));
    // Conceptos y proveedores son de la empresa: se bloquean cuando TODOS sus condominios están en solo lectura (la empresa A sólo tiene el A).
    bloqueada(await api(T.adminA, 'POST', '/api/conceptos', { nombre: 'Concepto nuevo', tipo_monto: 'fijo' }));
    bloqueada(await api(T.adminA, 'POST', '/api/proveedores', { razon_social: 'Ascensores SAC', rubro: 'ascensores' }));
    assert.equal(await prisma.unidad.count({ where: { codigo: 'A-999' } }), 0);
  });

  it('un concepto de la empresa se puede crear mientras otro condominio de la empresa sigue operando', async () => {
    const otro = await prisma.complejoHabitacional.create({ data: { nombre: 'Otro de A', tipo: 'Edificio', empresa_id: d.empresaA.id } });
    await prisma.suscripcionCondominio.create({ data: { complejo_id: otro.id, plan_clave: 'cortesia', modulos: ['ia_vouchers'], estado: 'activa' } });
    invalidarComercial();
    try {
      assert.equal((await api(T.adminA, 'POST', '/api/conceptos', { nombre: 'Concepto con otro operativo', tipo_monto: 'fijo' })).status, 201);
      // Pero lo que es del condominio en solo lectura sigue bloqueado.
      bloqueada(await api(T.adminA, 'POST', '/api/unidades', { codigo: 'A-998', tipo: 'Departamento', complejo_id: d.complejoA.id }));
    } finally {
      await prisma.concepto.deleteMany({ where: { nombre: 'Concepto con otro operativo' } });
      await prisma.suscripcionCondominio.deleteMany({ where: { complejo_id: otro.id } });
      await prisma.complejoHabitacional.delete({ where: { id: otro.id } });
    }
  });
});

describe('solo lectura: el vecino ve su historial, pero no sube vouchers', () => {
  it('subir el voucher del mantenimiento o de un cargo: 409 con «habla con tu administración», y no se crea nada', async () => {
    const antes = await prisma.pago.count();
    const m = await pagarComoResidente(base, T.prop1, d.reciboVencidoA.id, d.unidadA1.id);
    bloqueada({ status: m.status, body: m.body }, MENSAJE_SOLO_LECTURA_VECINO);
    const c = await pagarCargo(base, T.prop1, d.cargoVencidoA1.id);
    bloqueada({ status: c.status, body: c.body }, MENSAJE_SOLO_LECTURA_VECINO);
    const inq = await pagarComoResidente(base, T.inq1, d.reciboVencidoA.id, d.unidadA1.id);
    bloqueada({ status: inq.status, body: inq.body }, MENSAJE_SOLO_LECTURA_VECINO);
    assert.equal(await prisma.pago.count(), antes);
    assert.match(MENSAJE_SOLO_LECTURA_VECINO, /Habla con tu administración/);
  });

  it('su historial, sus cargos y el detalle de cada mantenimiento siguen a la vista', async () => {
    for (const ruta of ['/api/me/mantenimientos', '/api/me/cargos', `/api/me/mantenimientos/${d.reciboVencidoA.id}/${d.unidadA1.id}`, `/api/me/cargos/${d.cargoVencidoA1.id}`]) {
      const r = await api(T.prop1, 'GET', ruta);
      assert.equal(r.status, 200, `${ruta}: ${r.texto}`);
    }
  });
});

describe('solo lectura: lo que sigue permitido', () => {
  it('la administración lee todas sus pantallas', async () => {
    for (const ruta of ['/api/recibos', `/api/recibos/${d.reciboVencidoA.id}`, `/api/recibos/${d.reciboVencidoA.id}/agua`, '/api/pagos', '/api/unidades', '/api/conceptos', '/api/proveedores', '/api/comunicados', '/api/estructuras', '/api/cierres/block/' + ids.estructura + '?mes=8&anio=2026', '/api/notificaciones', '/api/dashboard/resumen']) {
      const r = await api(T.adminA, 'GET', ruta);
      assert.ok(r.status === 200 || r.status === 404, `${ruta}: ${r.status} ${r.texto}`);
      assert.notEqual(r.body?.code, 'SOLO_LECTURA', ruta);
    }
    assert.equal((await api(T.adminA, 'GET', '/api/recibos')).status, 200);
    assert.equal((await api(T.adminA, 'GET', '/api/pagos')).status, 200);
    assert.equal((await api(T.adminA, 'GET', '/api/unidades')).status, 200);
  });

  it('Mi plan, solicitar un plan, el perfil y la contraseña no se bloquean', async () => {
    assert.equal((await api(T.adminA, 'GET', '/api/comercial/mi-plan')).status, 200);
    const sol = await api(T.adminA, 'POST', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, { plan: 'basico' });
    assert.equal(sol.status, 200, sol.texto);
    assert.equal((await api(T.adminA, 'DELETE', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`)).status, 204);
    assert.equal((await api(T.adminA, 'PUT', '/api/me', { nombre: 'Admin A' })).status, 200);
  });

  it('GET /estado-operativo dice cuáles están en solo lectura, desde cuándo y qué ofrece; el superadmin recibe la lista vacía', async () => {
    const r = await api(T.adminA, 'GET', '/api/comercial/estado-operativo');
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.condominios.length, 1);
    const c = r.body.condominios[0];
    assert.deepEqual([c.complejo_id, c.solo_lectura, iso(Date.parse(c.gratis_hasta)), iso(Date.parse(c.solo_lectura_desde)), c.dias_gratis_restantes, c.basico_desde], [d.complejoA.id, true, iso(HOY() - DIA), iso(HOY()), null, 'S/ 20']);
    assert.deepEqual((await api(T.super, 'GET', '/api/comercial/estado-operativo')).body, { condominios: [] });
    const b = (await api(T.adminB, 'GET', '/api/comercial/estado-operativo')).body.condominios[0];
    assert.deepEqual([b.complejo_id, b.solo_lectura], [d.complejoB.id, false], 'la cortesía de B nunca');
  });

  it('un condominio con más de 50 departamentos también ve la oferta de Básico (sin tope)', async () => {
    const extra = Array.from({ length: 49 }, (_, i) => ({ codigo: `X-${i}`, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estado: 'activa' }));
    await prisma.unidad.createMany({ data: extra }); // 2 + 49 = 51
    try {
      const c = (await api(T.adminA, 'GET', '/api/comercial/estado-operativo')).body.condominios[0];
      assert.equal(c.basico_desde, 'S/ 20');
    } finally {
      await prisma.unidad.deleteMany({ where: { codigo: { startsWith: 'X-' } } });
    }
  });
});

describe('solo lectura: el superadmin, otro tenant y el pago de un plan', () => {
  it('el superadmin nunca queda bloqueado: emite el recibo, registra el pago y publica el comunicado del condominio en solo lectura', async () => {
    const r = await api(T.super, 'POST', '/api/recibos', { complejo_id: d.complejoA.id, mes: 12, anio: 2026, fecha_emision: iso(HOY()), fecha_vencimiento: iso(HOY() + 20 * DIA), conceptos: [{ concepto_id: d.conceptoA.id, monto: 80 }] });
    assert.equal(r.status, 201, r.texto);
    const p = await api(T.super, 'POST', '/api/pagos', { recibo_concepto_unidad_id: d.cargoVencidoA1.id, monto: 20, metodo_pago: 'efectivo' });
    assert.equal(p.status, 201, p.texto);
    const c = await api(T.super, 'POST', '/api/comunicados', { complejo_id: d.complejoA.id, titulo: 'Del superadmin', cuerpo: 'Texto del comunicado del superadmin.' });
    assert.equal(c.status, 201, c.texto);
    await prisma.pago.delete({ where: { id: p.body.id } });
    await prisma.reciboConceptoUnidad.update({ where: { id: d.cargoVencidoA1.id }, data: { estado_pago: 'pendiente', fecha_pago: null } });
  });

  it('otro tenant recibe 404 o 422 (nunca 409): el estado de un condominio ajeno no se revela; y el condominio B (cortesía) trabaja normal', async () => {
    // Un recurso por id ajeno es 404; una referencia ajena dentro del cuerpo es 422 (como siempre): en ningún caso el 409 delata que el condominio está en solo lectura.
    assert.equal((await api(T.adminB, 'POST', '/api/recibos', { complejo_id: d.complejoA.id, mes: 12, anio: 2026, fecha_emision: iso(HOY()), fecha_vencimiento: iso(HOY() + 20 * DIA), conceptos: [] })).status, 422);
    assert.equal((await api(T.adminB, 'POST', `/api/recibos/${d.reciboVencidoA.id}/avisar`)).status, 404);
    assert.equal((await api(T.adminB, 'POST', '/api/unidades', { codigo: 'B-777', tipo: 'Departamento', complejo_id: d.complejoA.id })).status, 422);
    assert.equal((await api(T.adminB, 'DELETE', `/api/recibos/${d.reciboFuturoA.id}`)).status, 404);
    assert.equal((await api(T.adminB, 'PATCH', `/api/pagos/${ids.pago}/validacion`, { estado: 'validado' })).status, 404);
    const b = await api(T.adminB, 'POST', '/api/comunicados', { complejo_id: d.complejoB.id, titulo: 'Aviso de B', cuerpo: 'Texto del aviso del condominio B.' });
    assert.equal(b.status, 201, b.texto);
  });

  it('pagar un plan de pago levanta el bloqueo al instante (Pro y Básico); y si luego vence pasada la gracia, vuelve a solo lectura', async () => {
    const pago = (plan: string, over: Record<string, unknown> = {}) => ({ monto: plan === 'basico' ? '23.60' : '59.00', fecha_pago: iso(HOY()), medio: 'transferencia', operacion: `OP-${plan}-${Math.random()}`, periodo_desde: iso(HOY()), periodo_hasta: iso(HOY() + 30 * DIA), ...over });
    const comunicado = () => api(T.adminA, 'POST', '/api/comunicados', { complejo_id: d.complejoA.id, titulo: 'Tras el pago', cuerpo: 'Texto del comunicado tras el pago.' });
    for (const plan of ['pro', 'basico']) {
      await enSoloLectura();
      bloqueada(await comunicado());
      assert.equal((await api(T.adminA, 'POST', `/api/comercial/mi-plan/${d.complejoA.id}/solicitud`, { plan })).status, 200);
      const r = await api(T.super, 'POST', `/api/comercial/suscripciones/${d.complejoA.id}/pagos`, pago(plan));
      assert.equal(r.status, 201, r.texto);
      const s = await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: d.complejoA.id } });
      assert.equal(s.gratis_hasta!.getTime(), HOY() - DIA, 'pagar no toca gratis_hasta');
      const ok = await comunicado();
      assert.equal(ok.status, 201, `${plan}: ${ok.texto}`);
      assert.equal((await api(T.adminA, 'GET', '/api/comercial/estado-operativo')).body.condominios[0].solo_lectura, false);
      await prisma.comunicado.deleteMany({ where: { titulo: 'Tras el pago' } });
      // Venció hace 30 días (pasada la gracia) y su gratis_hasta ya pasó: solo lectura de inmediato.
      await prisma.suscripcionCondominio.update({ where: { complejo_id: d.complejoA.id }, data: { vigente_hasta: new Date(HOY() - 30 * DIA) } });
      invalidarComercial();
      bloqueada(await comunicado());
    }
  });

  it('con dias_gratis sin plazo (gratis_hasta null) un condominio Gratis nunca queda en solo lectura', async () => {
    await prisma.suscripcionCondominio.update({ where: { complejo_id: d.complejoA.id }, data: { gratis_hasta: null } });
    invalidarComercial();
    const r = await api(T.adminA, 'POST', '/api/comunicados', { complejo_id: d.complejoA.id, titulo: 'Sin plazo', cuerpo: 'Texto del comunicado sin plazo.' });
    assert.equal(r.status, 201, r.texto);
    await prisma.comunicado.deleteMany({ where: { titulo: 'Sin plazo' } });
  });
});
