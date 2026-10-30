// OCR primero, IA sólo si hace falta. El OCR propio lee el voucher y, si TODO calza (`ocrAlcanza`), la evaluación se cierra sin llamar a la IA; si no, escala
// a la IA como siempre, y sólo si la IA tampoco lee se usa la lectura del OCR (topada, sin validar sola ni fijar la fecha). El check del tesorero sigue mandando.
// Nada sale a la red: el `fetch` de la IA y el del OCR son falsos, y cada prueba cuenta las llamadas de cada uno.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { esperar, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { dnsFalso, restaurarDns } from './helpers/gateways';
import { pagarCargo, pngUnico } from './helpers/pagoResidente';
import { hoyLima } from '../src/server/lib/fechas';
import { guardarOcr } from '../src/server/lib/gatewaysAdmin';
import { limpiarTodo } from '../src/server/lib/cooldown';
import { contrastar, type Duplicados, type MedioParaContraste } from '../src/server/services/contraste';
import { esperarEvaluaciones, UMBRAL_AUTOVALIDACION } from '../src/server/services/evaluacion';
import { guardar as guardarClaveLlavero, llaveroDeps } from '../src/server/services/llavero';
import { aceptarPorOcr, leerVoucherDeTexto, lecturaOcrEnMoneda, MODELO_OCR_SOLO, ocrAlcanza, ocrDeps, RESUMEN_OCR_SOLO, TOPE_CONFIANZA_OCR } from '../src/server/services/ocrVoucher';
import { olvidarTodoUso } from '../src/server/services/rotacion';
import type { Lectura } from '../src/server/lib/lecturaComprobante';

const ENC = 'clave-maestra-de-pruebas-que-supera-32-caracteres';
const DIA = 86_400_000;
const HOY = hoyLima().getTime();
const iso = (dias = 0) => new Date(HOY + dias * DIA).toISOString().slice(0, 10);
/** «DD/MM/AAAA» de hoy ± `dias`, como lo escribe una app de pagos. */
const fechaTexto = (dias = 0) => iso(dias).split('-').reverse().join('/');

// =====================================================================================================
// 1. `ocrAlcanza`, pura: cada condición por separado
// =====================================================================================================
const MEDIOS: MedioParaContraste[] = [{ tipo: 'yape', titular: 'María Pérez García', celular: '987654321', numero_cuenta: null, cci: null }];
const ESPERADO = { monto: '100', moneda: 'PEN', emision: new Date(HOY - 60 * DIA), hoy: new Date(HOY), periodo: { mes: 10, anio: 2026 } };
const SIN_DUP: Duplicados = { archivoEnPago: null, operacionEnPago: null };

/** Voucher de Yape que calza en todo con ESPERADO y MEDIOS; cada prueba cambia UNA cosa. */
const voucher = (cambios: { quitar?: 'fecha' | 'operacion' | 'celular'; simbolo?: string; monto?: string; celular?: string; fecha?: string; operacion?: string; estado?: string; mensaje?: string } = {}): string => {
  const l = [cambios.estado ?? '¡Yapeaste!', `${cambios.simbolo ?? 'S/'} ${cambios.monto ?? '100'}`, 'Maria Perez Garcia'];
  if (cambios.quitar !== 'fecha') l.push(`${cambios.fecha ?? fechaTexto()} | 09:14 a. m.`);
  if (cambios.quitar !== 'celular') l.push(`Celular: *** *** ${cambios.celular ?? '321'}`);
  if (cambios.quitar !== 'operacion') l.push('Código de operación', cambios.operacion ?? '1234567');
  if (cambios.mensaje) l.push(`Mensaje: ${cambios.mensaje}`);
  return l.join('\n');
};

