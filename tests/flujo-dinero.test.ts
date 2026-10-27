import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { cabecerasDeSesion, darCortesia, esperar, iniciar, llamar, login, PASSWORD, prisma, vaciarBase } from './helpers/app';
import { hoyLima } from '../src/server/lib/fechas';
import { llaveroDeps } from '../src/server/services/llavero';

/**
 * Recorrido completo del dinero de un condominio, con actores reales y sólo por la API (sesión cookie + CSRF):
 * Marta (administradora) emite el recibo; Rosa, Jorge y Carmen (vecinos) pagan o no; el tiempo pasa; todo cuadra al sol.
 * Los tests de este archivo son pasos de UNA misma historia: dependen del orden y comparten estado.
 */

const DIA = 86_400_000;
const MONTO = '180.50';
const TOTAL = '541.50';
const iso = (d: Date) => d.toISOString().slice(0, 10);

const JPG = (marca: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(marca)]);
const FOTO_ROSA = JPG('foto-del-voucher-de-rosa');
const FOTO_JORGE_1 = JPG('foto-borrosa-de-jorge');
const FOTO_JORGE_2 = JPG('foto-nitida-de-jorge');

let base: string;
let cerrar: () => Promise<void>;
type Actor = 'marta' | 'adminB' | 'super' | 'rosa' | 'luis' | 'jorge' | 'carmen' | 'pedro';
let T: Record<Actor, string>;
const ids = {} as Record<string, number>;
const hoy = hoyLima();

