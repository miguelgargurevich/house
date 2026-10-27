// La fecha del voucher sólo se aplica si la evaluación respalda el comprobante, y la IA también lee el mensaje (periodo) del voucher.
// Caso real (27-oct-2026): pago de octubre de B01-804 (S/ 272.15) con el voucher de setiembre (S/ 258.79, mensaje «Setiembre B1 804»): la IA dio
// «no coincide» y aun así se le cambió la fecha a los 9 pagos del grupo. Todo con IA falsa (`llaveroDeps.fetch` inyectado): nunca red real.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { cabecerasDeSesion, iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { hoyLima } from '../src/server/lib/fechas';
import { lecturaSchema, parsearLectura, PROMPT_SISTEMA, MAX_TEXTO, type Lectura } from '../src/server/lib/lecturaComprobante';
import { alertaDePeriodo, contrastar, mesDelMensaje } from '../src/server/services/contraste';
import { esperarEvaluaciones, evaluacionDeps } from '../src/server/services/evaluacion';
import { decidirFechaEvaluada, MOTIVO_NO_COINCIDE, MOTIVO_OTRO_PERIODO } from '../src/server/services/fechaVoucher';
import { guardar as guardarClaveLlavero, llaveroDeps } from '../src/server/services/llavero';
import { alertasDeOcr, ALERTA_OCR, mesDelMensaje as mesDelMensajeOcr } from '../src/server/services/ocrVoucher';
import { limpiarTodo } from '../src/server/lib/cooldown';
import { olvidarTodoUso } from '../src/server/services/rotacion';

const DIA = 86_400_000;
const ENC = 'clave-maestra-de-pruebas-que-supera-32-caracteres';
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const HOY = hoyLima().getTime();

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'adminA' | 'prop1', string>;

// ---------- IA falsa ----------
let respuesta: () => Response = () => lecturaOk();
const fetchOriginal = llaveroDeps.fetch;
const relojOriginal = { ...evaluacionDeps };
let n = 0;
const unico = () => ++n;
const dosShapes = (texto: string) => new Response(JSON.stringify({ choices: [{ message: { content: texto } }], candidates: [{ content: { parts: [{ text: texto }] } }] }), { status: 200 });
const lectura = (extra: Record<string, unknown> = {}) => ({
  es_comprobante_de_pago: true, legible: true, medio: 'transferencia', estado_operacion: 'exitosa', monto: 272.15, moneda: 'PEN', fecha: iso(HOY - 2 * DIA),
  numero_operacion: `OP${String(unico()).padStart(6, '0')}`, destinatario_nombre: 'JUNTA DE PROPIETARIOS LIBERTADORES', destino_numero: '7073', ...extra,
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
  T = { adminA: await login(base, 'admin.a@test.pe'), prop1: await login(base, 'prop1@test.pe') };
  llaveroDeps.fetch = async () => respuesta();
});
after(async () => {
  llaveroDeps.fetch = fetchOriginal;
  Object.assign(evaluacionDeps, relojOriginal);
  delete process.env.LLAVERO_ENC_KEY;
  await esperarEvaluaciones();
  await cerrar();
  await prisma.$disconnect();
});