function evaluarPuro(texto: string, opciones: { dup?: Duplicados; moneda?: string; medios?: MedioParaContraste[] } = {}) {
  const ocr = leerVoucherDeTexto(texto);
  assert.ok(ocr, 'el lector de reglas debe leer el voucher de la prueba');
  const lectura: Lectura = lecturaOcrEnMoneda(ocr.lectura, opciones.moneda ?? 'PEN'); // como lo hace evaluacion.ts
  const c = contrastar(lectura, { ...ESPERADO, moneda: opciones.moneda ?? 'PEN' }, opciones.medios ?? MEDIOS, opciones.dup ?? SIN_DUP);
  return { ocr, c, alcanza: ocrAlcanza(c, { ...ocr, lectura }, ESPERADO.periodo) };
}

describe('0. el lector conserva el número de operación tal como está impreso', () => {
  it('un número alfanumérico con mayúsculas no pierde sus letras (en la misma línea ni en la siguiente)', () => {
    assert.equal(leerVoucherDeTexto('Yape\nS/ 100\nCódigo de operación\nOPA11111')!.lectura.numero_operacion, 'OPA11111');
    assert.equal(leerVoucherDeTexto('BCP\nS/ 100\nNúmero de operación: AB-12345')!.lectura.numero_operacion, 'AB-12345');
    assert.equal(leerVoucherDeTexto('BCP\nS/ 100\nNumero de operacion 02515717')!.lectura.numero_operacion, '02515717');
  });
});

describe('1. ocrAlcanza: sólo si TODO calza', () => {
  it('el voucher que calza en monto, destino, fecha y operación, sin alertas → alcanza, con confianza ≥ umbral de autovalidación', () => {
    const r = evaluarPuro(voucher());
    assert.equal(r.alcanza, true, JSON.stringify(r.c));
    assert.deepEqual(r.c.alertas, []);
    assert.ok(r.c.confianza >= UMBRAL_AUTOVALIDACION, `confianza ${r.c.confianza}`);
    const aceptado = aceptarPorOcr(r.c);
    assert.equal(aceptado.veredicto, 'coincide');
    assert.equal(aceptado.resumen, RESUMEN_OCR_SOLO);
    assert.deepEqual(aceptado.alertas, []);
    assert.ok(aceptado.confianza >= UMBRAL_AUTOVALIDACION);
  });

  it('sin palabras de éxito (estado «desconocido») pero con todo lo demás, también alcanza: el estado sólo se exige si el voucher lo trae', () => {
    // «Yape» a secas, sin «Yapeaste»/«exitosa»: el lector deja el estado en «desconocido».
    const r = evaluarPuro('Yape\nS/ 100\nMaria Perez Garcia\n' + `${fechaTexto()}\nCelular: *** *** 321\nCódigo de operación\n1234567`);
    assert.equal(r.ocr.lectura.estado_operacion, 'desconocido');
    assert.equal(r.alcanza, true, JSON.stringify(r.c));
  });

  const NO_ALCANZA: [string, () => ReturnType<typeof evaluarPuro>][] = [
    ['monto distinto', () => evaluarPuro(voucher({ monto: '99' }))],
    ['monto sin moneda comparable (condominio en pesos: un «$» no se sabe si son pesos)', () => evaluarPuro(voucher({ simbolo: '$' }), { moneda: 'CLP' })],
    ['monto en otra moneda (condominio en pesos, voucher en soles)', () => evaluarPuro(voucher(), { moneda: 'CLP' })],
    ['destino desconocido (otro celular)', () => evaluarPuro(voucher({ celular: '999' }))],
    ['destino sin datos (ni celular ni nombre que comparar)', () => evaluarPuro('Yape\nS/ 100\n' + `${fechaTexto()}\nCódigo de operación\n1234567`)],
    ['sin medios de pago activos', () => evaluarPuro(voucher(), { medios: [] })],
    ['sin fecha', () => evaluarPuro(voucher({ quitar: 'fecha' }))],
    ['fecha fuera de rango (200 días atrás)', () => evaluarPuro(voucher({ fecha: fechaTexto(-200) }))],
    ['fecha fuera de rango (futura)', () => evaluarPuro(voucher({ fecha: fechaTexto(10) }))],
    ['sin número de operación', () => evaluarPuro(voucher({ quitar: 'operacion' }))],
    ['número de operación demasiado corto (< MIN_OPERACION)', () => evaluarPuro(voucher({ operacion: '1234' }))],
    ['número de operación repetido en otro pago', () => evaluarPuro(voucher(), { dup: { archivoEnPago: null, operacionEnPago: 7 } })],
    ['archivo repetido en otro pago', () => evaluarPuro(voucher(), { dup: { archivoEnPago: 7, operacionEnPago: null } })],
    ['operación rechazada', () => evaluarPuro(voucher({ estado: 'Operación rechazada' }))],
    ['operación en proceso (pendiente)', () => evaluarPuro(voucher({ estado: 'Operación en proceso' }))],
    ['el mensaje nombra otro mes que el recibo (alerta de periodo)', () => evaluarPuro(voucher({ mensaje: 'Setiembre B1 804' }))],
  ];
  for (const [nombre, armar] of NO_ALCANZA) {
    it(`NO alcanza: ${nombre}`, () => { assert.equal(armar().alcanza, false); });
  }

  it('ocrAlcanza mira el número de operación por sí misma (no depende de que el lector ya lo haya filtrado): 4 caracteres no alcanzan, 5 sí', () => {
    const r = evaluarPuro(voucher());
    assert.equal(ocrAlcanza(r.c, { ...r.ocr, lectura: { ...r.ocr.lectura, numero_operacion: '1234' } }, ESPERADO.periodo), false);
    assert.equal(ocrAlcanza(r.c, { ...r.ocr, lectura: { ...r.ocr.lectura, numero_operacion: '12345' } }, ESPERADO.periodo), true);
  });

  it('aceptarPorOcr: sube a «coincide» un contraste con estado «desconocido» (que sólo llegó a «revisar») y limpia las alertas', () => {
    const sinEstado = evaluarPuro('Yape\nS/ 100\nMaria Perez Garcia\n' + `${fechaTexto()}\nCelular: *** *** 321\nCódigo de operación\n1234567`);
    assert.equal(sinEstado.c.veredicto, 'revisar', 'sin palabras de éxito el contraste normal no llega a «coincide»');
    const a = aceptarPorOcr(sinEstado.c);
    assert.equal(a.veredicto, 'coincide');
    assert.ok(a.confianza >= UMBRAL_AUTOVALIDACION, `confianza ${a.confianza}`);
    assert.deepEqual(aceptarPorOcr({ ...sinEstado.c, alertas: ['una alerta'] }).alertas, []);
  });

  it('el mensaje del MISMO mes del recibo no estorba (la alerta de periodo es sólo si nombra otro mes)', () => {
    assert.equal(evaluarPuro(voucher({ mensaje: 'Octubre B1 804' })).alcanza, true);
  });
});

