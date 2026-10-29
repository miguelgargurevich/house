// Reglas de cobranza: (1) la fecha del pago es la del voucher, (2) dos recordatorios por recibo y unidad sin voucher, (3) mora en el recibo siguiente.
// La IA es siempre falsa (`llaveroDeps.fetch` inyectado), el reloj es inyectado y nunca hay red.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import { Prisma } from '@prisma/client';
import XLSX from 'xlsx';
import { cabecerasDeSesion, iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { hoyLima } from '../src/server/lib/fechas';
import { encolarAviso, encolarRecordatorios } from '../src/server/services/avisos';
import { plantilla } from '../src/server/services/avisos/plantillas';
import { decidirFecha, DIAS_ANTES_EMISION_VOUCHER } from '../src/server/services/fechaVoucher';
import { evaluacionDeps, esperarEvaluaciones } from '../src/server/services/evaluacion';
import { guardar as guardarClaveLlavero, llaveroDeps } from '../src/server/services/llavero';
import { pagarComoResidente } from './helpers/pagoResidente';
import { invalidarComercial } from '../src/server/services/comercial/modulos';
import { agregarMora, CONCEPTO_MORA, esConceptoMora, evaluarMora, informeDeMora, moraDeps } from '../src/server/services/mora';
import { olvidarTodoUso } from '../src/server/services/rotacion';
import { limpiarTodo } from '../src/server/lib/cooldown';
import { fechaPorRevisar, textoFechaPago } from '../src/pages/shared/mantenimiento/fechaPago';
import { resumenSubida } from '../src/pages/admin/_parts/cobranza/resumenExcel';

const DIA = 86_400_000;
const ENC = 'clave-maestra-de-pruebas-que-supera-32-caracteres';
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const HOY = hoyLima().getTime();

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1' | 'prop2', string>;
let torre1: { id: number };
let torre2: { id: number };
let torre3: { id: number };

// ---------- IA falsa ----------
let respuesta: () => Response = () => lecturaOk();
const fetchOriginal = llaveroDeps.fetch;
const relojOriginal = { ...evaluacionDeps };
const moraRelojOriginal = { ...moraDeps };
let n = 0;
const unico = () => ++n;
const dosShapes = (texto: string) => new Response(JSON.stringify({ choices: [{ message: { content: texto } }], candidates: [{ content: { parts: [{ text: texto }] } }] }), { status: 200 });
const lectura = (extra: Record<string, unknown> = {}) => ({
  es_comprobante_de_pago: true, legible: true, medio: 'yape', estado_operacion: 'exitosa', monto: 100, moneda: 'PEN', fecha: iso(HOY),
  numero_operacion: `OP${String(unico()).padStart(6, '0')}`, destinatario_nombre: 'Maria Perez Garcia', destino_numero: '321', ...extra,
});
const lecturaOk = (extra: Record<string, unknown> = {}) => dosShapes(JSON.stringify(lectura(extra)));
const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`captura-falsa-${unico()}`)]);

async function subirVoucher(token: string, pagoId: number) {
  const r = await fetch(`${base}/api/pagos/${pagoId}/comprobante`, { method: 'POST', headers: { 'content-type': 'image/png', ...cabecerasDeSesion(token) }, body: new Uint8Array(PNG()) });
  assert.equal(r.status, 201, await r.text());
}

before(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, ai: 100_000, llavero: 100_000, evaluacion: 100_000 } }));
  T = {
    super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'),
    prop1: await login(base, 'prop1@test.pe'), prop2: await login(base, 'prop2@test.pe'),
  };
  torre1 = await prisma.estructura.create({ data: { nombre: 'B.1', tipo: 'block', complejo_id: d.complejoA.id } });
  torre2 = await prisma.estructura.create({ data: { nombre: 'B.2', tipo: 'block', complejo_id: d.complejoA.id } });
  torre3 = await prisma.estructura.create({ data: { nombre: 'B.3', tipo: 'block', complejo_id: d.complejoA.id } });
  llaveroDeps.fetch = async () => respuesta();
});
after(async () => {
  llaveroDeps.fetch = fetchOriginal;
  Object.assign(evaluacionDeps, relojOriginal);
  Object.assign(moraDeps, moraRelojOriginal);
  delete process.env.LLAVERO_ENC_KEY;
  await esperarEvaluaciones();
  await cerrar();
  await prisma.$disconnect();
});

// =====================================================================================================
// 1. Fecha de pago = fecha del voucher
// =====================================================================================================
describe('decidirFecha (pura): qué fecha del voucher se puede usar', () => {
  const emision = new Date('2026-10-15T00:00:00Z');
  const hoy = new Date('2026-10-26T17:00:00Z');
  const base = { es_comprobante_de_pago: true, legible: true, estado_operacion: 'exitosa' as const, fecha: '2026-10-20' as string | null };

  it('una fecha creíble se aplica, guardada al mediodía UTC del día leído (el mismo día en cualquier zona)', () => {
    const r = decidirFecha(base, { hoy, emision });
    assert.equal(r.tipo, 'aplicar');
    if (r.tipo === 'aplicar') assert.equal(r.fecha.toISOString(), '2026-10-20T12:00:00.000Z');
    assert.equal(decidirFecha({ ...base, fecha: '2026-10-26' }, { hoy, emision }).tipo, 'aplicar', 'hoy vale');
  });

  it('futura (después de hoy en Lima) → inválida; el borde de medianoche de Lima manda', () => {
    assert.equal(decidirFecha({ ...base, fecha: '2026-10-27' }, { hoy, emision }).tipo, 'invalida');
    const f = { ...base, fecha: '2026-11-02' };
    assert.equal(decidirFecha(f, { hoy: new Date('2026-11-02T04:59:59Z'), emision }).tipo, 'invalida', 'en Lima aún es 1 de noviembre');
    assert.equal(decidirFecha(f, { hoy: new Date('2026-11-02T05:00:00Z'), emision }).tipo, 'aplicar', 'en Lima ya es 2 de noviembre');
  });

  it(`anterior a la emisión − ${DIAS_ANTES_EMISION_VOUCHER} días → inválida; justo el límite se acepta`, () => {
    assert.equal(DIAS_ANTES_EMISION_VOUCHER, 60);
    assert.equal(decidirFecha({ ...base, fecha: '2026-08-16' }, { hoy, emision }).tipo, 'aplicar', '60 días antes de la emisión');
    assert.equal(decidirFecha({ ...base, fecha: '2026-08-15' }, { hoy, emision }).tipo, 'invalida', '61 días antes');
  });

  it('sin fecha, ilegible, no es un comprobante o la operación no está exitosa → no leída', () => {
    for (const x of [{ fecha: null }, { legible: false }, { es_comprobante_de_pago: false }, { estado_operacion: 'pendiente' as const }, { estado_operacion: 'fallida' as const }]) {
      assert.equal(decidirFecha({ ...base, ...x }, { hoy, emision }).tipo, 'no_leida', JSON.stringify(x));
    }
    assert.equal(decidirFecha({ ...base, estado_operacion: 'desconocido' }, { hoy, emision }).tipo, 'aplicar', 'un depósito sin estado claro sí cuenta');
  });
});