before(async () => {
  await vaciarBase();
  const hash = await bcrypt.hash(PASSWORD, 4);
  const usuario = (nombre: string, email: string, rol: string, extra: Record<string, unknown> = {}) => prisma.usuario.create({ data: { nombre, email, rol, password_hash: hash, ...extra } });

  const andina = await prisma.empresaAdministradora.create({ data: { nombre: 'Administradora Andina' } });
  const costa = await prisma.empresaAdministradora.create({ data: { nombre: 'Administradora Costa' } });
  const alamos = await prisma.complejoHabitacional.create({ data: { nombre: 'Condominio Los Álamos', tipo: 'Edificio', empresa_id: andina.id } });
  const brisas = await prisma.complejoHabitacional.create({ data: { nombre: 'Condominio Las Brisas', tipo: 'Edificio', empresa_id: costa.id } });
  await darCortesia(alamos.id, brisas.id);
  const enAlamos = { empresa_id: andina.id, complejo_id: alamos.id };

  const marta = await usuario('Marta Quispe', 'marta@andina.test', 'admin', { empresa_id: andina.id });
  const adminB = await usuario('Hugo Salas', 'hugo@costa.test', 'admin', { empresa_id: costa.id });
  await usuario('Super', 'super@test.pe', 'superadmin');
  const rosa = await usuario('Rosa Huamán', 'rosa@test.pe', 'propietario', enAlamos);
  const luis = await usuario('Luis Paredes', 'luis@test.pe', 'inquilino', enAlamos);
  const jorge = await usuario('Jorge Mendoza', 'jorge@test.pe', 'propietario', enAlamos);
  const carmen = await usuario('Carmen Rojas', 'carmen@test.pe', 'propietario', enAlamos);
  const pedro = await usuario('Pedro Vargas', 'pedro@test.pe', 'propietario', { empresa_id: costa.id, complejo_id: brisas.id });
  ids.marta = marta.id; ids.adminB = adminB.id; ids.rosa = rosa.id; ids.jorge = jorge.id; ids.carmen = carmen.id;
  ids.complejo = alamos.id;

  const unidad = (codigo: string, complejo: { id: number; empresa_id: number | null }, propietario_id: number, extra: Record<string, unknown> = {}) =>
    prisma.unidad.create({ data: { codigo, tipo: 'Departamento', complejo_id: complejo.id, empresa_id: complejo.empresa_id, propietario_id, estado: 'activa', ...extra } });
  ids.uA = (await unidad('A-101', alamos, rosa.id, { inquilino_id: luis.id })).id;
  ids.uB = (await unidad('B-202', alamos, jorge.id)).id;
  ids.uC = (await unidad('C-303', alamos, carmen.id)).id;
  await unidad('P-1', brisas, pedro.id);

  ids.concepto = (await prisma.concepto.create({ data: { nombre: 'Mantenimiento', empresa_id: andina.id, tipo_monto: 'fijo' } })).id;
  const conceptoCosta = await prisma.concepto.create({ data: { nombre: 'Agua', empresa_id: costa.id, tipo_monto: 'fijo' } });
  // Pedro, de OTRA empresa, ya debe un recibo vencido: nada de eso puede aparecer en lo de Marta.
  const reciboCosta = await prisma.recibo.create({ data: { empresa_id: costa.id, complejo_id: brisas.id, mes: 1, anio: 2026, fecha_emision: new Date(hoy.getTime() - 60 * DIA), fecha_vencimiento: new Date(hoy.getTime() - 30 * DIA), estado: 'emitido' } });
  const rcCosta = await prisma.reciboConcepto.create({ data: { recibo_id: reciboCosta.id, concepto_id: conceptoCosta.id, monto: 90, orden: 1 } });
  const unidadPedro = await prisma.unidad.findFirstOrThrow({ where: { codigo: 'P-1' } });
  const cargoCosta = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rcCosta.id, unidad_id: unidadPedro.id, monto: 90, estado_pago: 'pendiente' } });
  ids.cargoPedro = cargoCosta.id;

  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, ai: 100_000 } }));
  T = {
    marta: await login(base, 'marta@andina.test'),
    adminB: await login(base, 'hugo@costa.test'),
    super: await login(base, 'super@test.pe'),
    rosa: await login(base, 'rosa@test.pe'),
    luis: await login(base, 'luis@test.pe'),
    jorge: await login(base, 'jorge@test.pe'),
    carmen: await login(base, 'carmen@test.pe'),
    pedro: await login(base, 'pedro@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

// ---------- Ayudas ----------
async function ok(r: Promise<{ status: number; body: any; texto: string }>, status = 200) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const x = await r;
  assert.equal(x.status, status, x.texto);
  return x.body;
}
const get = (actor: Actor, ruta: string) => llamar(base, 'GET', ruta, T[actor]);

/** Sube el comprobante como cuerpo crudo y devuelve la respuesta. */
async function subir(actor: Actor, pagoId: number, bytes: Buffer, nombre: string) {
  const r = await fetch(`${base}/api/pagos/${pagoId}/comprobante`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg', 'x-nombre-archivo': nombre, ...cabecerasDeSesion(T[actor]) },
    body: new Uint8Array(bytes),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

/** El residente registra el pago por transferencia de su cargo y adjunta el comprobante. */
async function pagarConComprobante(actor: Actor, cargoId: number, bytes: Buffer, referencia: string): Promise<number> {
  const pago = await ok(llamar(base, 'POST', `/api/me/cargos/${cargoId}/pagos`, T[actor], { metodo_pago: 'transferencia', referencia }), 201);
  assert.equal(pago.estado_validacion, 'por_validar');
  const sub = await subir(actor, pago.id, bytes, `${referencia}.jpg`);
  assert.equal(sub.status, 201, JSON.stringify(sub.body));
  return pago.id;
}

const resumen = () => ok(get('marta', '/api/dashboard/resumen'));
const detalleRecibo = () => ok(get('marta', `/api/recibos/${ids.recibo}`));
const estadoDe = async (cargoId: number) => (await detalleRecibo()).cargos.find((c: { id: number }) => c.id === cargoId).estado as string;
const centimos = (s: string) => Math.round(Number(s) * 100);

/** Invariante de dinero: lo cobrado (según los pagos validados en base) + lo que falta = lo emitido, y el recibo y el dashboard coinciden. */
async function conciliar(cobradoEsperado: string) {
  const d = await detalleRecibo();
  const validados = await prisma.pago.aggregate({ where: { estado_validacion: 'validado', reciboConceptoUnidad: { reciboConcepto: { recibo_id: ids.recibo } } }, _sum: { monto: true } });
  assert.equal(d.totales.monto, TOTAL, 'total emitido');
  assert.equal(d.totales.cobrado, cobradoEsperado);
  assert.equal(Number(validados._sum.monto ?? 0).toFixed(2), cobradoEsperado, 'lo cobrado sale sólo de pagos validados');
  assert.equal(centimos(d.totales.cobrado) + centimos(d.totales.pendiente), centimos(TOTAL), 'cobrado + por cobrar = emitido');
  const r = await resumen();
  assert.equal(r.cobrado_mes, cobradoEsperado);
  assert.equal(centimos(r.cobrado_mes) + centimos(r.cargos_pendientes_monto), centimos(TOTAL), 'dashboard: cobrado + por cobrar = emitido');
}

describe('flujo del dinero de un condominio', () => {
  it('1 · Marta emite el recibo del mes: 3 cargos con el monto correcto, nada cobrado', async () => {
    const recibo = await ok(llamar(base, 'POST', '/api/recibos', T.marta, {
      complejo_id: ids.complejo, mes: hoy.getUTCMonth() + 1, anio: hoy.getUTCFullYear(),
      fecha_emision: iso(hoy), fecha_vencimiento: iso(new Date(hoy.getTime() + 10 * DIA)),
      descripcion: 'Mantenimiento del mes', conceptos: [{ concepto_id: ids.concepto, monto: 180.5 }],
    }), 201);
    ids.recibo = recibo.id;

    const d = await detalleRecibo();
    assert.equal(d.cargos.length, 3);
    assert.deepEqual(d.cargos.map((c: { unidad: { codigo: string } }) => c.unidad.codigo), ['A-101', 'B-202', 'C-303']);
    assert.ok(d.cargos.every((c: { monto: string; estado: string }) => centimos(c.monto) === 18050 && c.estado === 'pendiente'));
    for (const c of d.cargos) ids[`cargo${c.unidad.codigo[0]}`] = c.id;
    assert.deepEqual(d.totales, { monto: TOTAL, cobrado: '0.00', pendiente: TOTAL, en_revision: '0.00' });

    const r = await resumen();
    assert.equal(r.cargos_pendientes_monto, TOTAL, 'por cobrar = suma de los 3 cargos (el recibo de otra empresa no cuenta)');
    assert.equal(r.cobrado_mes, '0.00');
    assert.equal(r.morosos, 0);
    assert.deepEqual(r.estados, { pagado: 0, pendiente: 3, vencido: 0, en_revision: 0 });
    await conciliar('0.00');
  });

  it('2 · Rosa paga por transferencia con comprobante: su cargo queda en revisión, sigue por cobrar y no es moroso', async () => {
    const mis = await ok(get('rosa', '/api/me/cargos'));
    assert.equal(mis.total, 1);
    assert.equal(mis.items[0].id, ids.cargoA);
    assert.equal(mis.items[0].estado, 'pendiente');

    ids.pagoRosa = await pagarConComprobante('rosa', ids.cargoA, FOTO_ROSA, 'OP-FALSA-ROSA');

    const cargo = await ok(get('rosa', `/api/me/cargos/${ids.cargoA}`));
    assert.equal(cargo.estado, 'en_revision');
    assert.equal(cargo.pagos[0].comprobante.nombre, 'OP-FALSA-ROSA.jpg');
    assert.equal(cargo.pagos[0].comprobante.datos, undefined, 'los bytes nunca viajan en el cargo');
    assert.equal((await ok(get('luis', `/api/me/cargos/${ids.cargoA}`))).estado, 'en_revision', 'el inquilino de la misma unidad ve lo mismo');

    const r = await resumen();
    assert.equal(r.cargos_pendientes_monto, TOTAL, 'en revisión sigue siendo por cobrar');
    assert.equal(r.cobrado_mes, '0.00', 'todavía no es dinero cobrado');
    assert.deepEqual(r.estados, { pagado: 0, pendiente: 2, vencido: 0, en_revision: 1 });
    assert.equal(r.pagos_por_validar, 1);
    await conciliar('0.00');
  });

  it('3 · Marta abre el comprobante de Rosa y lo valida: el cargo queda pagado y lo cobrado sube', async () => {
    const cola = await ok(get('marta', '/api/pagos?estado_validacion=por_validar'));
    assert.equal(cola.total, 1);
    assert.equal(cola.items[0].id, ids.pagoRosa);
    assert.equal(cola.items[0].unidad.codigo, 'A-101');
    assert.equal(centimos(cola.items[0].monto), 18050);

    const foto = await fetch(`${base}/api/pagos/${ids.pagoRosa}/comprobante`, { headers: cabecerasDeSesion(T.marta) });
    assert.equal(foto.status, 200);
    assert.equal(foto.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await foto.arrayBuffer()), FOTO_ROSA, 'es exactamente el archivo que subió Rosa');

    const validado = await ok(llamar(base, 'PATCH', `/api/pagos/${ids.pagoRosa}/validacion`, T.marta, { estado: 'validado' }));
    assert.equal(validado.estado_validacion, 'validado');
    assert.equal(validado.validado_por.id, ids.marta);
    assert.equal(await estadoDe(ids.cargoA), 'pagado');

    const r = await resumen();
    assert.equal(r.cobrado_mes, MONTO);
    assert.equal(r.cargos_pendientes_monto, '361.00');
    assert.equal(r.pagos_por_validar, 0);
    await conciliar(MONTO);

    const historial = await ok(get('rosa', '/api/me/pagos'));
    assert.equal(historial.total, 1);
    assert.equal(historial.items[0].estado_validacion, 'validado');
    assert.equal((await ok(get('rosa', `/api/me/cargos/${ids.cargoA}`))).estado, 'pagado');
    const res = await ok(get('rosa', '/api/dashboard/resumen'));
    assert.equal(res.deuda_total, '0.00');
    assert.equal(res.pagado_ano, MONTO);
  });

  it('4 · Jorge paga, Marta rechaza con motivo, el cargo vuelve a pendiente y Jorge paga de nuevo con éxito', async () => {
    ids.pagoJorge1 = await pagarConComprobante('jorge', ids.cargoB, FOTO_JORGE_1, 'OP-FALSA-JORGE-1');
    assert.equal((await ok(get('marta', '/api/dashboard/resumen'))).pagos_por_validar, 1);

    await ok(llamar(base, 'PATCH', `/api/pagos/${ids.pagoJorge1}/validacion`, T.marta, { estado: 'rechazado' }), 422); // sin motivo no se rechaza
    const rechazado = await ok(llamar(base, 'PATCH', `/api/pagos/${ids.pagoJorge1}/validacion`, T.marta, { estado: 'rechazado', motivo: 'La foto está borrosa: no se lee el número de operación' }));
    assert.equal(rechazado.estado_validacion, 'rechazado');
    assert.equal(await estadoDe(ids.cargoB), 'pendiente');
    await ok(llamar(base, 'PATCH', `/api/pagos/${ids.pagoJorge1}/validacion`, T.marta, { estado: 'validado' }), 409); // ya revisado

    const visto = await ok(get('jorge', `/api/me/cargos/${ids.cargoB}`));
    assert.equal(visto.estado, 'pendiente');
    assert.equal(visto.pagos[0].estado_validacion, 'rechazado');
    assert.equal(visto.pagos[0].motivo_rechazo, 'La foto está borrosa: no se lee el número de operación');
    const hist = await ok(get('jorge', '/api/me/pagos'));
    assert.equal(hist.items[0].motivo_rechazo, 'La foto está borrosa: no se lee el número de operación');

    ids.pagoJorge2 = await pagarConComprobante('jorge', ids.cargoB, FOTO_JORGE_2, 'OP-FALSA-JORGE-2');
    assert.notEqual(ids.pagoJorge2, ids.pagoJorge1);
    assert.equal((await ok(get('jorge', `/api/me/cargos/${ids.cargoB}`))).estado, 'en_revision');
    await conciliar(MONTO); // lo rechazado y lo que espera revisión no es cobrado
  });

  it('5 · pasa el tiempo: sólo Carmen es morosa (con sus días de atraso); Marta le registra el efectivo y se pone al día', async () => {
    // El recibo vence hace 12 días (el reloj se «adelanta» moviendo la fecha, como lo haría Marta corrigiéndola).
    await ok(llamar(base, 'PUT', `/api/recibos/${ids.recibo}`, T.marta, { fecha_vencimiento: iso(new Date(hoy.getTime() - 12 * DIA)) }));

    const mora = await ok(get('marta', '/api/reportes/morosidad'));
    assert.equal(mora.total, 1, 'Rosa pagó y Jorge está en revisión: no cuentan como morosos');
    assert.equal(mora.items[0].unidad.codigo, 'C-303');
    assert.equal(mora.items[0].propietario.nombre, 'Carmen Rojas');
    assert.equal(mora.items[0].deuda_total, MONTO);
    assert.equal(mora.items[0].cargos_vencidos, 1);
    assert.equal(mora.items[0].dias_max_atraso, 12);

    const r = await resumen();
    assert.equal(r.morosos, 1);
    assert.deepEqual(r.estados, { pagado: 1, pendiente: 0, vencido: 1, en_revision: 1 });
    assert.equal(r.cargos_pendientes_monto, '361.00', 'Jorge (en revisión) y Carmen siguen por cobrar');
    assert.equal(await estadoDe(ids.cargoC), 'vencido');
    assert.equal((await ok(get('carmen', `/api/me/cargos/${ids.cargoC}`))).estado, 'vencido');
    assert.equal((await ok(get('jorge', `/api/me/cargos/${ids.cargoB}`))).estado, 'en_revision');
    assert.equal((await ok(get('marta', '/api/recibos'))).items[0].estado_cobranza, 'vencido');

    const efectivo = await ok(llamar(base, 'POST', '/api/pagos', T.marta, { recibo_concepto_unidad_id: ids.cargoC, monto: 180.5, metodo_pago: 'efectivo', referencia: 'CAJA-0001' }), 201);
    assert.equal(efectivo.estado_validacion, 'validado', 'el pago manual del administrador nace validado');
    assert.equal(await estadoDe(ids.cargoC), 'pagado');
    assert.equal((await ok(get('marta', '/api/reportes/morosidad'))).total, 0);
    await conciliar('361.00');
    assert.equal((await resumen()).morosos, 0);

    // Marta cierra la revisión pendiente de Jorge: todo cobrado.
    await ok(llamar(base, 'PATCH', `/api/pagos/${ids.pagoJorge2}/validacion`, T.marta, { estado: 'validado' }));
    await conciliar(TOTAL);
    const final = await resumen();
    assert.equal(final.cargos_pendientes_monto, '0.00');
    assert.deepEqual(final.estados, { pagado: 3, pendiente: 0, vencido: 0, en_revision: 0 });
    assert.equal((await detalleRecibo()).estado_cobranza, 'pagado');
  });

  it('6a · ningún vecino ve datos de otra unidad (404, no 403)', async () => {
    const ajeno: [Actor, string][] = [
      ['rosa', `/api/me/cargos/${ids.cargoB}`], ['rosa', `/api/me/cargos/${ids.cargoC}`],
      ['jorge', `/api/me/cargos/${ids.cargoA}`], ['carmen', `/api/me/cargos/${ids.cargoA}`], ['luis', `/api/me/cargos/${ids.cargoB}`],
      ['pedro', `/api/me/cargos/${ids.cargoA}`], ['rosa', `/api/me/cargos/${ids.cargoPedro}`],
      ['rosa', `/api/pagos/${ids.pagoJorge2}/comprobante`], ['jorge', `/api/pagos/${ids.pagoRosa}/comprobante`],
      ['carmen', `/api/pagos/${ids.pagoRosa}/comprobante`], ['luis', `/api/pagos/${ids.pagoJorge2}/comprobante`], ['pedro', `/api/pagos/${ids.pagoJorge2}/comprobante`],
    ];
    for (const [actor, ruta] of ajeno) assert.equal((await get(actor, ruta)).status, 404, `${actor} → ${ruta}`);
    // No pueden pagar el cargo de otro ni colgarle un archivo a su pago.
    assert.equal((await llamar(base, 'POST', `/api/me/cargos/${ids.cargoB}/pagos`, T.rosa, { metodo_pago: 'yape' })).status, 404);
    assert.equal((await subir('rosa', ids.pagoJorge2, FOTO_ROSA, 'x.jpg')).status, 404);
    // Y las listas sólo traen lo propio.
    const codigos = async (actor: Actor) => (await ok(get(actor, '/api/me/cargos'))).items.map((c: { unidad: { codigo: string } }) => c.unidad.codigo);
    assert.deepEqual(await codigos('rosa'), ['A-101']);
    assert.deepEqual(await codigos('luis'), ['A-101']);
    assert.deepEqual(await codigos('jorge'), ['B-202']);
    assert.deepEqual(await codigos('carmen'), ['C-303']);
    assert.deepEqual(await codigos('pedro'), ['P-1']);
    assert.deepEqual((await ok(get('carmen', '/api/me/pagos'))).items.map((p: { id: number }) => p.id).sort(), [await prisma.pago.findFirstOrThrow({ where: { referencia: 'CAJA-0001' } }).then((p) => p.id)]);
    // Un vecino no entra a las pantallas ni a las acciones del administrador.
    for (const ruta of ['/api/pagos', `/api/recibos/${ids.recibo}`, '/api/reportes/morosidad']) assert.equal((await get('rosa', ruta)).status, 403, ruta);
    assert.equal((await llamar(base, 'PATCH', `/api/pagos/${ids.pagoJorge2}/validacion`, T.jorge, { estado: 'validado' })).status, 403);
  });

  it('6b · el administrador de otra empresa no ve nada de este recorrido (404 en todo)', async () => {
    const peticiones: [string, string, unknown?][] = [
      ['GET', `/api/recibos/${ids.recibo}`], ['PUT', `/api/recibos/${ids.recibo}`, { descripcion: 'x' }],
      ['GET', `/api/pagos/${ids.pagoRosa}`], ['GET', `/api/pagos/${ids.pagoRosa}/comprobante`], ['PATCH', `/api/pagos/${ids.pagoJorge2}/validacion`, { estado: 'rechazado', motivo: 'intento ajeno' }],
      ['GET', `/api/recibo-concepto-unidades/${ids.cargoA}`], ['DELETE', `/api/pagos/${ids.pagoRosa}`],
    ];
    for (const [m, ruta, cuerpo] of peticiones) assert.equal((await llamar(base, m, ruta, T.adminB, cuerpo)).status, 404, `${m} ${ruta}`);
    // Un pago manual sobre un cargo ajeno se rechaza como referencia inexistente (422), sin tocar nada.
    assert.equal((await llamar(base, 'POST', '/api/pagos', T.adminB, { recibo_concepto_unidad_id: ids.cargoA, monto: 1, metodo_pago: 'efectivo' })).status, 422);

    assert.equal((await ok(get('adminB', '/api/pagos'))).total, 0);
    assert.equal((await ok(get('adminB', '/api/recibos'))).items.some((r: { id: number }) => r.id === ids.recibo), false);
    const mora = await ok(get('adminB', '/api/reportes/morosidad'));
    assert.deepEqual(mora.items.map((i: { unidad: { codigo: string } }) => i.unidad.codigo), ['P-1'], 'sólo ve su propia morosidad');
    const r = await ok(get('adminB', '/api/dashboard/resumen'));
    assert.equal(r.cobrado_mes, '0.00');
    assert.equal(r.cargos_pendientes_monto, '90.00');
    // Nada de lo anterior alteró el recorrido.
    await conciliar(TOTAL);
  });

  it('6c · la auditoría registra emitir, validar y rechazar sin guardar el contenido de los archivos', async () => {
    const por = (accion: string) => prisma.auditoria.findMany({ where: { accion }, orderBy: { id: 'asc' } });
    const emitir = await esperar(async () => { const f = await prisma.auditoria.findMany({ where: { entidad: 'recibo', accion: 'crear' } }); return f.length ? f : null; });
    assert.equal(emitir.length, 1);
    assert.equal(emitir[0].usuario_id, ids.marta);
    assert.equal(emitir[0].entidad_id, ids.recibo);

    const validar = await esperar(async () => { const f = await por('validar'); return f.length === 2 ? f : null; });
    assert.deepEqual(validar.map((a) => a.entidad_id), [ids.pagoRosa, ids.pagoJorge2]);
    assert.ok(validar.every((a) => a.usuario_id === ids.marta && a.entidad === 'pago'));
    const rechazar = await esperar(async () => { const f = await por('rechazar'); return f.length === 1 ? f : null; });
    assert.equal(rechazar[0].entidad_id, ids.pagoJorge1);
    assert.deepEqual(rechazar[0].detalle, { estado: 'rechazado', motivo: 'La foto está borrosa: no se lee el número de operación' });
    const subidas = await esperar(async () => { const f = await por('subir_comprobante'); return f.length === 3 ? f : null; });
    assert.deepEqual(subidas.map((a) => a.usuario_id).sort(), [ids.rosa, ids.jorge, ids.jorge].sort());

    // Ni los bytes ni su base64 ni el texto del archivo aparecen en ningún registro; sólo nombre, tipo, tamaño y huella.
    const todo = JSON.stringify(await prisma.auditoria.findMany());
    for (const f of [FOTO_ROSA, FOTO_JORGE_1, FOTO_JORGE_2]) {
      assert.ok(!todo.includes(f.toString('latin1').slice(4)) && !todo.includes(f.toString('base64')));
    }
    assert.ok(!todo.includes(PASSWORD), 'ninguna contraseña en la auditoría');
    assert.match(String((subidas[0].detalle as { sha256: string }).sha256), /^[0-9a-f]{64}$/);
    // La administradora de la empresa no lee la auditoría; el superadmin sí.
    assert.equal((await get('marta', '/api/auditoria')).status, 403);
    const api = await ok(get('super', '/api/auditoria?accion=validar'));
    assert.equal(api.total, 2);
  });

  it('7 · el asistente de IA responde (con un fetch falso, sin red) y el recorrido sigue cuadrando', async () => {
    const fetchOriginal = llaveroDeps.fetch;
    const llamadas: string[] = [];
    process.env.GEMINI_API_KEY = 'gemini-CLAVE-FALSA-NO-REAL';
    llaveroDeps.fetch = async (url) => {
      llamadas.push(String(url));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Todo el recibo del mes está cobrado.' }] } }] }), { status: 200 });
    };
    try {
      const r = await ok(llamar(base, 'POST', '/api/ai-chat', T.marta, { message: '¿Cómo va la cobranza del mes?' }));
      assert.equal(r.response, 'Todo el recibo del mes está cobrado.');
      assert.equal(llamadas.length, 1);
      assert.match(llamadas[0], /^https:\/\//);
    } finally {
      llaveroDeps.fetch = fetchOriginal;
      delete process.env.GEMINI_API_KEY;
    }
    await conciliar(TOTAL);
  });
});