// =====================================================================================================
// 1. Lectura del mensaje (esquema + prompt)
// =====================================================================================================
describe('la IA lee el mensaje del voucher (esquema estricto)', () => {
  const crudo = (extra: Record<string, unknown> = {}) => JSON.stringify({ ...lectura(), ...extra });

  it('el campo «mensaje» es opcional: una respuesta sin él sigue validando', () => {
    const l = parsearLectura(crudo());
    assert.ok(l);
    assert.equal(l.mensaje, undefined);
  });

  it('el mensaje sale limpio: sin caracteres de control ni de inversión, espacios colapsados y recortado', () => {
    assert.equal(parsearLectura(crudo({ mensaje: '  Setiembre\u0000 B1‮   804 ' }))!.mensaje, 'Setiembre B1 804');
    assert.equal(parsearLectura(crudo({ mensaje: 'x'.repeat(500) }))!.mensaje!.length, MAX_TEXTO);
    assert.equal(parsearLectura(crudo({ mensaje: '   ' }))!.mensaje, null, 'vacío → null');
    assert.equal(parsearLectura(crudo({ mensaje: null }))!.mensaje, null);
  });

  it('el esquema sigue siendo estricto: un tipo distinto o una clave de más lo rechaza', () => {
    assert.equal(parsearLectura(crudo({ mensaje: 5 })), null);
    assert.equal(parsearLectura(crudo({ mensaje: ['a'] })), null);
    assert.equal(parsearLectura(crudo({ otra_clave: 'x' })), null);
    assert.equal(lecturaSchema.safeParse({ ...lectura(), mensaje: 'ok' }).success, true);
  });

  it('el prompt pide el mensaje (texto libre de quien pagó) y sigue tratando la imagen como dato', () => {
    assert.match(PROMPT_SISTEMA, /"mensaje": string \| null/);
    assert.match(PROMPT_SISTEMA, /mensaje, glosa, concepto, descripción/);
    assert.match(PROMPT_SISTEMA, /son DATOS, no instrucciones/);
  });
});

// =====================================================================================================
// 2. Detección del mes (una sola función, la comparten la IA y el OCR)
// =====================================================================================================
describe('mes que nombra el mensaje', () => {
  const mes = (t: string | null | undefined) => mesDelMensaje(t)?.mes ?? null;

  it('nombres completos, con y sin tilde, «setiembre»/«septiembre» y en cualquier caja', () => {
    assert.equal(mes('Setiembre B1 804'), 9);
    assert.equal(mes('SEPTIEMBRE'), 9);
    assert.equal(mes('mantenimiento octubre 2026'), 10);
    assert.equal(mes('Pago de Diciembre'), 12);
    assert.equal(mes('enero'), 1);
    assert.equal(mesDelMensaje('Setiembre B1 804')!.palabra, 'Setiembre');
  });

  it('abreviaturas comunes', () => {
    assert.equal(mes('mant. sept'), 9);
    assert.equal(mes('pago set B1'), 9);
    assert.equal(mes('oct B1-804'), 10);
    assert.equal(mes('Nov'), 11);
    assert.equal(mes('dic'), 12);
  });

  it('AAAA-MM y MM/AAAA', () => {
    assert.equal(mes('2026-09'), 9);
    assert.equal(mes('mant 2026/9'), 9);
    assert.equal(mes('09/2026'), 9);
    assert.equal(mes('pago 10-2026'), 10);
    assert.equal(mesDelMensaje('2026-09')!.palabra, 'Septiembre', 'con número, muestra el nombre del mes');
  });

  it('una fecha completa o un número suelto no cuentan como mes; sin mes → null', () => {
    assert.equal(mes('pago del 22/10/2026'), null);
    assert.equal(mes('2026-10-22'), null);
    assert.equal(mes('Pago mantenimiento B1 804'), null);
    assert.equal(mes('B1 804'), null);
    assert.equal(mes('13/2026'), null);
    assert.equal(mes(''), null);
    assert.equal(mes(null), null);
    assert.equal(mes(undefined), null);
  });

  it('el OCR usa la MISMA función (re-exportada) y su alerta no cambió', () => {
    assert.equal(mesDelMensajeOcr, mesDelMensaje);
    const l = { lectura: lectura() as unknown as Lectura, mensaje: 'Setiembre', banco: 'bcp' as const };
    assert.deepEqual(alertasDeOcr(l, { mes: 10, anio: 2026 }), [ALERTA_OCR, 'El mensaje del voucher dice «Setiembre», pero el recibo es de octubre de 2026']);
    assert.deepEqual(alertasDeOcr(l, { mes: 9, anio: 2026 }), [ALERTA_OCR]);
  });

  it('la alerta de la IA dice «comprobante», nombra el mes del mensaje y el del recibo; mes igual o sin mensaje → sin alerta', () => {
    assert.equal(alertaDePeriodo('Setiembre B1 804', { mes: 10, anio: 2026 }, 'comprobante'), 'El mensaje del comprobante dice «Setiembre», pero el recibo es de octubre de 2026');
    assert.equal(alertaDePeriodo('Octubre', { mes: 10, anio: 2026 }, 'comprobante'), null);
    assert.equal(alertaDePeriodo('sin mes', { mes: 10, anio: 2026 }, 'comprobante'), null);
    assert.equal(alertaDePeriodo(null, { mes: 10, anio: 2026 }, 'comprobante'), null);
    assert.equal(alertaDePeriodo('Setiembre', null, 'comprobante'), null);
  });
});

