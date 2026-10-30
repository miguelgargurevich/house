// Validación automática «IA + tesorero»: el pago se valida solo cuando la IA leyó un voucher que coincide Y el tesorero del block dio su conformidad,
// dispare quien dispare (el que llegue segundo). Sin tesorero en el block, o si el pago lo registró el propio tesorero, basta la IA (con el interruptor).
// Nada sale a la red: el `fetch` del llavero es falso.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { darCortesia, esperar, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { dnsFalso, restaurarDns } from './helpers/gateways';
import { pagarCargo } from './helpers/pagoResidente';
import { hoyLima } from '../src/server/lib/fechas';
import { esperarEvaluaciones } from '../src/server/services/evaluacion';
import { guardar as guardarClaveLlavero, llaveroDeps } from '../src/server/services/llavero';
import { limpiarTodo } from '../src/server/lib/cooldown';
import { olvidarTodoUso } from '../src/server/services/rotacion';
import { invalidarComercial } from '../src/server/services/comercial/modulos';
import { cerrarPago } from '../src/server/services/validacionPago';

const ENC = 'clave-maestra-de-pruebas-que-supera-32-caracteres';
const DIA = 86_400_000;
const HOY_ISO = new Date(hoyLima().getTime()).toISOString().slice(0, 10);

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let ids: Record<'presi1' | 'tesor1' | 'tesor2' | 'tesorPropio', number>;
let T: Record<'adminA' | 'prop1' | 'prop2' | 'presi1' | 'tesor1' | 'tesor2' | 'tesorPropio', string>;
let unidadSinTesorero: { id: number };
let unidadDelTesorero: { id: number };
let unidadPropia1: { id: number }; // A-101 (block 1: tesorero 1)

// ---------- fetch inyectado ----------
let llamadas = 0;
let responder: () => Response | Promise<Response> = () => ok(lec());
const fetchOriginal = llaveroDeps.fetch;
const ok = (texto: string) => new Response(JSON.stringify({ choices: [{ message: { content: texto } }], candidates: [{ content: { parts: [{ text: texto }] } }] }), { status: 200 });
let n = 0;
const lec = (extra: Record<string, unknown> = {}) => JSON.stringify({
  es_comprobante_de_pago: true, legible: true, medio: 'yape', estado_operacion: 'exitosa', monto: 100, moneda: 'PEN', fecha: HOY_ISO,
  numero_operacion: `OP${String(++n).padStart(6, '0')}`, destinatario_nombre: 'Maria Perez Garcia', destino_numero: '321', ...extra,
});
const compuertas: (() => void)[] = [];
function compuerta() {
  let abrir!: () => void;
  const promesa = new Promise<void>((r) => { abrir = r; });
  compuertas.push(abrir);
  return { promesa, abrir };
}