// =====================================================================================================
// 2. Evaluación completa (base de pruebas + fetch inyectado)
// =====================================================================================================
let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let ids: Record<'tesor1', number>;
let T: Record<'adminA' | 'prop1' | 'prop2' | 'tesor1', string>;
let unidad1: { id: number }; // block 1 (con tesorero)
let unidadOtroBlock: { id: number }; // block 4, sin tesorero

// ---------- fetch inyectado: IA y OCR ----------
let llamadasIA = 0;
let llamadasOcr = 0;
let responder: () => Response | Promise<Response> = () => okIA(lec());
let textoOcr: string | null = null; // lo que «lee» el OCR; null = el servicio responde 502
let compuertaOcr: Promise<void> | null = null;
const fetchOriginal = llaveroDeps.fetch;
const ocrOriginal = { ...ocrDeps };
const okIA = (texto: string) => new Response(JSON.stringify({ choices: [{ message: { content: texto } }], candidates: [{ content: { parts: [{ text: texto }] } }] }), { status: 200 });
let n = 0;
const lec = (extra: Record<string, unknown> = {}) => JSON.stringify({
  es_comprobante_de_pago: true, legible: true, medio: 'yape', estado_operacion: 'exitosa', monto: 100, moneda: 'PEN', fecha: iso(), numero_operacion: `IA${String(++n).padStart(6, '0')}`,
  destinatario_nombre: 'Maria Perez Garcia', destino_numero: '321', ...extra,
});
const operacionNueva = () => String(7_000_000 + ++n);

