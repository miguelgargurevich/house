// Cierre de la Junta central. Ingresos = aportes de los blocks que el tesorero central ya confirmó (sin la parte del fondo de contingencia del condominio, que va aparte) +
// ingresos manuales (alquiler de estacionamiento —se paga aparte a la cuenta de la Junta central— y otros), todos con voucher; egresos = servicios (boleta) y proveedores
// (factura), con voucher. Saldo del mes y Fondo de ahorros acumulado. «Blocks que aún no aportan». Permisos: registra el TESORERO CENTRAL (o la administración); el presidente
// central lo ve; la junta de un block NO lo ve (sólo su aporte); otro condominio → 404. Aviso al tesorero central el día 5, una vez por mes.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { cabecerasDeSesion, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { pngUnico } from './helpers/pagoResidente';
import { encolarAportesPendientes, encolarCierresPendientes } from '../src/server/services/avisos/cierres';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let e1: { id: number };
let e2: { id: number };
let eB: { id: number };
let proveedorA: { id: number };
let proveedorB: { id: number };
let T: Record<'adminA' | 'adminB' | 'prop1' | 'tesor1' | 'presi1' | 'tesor2' | 'central' | 'presiCentral' | 'tesorB', string>;
let ids: Record<'central' | 'presiCentral' | 'tesor1' | 'tesor2', number>;

const llama = (t: string | null, metodo: string, ruta: string, cuerpo?: unknown) => llamar(base, metodo, ruta, t, cuerpo);
const central = (t: string | null, mes = 9, anio = 2026, extra = '') => llama(t, 'GET', `/api/cierres/central?mes=${mes}&anio=${anio}${extra}`);
const movimientosDe = (complejoId: number) => prisma.movimientoCentral.count({ where: { complejo_id: complejoId } });

async function recibo(estructuraId: number, mes: number, anio: number, partidas: { concepto: { id: number }; cargos: [number, number, string][] }[], complejo = d.complejoA, empresa = d.empresaA) {
  const r = await prisma.recibo.create({ data: { empresa_id: empresa.id, complejo_id: complejo.id, estructura_id: estructuraId, mes, anio, fecha_emision: new Date(Date.UTC(anio, mes - 1, 1)), fecha_vencimiento: new Date(Date.UTC(anio, mes - 1, 20)), estado: 'emitido' } });
  let orden = 0;
  for (const p of partidas) {
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: r.id, concepto_id: p.concepto.id, monto: p.cargos.reduce((s, c) => s + c[1], 0), orden: ++orden } });
    for (const [unidad_id, monto, estado_pago] of p.cargos) await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id, monto, estado_pago } });
  }
}

interface Archivo { bytes: Buffer; tipo: string; nombre: string }
const voucher = (): Archivo => ({ bytes: pngUnico(), tipo: 'image/png', nombre: 'voucher.png' });
type Campos = Record<string, string | number | undefined>;

async function enviar(url: string, token: string | null, campos: Campos, archivo: Archivo | null) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) if (v !== undefined) fd.append(k, String(v));
  if (archivo) fd.append('voucher', new Blob([new Uint8Array(archivo.bytes)], { type: archivo.tipo }), archivo.nombre);
  const r = await fetch(`${base}${url}`, { method: 'POST', headers: cabecerasDeSesion(token), body: fd });
  const texto = await r.text();
  let body: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = JSON.parse(texto); } catch { /* sin JSON */ }
  return { status: r.status, body, texto };
}
/** Registra un movimiento de la Junta central como la pantalla: multipart con los campos y el voucher en `voucher` (`archivo: null` = sin archivo). */
const registrar = (token: string | null, campos: Campos, archivo: Archivo | null = voucher(), consulta = '') =>
  enviar(`/api/cierres/central/movimientos${consulta}`, token, { mes: 9, anio: 2026, fecha: '2026-10-02', ...campos }, archivo);
/** Un block registra su aporte a la Junta central (línea `central`) con el endpoint del cierre del block. */
const aportar = (token: string, estructuraId: number, campos: Campos = {}) =>
  enviar(`/api/cierres/block/${estructuraId}/lineas`, token, { mes: 9, anio: 2026, linea: 'central', fecha_pago: '2026-10-02', ...campos }, voucher());

const alquiler = { categoria: 'alquiler_estacionamiento', pagador: 'Juan Pérez (A-101)', estacionamiento: 'E-12', monto: '150.00', referencia: 'DEP-1' };