// =====================================================================================================
// 3. Contraste (puro): el periodo bloquea «coincide»
// =====================================================================================================
describe('contrastar: el mensaje de otro mes impide «coincide»', () => {
  const emision = new Date(HOY - 5 * DIA);
  const esperado = { monto: '272.15', emision, hoy: new Date(HOY), periodo: { mes: 10, anio: 2026 } };
  const medios = [{ tipo: 'banco', titular: 'JUNTA DE PROPIETARIOS LIBERTADORES', celular: null, numero_cuenta: '1932077777073', cci: null }];
  const sinDup = { archivoEnPago: null, operacionEnPago: null };
  const L = (extra: Record<string, unknown> = {}) => lecturaSchema.parse(lectura(extra));

  it('línea base: todo correcto y sin mensaje → coincide', () => {
    const c = contrastar(L(), esperado, medios, sinDup);
    assert.equal(c.veredicto, 'coincide');
    assert.deepEqual(c.alertas, []);
  });

  it('todo correcto pero el mensaje dice setiembre y el recibo es de octubre → «revisar» con la alerta (no «coincide»)', () => {
    const c = contrastar(L({ mensaje: 'Setiembre B1 804' }), esperado, medios, sinDup);
    assert.equal(c.veredicto, 'revisar');
    assert.deepEqual(c.alertas, ['El mensaje del comprobante dice «Setiembre», pero el recibo es de octubre de 2026']);
    assert.match(c.resumen, /el periodo/);
    assert.deepEqual(c.coincidencias, { monto: true, destino: true, fecha: true, estado_operacion: true }, 'las comprobaciones no se tocan');
  });

  it('el mismo mes, otro texto, null o sin el campo → coincide como antes', () => {
    for (const mensaje of ['Octubre B1 804', 'oct', '2026-10', 'Pago mantenimiento', null]) {
      assert.equal(contrastar(L({ mensaje }), esperado, medios, sinDup).veredicto, 'coincide', String(mensaje));
    }
  });

  it('sin periodo del recibo no hay comparación; el monto malo + mes malo sigue «no_coincide» con las DOS alertas', () => {
    assert.equal(contrastar(L({ mensaje: 'Setiembre' }), { ...esperado, periodo: null }, medios, sinDup).veredicto, 'coincide');
    const c = contrastar(L({ monto: 258.79, mensaje: 'Setiembre B1 804' }), esperado, medios, sinDup);
    assert.equal(c.veredicto, 'no_coincide');
    assert.deepEqual(c.alertas, ['El monto del comprobante no coincide con lo que se debe', 'El mensaje del comprobante dice «Setiembre», pero el recibo es de octubre de 2026']);
  });
});