before(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  dnsFalso();
  d = await sembrar();
  const e1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
  const e4 = await prisma.estructura.create({ data: { nombre: 'Block 4', tipo: 'Block', complejo_id: d.complejoA.id } }); // sin tesorero
  await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: e1.id } });
  unidad1 = d.unidadA1;
  const hash = await bcrypt.hash(PASSWORD, 4);
  ids = { tesor1: (await prisma.usuario.create({ data: { nombre: 'Tesorero 1', email: 'tesor1@test.pe', rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, cargo_junta: 'tesorero', estructura_id: e1.id } })).id };
  unidadOtroBlock = await prisma.unidad.create({ data: { codigo: 'OP-4', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: e4.id, propietario_id: d.propietario2.id, estado: 'activa' } });
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, evaluacion: 100_000 } }));
  T = { adminA: await login(base, 'admin.a@test.pe'), prop1: await login(base, 'prop1@test.pe'), prop2: await login(base, 'prop2@test.pe'), tesor1: await login(base, 'tesor1@test.pe') };
  llaveroDeps.fetch = async () => { llamadasIA += 1; return responder(); };
});
after(async () => {
  llaveroDeps.fetch = fetchOriginal;
  Object.assign(ocrDeps, ocrOriginal);
  restaurarDns();
  delete process.env.LLAVERO_ENC_KEY;
  await esperarEvaluaciones();
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  delete process.env.GEMINI_API_KEY;
  await prisma.claveIntegracion.deleteMany();
  await prisma.configuracionOcr.deleteMany();
  await guardarClaveLlavero({ proveedor: 'openai', clave: 'clave-falsa-openai-0001', usuarioId: d.superadmin.id });
  await guardarOcr({ modo: 'interno', clave: 'clave-ocr-falsa' }, d.superadmin.id);
  await prisma.evaluacionComprobante.deleteMany();
  await prisma.medioPago.deleteMany();
  await prisma.medioPago.create({ data: { complejo_id: d.complejoA.id, tipo: 'yape', celular: '987654321', titular: 'María Pérez García', creado_por_id: d.adminA.id } });
  await interruptor(true);
  await prisma.notificacion.deleteMany();
  limpiarTodo();
  olvidarTodoUso();
  llamadasIA = 0;
  llamadasOcr = 0;
  compuertaOcr = null;
  textoOcr = voucher();
  responder = () => okIA(lec());
  Object.assign(ocrDeps, ocrOriginal, {
    fetch: async () => {
      llamadasOcr += 1;
      if (compuertaOcr) await compuertaOcr;
      return textoOcr === null ? new Response('{}', { status: 502 }) : new Response(JSON.stringify({ text: textoOcr, pages: 1, blocks: [] }));
    },
  });
});
afterEach(async () => { await esperarEvaluaciones(); });

const interruptor = (valor: boolean) => prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { validacion_automatica_ia: valor } });
const pagoDb = (id: number) => prisma.pago.findUniqueOrThrow({ where: { id } });
const evaluacionDb = (id: number) => prisma.evaluacionComprobante.findUniqueOrThrow({ where: { pago_id: id } });
const dar = (t: string, id: number) => llamar(base, 'PUT', `/api/pagos/${id}/conformidad`, t);

let k = 0;
/** Cargo nuevo (S/ 100, emitido hace 60 días) y su pago por validar con voucher; la evaluación corre en segundo plano (NO se espera). */
async function pagar(token: string, unidad: { id: number }, o: { mes?: number; bytes?: Buffer } = {}): Promise<{ pagoId: number; cargoId: number }> {
  k += 1;
  const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, mes: o.mes ?? 10, anio: 2000 + k, fecha_emision: new Date(HOY - 60 * DIA), fecha_vencimiento: new Date(HOY + 30 * DIA), estado: 'emitido' } });
  const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: d.conceptoA.id, monto: 100, orden: 1 } });
  const cargo = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidad.id, monto: 100, estado_pago: 'pendiente' } });
  const r = await pagarCargo(base, token, cargo.id, { metodo_pago: 'yape', referencia: 'OP-FALSA' }, { bytes: o.bytes ?? pngUnico(), tipo: 'image/png', nombre: 'voucher.png' });
  assert.equal(r.status, 201, r.texto);
  return { pagoId: r.body.id, cargoId: cargo.id };
}
async function evaluado(token = T.prop1, unidad: { id: number } = unidad1, o: { mes?: number; bytes?: Buffer } = {}) {
  const p = await pagar(token, unidad, o);
  await esperarEvaluaciones();
  return { ...p, ev: await evaluacionDb(p.pagoId) };
}