before(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  dnsFalso();
  d = await sembrar();
  const e1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
  const e2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'Block', complejo_id: d.complejoA.id } });
  const e3 = await prisma.estructura.create({ data: { nombre: 'Block 3', tipo: 'Block', complejo_id: d.complejoA.id } });
  const e4 = await prisma.estructura.create({ data: { nombre: 'Block 4', tipo: 'Block', complejo_id: d.complejoA.id } }); // sin tesorero
  await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: e1.id } });
  await prisma.unidad.update({ where: { id: d.unidadA2.id }, data: { estructura_id: e2.id } });
  unidadPropia1 = d.unidadA1;
  const hash = await bcrypt.hash(PASSWORD, 4);
  const junta = async (nombre: string, email: string, cargo: string, estructura_id: number) =>
    (await prisma.usuario.create({ data: { nombre, email, rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, cargo_junta: cargo, estructura_id } })).id;
  ids = {
    presi1: await junta('Presidente 1', 'presi1@test.pe', 'presidente', e1.id),
    tesor1: await junta('Tesorero 1', 'tesor1@test.pe', 'tesorero', e1.id),
    tesor2: await junta('Tesorero 2', 'tesor2@test.pe', 'tesorero', e2.id),
    tesorPropio: await junta('Tesorero con unidad', 'tesorpropio@test.pe', 'tesorero', e3.id),
  };
  // El block 2 SÍ tiene tesorero (tesor2); el block 4 no tiene ninguno; el block 3 sólo tiene al tesorero dueño de su unidad.
  unidadSinTesorero = await prisma.unidad.create({ data: { codigo: 'S4-1', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: e4.id, propietario_id: d.propietario2.id, estado: 'activa' } });
  unidadDelTesorero = await prisma.unidad.create({ data: { codigo: 'T3-1', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: e3.id, propietario_id: ids.tesorPropio, estado: 'activa' } });
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, evaluacion: 100_000 } }));
  T = {
    adminA: await login(base, 'admin.a@test.pe'), prop1: await login(base, 'prop1@test.pe'), prop2: await login(base, 'prop2@test.pe'),
    presi1: await login(base, 'presi1@test.pe'), tesor1: await login(base, 'tesor1@test.pe'), tesor2: await login(base, 'tesor2@test.pe'), tesorPropio: await login(base, 'tesorpropio@test.pe'),
  };
  llaveroDeps.fetch = async () => { llamadas += 1; return responder(); };
});
after(async () => {
  llaveroDeps.fetch = fetchOriginal;
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
  await guardarClaveLlavero({ proveedor: 'openai', clave: 'clave-falsa-openai-0001', usuarioId: d.superadmin.id });
  await prisma.medioPago.deleteMany();
  await prisma.medioPago.create({ data: { complejo_id: d.complejoA.id, tipo: 'yape', celular: '987654321', titular: 'María Pérez García', creado_por_id: d.adminA.id } });
  await interruptor(true);
  await prisma.notificacion.deleteMany();
  limpiarTodo();
  olvidarTodoUso();
  llamadas = 0;
  responder = () => ok(lec());
});
afterEach(async () => {
  for (const abrir of compuertas.splice(0)) abrir();
  await esperarEvaluaciones();
});

const interruptor = (valor: boolean) => prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { validacion_automatica_ia: valor } });
const llama = (t: string | null, metodo: string, ruta: string, cuerpo?: unknown) => llamar(base, metodo, ruta, t, cuerpo);
const dar = (t: string, id: number) => llama(t, 'PUT', `/api/pagos/${id}/conformidad`);
const quitar = (t: string, id: number) => llama(t, 'DELETE', `/api/pagos/${id}/conformidad`);
const pagoDb = (id: number) => prisma.pago.findUniqueOrThrow({ where: { id } });
const evaluacionDb = (id: number) => prisma.evaluacionComprobante.findUniqueOrThrow({ where: { pago_id: id } });
const auditoriaValidar = (id: number) => prisma.auditoria.findMany({ where: { entidad: 'pago', entidad_id: id, accion: 'validar' } });

let k = 0;
/** Cargo nuevo (S/ 100) en la unidad y el pago por validar con su voucher; la IA lo lee en segundo plano (NO espera). */
async function pagar(token: string, unidad: { id: number }): Promise<{ pagoId: number; cargoId: number }> {
  k += 1;
  const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, mes: 1 + (k % 12), anio: 2000 + k, fecha_emision: new Date(hoyLima().getTime() - 60 * DIA), fecha_vencimiento: new Date(hoyLima().getTime() + 30 * DIA), estado: 'emitido' } });
  const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: d.conceptoA.id, monto: 100, orden: 1 } });
  const cargo = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidad.id, monto: 100, estado_pago: 'pendiente' } });
  const r = await pagarCargo(base, token, cargo.id, { metodo_pago: 'yape', referencia: 'OP-FALSA' });
  assert.equal(r.status, 201, r.texto);
  return { pagoId: r.body.id, cargoId: cargo.id };
}
/** Pago de A-101 (block 1, con tesorero) ya evaluado por la IA. */
async function pagoEvaluado(unidad: { id: number } = unidadPropia1, token = T.prop1) {
  const p = await pagar(token, unidad);
  await esperarEvaluaciones();
  return p;
}
const cargoEstado = async (cargoId: number) => (await prisma.reciboConceptoUnidad.findUniqueOrThrow({ where: { id: cargoId } })).estado_pago;