// =====================================================================================================
// 4. Decisión de la fecha (pura)
// =====================================================================================================
describe('decidirFechaEvaluada (pura): cuándo vale la fecha del voucher', () => {
  const hoy = new Date('2026-10-27T17:00:00Z');
  const emision = new Date('2026-10-15T00:00:00Z');
  const lec = { es_comprobante_de_pago: true, legible: true, estado_operacion: 'exitosa' as const, fecha: '2026-10-22' as string | null, mensaje: undefined as string | null | undefined };
  const o = { hoy, emision, veredicto: 'coincide' as const, periodo: { mes: 10, anio: 2026 } };

  it('«coincide» y «revisar» sin alerta de periodo → se aplica como siempre', () => {
    assert.equal(decidirFechaEvaluada(lec, o).tipo, 'aplicar');
    assert.equal(decidirFechaEvaluada(lec, { ...o, veredicto: 'revisar' }).tipo, 'aplicar');
  });

  it('«no_coincide» → no_leida con el motivo, aunque la fecha sea perfectamente creíble', () => {
    assert.deepEqual(decidirFechaEvaluada(lec, { ...o, veredicto: 'no_coincide' }), { tipo: 'no_leida', motivo: MOTIVO_NO_COINCIDE });
    assert.equal(MOTIVO_NO_COINCIDE, 'El comprobante no coincide con el pago: la fecha no se aplica');
  });

  it('«ilegible» → no_leida', () => {
    for (const x of [{ legible: false }, { es_comprobante_de_pago: false }]) {
      assert.equal(decidirFechaEvaluada({ ...lec, ...x }, { ...o, veredicto: 'ilegible' }).tipo, 'no_leida', JSON.stringify(x));
    }
  });

  it('el mensaje de otro mes → no_leida (con el veredicto que sea); del mismo mes o sin mes → se aplica', () => {
    assert.deepEqual(decidirFechaEvaluada({ ...lec, mensaje: 'Setiembre B1 804' }, { ...o, veredicto: 'revisar' }), { tipo: 'no_leida', motivo: MOTIVO_OTRO_PERIODO });
    assert.equal(decidirFechaEvaluada({ ...lec, mensaje: 'Setiembre' }, o).tipo, 'no_leida');
    assert.equal(decidirFechaEvaluada({ ...lec, mensaje: 'Octubre' }, o).tipo, 'aplicar');
    assert.equal(decidirFechaEvaluada({ ...lec, mensaje: 'Pago B1 804' }, o).tipo, 'aplicar');
    assert.equal(decidirFechaEvaluada({ ...lec, mensaje: 'Setiembre' }, { ...o, periodo: null }).tipo, 'aplicar', 'sin recibo no hay periodo que comparar');
  });

  it('una fecha futura sigue siendo «invalida» (no se confunde con la regla nueva)', () => {
    assert.equal(decidirFechaEvaluada({ ...lec, fecha: '2026-10-28' }, o).tipo, 'invalida');
  });
});