describe('2. OCR primero: si todo calza, no se llama a la IA', () => {
  it('voucher que calza en todo: completada / coincide / proveedor «ocr», SIN llamar a la IA, con el resumen del OCR y la fecha del voucher aplicada', async () => {
    await interruptor(false);
    const fecha = fechaTexto(-3);
    textoOcr = voucher({ fecha, operacion: operacionNueva() });
    const { pagoId, ev } = await evaluado();
    assert.equal(llamadasIA, 0, 'la IA ni se llamó');
    assert.equal(llamadasOcr, 1);
    assert.equal(ev.estado, 'completada');
    assert.equal(ev.proveedor, 'ocr');
    assert.equal(ev.modelo, MODELO_OCR_SOLO);
    assert.equal(ev.veredicto, 'coincide');
    assert.ok(ev.confianza! >= UMBRAL_AUTOVALIDACION, `confianza ${ev.confianza}`);
    assert.equal(ev.resumen, RESUMEN_OCR_SOLO);
    assert.deepEqual(ev.alertas, []);
    assert.deepEqual(ev.coincidencias, { monto: true, destino: true, fecha: true, estado_operacion: true });
    assert.equal((ev.extraido as { monto: number }).monto, 100);
    const p = await pagoDb(pagoId);
    assert.equal(p.fecha_origen, 'voucher', 'la fecha del voucher SÍ se aplica cuando el OCR decidió solo');
    assert.equal(p.fecha_pago.toISOString().slice(0, 10), iso(-3));
    assert.equal(p.estado_validacion, 'por_validar', 'con el interruptor apagado no se valida sola');
  });

  it('con la validación automática: SIN el check del tesorero no se valida; al darlo, el pago queda validado «por IA + tesorero» (leído sólo con OCR)', async () => {
    textoOcr = voucher({ operacion: operacionNueva() });
    const { pagoId, cargoId } = await evaluado();
    assert.equal(llamadasIA, 0);
    const antes = await pagoDb(pagoId);
    assert.equal(antes.estado_validacion, 'por_validar', 'el OCR solo no basta: falta el tesorero');
    assert.equal(antes.validado_por_ia, false);
    const r = await dar(T.tesor1, pagoId);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.estado_validacion, 'validado');
    const p = await pagoDb(pagoId);
    assert.equal(p.estado_validacion, 'validado');
    assert.equal(p.validado_por_ia, true);
    assert.equal(p.conformidad_por_id, ids.tesor1);
    assert.equal((await prisma.reciboConceptoUnidad.findUniqueOrThrow({ where: { id: cargoId } })).estado_pago, 'pagado');
    assert.equal(llamadasIA, 0, 'nunca se necesitó la IA');
  });

  it('tesorero primero, OCR después: la conformidad sola no valida; al terminar la lectura del OCR el pago queda validado', async () => {
    let abrir!: () => void;
    compuertaOcr = new Promise<void>((r) => { abrir = r; });
    textoOcr = voucher({ operacion: operacionNueva() });
    const { pagoId } = await pagar(T.prop1, unidad1);
    await esperar(async () => llamadasOcr === 1);
    assert.equal((await dar(T.tesor1, pagoId)).status, 200);
    assert.equal((await pagoDb(pagoId)).estado_validacion, 'por_validar', 'el OCR aún no terminó');
    abrir();
    await esperarEvaluaciones();
    const p = await pagoDb(pagoId);
    assert.equal(p.estado_validacion, 'validado');
    assert.equal(p.validado_por_ia, true);
    assert.equal(llamadasIA, 0);
  });

  it('un bloque sin tesorero (nadie que dé el check): basta el OCR que calza, como antes bastaba la IA', async () => {
    textoOcr = voucher({ operacion: operacionNueva() });
    const { pagoId } = await evaluado(T.prop2, unidadOtroBlock);
    assert.equal(llamadasIA, 0);
    assert.equal((await pagoDb(pagoId)).estado_validacion, 'validado');
  });
});