describe('IA + tesorero: valida solo cuando se cumplen las dos', () => {
  it('IA primero, tesorero después: la IA sola NO valida; al dar la conformidad el pago queda validado «por IA + tesorero»', async () => {
    const { pagoId, cargoId } = await pagoEvaluado();
    const ev = await evaluacionDb(pagoId);
    assert.equal(ev.veredicto, 'coincide');
    const antes = await pagoDb(pagoId);
    assert.equal(antes.estado_validacion, 'por_validar', 'sólo la IA no basta');
    assert.equal(antes.validado_por_ia, false);
    assert.equal(await cargoEstado(cargoId), 'en_revision');

    const r = await dar(T.tesor1, pagoId);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.estado_validacion, 'validado', 'la respuesta ya trae el pago validado');
    assert.equal(r.body.validado_por_ia, true);
    assert.equal(r.body.conformidad.por.nombre, 'Tesorero 1');
    const p = await pagoDb(pagoId);
    assert.equal(p.estado_validacion, 'validado');
    assert.equal(p.validado_por_ia, true);
    assert.equal(p.validado_por_id, null);
    assert.equal(p.conformidad_por_id, ids.tesor1, 'queda quién dio la conformidad');
    assert.ok(p.validado_at);
    assert.equal(await cargoEstado(cargoId), 'pagado');
    const aud = await auditoriaValidar(pagoId);
    assert.equal(aud.length, 1);
    assert.equal(aud[0]!.usuario_id, null);
    assert.deepEqual(aud[0]!.detalle, { por: 'ia', veredicto: 'coincide', confianza: 1, tesorero: ids.tesor1 });
    const avisos = await prisma.notificacion.findMany({ where: { tipo: 'pago_validado', ref_entidad: 'pago', ref_id: pagoId } });
    assert.deepEqual(avisos.map((a) => a.usuario_id).sort(), [d.propietario1.id, d.inquilino1.id].sort());
  });

  it('tesorero primero, IA después: la conformidad sola NO valida; al terminar la evaluación el pago queda validado', async () => {
    const puerta = compuerta();
    responder = async () => { await puerta.promesa; return ok(lec()); };
    const { pagoId, cargoId } = await pagar(T.prop1, unidadPropia1);
    await esperar(async () => llamadas === 1);
    assert.equal((await dar(T.tesor1, pagoId)).status, 200);
    const medio = await pagoDb(pagoId);
    assert.equal(medio.estado_validacion, 'por_validar', 'la IA aún no terminó');
    assert.ok(medio.conformidad_at);
    puerta.abrir();
    await esperarEvaluaciones();
    const p = await pagoDb(pagoId);
    assert.equal(p.estado_validacion, 'validado');
    assert.equal(p.validado_por_ia, true);
    assert.equal(p.conformidad_por_id, ids.tesor1);
    assert.equal(await cargoEstado(cargoId), 'pagado');
    assert.deepEqual((await auditoriaValidar(pagoId)).map((a) => a.detalle), [{ por: 'ia', veredicto: 'coincide', confianza: 1, tesorero: ids.tesor1 }]);
  });

  it('sólo la IA (coincide) y el tesorero aún no confirma: sigue por validar con el cargo en revisión, y nadie lo valida dos veces', async () => {
    const { pagoId, cargoId } = await pagoEvaluado();
    const p = await pagoDb(pagoId);
    assert.equal(p.estado_validacion, 'por_validar');
    assert.equal(p.conformidad_at, null);
    assert.equal(await cargoEstado(cargoId), 'en_revision');
    assert.equal((await auditoriaValidar(pagoId)).length, 0);
  });

  it('sólo el tesorero, con la IA dudosa (monto distinto): sigue por validar aunque dé la conformidad', async () => {
    responder = () => ok(lec({ monto: 7 }));
    const { pagoId } = await pagoEvaluado();
    assert.equal((await evaluacionDb(pagoId)).veredicto, 'no_coincide');
    const r = await dar(T.tesor1, pagoId);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.estado_validacion, 'por_validar');
    const p = await pagoDb(pagoId);
    assert.equal(p.estado_validacion, 'por_validar');
    assert.equal(p.validado_por_ia, false);
    assert.ok(p.conformidad_at, 'la conformidad queda dada para la administradora');
    assert.equal((await auditoriaValidar(pagoId)).length, 0);
  });

  it('interruptor apagado: con la IA coincidiendo y la conformidad dada (en cualquier orden) NUNCA valida solo', async () => {
    await interruptor(false);
    const iaPrimero = await pagoEvaluado();
    assert.equal((await dar(T.tesor1, iaPrimero.pagoId)).body.estado_validacion, 'por_validar');
    const puerta = compuerta();
    responder = async () => { await puerta.promesa; return ok(lec()); };
    const tesoreroPrimero = await pagar(T.prop1, unidadPropia1);
    await esperar(async () => llamadas === 1);
    await dar(T.tesor1, tesoreroPrimero.pagoId);
    puerta.abrir();
    await esperarEvaluaciones();
    for (const { pagoId, cargoId } of [iaPrimero, tesoreroPrimero]) {
      assert.equal((await evaluacionDb(pagoId)).veredicto, 'coincide');
      const p = await pagoDb(pagoId);
      assert.equal(p.estado_validacion, 'por_validar');
      assert.equal(p.validado_por_ia, false);
      assert.ok(p.conformidad_at);
      assert.equal(await cargoEstado(cargoId), 'en_revision');
    }
  });

  it('si el tesorero quita su conformidad antes de que la IA termine, el pago NO se valida solo', async () => {
    const puerta = compuerta();
    responder = async () => { await puerta.promesa; return ok(lec()); };
    const { pagoId } = await pagar(T.prop1, unidadPropia1);
    await esperar(async () => llamadas === 1);
    await dar(T.tesor1, pagoId);
    assert.equal((await quitar(T.tesor1, pagoId)).status, 200);
    puerta.abrir();
    await esperarEvaluaciones();
    const p = await pagoDb(pagoId);
    assert.equal(p.estado_validacion, 'por_validar');
    assert.equal(p.conformidad_at, null);
  });

  it('el presidente (que no es tesorero) no da la conformidad, así que no dispara nada', async () => {
    const { pagoId } = await pagoEvaluado();
    assert.equal((await dar(T.presi1, pagoId)).status, 403);
    assert.equal((await pagoDb(pagoId)).estado_validacion, 'por_validar');
  });
});