before(async () => {
  d = await sembrar();
  e1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
  e2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'Block', complejo_id: d.complejoA.id } });
  eB = await prisma.estructura.create({ data: { nombre: 'Block B', tipo: 'Block', complejo_id: d.complejoB.id } });
  await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: e1.id } });
  await prisma.unidad.update({ where: { id: d.unidadA2.id }, data: { estructura_id: e2.id } });
  await prisma.unidad.update({ where: { id: d.unidadB1.id }, data: { estructura_id: eB.id } });
  proveedorA = await prisma.proveedor.create({ data: { empresa_id: d.empresaA.id, razon_social: 'Jardines SAC', rubro: 'jardineria' } });
  proveedorB = await prisma.proveedor.create({ data: { empresa_id: d.empresaB.id, razon_social: 'Proveedor de B', rubro: 'otros' } });

  const hash = await bcrypt.hash(PASSWORD, 4);
  const junta = async (nombre: string, email: string, cargo: string, complejo: { id: number; empresa_id: number | null }, estructura_id: number | null) =>
    (await prisma.usuario.create({ data: { nombre, email, rol: 'propietario', password_hash: hash, empresa_id: complejo.empresa_id, complejo_id: complejo.id, cargo_junta: cargo, estructura_id } })).id;
  ids = {
    central: await junta('Tesorero central', 'central@test.pe', 'tesorero', d.complejoA, null),
    presiCentral: await junta('Presidente central', 'presicentral@test.pe', 'presidente', d.complejoA, null),
    tesor1: await junta('Tesorero 1', 'tesor1@test.pe', 'tesorero', d.complejoA, e1.id),
    tesor2: await junta('Tesorero 2', 'tesor2@test.pe', 'tesorero', d.complejoA, e2.id),
  };
  await junta('Presidente 1', 'presi1@test.pe', 'presidente', d.complejoA, e1.id);
  await junta('Tesorero B', 'tesorb@test.pe', 'tesorero', d.complejoB, eB.id);

  const concepto = (nombre: string, destino: string | null) => prisma.concepto.create({ data: { nombre, empresa_id: d.empresaA.id, destino } });
  const luz = await concepto('LUZ AREAS COMUNES DEL CONDOMINIO', 'central');
  const contingencia = await concepto('FONDO DE CONTINGENCIA DEL CONDOMINIO', 'central');
  const admin = await concepto('ADMINISTRACION', 'administradora');
  const luzB = await prisma.concepto.create({ data: { nombre: 'LUZ AREAS COMUNES B', empresa_id: d.empresaB.id, destino: 'central' } });
  // Setiembre: Block 1 aporta 60 a la Junta central (luz 50 + contingencia 10), Block 2 aporta 40; Block B (otro condominio) 99. Agosto: sólo administración (nadie aporta a la central).
  await recibo(e1.id, 9, 2026, [{ concepto: luz, cargos: [[d.unidadA1.id, 50, 'pagado']] }, { concepto: contingencia, cargos: [[d.unidadA1.id, 10, 'pagado']] }, { concepto: admin, cargos: [[d.unidadA1.id, 100, 'pagado']] }]);
  await recibo(e2.id, 9, 2026, [{ concepto: luz, cargos: [[d.unidadA2.id, 40, 'pagado']] }]);
  await recibo(e1.id, 8, 2026, [{ concepto: admin, cargos: [[d.unidadA1.id, 30, 'pagado']] }]);
  await recibo(eB.id, 9, 2026, [{ concepto: luzB, cargos: [[d.unidadB1.id, 99, 'pagado']] }], d.complejoB, d.empresaB);

  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  const entrar = (email: string) => login(base, email);
  T = {
    adminA: await entrar('admin.a@test.pe'), adminB: await entrar('admin.b@test.pe'), prop1: await entrar('prop1@test.pe'), tesor1: await entrar('tesor1@test.pe'), presi1: await entrar('presi1@test.pe'),
    tesor2: await entrar('tesor2@test.pe'), central: await entrar('central@test.pe'), presiCentral: await entrar('presicentral@test.pe'), tesorB: await entrar('tesorb@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('quién ve el cierre de la Junta central', () => {
  it('el tesorero central, el presidente central y la administración lo ven; sólo la administración y el tesorero central pueden registrar', async () => {
    const t = await central(T.central);
    assert.equal(t.status, 200, t.texto);
    assert.equal(t.body.complejo_id, d.complejoA.id);
    assert.equal(t.body.puede.registrar, true);
    const p = await central(T.presiCentral);
    assert.equal(p.status, 200);
    assert.equal(p.body.puede.registrar, false, 'el presidente central sólo mira');
    const a = await central(T.adminA, 9, 2026, `&complejo_id=${d.complejoA.id}`);
    assert.equal(a.status, 200);
    assert.equal(a.body.puede.registrar, true);
  });

  it('la junta de un block NO ve el cierre central (sólo su aporte), ni un propietario sin cargo', async () => {
    for (const t of [T.tesor1, T.presi1, T.tesor2, T.prop1]) assert.equal((await central(t)).status, 403);
    assert.equal((await llama(T.tesor1, 'GET', `/api/cierres/block/${e1.id}?mes=9&anio=2026`)).status, 200, 'su propio cierre de block sí');
    assert.equal((await central(null)).status, 401);
  });

  it('otro condominio u otra empresa → 404; la administración debe elegir condominio (422); la junta de un block de otro condominio → 403', async () => {
    assert.equal((await central(T.adminB, 9, 2026, `&complejo_id=${d.complejoA.id}`)).status, 404);
    assert.equal((await central(T.central, 9, 2026, `&complejo_id=${d.complejoB.id}`)).status, 404);
    assert.equal((await central(T.adminA)).status, 422);
    assert.equal((await central(T.tesorB)).status, 403);
  });

  it('el cierre de la Junta central de otro condominio sólo trae lo suyo', async () => {
    const b = await central(T.adminB, 9, 2026, `&complejo_id=${d.complejoB.id}`);
    assert.equal(b.status, 200);
    assert.deepEqual(b.body.ingresos.aportes.blocks.map((x: any) => x.estructura.nombre), ['Block B']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(b.body.ingresos.aportes.blocks[0].facturado, '99.00');
  });
});

describe('blocks que aún no aportan y aviso del día 5 al tesorero central', () => {
  const notis = (usuarioId: number) => prisma.notificacion.findMany({ where: { usuario_id: usuarioId, tipo: 'cierre_pendiente', ref_entidad: { startsWith: 'cierre-central:' } } });

  it('al inicio ningún block aportó: los dos están en la lista y el mes está en «faltan aportes»', async () => {
    const r = await central(T.central);
    assert.equal(r.body.estado, 'faltan_aportes');
    assert.deepEqual(r.body.blocks_sin_aportar, [{ id: e1.id, nombre: 'Block 1', facturado: '60.00' }, { id: e2.id, nombre: 'Block 2', facturado: '40.00' }]);
    assert.equal(r.body.ingresos.total, '0.00');
    assert.equal(r.body.saldo_mes, '0.00');
  });

  it('antes del día 5 (en la zona del condominio) no avisa; desde el 5 avisa una sola vez, sólo al tesorero central y diciendo qué blocks faltan', async () => {
    // 03:00 UTC del 5 es todavía el 4 a las 22:00 en Lima.
    assert.equal(await encolarAportesPendientes(new Date('2026-10-05T03:00:00Z')), 0);
    assert.equal((await notis(ids.central)).length, 0);
    assert.equal(await encolarAportesPendientes(new Date('2026-10-05T10:00:00Z')), 1);
    const n = await notis(ids.central);
    assert.equal(n.length, 1);
    assert.equal(n[0]!.canal, 'email');
    assert.equal(n[0]!.ref_entidad, 'cierre-central:2026-09');
    assert.equal(n[0]!.ref_id, d.complejoA.id);
    assert.match(n[0]!.asunto, /Junta central de setiembre de 2026/);
    assert.match(n[0]!.cuerpo, /Block 1, Block 2/);
    // Repetir el ciclo (cada 15 min) o llegar el día 6 no duplica.
    assert.equal(await encolarAportesPendientes(new Date('2026-10-05T10:15:00Z')), 0);
    assert.equal(await encolarAportesPendientes(new Date('2026-10-06T15:00:00Z')), 0);
    assert.equal((await notis(ids.central)).length, 1);
    // Ni el presidente central, ni los tesoreros de block, ni el otro condominio (no tiene tesorero central) reciben este aviso.
    const todos = await prisma.notificacion.findMany({ where: { tipo: 'cierre_pendiente', ref_entidad: { startsWith: 'cierre-central:' } } });
    assert.deepEqual([...new Set(todos.map((x) => x.usuario_id))], [ids.central]);
  });

  it('el aviso de cada block (otro) sigue siendo aparte: el tesorero central no lo recibe', async () => {
    await encolarCierresPendientes(new Date('2026-10-05T10:00:00Z'));
    const delBlock = await prisma.notificacion.findMany({ where: { usuario_id: ids.central, tipo: 'cierre_pendiente', ref_entidad: { startsWith: 'cierre:' } } });
    assert.equal(delBlock.length, 0);
    assert.ok((await prisma.notificacion.count({ where: { usuario_id: ids.tesor1, tipo: 'cierre_pendiente', ref_entidad: 'cierre:2026-09' } })) >= 1);
  });

  it('un mes sin aportes que esperar (agosto: sólo administración) no avisa', async () => {
    assert.equal(await encolarAportesPendientes(new Date('2026-09-05T15:00:00Z')), 0);
  });
});

describe('aportes de los blocks: sólo cuenta lo confirmado, y la contingencia va aparte', () => {
  it('un aporte registrado pero sin la conformidad del tesorero central se muestra aparte y no suma a los ingresos', async () => {
    const a = await aportar(T.tesor1, e1.id, { monto_pagado: '54.00' }); // transfirió 54 de los 60 facturados
    assert.equal(a.status, 201, a.texto);
    const r = await central(T.central);
    assert.equal(r.body.ingresos.aportes.por_confirmar, '54.00');
    assert.equal(r.body.ingresos.aportes.confirmados, '0.00');
    assert.equal(r.body.ingresos.total, '0.00');
    assert.equal(r.body.saldo_mes, '0.00');
    assert.deepEqual(r.body.blocks_sin_aportar.map((b: any) => b.nombre), ['Block 2']); // eslint-disable-line @typescript-eslint/no-explicit-any
    const fila = r.body.ingresos.aportes.blocks.find((b: any) => b.estructura.id === e1.id); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(fila.estado, 'sin_conformidad');
    assert.equal(fila.registro.monto_pagado, '54.00');
  });

  it('con la conformidad, entra a los ingresos SIN la parte del fondo de contingencia (10 de 60, en proporción a lo transferido: 9.00)', async () => {
    const reg = (await central(T.central)).body.ingresos.aportes.blocks.find((b: any) => b.estructura.id === e1.id).registro; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal((await llama(T.central, 'PUT', `/api/cierres/lineas/${reg.id}/conformidad`)).status, 200);
    const r = await central(T.central);
    assert.equal(r.body.ingresos.aportes.confirmados, '45.00');
    assert.equal(r.body.ingresos.aportes.fondo_contingencia, '9.00');
    assert.equal(r.body.ingresos.aportes.por_confirmar, '0.00');
    assert.equal(r.body.fondo_contingencia_mes, '9.00');
    assert.equal(r.body.fondo_contingencia, '9.00');
    assert.equal(r.body.ingresos.total, '45.00');
    assert.equal(r.body.saldo_mes, '45.00');
  });

  it('cuando el último block aporta ya no hay blocks pendientes; falta la conformidad hasta que se da; luego, al día', async () => {
    const a = await aportar(T.tesor2, e2.id); // por defecto, lo facturado (40)
    assert.equal(a.status, 201, a.texto);
    let r = await central(T.central);
    assert.deepEqual(r.body.blocks_sin_aportar, []);
    assert.equal(r.body.estado, 'falta_conformidad');
    assert.equal(r.body.ingresos.aportes.confirmados, '45.00', 'el aporte del Block 2 aún no cuenta');
    assert.equal(r.body.ingresos.aportes.por_confirmar, '40.00');
    const reg = r.body.ingresos.aportes.blocks.find((b: any) => b.estructura.id === e2.id).registro; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal((await llama(T.central, 'PUT', `/api/cierres/lineas/${reg.id}/conformidad`)).status, 200);
    r = await central(T.central);
    assert.equal(r.body.estado, 'al_dia');
    assert.equal(r.body.ingresos.aportes.confirmados, '85.00');
    assert.equal(r.body.ingresos.aportes.fondo_contingencia, '9.00', 'el Block 2 no aporta contingencia');
  });

  it('el voucher de un aporte de block se abre desde el cierre central (el tesorero central) y no desde la junta de otro block', async () => {
    const reg = (await central(T.central)).body.ingresos.aportes.blocks.find((b: any) => b.estructura.id === e1.id).registro; // eslint-disable-line @typescript-eslint/no-explicit-any
    const ok = await fetch(`${base}/api/cierres/lineas/${reg.id}/voucher`, { headers: cabecerasDeSesion(T.central) });
    assert.equal(ok.status, 200);
    const otro = await fetch(`${base}/api/cierres/lineas/${reg.id}/voucher`, { headers: cabecerasDeSesion(T.tesor2) });
    assert.equal(otro.status, 404);
  });
});

describe('registrar un ingreso: alquiler de estacionamiento y otros (voucher obligatorio)', () => {
  it('el tesorero central registra el alquiler: quién paga (texto), estacionamiento, periodo (el mes del cierre), monto y voucher', async () => {
    const antes = await movimientosDe(d.complejoA.id);
    const r = await registrar(T.central, alquiler);
    assert.equal(r.status, 201, r.texto);
    const m = r.body.movimiento;
    assert.equal(m.tipo, 'ingreso');
    assert.equal(m.categoria, 'alquiler_estacionamiento');
    assert.equal(m.categoria_etiqueta, 'Alquiler de estacionamiento');
    assert.equal(m.pagador, 'Juan Pérez (A-101)');
    assert.equal(m.estacionamiento, 'E-12');
    assert.equal(m.monto, '150.00');
    assert.equal(m.mes, 9);
    assert.equal(m.anio, 2026);
    assert.equal(m.fecha, '2026-10-02');
    assert.equal(m.referencia, 'DEP-1');
    assert.equal(m.registrado_por.nombre, 'Tesorero central');
    assert.equal(m.voucher.tipo_mime, 'image/png');
    assert.ok(!r.texto.includes('datos'), 'nunca devuelve los bytes del voucher');
    assert.equal(await movimientosDe(d.complejoA.id), antes + 1);
  });

  it('el alquiler lo paga también un externo (texto libre) y el otro ingreso lleva su detalle', async () => {
    const ext = await registrar(T.central, { ...alquiler, pagador: 'Externo: Carlos Ríos (placa ABC-123)', estacionamiento: 'E-14', monto: '120' });
    assert.equal(ext.status, 201, ext.texto);
    assert.equal(ext.body.movimiento.pagador, 'Externo: Carlos Ríos (placa ABC-123)');
    const otro = await registrar(T.central, { categoria: 'otro_ingreso', descripcion: 'Venta de chatarra', monto: '20.50' });
    assert.equal(otro.status, 201, otro.texto);
    assert.equal(otro.body.movimiento.descripcion, 'Venta de chatarra');
    assert.equal(otro.body.movimiento.estacionamiento, null);
    // El ingreso de prueba (externo) se quita para dejar los números fijos: 150.00 + 20.50.
    assert.equal((await llama(T.central, 'DELETE', `/api/cierres/central/movimientos/${ext.body.movimiento.id}`)).status, 204);
  });

  it('sin voucher → 422 y no queda nada guardado (ni con JSON)', async () => {
    const antes = await movimientosDe(d.complejoA.id);
    const sin = await registrar(T.central, alquiler, null);
    assert.equal(sin.status, 422);
    assert.ok(sin.body.campos.voucher);
    const json = await llama(T.central, 'POST', '/api/cierres/central/movimientos', { mes: 9, anio: 2026, fecha: '2026-10-02', ...alquiler });
    assert.equal(json.status, 422);
    assert.ok(json.body.campos.voucher);
    assert.equal(await movimientosDe(d.complejoA.id), antes);
  });

  it('el voucher se verifica por su contenido: tipo no permitido → 415, bytes que no corresponden → 422', async () => {
    const antes = await movimientosDe(d.complejoA.id);
    assert.equal((await registrar(T.central, alquiler, { bytes: Buffer.from('hola'), tipo: 'text/plain', nombre: 'v.txt' })).status, 415);
    assert.equal((await registrar(T.central, alquiler, { bytes: Buffer.from('no soy una imagen'), tipo: 'image/png', nombre: 'v.png' })).status, 422);
    assert.equal(await movimientosDe(d.complejoA.id), antes);
  });

  it('el alquiler exige quién paga y qué estacionamiento; los otros ingresos y los egresos, su detalle; monto, fecha y mes válidos', async () => {
    const antes = await movimientosDe(d.complejoA.id);
    const caso = async (campos: Campos, campo: string) => {
      const r = await registrar(T.central, campos);
      assert.equal(r.status, 422, `${campo}: ${r.texto}`);
      assert.ok(r.body.campos[campo], `falta el error de ${campo}: ${r.texto}`);
    };
    await caso({ ...alquiler, pagador: undefined }, 'pagador');
    await caso({ ...alquiler, estacionamiento: undefined }, 'estacionamiento');
    await caso({ categoria: 'otro_ingreso', monto: '5' }, 'descripcion');
    await caso({ categoria: 'servicio', monto: '5' }, 'descripcion');
    await caso({ ...alquiler, monto: '0' }, 'monto');
    await caso({ ...alquiler, monto: '12.345' }, 'monto');
    await caso({ ...alquiler, monto: '-4' }, 'monto');
    await caso({ ...alquiler, fecha: '2999-01-01' }, 'fecha');
    await caso({ ...alquiler, fecha: '02/10/2026' }, 'fecha');
    await caso({ ...alquiler, mes: 13 }, 'mes');
    await caso({ ...alquiler, categoria: 'inventada' }, 'categoria');
    await caso({ ...alquiler, proveedor_id: proveedorA.id }, 'proveedor_id');
    assert.equal(await movimientosDe(d.complejoA.id), antes);
  });
});

describe('registrar un egreso: servicios (boleta) y proveedores de áreas comunes (factura)', () => {
  it('servicio: boleta y voucher; proveedor: su factura y el proveedor de la empresa', async () => {
    const s = await registrar(T.central, { categoria: 'servicio', descripcion: 'Luz áreas comunes', documento: 'BOL-123', monto: '80.00', referencia: 'TRF-9' });
    assert.equal(s.status, 201, s.texto);
    assert.equal(s.body.movimiento.tipo, 'egreso');
    assert.equal(s.body.movimiento.documento, 'BOL-123');
    assert.equal(s.body.movimiento.pagador, null, 'un egreso no guarda «quién paga»');
    const p = await registrar(T.central, { categoria: 'proveedor', descripcion: 'Jardinería de octubre', documento: 'F001-9', monto: '30.00', proveedor_id: proveedorA.id, pagador: 'no aplica', estacionamiento: 'E-1' });
    assert.equal(p.status, 201, p.texto);
    assert.deepEqual(p.body.movimiento.proveedor, { id: proveedorA.id, razon_social: 'Jardines SAC' });
    assert.equal(p.body.movimiento.pagador, null);
    assert.equal(p.body.movimiento.estacionamiento, null);
  });

  it('un proveedor de otra empresa (o inexistente) → 422 y no queda nada', async () => {
    const antes = await movimientosDe(d.complejoA.id);
    for (const id of [proveedorB.id, 999_999]) {
      const r = await registrar(T.central, { categoria: 'proveedor', descripcion: 'X', monto: '10', proveedor_id: id });
      assert.equal(r.status, 422, r.texto);
      assert.ok(r.body.campos.proveedor_id);
    }
    assert.equal(await movimientosDe(d.complejoA.id), antes);
  });

  it('sin voucher tampoco se registra un egreso', async () => {
    const antes = await movimientosDe(d.complejoA.id);
    const r = await registrar(T.central, { categoria: 'servicio', descripcion: 'Agua', monto: '10' }, null);
    assert.equal(r.status, 422);
    assert.ok(r.body.campos.voucher);
    assert.equal(await movimientosDe(d.complejoA.id), antes);
  });
});

describe('saldo del mes y Fondo de ahorros de la Junta central', () => {
  it('setiembre: ingresos = aportes confirmados sin contingencia (85) + otros ingresos (170.50); egresos 110; saldo 145.50', async () => {
    const r = await central(T.central);
    assert.equal(r.body.ingresos.aportes.confirmados, '85.00');
    assert.equal(r.body.ingresos.otros.total, '170.50');
    assert.equal(r.body.ingresos.otros.movimientos.length, 2);
    assert.equal(r.body.ingresos.total, '255.50');
    assert.equal(r.body.egresos.total, '110.00');
    assert.equal(r.body.egresos.movimientos.length, 2);
    assert.equal(r.body.saldo_mes, '145.50');
    assert.equal(r.body.fondo_ahorros, '145.50');
    assert.equal(r.body.fondo_contingencia, '9.00');
  });

  it('el Fondo de ahorros acumula los meses anteriores; el de contingencia va aparte y no se mezcla', async () => {
    assert.equal((await registrar(T.central, { categoria: 'otro_ingreso', descripcion: 'Intereses', monto: '100', mes: 8 })).status, 201);
    assert.equal((await registrar(T.central, { categoria: 'servicio', descripcion: 'Agua', monto: '30', mes: 8 })).status, 201);
    const ago = await central(T.central, 8);
    assert.equal(ago.body.saldo_mes, '70.00');
    assert.equal(ago.body.fondo_ahorros, '70.00', 'agosto no suma setiembre');
    assert.equal(ago.body.fondo_contingencia, '0.00');
    assert.equal(ago.body.estado, 'sin_blocks');
    const set = await central(T.central);
    assert.equal(set.body.saldo_mes, '145.50');
    assert.equal(set.body.fondo_ahorros, '215.50', '70 de agosto + 145.50 de setiembre');
    const oct = await central(T.central, 10);
    assert.equal(oct.body.saldo_mes, '0.00');
    assert.equal(oct.body.fondo_ahorros, '215.50', 'el fondo sigue en octubre');
    assert.equal(oct.body.fondo_contingencia, '9.00');
    assert.equal(oct.body.fondo_contingencia_mes, '0.00');
  });

  it('un movimiento de otro condominio no se mezcla en el fondo', async () => {
    const b = await central(T.adminB, 9, 2026, `&complejo_id=${d.complejoB.id}`);
    assert.equal(b.body.fondo_ahorros, '0.00');
    assert.equal(b.body.saldo_mes, '0.00');
  });
});

describe('quién registra y quién corrige', () => {
  it('el presidente central, los tesoreros de block y un propietario sin cargo NO registran (403) y no queda nada', async () => {
    const antes = await movimientosDe(d.complejoA.id);
    for (const t of [T.presiCentral, T.tesor1, T.presi1, T.prop1, T.tesorB]) {
      const r = await registrar(t, alquiler);
      assert.equal(r.status, 403, r.texto);
    }
    assert.equal(await movimientosDe(d.complejoA.id), antes);
  });

  it('la administración sí registra (eligiendo el condominio); de otra empresa → 404; sin condominio → 422; el tesorero central de otro condominio → 404', async () => {
    const ok = await registrar(T.adminA, { categoria: 'otro_egreso', descripcion: 'Papelería', monto: '12.00' }, voucher(), `?complejo_id=${d.complejoA.id}`);
    assert.equal(ok.status, 201, ok.texto);
    assert.equal(ok.body.movimiento.registrado_por.nombre, 'Admin A');
    assert.equal((await llama(T.adminA, 'DELETE', `/api/cierres/central/movimientos/${ok.body.movimiento.id}`)).status, 204);
    assert.equal((await registrar(T.adminB, alquiler, voucher(), `?complejo_id=${d.complejoA.id}`)).status, 404);
    assert.equal((await registrar(T.adminA, alquiler)).status, 422);
    assert.equal((await registrar(T.central, alquiler, voucher(), `?complejo_id=${d.complejoB.id}`)).status, 404);
  });

  it('el voucher lo abren el tesorero central, el presidente central y la administración; la junta de un block no (403) y otra empresa tampoco (404)', async () => {
    const m = (await central(T.central)).body.ingresos.otros.movimientos[0];
    const ver = (t: string) => fetch(`${base}/api/cierres/central/movimientos/${m.id}/voucher`, { headers: cabecerasDeSesion(t) });
    for (const t of [T.central, T.presiCentral, T.adminA]) {
      const r = await ver(t);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-type'), 'image/png');
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      assert.match(r.headers.get('cache-control') ?? '', /no-store/);
    }
    assert.equal((await ver(T.tesor1)).status, 403);
    assert.equal((await ver(T.prop1)).status, 403);
    assert.equal((await ver(T.adminB)).status, 404);
    assert.equal((await ver(T.tesorB)).status, 403);
  });

  it('quitar un movimiento: el tesorero central o la administración (204); el presidente y los de block, 403; otra empresa, 404; ya no cuenta ni se abre su voucher', async () => {
    const r = await registrar(T.central, { categoria: 'servicio', descripcion: 'Agua de prueba', monto: '5.00' });
    assert.equal(r.status, 201);
    const id = r.body.movimiento.id;
    assert.equal((await central(T.central)).body.egresos.total, '115.00');
    for (const t of [T.presiCentral, T.tesor1, T.prop1]) assert.equal((await llama(t, 'DELETE', `/api/cierres/central/movimientos/${id}`)).status, 403);
    assert.equal((await llama(T.adminB, 'DELETE', `/api/cierres/central/movimientos/${id}`)).status, 404);
    assert.equal((await central(T.central)).body.egresos.total, '115.00', 'nada cambió con los intentos rechazados');
    assert.equal((await llama(T.central, 'DELETE', `/api/cierres/central/movimientos/${id}`)).status, 204);
    assert.equal((await central(T.central)).body.egresos.total, '110.00');
    assert.equal((await llama(T.central, 'DELETE', `/api/cierres/central/movimientos/${id}`)).status, 404);
    assert.equal((await fetch(`${base}/api/cierres/central/movimientos/${id}/voucher`, { headers: cabecerasDeSesion(T.central) })).status, 404);
    assert.equal(await prisma.archivoMovimientoCentral.count({ where: { movimiento_id: id } }), 0, 'el voucher se borra con el movimiento');
  });
});

describe('auditoría', () => {
  it('registrar y quitar quedan auditados como cierre_central, con el hash del voucher y nunca el archivo', async () => {
    const r = await registrar(T.central, { categoria: 'otro_ingreso', descripcion: 'Auditoría', monto: '7.00' });
    assert.equal(r.status, 201);
    const id = r.body.movimiento.id;
    await llama(T.central, 'DELETE', `/api/cierres/central/movimientos/${id}`);
    const filas = await prisma.auditoria.findMany({ where: { entidad: 'cierre_central', entidad_id: id }, orderBy: { id: 'asc' } });
    assert.deepEqual(filas.map((f) => f.accion), ['registrar_ingreso', 'quitar_ingreso']);
    const detalle = filas[0]!.detalle as Record<string, unknown>;
    assert.equal(detalle.monto, '7.00');
    assert.match(String(detalle.sha256), /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(detalle).includes('datos'));
    assert.equal(filas[0]!.usuario_id, ids.central);
  });
});

describe('aviso cuando todos ya aportaron', () => {
  it('si todos los blocks ya registraron su aporte del mes no hay nada que avisar (aunque falte la conformidad)', async () => {
    const luz = await prisma.concepto.findFirstOrThrow({ where: { empresa_id: d.empresaA.id, nombre: 'LUZ AREAS COMUNES DEL CONDOMINIO' } });
    await recibo(e1.id, 10, 2026, [{ concepto: luz, cargos: [[d.unidadA1.id, 25, 'pagado']] }]);
    await recibo(e2.id, 10, 2026, [{ concepto: luz, cargos: [[d.unidadA2.id, 35, 'pagado']] }]);
    for (const [t, e] of [[T.tesor1, e1.id], [T.tesor2, e2.id]] as const) assert.equal((await aportar(t, e, { mes: 10 })).status, 201);
    assert.equal((await central(T.central, 10)).body.blocks_sin_aportar.length, 0);
    assert.equal(await encolarAportesPendientes(new Date('2026-11-05T15:00:00Z')), 0);
  });

  it('el mes siguiente se avisa aparte (una vez por mes): ref propia por mes', async () => {
    const luz = await prisma.concepto.findFirstOrThrow({ where: { empresa_id: d.empresaA.id, nombre: 'LUZ AREAS COMUNES DEL CONDOMINIO' } });
    await recibo(e1.id, 11, 2026, [{ concepto: luz, cargos: [[d.unidadA1.id, 25, 'pagado']] }]);
    assert.equal(await encolarAportesPendientes(new Date('2026-12-07T15:00:00Z')), 1);
    const n = await prisma.notificacion.findMany({ where: { usuario_id: ids.central, ref_entidad: 'cierre-central:2026-11' } });
    assert.equal(n.length, 1);
    assert.match(n[0]!.cuerpo, /Block 1/);
    assert.ok(!/Block 2/.test(n[0]!.cuerpo), 'el Block 2 no tiene recibo de noviembre: no se le espera');
    assert.equal(await encolarAportesPendientes(new Date('2026-12-08T15:00:00Z')), 0);
  });
});