describe('3. OCR primero: cualquier condición que falle escala a la IA', () => {
  const ESCENARIOS: [string, () => string, { mes?: number }?][] = [
    ['monto distinto', () => voucher({ monto: '99', operacion: operacionNueva() })],
    ['destino desconocido', () => voucher({ celular: '999', operacion: operacionNueva() })],
    ['sin datos de destino', () => `Yape\nS/ 100\n${fechaTexto()} | 09:14 a. m.\nCódigo de operación\n${operacionNueva()}`],
    ['sin fecha', () => voucher({ quitar: 'fecha', operacion: operacionNueva() })],
    ['fecha fuera de rango', () => voucher({ fecha: fechaTexto(-200), operacion: operacionNueva() })],
    ['sin número de operación', () => voucher({ quitar: 'operacion' })],
    ['operación rechazada', () => voucher({ estado: 'Operación rechazada', operacion: operacionNueva() })],
    ['el mensaje nombra otro mes que el recibo', () => voucher({ mensaje: 'Setiembre B1 804', operacion: operacionNueva() }), { mes: 10 }],
  ];
  for (const [nombre, texto, o] of ESCENARIOS) {
    it(`${nombre}: se llama a la IA y manda su lectura (el OCR no rechaza ni deja «no_coincide» por sí solo)`, async () => {
      textoOcr = texto();
      const { pagoId, ev } = await evaluado(T.prop1, unidad1, o);
      assert.equal(llamadasOcr, 1);
      assert.ok(llamadasIA >= 1, 'se escaló a la IA');
      assert.equal(ev.proveedor, 'openai');
      assert.notEqual(ev.modelo, MODELO_OCR_SOLO);
      assert.equal(ev.veredicto, 'coincide', 'la que decide es la IA');
      assert.ok((await pagoDb(pagoId)).fecha_origen === 'voucher', 'y su fecha se aplica como siempre');
    });
  }

  it('operación repetida en otro pago: el OCR no la acepta (escala a la IA)', async () => {
    const op = operacionNueva();
    textoOcr = voucher({ operacion: op });
    const primero = await evaluado(T.prop1, unidad1);
    assert.equal(primero.ev.proveedor, 'ocr');
    assert.equal(llamadasIA, 0);
    const segundo = await evaluado(T.prop2, unidadOtroBlock); // mismo texto → misma operación
    assert.ok(llamadasIA >= 1, 'se escaló a la IA');
    assert.equal(segundo.ev.proveedor, 'openai');
  });

  it('archivo repetido en otro pago: el OCR no lo acepta (escala a la IA, que lo marca no_coincide)', async () => {
    const bytes = pngUnico();
    textoOcr = voucher({ operacion: operacionNueva() });
    const primero = await evaluado(T.prop1, unidad1, { bytes });
    assert.equal(primero.ev.proveedor, 'ocr');
    textoOcr = voucher({ operacion: operacionNueva() }); // otra operación: sólo el archivo se repite
    const segundo = await evaluado(T.prop2, unidadOtroBlock, { bytes });
    assert.ok(llamadasIA >= 1, 'se escaló a la IA');
    assert.equal(segundo.ev.proveedor, 'openai');
    assert.ok((segundo.ev.alertas as string[]).includes(`Este archivo ya se usó en el pago #${primero.pagoId}`));
  });

  it('el OCR no lee nada útil (foto de un perro) o está caído: se llama a la IA como hoy', async () => {
    textoOcr = 'Hola, esto es una foto de mi perro';
    assert.equal((await evaluado()).ev.proveedor, 'openai');
    textoOcr = null;
    assert.equal((await evaluado()).ev.proveedor, 'openai');
    assert.ok(llamadasIA >= 2);
  });

  it('OCR no configurado: todo sigue como hoy (IA, y el servicio de OCR ni se llama)', async () => {
    await prisma.configuracionOcr.deleteMany();
    const { ev } = await evaluado();
    assert.equal(llamadasOcr, 0);
    assert.equal(llamadasIA, 1);
    assert.equal(ev.proveedor, 'openai');
    assert.equal(ev.veredicto, 'coincide');
  });
});