describe('la fecha del pago sale del voucher (IA falsa)', () => {
  let contador = 0;
  async function claves() {
    await guardarClaveLlavero({ proveedor: 'openai', clave: 'clave-falsa-openai-0001', usuarioId: d.superadmin.id });
  }
  /** Una unidad con `conceptos` cargos de S/ 100 cada uno, en un recibo emitido hace 60 días. */
  async function mantenimiento(conceptos = 1, propietarioId = d.propietario1.id) {
    contador += 1;
    const unidad = await prisma.unidad.create({ data: { codigo: `FV-${contador}`, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, propietario_id: propietarioId, estado: 'activa' } });
    const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, mes: 1, anio: 2026, fecha_emision: new Date(HOY - 60 * DIA), fecha_vencimiento: new Date(HOY + 30 * DIA), estado: 'emitido' } });
    const cargos = [];
    for (let i = 0; i < conceptos; i++) {
      const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: d.conceptoA.id, monto: 0, orden: i + 1 } });
      cargos.push(await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidad.id, monto: 100 / conceptos, estado_pago: 'pendiente' } }));
    }
    return { unidad, recibo, cargos };
  }
  /** El residente paga el mantenimiento completo (un pago por cargo, un grupo) con su voucher en el mismo pedido; la IA lo lee. */
  async function pagaYSube(m: Awaited<ReturnType<typeof mantenimiento>>, token = T.prop1) {
    const r = await pagarComoResidente(base, token, m.recibo.id, m.unidad.id, { metodo_pago: 'yape' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const pagoId = r.body.pago_id as number;
    await esperarEvaluaciones();
    return pagoId;
  }
  const pagosDe = (m: Awaited<ReturnType<typeof mantenimiento>>) => prisma.pago.findMany({ where: { recibo_concepto_unidad_id: { in: m.cargos.map((c) => c.id) } }, orderBy: { id: 'asc' } });

  beforeEach(async () => {
    process.env.LLAVERO_ENC_KEY = ENC;
    await prisma.claveIntegracion.deleteMany();
    await prisma.medioPago.deleteMany();
    await prisma.medioPago.create({ data: { complejo_id: d.complejoA.id, tipo: 'yape', celular: '987654321', titular: 'María Pérez García', creado_por_id: d.adminA.id } });
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { validacion_automatica_ia: false } });
    await prisma.notificacion.deleteMany();
    limpiarTodo();
    olvidarTodoUso();
    Object.assign(evaluacionDeps, relojOriginal);
    respuesta = () => lecturaOk();
    await claves();
  });
  afterEach(async () => { await esperarEvaluaciones(); });

  it('el residente sube su voucher: TODO el grupo del mantenimiento queda con la fecha leída, y la auditoría guarda anterior → nueva', async () => {
    const m = await mantenimiento(2);
    const leida = iso(HOY - 3 * DIA);
    respuesta = () => lecturaOk({ fecha: leida });
    const pagoId = await pagaYSube(m);
    const pagos = await pagosDe(m);
    assert.equal(pagos.length, 2);
    for (const p of pagos) {
      assert.equal(p.fecha_pago.toISOString(), `${leida}T12:00:00.000Z`);
      assert.equal(p.fecha_origen, 'voucher');
      assert.ok(p.fecha_declarada, 'guarda la fecha declarada');
    }
    const aud = await prisma.auditoria.findFirstOrThrow({ where: { accion: 'fecha_pago_voucher', entidad: 'pago', entidad_id: pagoId } });
    assert.deepEqual(aud.detalle, { origen: 'voucher', anterior: iso(HOY), nueva: leida });
    assert.equal(aud.usuario_id, null);
  });

  it('la fecha leída se juzga con el día del condominio: el 11-dic es FUTURA en Lima y vale en Madrid (10-dic 23:30 UTC)', async () => {
    evaluacionDeps.ahora = () => new Date('2026-12-10T23:30:00Z');
    respuesta = () => lecturaOk({ fecha: '2026-12-11' });
    try {
      const lima = await mantenimiento(1);
      await pagaYSube(lima);
      assert.equal((await pagosDe(lima))[0]!.fecha_origen, 'invalida', 'en Lima aún es el 10');
      await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { zona_horaria: 'Europe/Madrid' } });
      const madrid = await mantenimiento(1);
      await pagaYSube(madrid);
      const p = (await pagosDe(madrid))[0]!;
      assert.equal(p.fecha_origen, 'voucher', 'en Madrid ya es el 11');
      assert.equal(p.fecha_pago.toISOString(), '2026-12-11T12:00:00.000Z');
    } finally {
      await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { zona_horaria: 'America/Lima' } });
    }
  });

  it('el administrador adjunta el voucher a un pago ya validado: cambia la fecha del pago y la de su cargo', async () => {
    const m = await mantenimiento(1);
    const registrado = await llamar(base, 'POST', '/api/pagos', T.adminA, { recibo_concepto_unidad_id: m.cargos[0]!.id, monto: 100, metodo_pago: 'efectivo', fecha_pago: iso(HOY) });
    assert.equal(registrado.status, 201, JSON.stringify(registrado.body));
    const pagoId = registrado.body.id as number;
    assert.equal((await prisma.reciboConceptoUnidad.findUniqueOrThrow({ where: { id: m.cargos[0]!.id } })).estado_pago, 'pagado');
    const leida = iso(HOY - 5 * DIA);
    respuesta = () => lecturaOk({ fecha: leida });
    await subirVoucher(T.adminA, pagoId);
    await esperarEvaluaciones();
    const p = await prisma.pago.findUniqueOrThrow({ where: { id: pagoId } });
    assert.equal(p.estado_validacion, 'validado', 'adjuntar no cambia el estado');
    assert.equal(p.fecha_pago.toISOString(), `${leida}T12:00:00.000Z`);
    assert.equal(p.fecha_origen, 'voucher');
    const c = await prisma.reciboConceptoUnidad.findUniqueOrThrow({ where: { id: m.cargos[0]!.id } });
    assert.equal(c.fecha_pago?.toISOString(), `${leida}T12:00:00.000Z`);
  });

  it('si la IA no lee la fecha queda la declarada y se marca «no_leida» (visible en el pago)', async () => {
    const m = await mantenimiento(2);
    const antes = Date.now();
    respuesta = () => lecturaOk({ fecha: null });
    const pagoId = await pagaYSube(m);
    for (const p of await pagosDe(m)) {
      assert.equal(p.fecha_origen, 'no_leida');
      assert.ok(Math.abs(p.fecha_pago.getTime() - antes) < 60_000, 'sigue la fecha declarada (el momento del registro)');
    }
    const api = await llamar(base, 'GET', '/api/pagos?estado_validacion=por_validar&pageSize=100', T.adminA);
    const fila = api.body.items.find((x: { id: number }) => x.id === pagoId);
    assert.equal(fila.fecha_origen, 'no_leida', 'quien valida lo ve en la lista');
  });

  it('sin IA disponible (sin claves) también queda marcada como no leída', async () => {
    await prisma.claveIntegracion.deleteMany();
    const m = await mantenimiento(1);
    await pagaYSube(m);
    assert.equal((await pagosDe(m))[0]!.fecha_origen, 'no_leida');
  });

  it('una fecha leída FUTURA no se aplica y deja el pago por revisar, aunque la validación automática esté encendida', async () => {
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { validacion_automatica_ia: true } });
    const m = await mantenimiento(1);
    respuesta = () => lecturaOk({ fecha: iso(HOY + DIA) }); // mañana: el contraste lo tolera, la regla de la fecha no
    const pagoId = await pagaYSube(m);
    const p = await prisma.pago.findUniqueOrThrow({ where: { id: pagoId } });
    assert.equal(p.estado_validacion, 'por_validar', 'la IA no lo valida sola');
    assert.equal(p.fecha_origen, 'invalida');
    assert.ok(Math.abs(p.fecha_pago.getTime() - Date.now()) < 60_000, 'queda la declarada');
    const aud = await prisma.auditoria.findFirstOrThrow({ where: { accion: 'fecha_pago_voucher', entidad_id: pagoId } });
    assert.equal((aud.detalle as { leida?: string }).leida, iso(HOY + DIA));
  });

  it('con la validación automática y una fecha válida, el pago se valida con la fecha del voucher en su cargo', async () => {
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { validacion_automatica_ia: true } });
    const m = await mantenimiento(1);
    const leida = iso(HOY - 2 * DIA);
    respuesta = () => lecturaOk({ fecha: leida });
    const pagoId = await pagaYSube(m);
    assert.equal((await prisma.pago.findUniqueOrThrow({ where: { id: pagoId } })).estado_validacion, 'validado');
    const c = await prisma.reciboConceptoUnidad.findUniqueOrThrow({ where: { id: m.cargos[0]!.id } });
    assert.equal(c.estado_pago, 'pagado');
    assert.equal(c.fecha_pago?.toISOString(), `${leida}T12:00:00.000Z`, 'el cargo guarda la fecha del voucher, no la declarada');
  });

  it(`una fecha anterior a la emisión − ${DIAS_ANTES_EMISION_VOUCHER} días no se aplica; el límite exacto sí`, async () => {
    const vieja = await mantenimiento(1);
    respuesta = () => lecturaOk({ fecha: iso(HOY - 121 * DIA) }); // la emisión fue hace 60 días: 61 días antes de ella
    await pagaYSube(vieja);
    assert.equal((await pagosDe(vieja))[0]!.fecha_origen, 'invalida');
    const limite = await mantenimiento(1);
    respuesta = () => lecturaOk({ fecha: iso(HOY - 120 * DIA) });
    await pagaYSube(limite);
    const p = (await pagosDe(limite))[0]!;
    assert.equal(p.fecha_origen, 'voucher');
    assert.equal(p.fecha_pago.toISOString(), `${iso(HOY - 120 * DIA)}T12:00:00.000Z`);
  });

  it('un voucher nuevo cuya fecha no se lee restaura la fecha declarada (no deja la del voucher anterior)', async () => {
    const m = await mantenimiento(1);
    respuesta = () => lecturaOk({ fecha: iso(HOY - 4 * DIA) });
    const pagoId = await pagaYSube(m);
    const declarada = (await prisma.pago.findUniqueOrThrow({ where: { id: pagoId } })).fecha_declarada!;
    assert.equal((await prisma.pago.findUniqueOrThrow({ where: { id: pagoId } })).fecha_origen, 'voucher');
    respuesta = () => lecturaOk({ fecha: null });
    await subirVoucher(T.prop1, pagoId);
    await esperarEvaluaciones();
    const p = await prisma.pago.findUniqueOrThrow({ where: { id: pagoId } });
    assert.equal(p.fecha_origen, 'no_leida');
    assert.equal(p.fecha_pago.getTime(), declarada.getTime());
    assert.equal(p.fecha_declarada, null);
  });

  it('una fecha corregida a mano por la administración queda «manual» y ninguna evaluación posterior la pisa', async () => {
    const m = await mantenimiento(2);
    respuesta = () => lecturaOk({ fecha: iso(HOY - 3 * DIA) });
    const pagoId = await pagaYSube(m);
    const corregida = iso(HOY - 10 * DIA);
    const r = await llamar(base, 'PATCH', `/api/pagos/${pagoId}`, T.adminA, { fecha_pago: corregida });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    for (const p of await pagosDe(m)) { assert.equal(p.fecha_origen, 'manual'); assert.equal(iso(p.fecha_pago.getTime()), corregida); }
    respuesta = () => lecturaOk({ fecha: iso(HOY - 1 * DIA) });
    await subirVoucher(T.prop1, pagoId);
    await esperarEvaluaciones();
    for (const p of await pagosDe(m)) { assert.equal(p.fecha_origen, 'manual'); assert.equal(iso(p.fecha_pago.getTime()), corregida); }
  });

  it('otro mantenimiento (y otro tenant) no se toca', async () => {
    const m1 = await mantenimiento(1);
    const m2 = await mantenimiento(1, d.propietario2.id);
    respuesta = () => lecturaOk({ fecha: iso(HOY - 1 * DIA) });
    const r2 = await pagarComoResidente(base, T.prop2, m2.recibo.id, m2.unidad.id, { metodo_pago: 'yape' });
    assert.equal(r2.status, 201);
    await esperarEvaluaciones();
    respuesta = () => lecturaOk({ fecha: iso(HOY - 3 * DIA) });
    await pagaYSube(m1);
    // El voucher de m1 (hace 3 días) no toca la fecha de m2: conserva la de SU voucher (ayer).
    const otro = (await pagosDe(m2))[0]!;
    assert.equal(otro.fecha_origen, 'voucher');
    assert.equal(iso(otro.fecha_pago.getTime()), iso(HOY - 1 * DIA));
    const ajeno = await prisma.pago.findMany({ where: { reciboConceptoUnidad: { unidad: { complejo_id: d.complejoB.id } } } });
    assert.ok(ajeno.every((p) => p.fecha_origen === 'declarada'));
  });
});