// =====================================================================================================
// 5. De punta a punta (API + base + IA falsa): el caso real
// =====================================================================================================
describe('la fecha del voucher de punta a punta (IA falsa)', () => {
  let contador = 0;
  const TOTAL = 272.15;
  /** Mantenimiento de OCTUBRE de una unidad: 3 cargos que suman S/ 272.15, en un recibo emitido hace 60 días, con la cuenta del condominio como medio de pago. */
  async function mantenimientoDeOctubre() {
    contador += 1;
    const unidad = await prisma.unidad.create({ data: { codigo: `FP-${contador}`, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, propietario_id: d.propietario1.id, estado: 'activa' } });
    const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, mes: 10, anio: 2026, fecha_emision: new Date(HOY - 60 * DIA), fecha_vencimiento: new Date(HOY + 30 * DIA), estado: 'emitido' } });
    const cargos = [];
    for (const [i, monto] of [100, 100, 72.15].entries()) {
      const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: d.conceptoA.id, monto: 0, orden: i + 1 } });
      cargos.push(await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidad.id, monto, estado_pago: 'pendiente' } }));
    }
    return { unidad, recibo, cargos };
  }
  type Mant = Awaited<ReturnType<typeof mantenimientoDeOctubre>>;
  const pagosDe = (m: Mant) => prisma.pago.findMany({ where: { recibo_concepto_unidad_id: { in: m.cargos.map((c) => c.id) } }, orderBy: { id: 'asc' } });
  async function paga(m: Mant) {
    const r = await llamar(base, 'POST', `/api/me/mantenimientos/${m.recibo.id}/${m.unidad.id}/pagos`, T.prop1, { metodo_pago: 'transferencia' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.pago_id as number;
  }
  async function pagaYSube(m: Mant) {
    const pagoId = await paga(m);
    await subirVoucher(T.prop1, pagoId);
    await esperarEvaluaciones();
    return pagoId;
  }
  const evaluacionDe = (pagoId: number) => prisma.evaluacionComprobante.findUniqueOrThrow({ where: { pago_id: pagoId } });
  const cercaDeAhora = (f: Date) => Math.abs(f.getTime() - Date.now()) < 60_000;

  beforeEach(async () => {
    process.env.LLAVERO_ENC_KEY = ENC;
    await prisma.claveIntegracion.deleteMany();
    await prisma.medioPago.deleteMany();
    await prisma.medioPago.create({ data: { complejo_id: d.complejoA.id, tipo: 'banco', titular: 'JUNTA DE PROPIETARIOS LIBERTADORES', numero_cuenta: '1932077777073', creado_por_id: d.adminA.id } });
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { validacion_automatica_ia: false } });
    await prisma.notificacion.deleteMany();
    limpiarTodo();
    olvidarTodoUso();
    Object.assign(evaluacionDeps, relojOriginal);
    respuesta = () => lecturaOk();
    await guardarClaveLlavero({ proveedor: 'openai', clave: 'clave-falsa-openai-0001', usuarioId: d.superadmin.id });
  });
  afterEach(async () => { await esperarEvaluaciones(); });

  it('línea base: voucher de octubre con el monto exacto → coincide y la fecha del voucher se aplica a TODO el grupo', async () => {
    const m = await mantenimientoDeOctubre();
    const leida = iso(HOY - 2 * DIA);
    respuesta = () => lecturaOk({ fecha: leida, mensaje: 'Octubre B1 804' });
    const pagoId = await pagaYSube(m);
    assert.equal((await evaluacionDe(pagoId)).veredicto, 'coincide');
    const pagos = await pagosDe(m);
    assert.equal(pagos.length, 3);
    for (const p of pagos) { assert.equal(p.fecha_origen, 'voucher'); assert.equal(iso(p.fecha_pago.getTime()), leida); }
  });

  it('EL CASO REAL: S/ 258.79 vs 272.15 y mensaje «Setiembre B1 804» en un recibo de octubre → no_coincide, alerta de monto Y de periodo, la fecha NO se aplica', async () => {
    const m = await mantenimientoDeOctubre();
    const leida = iso(HOY - 5 * DIA);
    respuesta = () => lecturaOk({ monto: 258.79, fecha: leida, mensaje: 'Setiembre B1 804' });
    const pagoId = await pagaYSube(m);
    const ev = await evaluacionDe(pagoId);
    assert.equal(ev.estado, 'completada');
    assert.equal(ev.veredicto, 'no_coincide');
    assert.deepEqual(ev.alertas, ['El monto del comprobante no coincide con lo que se debe', 'El mensaje del comprobante dice «Setiembre», pero el recibo es de octubre de 2026']);
    assert.equal((ev.coincidencias as { monto: boolean }).monto, false);
    assert.equal((ev.extraido as { mensaje: string }).mensaje, 'Setiembre B1 804', 'lo leído queda guardado para quien valida');
    const pagos = await pagosDe(m);
    assert.equal(pagos.length, 3, 'los 3 pagos del grupo');
    for (const p of pagos) {
      assert.equal(p.fecha_origen, 'no_leida');
      assert.ok(cercaDeAhora(p.fecha_pago), 'queda la fecha declarada (el momento del registro), no la del voucher');
      assert.notEqual(iso(p.fecha_pago.getTime()), leida);
    }
    const aud = await prisma.auditoria.findFirstOrThrow({ where: { accion: 'fecha_pago_voucher', entidad_id: pagoId } });
    assert.equal((aud.detalle as { motivo: string }).motivo, MOTIVO_NO_COINCIDE);
  });

  it('el mismo voucher con el MONTO CORRECTO pero mensaje de setiembre → no «coincide» y la fecha no se aplica; la validación automática tampoco lo valida', async () => {
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { validacion_automatica_ia: true } });
    const m = await mantenimientoDeOctubre();
    respuesta = () => lecturaOk({ monto: TOTAL, fecha: iso(HOY - 5 * DIA), mensaje: 'Setiembre B1 804' });
    const pagoId = await pagaYSube(m);
    const ev = await evaluacionDe(pagoId);
    assert.equal(ev.veredicto, 'revisar');
    assert.deepEqual(ev.alertas, ['El mensaje del comprobante dice «Setiembre», pero el recibo es de octubre de 2026']);
    assert.match(ev.resumen!, /el periodo/);
    for (const p of await pagosDe(m)) {
      assert.equal(p.fecha_origen, 'no_leida');
      assert.ok(cercaDeAhora(p.fecha_pago));
      assert.equal(p.estado_validacion, 'por_validar', 'no se valida sola');
    }
    const aud = await prisma.auditoria.findFirstOrThrow({ where: { accion: 'fecha_pago_voucher', entidad_id: pagoId } });
    assert.equal((aud.detalle as { motivo: string }).motivo, MOTIVO_OTRO_PERIODO);
  });

  it('mensaje del mes correcto, sin mes, nulo o ausente → como hoy: coincide y la fecha del voucher se aplica', async () => {
    for (const extra of [{ mensaje: 'Octubre B1 804' }, { mensaje: 'Pago mantenimiento B1 804' }, { mensaje: null }, {}]) {
      const m = await mantenimientoDeOctubre();
      const leida = iso(HOY - 3 * DIA);
      respuesta = () => lecturaOk({ fecha: leida, ...extra });
      const pagoId = await pagaYSube(m);
      assert.equal((await evaluacionDe(pagoId)).veredicto, 'coincide', JSON.stringify(extra));
      for (const p of await pagosDe(m)) { assert.equal(p.fecha_origen, 'voucher', JSON.stringify(extra)); assert.equal(iso(p.fecha_pago.getTime()), leida); }
    }
  });

  it('un monto equivocado SIN mensaje de otro mes también deja la fecha declarada (no_coincide)', async () => {
    const m = await mantenimientoDeOctubre();
    respuesta = () => lecturaOk({ monto: 258.79, fecha: iso(HOY - 5 * DIA) });
    const pagoId = await pagaYSube(m);
    assert.equal((await evaluacionDe(pagoId)).veredicto, 'no_coincide');
    for (const p of await pagosDe(m)) { assert.equal(p.fecha_origen, 'no_leida'); assert.ok(cercaDeAhora(p.fecha_pago)); }
  });

  it('un voucher posterior que no coincide restaura la fecha declarada (no deja la del voucher bueno anterior)', async () => {
    const m = await mantenimientoDeOctubre();
    respuesta = () => lecturaOk({ fecha: iso(HOY - 4 * DIA), mensaje: 'Octubre' });
    const pagoId = await pagaYSube(m);
    assert.equal((await pagosDe(m))[0]!.fecha_origen, 'voucher');
    respuesta = () => lecturaOk({ monto: 258.79, fecha: iso(HOY - 9 * DIA), mensaje: 'Setiembre' });
    await subirVoucher(T.prop1, pagoId);
    await esperarEvaluaciones();
    for (const p of await pagosDe(m)) { assert.equal(p.fecha_origen, 'no_leida'); assert.ok(cercaDeAhora(p.fecha_pago)); assert.equal(p.fecha_declarada, null); }
  });

  it('una fecha «manual» NO se pisa: ni con un voucher que coincide ni con uno que no coincide ni con uno de otro mes', async () => {
    const m = await mantenimientoDeOctubre();
    respuesta = () => lecturaOk({ fecha: iso(HOY - 3 * DIA) });
    const pagoId = await pagaYSube(m);
    const corregida = iso(HOY - 10 * DIA);
    const r = await llamar(base, 'PATCH', `/api/pagos/${pagoId}`, T.adminA, { fecha_pago: corregida });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    for (const extra of [{}, { monto: 258.79, mensaje: 'Setiembre B1 804' }, { mensaje: 'Setiembre' }]) {
      respuesta = () => lecturaOk({ fecha: iso(HOY - 1 * DIA), ...extra });
      await subirVoucher(T.prop1, pagoId);
      await esperarEvaluaciones();
      for (const p of await pagosDe(m)) { assert.equal(p.fecha_origen, 'manual', JSON.stringify(extra)); assert.equal(iso(p.fecha_pago.getTime()), corregida); }
    }
  });
});