describe('4. Si el OCR no alcanzó y la IA tampoco lee: se usa la lectura del OCR, topada, sin segunda llamada al OCR', () => {
  const casos: [string, () => Response | Promise<Response>][] = [
    ['la IA responde un error definitivo (400)', () => new Response('{"error":"x"}', { status: 400 })],
    ['la IA responde algo que no valida', () => okIA('no es json')],
  ];
  for (const [nombre, fallo] of casos) {
    it(`${nombre}: proveedor «ocr», confianza ≤ 0,6, nunca «coincide», no valida ni fija la fecha, y el OCR se llamó UNA vez`, async () => {
      responder = fallo;
      textoOcr = voucher({ monto: '99', operacion: operacionNueva() }); // no alcanza: monto distinto
      const { pagoId, ev } = await evaluado();
      assert.equal(llamadasOcr, 1, 'sin segunda llamada al OCR');
      assert.ok(llamadasIA >= 1);
      assert.equal(ev.estado, 'completada');
      assert.equal(ev.proveedor, 'ocr');
      assert.notEqual(ev.modelo, MODELO_OCR_SOLO, 'no es una lectura que el OCR haya decidido solo');
      assert.ok(ev.confianza! <= TOPE_CONFIANZA_OCR);
      assert.notEqual(ev.veredicto, 'coincide');
      assert.equal((await dar(T.tesor1, pagoId)).body.estado_validacion, 'por_validar', 'ni con el check del tesorero');
      const p = await pagoDb(pagoId);
      assert.equal(p.validado_por_ia, false);
      assert.equal(p.fecha_origen, 'no_leida');
    });
  }

  it('la lectura de última red NO fija la fecha del pago aunque sea válida y el veredicto no sea «no_coincide» (sin destino que comparar → «revisar»)', async () => {
    responder = () => new Response('{"error":"x"}', { status: 400 });
    textoOcr = `Yape\nS/ 100\n${fechaTexto(-3)} | 09:14 a. m.\nCódigo de operación\n${operacionNueva()}`;
    const { pagoId, ev } = await evaluado();
    assert.equal(ev.proveedor, 'ocr');
    assert.equal(ev.veredicto, 'revisar');
    assert.equal((ev.extraido as { fecha: string }).fecha, iso(-3), 'el OCR sí leyó una fecha creíble');
    assert.equal((await pagoDb(pagoId)).fecha_origen, 'no_leida', '…pero no se aplica sola');
  });

  it('sin clave de IA: igual, la lectura del OCR que no alcanzó se guarda topada y no valida', async () => {
    await prisma.claveIntegracion.deleteMany();
    textoOcr = voucher({ celular: '999', operacion: operacionNueva() });
    const { pagoId, ev } = await evaluado();
    assert.equal(llamadasIA, 0);
    assert.equal(llamadasOcr, 1);
    assert.equal(ev.proveedor, 'ocr');
    assert.ok(ev.confianza! <= TOPE_CONFIANZA_OCR);
    assert.equal((await pagoDb(pagoId)).estado_validacion, 'por_validar');
  });

  it('un fallo transitorio de la IA con el reintento por delante espera a la IA (no usa la lectura del OCR)', async () => {
    responder = () => new Response('{"error":"x"}', { status: 503 });
    textoOcr = voucher({ monto: '99', operacion: operacionNueva() });
    const { ev } = await evaluado();
    assert.equal(ev.estado, 'pendiente', 'a la espera del reintento de la IA');
    assert.equal(llamadasOcr, 1);
  });
});