describe('IA + tesorero: cada condición de la IA cuenta cuando llega la conformidad', () => {
  // La IA evaluó y coincide (como en el caso feliz); se estropea UNA condición en la base y recién entonces el tesorero da la conformidad.
  const casos: [string, (pagoId: number) => Promise<unknown>, (() => Promise<unknown>)?][] = [
    ['la evaluación no se completó', (id) => prisma.evaluacionComprobante.update({ where: { pago_id: id }, data: { estado: 'error' } })],
    ['el veredicto no es «coincide»', (id) => prisma.evaluacionComprobante.update({ where: { pago_id: id }, data: { veredicto: 'revisar' } })],
    ['la confianza está bajo el umbral', (id) => prisma.evaluacionComprobante.update({ where: { pago_id: id }, data: { confianza: 0.5 } })],
    ['la lectura salió del OCR (sin IA)', (id) => prisma.evaluacionComprobante.update({ where: { pago_id: id }, data: { proveedor: 'ocr' } })],
    ['la fecha del voucher se descartó por inválida', (id) => prisma.pago.update({ where: { id }, data: { fecha_origen: 'invalida' } })],
    ['la evaluación es anterior al archivo vigente (lo reemplazaron)', (id) => prisma.archivoComprobante.update({ where: { pago_id: id }, data: { created_at: new Date(Date.now() + 60_000) } })],
    ['el condominio ya no tiene el módulo de IA', () => prisma.suscripcionCondominio.deleteMany().then(() => invalidarComercial()), () => darCortesia(d.complejoA.id, d.complejoB.id)],
  ];
  for (const [nombre, estropear, restaurar] of casos) {
    it(`no valida si ${nombre}`, async () => {
      const { pagoId, cargoId } = await pagoEvaluado();
      try {
        await estropear(pagoId);
        const r = await dar(T.tesor1, pagoId);
        assert.equal(r.status, 200, r.texto);
        assert.equal(r.body.estado_validacion, 'por_validar');
        assert.equal((await pagoDb(pagoId)).estado_validacion, 'por_validar');
        assert.equal(await cargoEstado(cargoId), 'en_revision');
        assert.equal((await auditoriaValidar(pagoId)).length, 0);
      } finally { await restaurar?.(); }
    });
  }

  it('control: sin estropear nada, la misma conformidad sí valida (las pruebas de arriba aíslan cada condición)', async () => {
    const { pagoId } = await pagoEvaluado();
    assert.equal((await dar(T.tesor1, pagoId)).body.estado_validacion, 'validado');
  });

  it('una fecha de voucher futura deja el pago por validar aunque la IA coincida y el tesorero confirme (en los dos órdenes)', async () => {
    const manana = new Date(hoyLima().getTime() + DIA).toISOString().slice(0, 10);
    responder = () => ok(lec({ fecha: manana }));
    const iaPrimero = await pagoEvaluado();
    await dar(T.tesor1, iaPrimero.pagoId);
    const puerta = compuerta();
    responder = async () => { await puerta.promesa; return ok(lec({ fecha: manana })); };
    llamadas = 0;
    const tesoreroPrimero = await pagar(T.prop1, unidadPropia1);
    await esperar(async () => llamadas === 1);
    await dar(T.tesor1, tesoreroPrimero.pagoId);
    puerta.abrir();
    await esperarEvaluaciones();
    for (const { pagoId } of [iaPrimero, tesoreroPrimero]) {
      assert.equal((await pagoDb(pagoId)).fecha_origen, 'invalida');
      assert.equal((await pagoDb(pagoId)).estado_validacion, 'por_validar');
    }
  });
});