// =====================================================================================================
// 2. Recordatorios: dos por recibo y unidad sin voucher
// =====================================================================================================
describe('recordatorios: por_vencer (2 días antes) y vence_hoy (el día), sin voucher', () => {
  let k = 0;
  /** Recibo de la torre B.7 que vence el 2-nov-2026, con una unidad de un propietario con correo y WhatsApp. */
  async function escenario(estadoCargo = 'pendiente') {
    k += 1;
    const torre = await prisma.estructura.create({ data: { nombre: `B.7${k}`, tipo: 'block', complejo_id: d.complejoA.id } });
    const usuario = await prisma.usuario.create({ data: { nombre: `Vecino Aviso ${k}`, email: `aviso${k}@test.pe`, telefono: '987654321', aviso_email: true, aviso_whatsapp: true, rol: 'propietario', password_hash: 'x', empresa_id: d.empresaA.id, complejo_id: d.complejoA.id } });
    const unidad = await prisma.unidad.create({ data: { codigo: `B7${k}-701`, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: torre.id, propietario_id: usuario.id, estado: 'activa' } });
    const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, estructura_id: torre.id, mes: 10, anio: 2026, fecha_emision: new Date('2026-10-15T00:00:00Z'), fecha_vencimiento: new Date('2026-11-02T00:00:00Z'), estado: 'emitido' } });
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: d.conceptoA.id, monto: 0, orden: 1 } });
    const cargo = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidad.id, monto: 150, estado_pago: estadoCargo } });
    return { torre, usuario, unidad, recibo, cargo };
  }
  const delUsuario = async (id: number) => (await prisma.notificacion.findMany({ where: { usuario_id: id }, orderBy: { id: 'asc' } }));
  const claves = (ns: { tipo: string; canal: string }[]) => ns.map((x) => `${x.tipo}/${x.canal}`).sort();
  const lima = (s: string) => new Date(s);

  beforeEach(async () => {
    await prisma.notificacion.deleteMany();
    // Los escenarios de las pruebas anteriores no deben recibir avisos en esta.
    const delEscenario = { reciboConcepto: { recibo: { estructura: { nombre: { startsWith: 'B.7' } } } } };
    await prisma.reciboConceptoUnidad.deleteMany({ where: delEscenario });
    await prisma.reciboConcepto.deleteMany({ where: { recibo: { estructura: { nombre: { startsWith: 'B.7' } } } } });
    await prisma.recibo.deleteMany({ where: { estructura: { nombre: { startsWith: 'B.7' } } } });
  });

  it('2 días antes sale por_vencer (correo y WhatsApp); 3 días antes y 1 día antes no', async () => {
    const e = await escenario();
    assert.equal(await encolarRecordatorios(lima('2026-10-30T17:00:00Z')), 0, '3 días antes (30-oct Lima)');
    assert.equal(await encolarRecordatorios(lima('2026-10-31T17:00:00Z')), 2, '2 días antes');
    assert.deepEqual(claves(await delUsuario(e.usuario.id)), ['por_vencer/email', 'por_vencer/whatsapp']);
    assert.equal(await encolarRecordatorios(lima('2026-11-01T17:00:00Z')), 0, '1 día antes: ya no sale otro');
  });

  it('el día del vencimiento sale vence_hoy (correo y WhatsApp), con el departamento y la torre en el texto', async () => {
    const e = await escenario();
    assert.equal(await encolarRecordatorios(lima('2026-11-02T17:00:00Z')), 2);
    const ns = await delUsuario(e.usuario.id);
    assert.deepEqual(claves(ns), ['vence_hoy/email', 'vence_hoy/whatsapp']);
    const correo = ns.find((x) => x.canal === 'email')!;
    assert.match(correo.asunto, /vence hoy/);
    assert.match(correo.cuerpo, new RegExp(`Departamento: ${e.unidad.codigo} \\(${e.torre.nombre}\\)`));
    assert.match(correo.cuerpo, /voucher/);
    assert.match(correo.cuerpo, /mora de S\/ 20/);
  });

  it('exactamente dos recordatorios por canal en toda la vida del recibo, aunque el planificador corra todo el tiempo', async () => {
    const e = await escenario();
    // Cada 15 minutos entre el 29-oct y el 3-nov (Lima), como el planificador real.
    for (let t = lima('2026-10-29T05:00:00Z').getTime(); t <= lima('2026-11-04T05:00:00Z').getTime(); t += 15 * 60_000) await encolarRecordatorios(new Date(t));
    const ns = await delUsuario(e.usuario.id);
    assert.deepEqual(claves(ns.filter((x) => x.tipo !== 'vencido')), ['por_vencer/email', 'por_vencer/whatsapp', 'vence_hoy/email', 'vence_hoy/whatsapp']);
    assert.equal(ns.filter((x) => x.tipo === 'vencido').length, 2, 'y el vencido de siempre (uno por canal)');
  });

  it('si ya subió su voucher (en revisión o pagado) no se manda ningún recordatorio', async () => {
    for (const estado of ['en_revision', 'pagado']) {
      const e = await escenario(estado);
      await encolarRecordatorios(lima('2026-10-31T17:00:00Z'));
      await encolarRecordatorios(lima('2026-11-02T17:00:00Z'));
      assert.deepEqual(await delUsuario(e.usuario.id), [], estado);
    }
  });

  it('encolar a mano un vence_hoy / por_vencer de un cargo con voucher tampoco crea nada (segunda barrera)', async () => {
    const e = await escenario('en_revision');
    for (const tipo of ['por_vencer', 'vence_hoy'] as const) assert.equal(await encolarAviso(tipo, e.usuario.id, { entidad: 'recibo', id: e.recibo.id }, { ahora: lima('2026-11-02T17:00:00Z') }), 0, tipo);
    await prisma.reciboConceptoUnidad.update({ where: { id: e.cargo.id }, data: { estado_pago: 'pendiente' } });
    assert.equal(await encolarAviso('vence_hoy', e.usuario.id, { entidad: 'recibo', id: e.recibo.id }, { ahora: lima('2026-11-02T17:00:00Z') }), 2, 'sin voucher sí');
  });

  it('si subió el voucher entre los dos recordatorios, el segundo no sale', async () => {
    const e = await escenario();
    await encolarRecordatorios(lima('2026-10-31T17:00:00Z'));
    await prisma.reciboConceptoUnidad.update({ where: { id: e.cargo.id }, data: { estado_pago: 'en_revision' } });
    await encolarRecordatorios(lima('2026-11-02T17:00:00Z'));
    assert.deepEqual(claves(await delUsuario(e.usuario.id)), ['por_vencer/email', 'por_vencer/whatsapp']);
  });

  it('borde de medianoche de Lima: 23:59:59 del día anterior no, 00:00:00 sí (vence_hoy y por_vencer)', async () => {
    const e = await escenario();
    assert.equal(await encolarRecordatorios(lima('2026-10-31T04:59:59Z')), 0, '30-oct 23:59:59 en Lima: faltan 3 días');
    assert.equal(await encolarRecordatorios(lima('2026-10-31T05:00:00Z')), 2, '31-oct 00:00:00 en Lima: faltan 2 días');
    assert.equal(await encolarRecordatorios(lima('2026-11-02T04:59:59Z')), 0, '1-nov 23:59:59 en Lima: falta 1 día');
    assert.equal(await encolarRecordatorios(lima('2026-11-02T05:00:00Z')), 2, '2-nov 00:00:00 en Lima: vence hoy');
    assert.equal(await encolarRecordatorios(lima('2026-11-03T04:59:59Z')), 0, 'sigue siendo 2-nov en Lima: no repite');
    assert.deepEqual(claves(await delUsuario(e.usuario.id)), ['por_vencer/email', 'por_vencer/whatsapp', 'vence_hoy/email', 'vence_hoy/whatsapp']);
  });

  it('otro condominio u otra unidad con voucher no impide el aviso de quien no lo subió', async () => {
    const sin = await escenario();
    const con = await escenario('en_revision');
    await encolarRecordatorios(lima('2026-11-02T17:00:00Z'));
    assert.equal((await delUsuario(sin.usuario.id)).length, 2);
    assert.equal((await delUsuario(con.usuario.id)).length, 0);
  });

  it('la mora sólo se menciona si el condominio la cobra', async () => {
    const e = await escenario();
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { mora_monto: 0 } });
    try {
      await encolarRecordatorios(lima('2026-11-02T17:00:00Z'));
      for (const x of await delUsuario(e.usuario.id)) assert.doesNotMatch(x.cuerpo, /mora/);
    } finally {
      await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { mora_monto: 20 } });
    }
  });

  it('en el plan Gratis (sin mora automática) el recordatorio no promete la mora aunque el condominio tenga un monto configurado', async () => {
    const e = await escenario();
    const sus = await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: d.complejoA.id } });
    await prisma.suscripcionCondominio.update({ where: { complejo_id: d.complejoA.id }, data: { plan_clave: 'gratis', modulos: [], estado: 'gratis' } });
    invalidarComercial();
    try {
      await encolarRecordatorios(lima('2026-11-02T17:00:00Z'));
      const ns = await delUsuario(e.usuario.id);
      assert.ok(ns.length > 0, 'el recordatorio sí sale (el correo es gratis)');
      for (const x of ns) assert.doesNotMatch(x.cuerpo, /mora/);
    } finally {
      await prisma.suscripcionCondominio.update({ where: { complejo_id: d.complejoA.id }, data: { plan_clave: sus.plan_clave, modulos: sus.modulos, estado: sus.estado } });
      invalidarComercial();
    }
  });

  it('las plantillas dicen voucher, día y mora; sin mora configurada no la mencionan', () => {
    const datos = { nombre: 'Ana Pérez', periodo: 'octubre de 2026', monto: 'S/ 150.00', vencimiento: '02/11/2026', condominio: 'Los Libertadores', departamentos: [{ codigo: 'B01-804', torre: 'Block 1' }] };
    const hoy = plantilla('vence_hoy', { ...datos, dias: 0, mora: 'S/ 20' });
    assert.equal(hoy.asunto, 'Tu recibo de octubre de 2026 vence hoy');
    assert.match(hoy.cuerpo, /Hola Ana,/);
    assert.match(hoy.cuerpo, /Departamento: B01-804 \(Block 1\)/);
    assert.match(hoy.cuerpo, /voucher/);
    assert.match(hoy.cuerpo, /mora de S\/ 20/);
    const antes = plantilla('por_vencer', { ...datos, dias: 2, mora: 'S/ 20' });
    assert.equal(antes.asunto, 'Tu recibo de octubre de 2026 vence en 2 días');
    assert.match(antes.cuerpo, /aún no recibimos tu voucher/);
    assert.doesNotMatch(plantilla('vence_hoy', { ...datos, dias: 0 }).cuerpo, /mora/);
  });
});