// =====================================================================================================
// 6. Pantalla: el panel de quien valida muestra el «Mensaje»; el residente no ve lo leído
// =====================================================================================================
describe('panel de evaluación: el mensaje leído', () => {
  // El panel importa `api.ts` (usa `import.meta.env` de Vite), así que no se puede montar en node: se prueba el código fuente, como las demás pruebas de pantalla.
  const PANEL = readFileSync('src/pages/shared/evaluacion.tsx', 'utf8');

  it('la fila «Mensaje del voucher» sale de `extraido.mensaje` (lo lee la IA o, sin ella, el OCR), sin depender del proveedor, y sólo si hay mensaje', () => {
    assert.match(PANEL, /\.\.\.\(x\.mensaje \? \[\{ etiqueta: 'Mensaje del voucher', detectado: x\.mensaje, ok: null as Comprobacion \}\] : \[\]\)/);
    assert.doesNotMatch(PANEL, /proveedor === 'ocr' && x\.mensaje/, 'no está atada al OCR');
    assert.match(PANEL, /\{f\.detectado \?\? 'no se pudo leer'\}/, 'se pinta como texto de React (escapado), nunca como HTML');
    assert.doesNotMatch(PANEL, /dangerouslySetInnerHTML/);
  });

  it('el residente no ve lo leído: su vista es sólo el estado (el servidor no manda el extraído)', async () => {
    const { conVistaResidente } = await import('../src/server/lib/evaluacionVista');
    const v = conVistaResidente({ evaluacion: { estado: 'completada', veredicto: 'no_coincide', extraido: { mensaje: 'Setiembre' } } as { estado: string; veredicto: string | null } });
    assert.deepEqual(v.evaluacion, { estado: 'necesita_revision' });
    assert.doesNotMatch(JSON.stringify(v), /Setiembre/);
  });

  it('el API de quien valida entrega el mensaje guardado en `extraido` (el panel lo lee de ahí)', async () => {
    const m = await prisma.pago.findFirst({ where: { evaluacion: { is: { veredicto: 'no_coincide' } } }, select: { id: true } });
    assert.ok(m, 'hay una evaluación no_coincide de las pruebas anteriores');
    const r = await llamar(base, 'GET', `/api/pagos/${m.id}/evaluacion`, T.adminA);
    assert.equal(r.status, 200);
    assert.equal(r.body.evaluacion.extraido.mensaje, 'Setiembre B1 804');
    const p = await llamar(base, 'GET', `/api/pagos/${m.id}/evaluacion`, T.prop1);
    assert.deepEqual(Object.keys(p.body.evaluacion), ['estado'], 'el residente sólo ve el estado');
  });
});