describe('IA + tesorero: cuando nadie puede dar la conformidad, la IA valida sola como antes', () => {
  it('el block no tiene tesorero: la IA coincide y valida sola (queda dicho en la auditoría)', async () => {
    const { pagoId, cargoId } = await pagoEvaluado(unidadSinTesorero, T.prop2);
    const p = await pagoDb(pagoId);
    assert.equal(p.estado_validacion, 'validado');
    assert.equal(p.validado_por_ia, true);
    assert.equal(p.conformidad_at, null);
    assert.equal(await cargoEstado(cargoId), 'pagado');
    assert.deepEqual((await auditoriaValidar(pagoId)).map((a) => a.detalle), [{ por: 'ia', veredicto: 'coincide', confianza: 1, sin_conformidad: 'sin_tesorero' }]);
  });

  it('el pago lo registró el propio tesorero (y es el único del block): la IA valida sola', async () => {
    const { pagoId } = await pagoEvaluado(unidadDelTesorero, T.tesorPropio);
    const p = await pagoDb(pagoId);
    assert.equal(p.estado_validacion, 'validado');
    assert.equal(p.validado_por_ia, true);
    assert.deepEqual((await auditoriaValidar(pagoId)).map((a) => a.detalle), [{ por: 'ia', veredicto: 'coincide', confianza: 1, sin_conformidad: 'pago_del_tesorero' }]);
  });

  it('con el interruptor apagado tampoco valida sola en esos casos', async () => {
    await interruptor(false);
    for (const [unidad, token] of [[unidadSinTesorero, T.prop2], [unidadDelTesorero, T.tesorPropio]] as const) {
      const { pagoId } = await pagoEvaluado(unidad, token);
      assert.equal((await pagoDb(pagoId)).estado_validacion, 'por_validar');
    }
  });

  it('pero si la IA duda, tampoco: sin tesorero sigue por validar', async () => {
    responder = () => ok(lec({ monto: 7 }));
    const { pagoId } = await pagoEvaluado(unidadSinTesorero, T.prop2);
    assert.equal((await pagoDb(pagoId)).estado_validacion, 'por_validar');
  });
});

describe('cerrarPago con exigirConformidad (la comprobación va en el mismo UPDATE)', () => {
  it('sin conformidad responde 409 «Falta el check del tesorero del block» y no cierra; con ella, cierra', async () => {
    const { pagoId, cargoId } = await pagoEvaluado();
    const cierre = { pagoId, cargoId, fechaPago: new Date(), estado: 'validado' as const, validadorId: d.adminA.id, exigirConformidad: true };
    await assert.rejects(() => cerrarPago(cierre), (e: { status?: number; message?: string }) => e.status === 409 && e.message === 'Falta el check del tesorero del block');
    assert.equal((await pagoDb(pagoId)).estado_validacion, 'por_validar');
    await prisma.pago.update({ where: { id: pagoId }, data: { conformidad_at: new Date(), conformidad_por_id: ids.tesor1 } });
    await cerrarPago(cierre);
    assert.equal((await pagoDb(pagoId)).estado_validacion, 'validado');
    await assert.rejects(() => cerrarPago(cierre), (e: { status?: number; message?: string }) => e.status === 409 && e.message === 'Este pago ya fue revisado');
  });
});