// =====================================================================================================
// 3. Mora en el recibo siguiente
// =====================================================================================================
type Celda = string | number | null;
const aXlsx = (filas: Celda[][]): Buffer => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Consolidado');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
const subirExcel = async (token: string, archivo: Buffer, complejoId: number) => {
  const f = new FormData();
  f.append('complejo_id', String(complejoId));
  f.append('archivo', new Blob([new Uint8Array(archivo)]), 'recibos.xlsx');
  const r = await fetch(`${base}/api/recibos/excel`, { method: 'POST', headers: cabecerasDeSesion(token), body: f });
  const texto = await r.text();
  let body: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = JSON.parse(texto); } catch { /* no es JSON */ }
  return { status: r.status, body, texto };
};
const CABECERA: Celda[][] = [
  [null, 'GRUPO PRUEBA'],
  [null, null, null, 'MES: Octubre 2026', null, null, 'VENCIMIENTO:', null, '02 DE NOVIEMBRE DE 2026'],
];
const MULTA = 'MULTA PAGO FUERA DE FECHA(ULTIMO DIA 2 CADA MES)';

describe('mora de S/ 20 en el recibo del mes siguiente', () => {
  const VENCE_SET = new Date('2026-10-02T00:00:00Z'); // el recibo de setiembre vence el 2-oct
  const mora = { motivo: 'Pago fuera de fecha del recibo de setiembre de 2026' };
  /** Unidades de la torre B.1 con su escenario de pago del recibo de setiembre. */
  const ESCENARIO: Record<string, { pagos: { monto: number; fecha: string; estado?: string }[]; tarde: boolean }> = {
    'B.1-101': { pagos: [{ monto: 100, fecha: '2026-10-01T15:00:00Z' }], tarde: false }, // a tiempo
    'B.1-102': { pagos: [{ monto: 100, fecha: '2026-10-02T15:00:00Z' }], tarde: false }, // el día del vencimiento: inclusive
    'B.1-103': { pagos: [{ monto: 100, fecha: '2026-10-03T15:00:00Z' }], tarde: true }, // un día tarde
    'B.1-104': { pagos: [], tarde: true }, // nunca pagó
    'B.1-105': { pagos: [{ monto: 50, fecha: '2026-10-01T15:00:00Z' }], tarde: true }, // parcial: no cubre el saldo
    'B.1-106': { pagos: [{ monto: 100, fecha: '2026-10-01T15:00:00Z', estado: 'por_validar' }], tarde: false }, // por validar cuenta
    'B.1-107': { pagos: [{ monto: 100, fecha: '2026-10-01T15:00:00Z', estado: 'rechazado' }], tarde: true }, // rechazado no cuenta
    'B.1-108': { pagos: [{ monto: 100, fecha: '2026-10-03T04:59:59Z' }], tarde: false }, // 2-oct 23:59:59 en Lima
    'B.1-109': { pagos: [{ monto: 100, fecha: '2026-10-03T05:00:00Z' }], tarde: true }, // 3-oct 00:00:00 en Lima
    'B.1-110': { pagos: [{ monto: 60, fecha: '2026-10-01T15:00:00Z' }, { monto: 40, fecha: '2026-10-02T10:00:00Z' }], tarde: false }, // dos pagos a tiempo que suman el saldo
    'B.1-111': { pagos: [{ monto: 60, fecha: '2026-10-01T15:00:00Z' }, { monto: 40, fecha: '2026-10-05T10:00:00Z' }], tarde: true }, // el segundo llegó tarde
  };
  const CODIGOS = Object.keys(ESCENARIO);
  const TARDE = CODIGOS.filter((c) => ESCENARIO[c]!.tarde);
  const unidades = new Map<string, number>();
  let reciboPrevio: { id: number };
  let reciboPrevio2: { id: number };

  const limpiarMes10 = async () => {
    await prisma.pago.deleteMany({ where: { reciboConceptoUnidad: { reciboConcepto: { recibo: { mes: 10, anio: 2026 } } } } });
    await prisma.reciboConceptoUnidad.deleteMany({ where: { reciboConcepto: { recibo: { mes: 10, anio: 2026 } } } });
    await prisma.reciboConcepto.deleteMany({ where: { recibo: { mes: 10, anio: 2026, complejo_id: d.complejoA.id } } });
    await prisma.recibo.deleteMany({ where: { mes: 10, anio: 2026, complejo_id: d.complejoA.id } });
    await prisma.concepto.deleteMany({ where: { nombre: CONCEPTO_MORA } });
  };

  before(async () => {
    for (const c of CODIGOS) unidades.set(c, (await prisma.unidad.create({ data: { codigo: c, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: torre1.id, estado: 'activa' } })).id);
    unidades.set('B.2-101', (await prisma.unidad.create({ data: { codigo: 'B.2-101', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: torre2.id, estado: 'activa' } })).id);
    unidades.set('B.3-101', (await prisma.unidad.create({ data: { codigo: 'B.3-101', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: torre3.id, estado: 'activa' } })).id);
    // Recibo de setiembre de la torre B.1 (y uno de la torre B.2 con su unidad sin pagar), con sus cargos de S/ 100 y sus pagos.
    const recibo = (estructura_id: number) => prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, estructura_id, mes: 9, anio: 2026, fecha_emision: new Date('2026-09-15T00:00:00Z'), fecha_vencimiento: VENCE_SET, estado: 'emitido' } });
    reciboPrevio = await recibo(torre1.id);
    reciboPrevio2 = await recibo(torre2.id);
    const rc1 = await prisma.reciboConcepto.create({ data: { recibo_id: reciboPrevio.id, concepto_id: d.conceptoA.id, monto: 0, orden: 1 } });
    const rc2 = await prisma.reciboConcepto.create({ data: { recibo_id: reciboPrevio2.id, concepto_id: d.conceptoA.id, monto: 0, orden: 1 } });
    for (const [codigo, esc] of Object.entries(ESCENARIO)) {
      const cargo = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc1.id, unidad_id: unidades.get(codigo)!, monto: 100, estado_pago: 'pendiente' } });
      for (const p of esc.pagos) {
        await prisma.pago.create({ data: { recibo_concepto_unidad_id: cargo.id, monto: p.monto, fecha_pago: new Date(p.fecha), estado_validacion: p.estado ?? 'validado', metodo_pago: 'yape' } });
      }
    }
    await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc2.id, unidad_id: unidades.get('B.2-101')!, monto: 100, estado_pago: 'pendiente' } });
  });

  beforeEach(async () => {
    await limpiarMes10();
    moraDeps.ahora = () => new Date('2026-10-20T15:00:00Z'); // el recibo de setiembre ya venció
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { mora_monto: 20 } });
  });
  afterEach(() => { Object.assign(moraDeps, moraRelojOriginal); });

  const filasExcel = (conMulta: boolean, multas: Record<string, Celda> = {}): Celda[][] => [
    ...CABECERA,
    conMulta ? ['BLOCK', 'Dpto.', 'Apellidos y Nombres', 'ADMINISTRACION', MULTA, 'TOTAL MANT'] : ['BLOCK', 'Dpto.', 'Apellidos y Nombres', 'ADMINISTRACION', 'TOTAL MANT'],
    ...CODIGOS.map((c): Celda[] => {
      const dpto = Number(c.split('-')[1]);
      const m = multas[c];
      return conMulta ? ['B.1', dpto, `VECINO ${c}`, 100, m ?? null, 100 + Number(m ?? 0)] : ['B.1', dpto, `VECINO ${c}`, 100, 100];
    }),
    ['TOTALES', null, null, 1100],
  ];
  /** Cargos de mora del recibo de octubre de la torre B.1 por código de unidad. */
  const morasDe = async (torre = torre1) => {
    const cargos = await prisma.reciboConceptoUnidad.findMany({
      where: { observaciones: { not: null }, reciboConcepto: { recibo: { mes: 10, anio: 2026, estructura_id: torre.id } } },
      include: { unidad: true, reciboConcepto: { include: { concepto: true } } },
    });
    return cargos;
  };
  const cargosDe = async (codigo: string) => prisma.reciboConceptoUnidad.findMany({ where: { unidad: { codigo }, reciboConcepto: { recibo: { mes: 10, anio: 2026 } } }, include: { reciboConcepto: { include: { concepto: true } } }, orderBy: { id: 'asc' } });

  it('Excel sin columna de multa: la unidad que pagó tarde recibe S/ 20 en «Multa por pago fuera de fecha» (recargo), con su motivo', async () => {
    const r = await subirExcel(T.adminA, aXlsx(filasExcel(false)), d.complejoA.id);
    assert.equal(r.status, 201, r.texto);
    const ms = await morasDe();
    assert.deepEqual(ms.map((c) => c.unidad?.codigo).sort(), [...TARDE].sort(), 'sólo quienes pagaron tarde: a tiempo, el día del vencimiento, por validar y los bordes de Lima NO');
    for (const c of ms) {
      assert.equal(c.monto.toString(), '20');
      assert.equal(c.reciboConcepto?.concepto?.nombre, CONCEPTO_MORA);
      assert.equal(c.reciboConcepto?.es_recargo, true);
      assert.equal(c.observaciones, mora.motivo);
      assert.equal(c.estado_pago, 'pendiente');
    }
    assert.equal(r.body.mora.cantidad, TARDE.length);
    assert.equal(r.body.mora.monto, '20.00');
    assert.equal(r.body.mora.mensaje, `Se agregó mora de S/ 20 a ${TARDE.length} departamentos: ${[...TARDE].sort().join(', ')}`);
    assert.deepEqual(r.body.mora.departamentos.map((x: { codigo: string }) => x.codigo).sort(), [...TARDE].sort());
    assert.ok(r.body.mora.departamentos.every((x: { torre: string }) => x.torre === 'B.1'));
    // El recibo de otra torre (B.2) no se creó ni se tocó.
    assert.equal(await prisma.recibo.count({ where: { mes: 10, anio: 2026, estructura_id: torre2.id } }), 0);
    // A tiempo: sólo su cargo de mantenimiento.
    assert.deepEqual((await cargosDe('B.1-101')).map((c) => c.monto.toString()), ['100']);
    assert.deepEqual((await cargosDe('B.1-103')).map((c) => c.monto.toString()), ['100', '20']);
  });

  it('reimportar el mismo Excel no suma dos moras (reemplaza el recibo y recalcula)', async () => {
    const excel = aXlsx(filasExcel(false));
    const primera = await subirExcel(T.adminA, excel, d.complejoA.id);
    const segunda = await subirExcel(T.adminA, excel, d.complejoA.id);
    assert.equal(segunda.status, 201, segunda.texto);
    assert.equal(segunda.body.recibos[0].accion, 'reemplazado');
    assert.equal(primera.body.recibo_id, segunda.body.recibo_id);
    const ms = await morasDe();
    assert.equal(ms.length, TARDE.length, 'una sola mora por unidad');
    for (const c of TARDE) assert.equal((await cargosDe(c)).length, 2, `${c}: mantenimiento + una mora`);
    assert.equal(await prisma.concepto.count({ where: { nombre: CONCEPTO_MORA } }), 1, 'el concepto se reutiliza');
    assert.equal(segunda.body.mora.cantidad, TARDE.length);
  });

  it('Excel con la columna de multa: una multa > 0 se respeta (sin duplicar); 0 o vacía y pagó tarde → el sistema pone S/ 20 en ESA columna', async () => {
    const multas = { 'B.1-103': 35, 'B.1-104': 0, 'B.1-109': 10.5 };
    const r = await subirExcel(T.adminA, aXlsx(filasExcel(true, multas)), d.complejoA.id);
    assert.equal(r.status, 201, r.texto);
    assert.equal(await prisma.concepto.count({ where: { nombre: CONCEPTO_MORA } }), 0, 'no se crea otro concepto: se usa la columna del Excel');
    const enColumna = async (c: string) => (await cargosDe(c)).filter((x) => x.reciboConcepto?.concepto?.nombre === MULTA).map((x) => x.monto.toString());
    assert.deepEqual(await enColumna('B.1-103'), ['35'], 'la multa del Excel (35) se respeta y no se le suma 20');
    assert.deepEqual(await enColumna('B.1-109'), ['10.5'], 'ídem con decimales');
    assert.deepEqual(await enColumna('B.1-104'), ['20'], 'multa 0 + pagó tarde → 20');
    assert.deepEqual(await enColumna('B.1-105'), ['20'], 'multa vacía + pagó tarde → 20');
    assert.deepEqual(await enColumna('B.1-101'), [], 'a tiempo y sin multa: nada');
    const sistema = TARDE.filter((c) => !['B.1-103', 'B.1-109'].includes(c));
    assert.equal(r.body.mora.cantidad, sistema.length);
    assert.match(r.body.mora.mensaje, new RegExp(`^Se agregó mora de S/ 20 a ${sistema.length} departamentos`));
    assert.ok(!r.body.mora.mensaje.includes('B.1-103'), 'quien ya traía multa no cuenta como mora agregada');
    // Sólo las agregadas por el sistema llevan el motivo; la del Excel queda como vino.
    assert.equal((await cargosDe('B.1-104')).find((x) => x.reciboConcepto?.concepto?.nombre === MULTA)?.observaciones, mora.motivo);
    assert.equal((await cargosDe('B.1-103')).find((x) => x.reciboConcepto?.concepto?.nombre === MULTA)?.observaciones, null);
  });

  it('reimportar el Excel con multa tampoco duplica nada', async () => {
    const excel = aXlsx(filasExcel(true, { 'B.1-103': 35 }));
    await subirExcel(T.adminA, excel, d.complejoA.id);
    const antes = (await prisma.reciboConceptoUnidad.findMany({ where: { reciboConcepto: { recibo: { mes: 10, anio: 2026, estructura_id: torre1.id } } }, include: { unidad: true, reciboConcepto: { include: { concepto: true } } } }))
      .map((c) => `${c.unidad?.codigo}|${c.reciboConcepto?.concepto?.nombre}|${c.monto}`).sort();
    const r = await subirExcel(T.adminA, excel, d.complejoA.id);
    assert.equal(r.status, 201, r.texto);
    const despues = (await prisma.reciboConceptoUnidad.findMany({ where: { reciboConcepto: { recibo: { mes: 10, anio: 2026, estructura_id: torre1.id } } }, include: { unidad: true, reciboConcepto: { include: { concepto: true } } } }))
      .map((c) => `${c.unidad?.codigo}|${c.reciboConcepto?.concepto?.nombre}|${c.monto}`).sort();
    assert.deepEqual(despues, antes);
  });

  it('emisión manual (POST /api/recibos): cada torre mira su propio recibo anterior; la torre sin recibo anterior no recibe mora', async () => {
    const emitir = (estructura_id: number) => llamar(base, 'POST', '/api/recibos', T.adminA, {
      complejo_id: d.complejoA.id, estructura_id, mes: 10, anio: 2026, fecha_emision: '2026-10-01', fecha_vencimiento: '2026-11-02',
      conceptos: [{ concepto_id: d.conceptoA.id, monto: 100 }],
    });
    const r1 = await emitir(torre1.id);
    assert.equal(r1.status, 201, JSON.stringify(r1.body));
    assert.equal(r1.body.mora.cantidad, TARDE.length);
    assert.match(r1.body.mora.mensaje, /^Se agregó mora de S\/ 20 a 6 departamentos: /);
    assert.deepEqual((await morasDe()).map((c) => c.unidad?.codigo).sort(), [...TARDE].sort());
    // B.2: su unidad nunca pagó el recibo de setiembre de SU torre → mora. B.3 no tiene recibo anterior → nada.
    const r2 = await emitir(torre2.id);
    assert.equal(r2.status, 201);
    assert.deepEqual(r2.body.mora.departamentos.map((x: { codigo: string }) => x.codigo), ['B.2-101']);
    const r3 = await emitir(torre3.id);
    assert.equal(r3.status, 201);
    assert.equal(r3.body.mora.cantidad, 0);
    assert.equal(r3.body.mora.mensaje, null);
    assert.deepEqual(await morasDe(torre3), []);
    // Repetir la emisión no crea nada nuevo (409) y no suma otra mora.
    assert.equal((await emitir(torre1.id)).status, 409);
    assert.equal((await morasDe()).length, TARDE.length);
  });

  it('emisión manual con una multa propia (monto > 0): se respeta y no se agrega mora encima', async () => {
    const multa = await prisma.concepto.create({ data: { nombre: 'Multa por pago fuera de fecha (manual)', empresa_id: d.empresaA.id, tipo_monto: 'fijo' } });
    try {
      const r = await llamar(base, 'POST', '/api/recibos', T.adminA, {
        complejo_id: d.complejoA.id, estructura_id: torre1.id, mes: 10, anio: 2026, fecha_emision: '2026-10-01', fecha_vencimiento: '2026-11-02',
        conceptos: [{ concepto_id: d.conceptoA.id, monto: 100 }, { concepto_id: multa.id, monto: 35, es_recargo: true }],
      });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.mora.cantidad, 0);
      assert.equal(await prisma.concepto.count({ where: { nombre: CONCEPTO_MORA } }), 0);
    } finally {
      await limpiarMes10();
      await prisma.concepto.delete({ where: { id: multa.id } });
    }
  });

  it('si el recibo anterior aún no venció (hoy ≤ vencimiento en Lima) no se evalúa nadie y se avisa', async () => {
    moraDeps.ahora = () => new Date('2026-10-03T04:59:59Z'); // 2-oct 23:59:59 en Lima: el día del vencimiento todavía se puede pagar
    const r = await subirExcel(T.adminA, aXlsx(filasExcel(false)), d.complejoA.id);
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.mora.cantidad, 0);
    assert.ok(r.body.advertencias.some((a: string) => /vence el 02\/10\/2026: aún no se puede saber quién pagó tarde/.test(a)), JSON.stringify(r.body.advertencias));
    assert.deepEqual(await morasDe(), []);
    await limpiarMes10();
    moraDeps.ahora = () => new Date('2026-10-03T05:00:00Z'); // ya es 3-oct en Lima
    const r2 = await subirExcel(T.adminA, aXlsx(filasExcel(false)), d.complejoA.id);
    assert.equal(r2.body.mora.cantidad, TARDE.length);
  });

  it('el recibo se emite con la fecha de hoy EN el condominio (Auckland ya está en el 21 cuando en Lima es el 20)', async () => {
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { zona_horaria: 'Pacific/Auckland' } });
    mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-20T11:30:00Z') }); // 06:30 en Lima; 00:30 del 21 en Auckland (UTC+13)
    try {
      const token = await login(base, 'admin.a@test.pe'); // la sesión nace en el instante simulado
      const r = await subirExcel(token, aXlsx(filasExcel(false)), d.complejoA.id);
      assert.equal(r.status, 201, r.texto);
      const recibo = await prisma.recibo.findFirstOrThrow({ where: { complejo_id: d.complejoA.id, estructura_id: torre1.id, mes: 10, anio: 2026 } });
      assert.equal(recibo.fecha_emision.toISOString().slice(0, 10), '2026-10-21');
    } finally {
      mock.timers.reset();
      await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { zona_horaria: 'America/Lima' } });
    }
  });

  it('el monto es configurable por condominio; 0 significa sin mora', async () => {
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { mora_monto: new Prisma.Decimal('35.50') } });
    const r = await subirExcel(T.adminA, aXlsx(filasExcel(false)), d.complejoA.id);
    assert.equal(r.body.mora.monto, '35.50');
    assert.match(r.body.mora.mensaje, /^Se agregó mora de S\/ 35\.50 a /);
    assert.equal((await morasDe())[0]!.monto.toString(), '35.5');
    await limpiarMes10();
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { mora_monto: 0 } });
    const r0 = await subirExcel(T.adminA, aXlsx(filasExcel(false)), d.complejoA.id);
    assert.equal(r0.body.mora.cantidad, 0);
    assert.deepEqual(await morasDe(), []);
  });

  it('el residente ve la línea de mora con su motivo; el que pagó a tiempo, no; otra torre y otro tenant no se afectan', async () => {
    await prisma.unidad.update({ where: { id: unidades.get('B.1-103')! }, data: { propietario_id: d.propietario1.id } });
    await prisma.unidad.update({ where: { id: unidades.get('B.1-101')! }, data: { propietario_id: d.propietario2.id } });
    try {
      const cargosB = await prisma.reciboConceptoUnidad.count({ where: { unidad: { complejo_id: d.complejoB.id } } });
      const r = await subirExcel(T.adminA, aXlsx(filasExcel(false)), d.complejoA.id);
      assert.equal(r.status, 201, r.texto);
      const reciboId = r.body.recibo_id as number;
      const tarde = await llamar(base, 'GET', `/api/me/mantenimientos/${reciboId}/${unidades.get('B.1-103')}`, T.prop1);
      assert.equal(tarde.status, 200, JSON.stringify(tarde.body));
      assert.deepEqual(tarde.body.conceptos.map((c: { concepto: string; monto: string; es_recargo: boolean; motivo: string | null }) => [c.concepto, c.monto, c.es_recargo, c.motivo]), [
        ['ADMINISTRACION', '100.00', false, null],
        [CONCEPTO_MORA, '20.00', true, mora.motivo],
      ]);
      assert.equal(tarde.body.total, '120.00');
      const aTiempo = await llamar(base, 'GET', `/api/me/mantenimientos/${reciboId}/${unidades.get('B.1-101')}`, T.prop2);
      assert.deepEqual(aTiempo.body.conceptos.map((c: { motivo: string | null }) => c.motivo), [null]);
      assert.equal(aTiempo.body.total, '100.00');
      // Otra torre (B.2: tarde, sin recibo de octubre) y otro tenant (complejo B): sin cargos nuevos.
      assert.equal(await prisma.reciboConceptoUnidad.count({ where: { unidad: { codigo: 'B.2-101' }, reciboConcepto: { recibo: { mes: 10, anio: 2026 } } } }), 0);
      assert.equal(await prisma.reciboConceptoUnidad.count({ where: { unidad: { complejo_id: d.complejoB.id } } }), cargosB);
    } finally {
      await prisma.unidad.updateMany({ where: { id: { in: [unidades.get('B.1-103')!, unidades.get('B.1-101')!] } }, data: { propietario_id: null } });
    }
  });

  it('el recibo viejo de otro tenant no cuenta: el admin de otro condominio no genera moras en el mío', async () => {
    const r = await subirExcel(T.adminB, aXlsx(filasExcel(false)), d.complejoA.id);
    assert.equal(r.status, 422, r.texto); // como siempre: un condominio ajeno «no existe o no tienes acceso»
    assert.deepEqual(await morasDe(), []);
  });

  it('evaluarMora (pura): enero mira diciembre del año anterior; un cargo pagado sin Pago cuenta por la fecha del cargo; sin recibo anterior, nadie', async () => {
    const torre = await prisma.estructura.create({ data: { nombre: 'B.9', tipo: 'block', complejo_id: d.complejoA.id } });
    const u = async (c: string) => (await prisma.unidad.create({ data: { codigo: c, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: torre.id, estado: 'activa' } })).id;
    const [aTiempo, tarde, sinFecha, sinPagos] = [await u('B.9-1'), await u('B.9-2'), await u('B.9-3'), await u('B.9-4')];
    const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, estructura_id: torre.id, mes: 12, anio: 2026, fecha_emision: new Date('2026-12-01T00:00:00Z'), fecha_vencimiento: new Date('2027-01-02T00:00:00Z'), estado: 'emitido' } });
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: d.conceptoA.id, monto: 0, orden: 1 } });
    const cargo = (unidad_id: number, extra: Record<string, unknown>) => prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id, monto: 80, ...extra } });
    await cargo(aTiempo, { estado_pago: 'pagado', fecha_pago: new Date('2027-01-01T12:00:00Z') });
    await cargo(tarde, { estado_pago: 'pagado', fecha_pago: new Date('2027-01-03T12:00:00Z') });
    await cargo(sinFecha, { estado_pago: 'pagado' });
    await cargo(sinPagos, { estado_pago: 'pendiente' });
    moraDeps.ahora = () => new Date('2027-01-15T15:00:00Z');
    const ev = await prisma.$transaction((tx) => evaluarMora(tx, { complejoId: d.complejoA.id, estructuraId: torre.id, mes: 1, anio: 2027, unidadIds: [aTiempo, tarde, sinFecha, sinPagos] }));
    assert.equal(ev.anterior?.id, recibo.id, 'enero de 2027 mira diciembre de 2026');
    assert.deepEqual([...ev.tarde].sort(), [tarde, sinPagos].sort());
    const sin = await prisma.$transaction((tx) => evaluarMora(tx, { complejoId: d.complejoA.id, estructuraId: torre.id, mes: 5, anio: 2027, unidadIds: [tarde] }));
    assert.equal(sin.anterior, null);
    assert.equal(sin.tarde.size, 0);
  });

  it('agregarMora llamada dos veces sobre el mismo recibo no suma dos moras (idempotente por unidad y motivo)', async () => {
    const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, estructura_id: torre1.id, mes: 10, anio: 2026, fecha_emision: new Date('2026-10-01T00:00:00Z'), fecha_vencimiento: new Date('2026-11-02T00:00:00Z'), estado: 'emitido' } });
    const llamarAgregar = () => prisma.$transaction((tx) => agregarMora(tx, { reciboId: recibo.id, complejoId: d.complejoA.id, estructuraId: torre1.id, empresaId: d.empresaA.id, mes: 10, anio: 2026, unidadIds: CODIGOS.map((c) => unidades.get(c)!), monto: new Prisma.Decimal(20) }));
    await llamarAgregar();
    await llamarAgregar();
    const ms = await morasDe();
    assert.equal(ms.length, TARDE.length);
    assert.equal(new Set(ms.map((c) => c.unidad_id)).size, TARDE.length);
  });

  it('el informe lo dice en singular y recorta las listas largas', () => {
    assert.equal(informeDeMora(new Prisma.Decimal(20), [{ reciboId: 1, torre: 'B.1', unidades: [{ id: 1, codigo: 'B.1-101', torre: 'B.1' }] }]).mensaje, 'Se agregó mora de S/ 20 a 1 departamento: B.1-101');
    assert.equal(informeDeMora(new Prisma.Decimal(20), []).mensaje, null);
    const largas = Array.from({ length: 25 }, (_, i) => ({ id: i, codigo: `X-${String(i + 1).padStart(2, '0')}`, torre: null }));
    assert.match(informeDeMora(new Prisma.Decimal(20), [{ reciboId: 1, torre: null, unidades: largas }]).mensaje!, /… y 5 más$/);
  });

  it('esConceptoMora reconoce la multa del Excel real de la administradora y no confunde otros conceptos', () => {
    assert.equal(esConceptoMora('MULTA PAGO FUERA DE FECHA(ULTIMO DIA 2 CADA MES)'), true);
    assert.equal(esConceptoMora('Mora'), true);
    assert.equal(esConceptoMora('Multa por pago fuera de fecha'), true);
    for (const n of ['ADMINISTRACION VRANY', 'AGUA DPTO.', 'FONDO DE CONTINGENCIA DEL BLOCK', 'OTROS', 'MORADA']) assert.equal(esConceptoMora(n), false, n);
  });
});

// =====================================================================================================
// 4. Configuración por condominio y pantallas
// =====================================================================================================
describe('mora_monto del condominio', () => {
  it('por defecto 20.00; el admin la edita; valida el formato; la junta/residente no; otro tenant → 404', async () => {
    const c = await llamar(base, 'GET', `/api/complejos/${d.complejoA.id}`, T.adminA);
    assert.equal(c.body.mora_monto, '20');
    const ok = await llamar(base, 'PATCH', `/api/complejos/${d.complejoA.id}`, T.adminA, { mora_monto: '35.50' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.mora_monto, '35.5');
    assert.equal((await llamar(base, 'PUT', `/api/complejos/${d.complejoA.id}`, T.adminA, { mora_monto: 0 })).status, 200, '0 = sin mora');
    for (const malo of ['-5', 'abc', '12.345', 1e9]) assert.equal((await llamar(base, 'PATCH', `/api/complejos/${d.complejoA.id}`, T.adminA, { mora_monto: malo })).status, 422, String(malo));
    assert.equal((await llamar(base, 'PATCH', `/api/complejos/${d.complejoA.id}`, T.prop1, { mora_monto: 99 })).status, 403);
    assert.equal((await llamar(base, 'PATCH', `/api/complejos/${d.complejoA.id}`, T.adminB, { mora_monto: 99 })).status, 404);
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { mora_monto: 20 } });
  });
});

describe('pantallas: fecha del voucher, línea de mora, mora del condominio, aviso nuevo', () => {
  const fuente = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');

  it('textoFechaPago dice de dónde salió la fecha y fechaPorRevisar marca lo que debe mirar quien valida', () => {
    assert.match(textoFechaPago('voucher'), /voucher/i);
    assert.match(textoFechaPago('no_leida'), /no se pudo leer/);
    assert.match(textoFechaPago('invalida'), /futura o muy antigua/);
    assert.match(textoFechaPago('manual'), /a mano/);
    assert.match(textoFechaPago('declarada'), /declarada/);
    assert.match(textoFechaPago(undefined), /declarada/);
    assert.equal(fechaPorRevisar('no_leida'), true);
    assert.equal(fechaPorRevisar('invalida'), true);
    for (const o of ['voucher', 'declarada', 'manual', undefined] as const) assert.equal(fechaPorRevisar(o), false);
  });

  it('el detalle del pago muestra la fecha del voucher y avisa si no se leyó o no se aplicó', () => {
    const f = fuente('src/pages/admin/_parts/cobranza/ValidarPagoModal.tsx');
    assert.match(f, /fecha_origen\?: FechaOrigen/);
    assert.match(f, /pago\.fecha_origen === 'voucher' \? 'Fecha del voucher' : 'Fecha del pago'/);
    assert.match(f, /textoFechaPago\(pago\.fecha_origen\)/);
    assert.match(f, /fechaPorRevisar\(pago\.fecha_origen\)/);
    assert.match(f, /La IA no pudo leer la fecha del voucher/);
    assert.match(f, /fecha futura o demasiado antigua/);
  });

  it('el recibo del residente muestra el motivo bajo la línea de mora; el historial, de dónde salió cada fecha', () => {
    const f = fuente('src/pages/shared/mantenimiento/Desglose.tsx');
    assert.match(f, /\{c\.motivo && <span[^>]*>\{c\.motivo\}<\/span>\}/);
    assert.match(f, /title=\{textoFechaPago\(p\.fecha_origen\)\}/);
    assert.match(fuente('src/pages/shared/mantenimiento/tipos.ts'), /motivo\?: string \| null/);
  });

  it('la ficha del condominio muestra y edita la mora', () => {
    const modal = fuente('src/pages/admin/_parts/condominio/ModalDeComplejo.tsx');
    assert.match(modal, /Mora por pago fuera de fecha \(\$\{simboloDe\(paisMoneda\.moneda \|\| monedaDelPais\(paisMoneda\.pais\)\)\}\)/); // el símbolo es el de la moneda del condominio (S/ en soles)
    assert.match(modal, /register\('mora_monto'/);
    assert.match(modal, /mora_monto: v\.mora_monto\.trim\(\)\.replace\(',', '\.'\)/);
    assert.match(fuente('src/pages/admin/CondominioDetalle.tsx'), /label: 'Mora por pago fuera de fecha'/);
  });

  it('la lista de avisos conoce vence_hoy y la subida del Excel muestra el mensaje de la mora', () => {
    assert.match(fuente('src/pages/admin/_parts/avisos/EnviosTab.tsx'), /vence_hoy: 'Vence hoy'/);
    assert.match(fuente('src/pages/admin/_parts/cobranza/SubirExcelModal.tsx'), /resumen\?\.mora && /);
    const r = resumenSubida({ recibo_id: 1, mes: 10, anio: 2026, unidades_procesadas: 3, filas_saltadas: 0, conceptos: 1, mora: { monto: '20.00', cantidad: 2, mensaje: 'Se agregó mora de S/ 20 a 2 departamentos: B.1-103, B.1-104' } });
    assert.equal(r.mora, 'Se agregó mora de S/ 20 a 2 departamentos: B.1-103, B.1-104');
    assert.equal(resumenSubida({ recibo_id: 1, mes: 10, anio: 2026, unidades_procesadas: 3, filas_saltadas: 0, conceptos: 1 }).mora, null, 'respuestas viejas sin mora no rompen');
  });
});
