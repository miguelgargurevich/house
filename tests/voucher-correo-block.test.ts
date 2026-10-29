// Cuando un VECINO entrega su voucher (el panel de pago, «Adjuntar/Reemplazar comprobante» o los bots) se le manda por correo, adjunto, a la junta del block.
// Resend SIEMPRE falso (`voucherBlockDeps.fetch` inyectado) e IA sin red: nunca sale nada a la red real.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { cabecerasDeSesion, iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { pagarComoResidente, pngUnico, voucherPng } from './helpers/pagoResidente';
import { hoyLima } from '../src/server/lib/fechas';
import { enviarCorreo } from '../src/server/services/avisos/canales';
import { esperarAvisosVoucher, voucherBlockDeps } from '../src/server/services/avisos/voucherBlock';
import { esperarEvaluaciones } from '../src/server/services/evaluacion';
import { llaveroDeps } from '../src/server/services/llavero';
import { manejarMedio } from '../src/server/services/canales/voucher';
import type { AuthUser } from '../src/server/middleware/auth';

const DIA = 86_400_000;
const HOY = hoyLima().getTime();
const CORREO_BLOCK = 'junta.block1@ejemplo.test';
const CLAVE = 're_CLAVE-FALSA-NO-REAL';
const ENV_OK = { RESEND_API_KEY: CLAVE, MAIL_FROM: 'House <house@ejemplo.test>' };

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let block: { id: number };
let T: Record<'prop1' | 'adminA', string>;

// ---------- Resend falso ----------
interface Correo { url: string; auth: string | null; body: { from: string; to: string[]; subject: string; text: string; attachments?: { filename: string; content: string }[] } }
let correos: Correo[] = [];
let responder: () => Response = () => new Response('{"id":"x"}', { status: 200 });
const originales = { fetch: voucherBlockDeps.fetch, env: voucherBlockDeps.env, espera: voucherBlockDeps.esperaReintentoMs, ia: llaveroDeps.fetch };

interface Mant { reciboId: number; unidadId: number }
/** Un recibo de octubre de 2026 con agua 40, limpieza 60 y mora 15 (total 115) para UNA unidad. */
async function mantenimiento(unidad: { id: number }): Promise<Mant> {
  const complejo = d.complejoA;
  const recibo = await prisma.recibo.create({ data: { empresa_id: complejo.empresa_id, complejo_id: complejo.id, mes: 10, anio: 2026, fecha_emision: new Date(HOY - 10 * DIA), fecha_vencimiento: new Date(HOY + 20 * DIA), estado: 'emitido' } });
  for (const [i, [nombre, monto]] of ([['Agua', 40], ['Limpieza', 60], ['Mora', 15]] as const).entries()) {
    const concepto = await prisma.concepto.create({ data: { nombre, empresa_id: complejo.empresa_id, tipo_monto: 'fijo' } });
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: concepto.id, monto, orden: i + 1, es_recargo: nombre === 'Mora' } });
    await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidad.id, monto, estado_pago: 'pendiente' } });
  }
  return { reciboId: recibo.id, unidadId: unidad.id };
}

const pagar = async (m: Mant, campos?: Record<string, string>, archivo = voucherPng()) => {
  const r = await pagarComoResidente(base, T.prop1, m.reciboId, m.unidadId, campos, archivo);
  await esperarAvisosVoucher();
  return r;
};
const avisos = (pagoId?: number) => prisma.auditoria.findMany({ where: { accion: 'avisar_voucher_block', entidad: 'pago', ...(pagoId ? { entidad_id: pagoId } : {}) }, orderBy: { id: 'asc' } });
const detalle = (a: { detalle: unknown }) => a.detalle as { resultado: string; motivo?: string; intentos?: number; sha256?: string };

/** Sube (o reemplaza) el comprobante de un pago por `POST /api/pagos/:id/comprobante`. */
async function subir(token: string, pagoId: number, bytes: Buffer, nombre = 'comprobante.png') {
  const r = await fetch(`${base}/api/pagos/${pagoId}/comprobante`, { method: 'POST', headers: { 'content-type': 'image/png', 'x-nombre-archivo': encodeURIComponent(nombre), ...cabecerasDeSesion(token) }, body: new Uint8Array(bytes) });
  await r.text();
  await esperarAvisosVoucher();
  return r.status;
}

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, ai: 100_000, llavero: 100_000, evaluacion: 100_000 } }));
  T = { prop1: await login(base, 'prop1@test.pe'), adminA: await login(base, 'admin.a@test.pe') };
  block = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'block', complejo_id: d.complejoA.id, correo_vouchers: CORREO_BLOCK } });
  await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: block.id } });
  llaveroDeps.fetch = async () => { throw new Error('sin red en las pruebas'); };
  voucherBlockDeps.fetch = async (url, init) => {
    correos.push({ url: String(url), auth: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) });
    return responder();
  };
  voucherBlockDeps.esperaReintentoMs = 0;
});
after(async () => {
  Object.assign(voucherBlockDeps, { fetch: originales.fetch, env: originales.env, esperaReintentoMs: originales.espera });
  llaveroDeps.fetch = originales.ia;
  await esperarEvaluaciones();
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  correos = [];
  responder = () => new Response('{"id":"x"}', { status: 200 });
  voucherBlockDeps.env = ENV_OK;
  await prisma.estructura.update({ where: { id: block.id }, data: { correo_vouchers: CORREO_BLOCK } });
  await prisma.auditoria.deleteMany({ where: { accion: 'avisar_voucher_block' } });
});
afterEach(async () => { await esperarEvaluaciones(); await esperarAvisosVoucher(); });

describe('el pago del panel avisa al correo del block, con el voucher adjunto', () => {
  it('manda UN correo al correo del block con el asunto, el cuerpo y el archivo; y lo deja auditado sin el contenido', async () => {
    const m = await mantenimiento(d.unidadA1);
    const bytes = pngUnico();
    const r = await pagar(m, { metodo_pago: 'yape', referencia: 'OP-4455' }, voucherPng({ bytes, nombre: 'Operación ñandú.png' }));
    assert.equal(r.status, 201, r.texto);
    assert.equal(correos.length, 1);
    const c = correos[0]!;
    assert.equal(c.url, 'https://api.resend.com/emails');
    assert.equal(c.auth, `Bearer ${CLAVE}`);
    assert.deepEqual(c.body.to, [CORREO_BLOCK]);
    assert.equal(c.body.from, 'House <house@ejemplo.test>');
    assert.equal(c.body.subject, 'Voucher de pago · A-101 · octubre 2026 · S/ 115.00');
    assert.equal(c.body.attachments?.length, 1);
    assert.equal(c.body.attachments![0]!.filename, 'Operación ñandú.png');
    assert.ok(Buffer.from(c.body.attachments![0]!.content, 'base64').equals(bytes), 'el adjunto es el voucher tal cual');
    for (const parte of ['Departamento: A-101 (Block 1)', 'Condominio: Complejo A', 'Propietario: Propietario 1', 'Mes: octubre 2026', 'Monto: S/ 115.00', 'Método: Yape', 'N.º de operación: OP-4455', 'Fecha: ']) {
      assert.ok(c.body.text.includes(parte), `falta «${parte}» en el cuerpo:\n${c.body.text}`);
    }
    assert.ok(!c.body.text.includes('Pagó:'), 'paga el propio propietario: no hace falta repetirlo');
    assert.doesNotMatch(c.body.text, /\?[a-z_]+=|token|password/i, 'sin enlaces con datos en la URL');

    const filas = await avisos(r.body.pago_id);
    assert.equal(filas.length, 1);
    assert.equal(detalle(filas[0]!).resultado, 'enviado');
    const volcado = JSON.stringify(filas);
    for (const secreto of [CLAVE, CORREO_BLOCK, c.body.attachments![0]!.content.slice(0, 40)]) assert.ok(!volcado.includes(secreto), 'la auditoría no filtra la clave, el correo ni el archivo');
  });

  it('multimoneda: en un condominio en dólares el asunto y el monto del correo dicen «US$»', async () => {
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { moneda: 'USD' } });
    try {
      const r = await pagar(await mantenimiento(d.unidadA1), { metodo_pago: 'yape' });
      assert.equal(r.status, 201, r.texto);
      assert.equal(correos.length, 1);
      assert.equal(correos[0]!.body.subject, 'Voucher de pago · A-101 · octubre 2026 · US$ 115.00');
      assert.ok(correos[0]!.body.text.includes('Monto: US$ 115.00'), correos[0]!.body.text);
      assert.ok(!correos[0]!.body.text.includes('S/'));
    } finally {
      await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { moneda: 'PEN' } });
    }
  });

  it('si paga el inquilino, el correo dice quién pagó además del propietario', async () => {
    const m = await mantenimiento(d.unidadA1);
    const inq = await login(base, 'inq1@test.pe');
    const r = await pagarComoResidente(base, inq, m.reciboId, m.unidadId);
    await esperarAvisosVoucher();
    assert.equal(r.status, 201, r.texto);
    assert.equal(correos.length, 1);
    assert.match(correos[0]!.body.text, /Propietario: Propietario 1\nPagó: Inquilino 1/);
  });

  it('el pago responde aunque Resend tarde: el correo sale DESPUÉS de responder (segundo plano)', async () => {
    let liberar!: () => void;
    const lento = new Promise<void>((res) => { liberar = res; });
    voucherBlockDeps.fetch = async (url, init) => { await lento; correos.push({ url: String(url), auth: null, body: JSON.parse(String(init?.body)) }); return responder(); };
    try {
      const m = await mantenimiento(d.unidadA1);
      const pedido = pagarComoResidente(base, T.prop1, m.reciboId, m.unidadId);
      // Si la ruta esperara al correo, la respuesta no llegaría mientras Resend no conteste.
      const r = await Promise.race([pedido, new Promise<null>((res) => setTimeout(() => res(null), 4000))]);
      assert.ok(r, 'el pago no respondió: está esperando al correo');
      assert.equal(r.status, 201, r.texto);
      assert.equal(correos.length, 0, 'todavía no salió');
      liberar();
      await esperarAvisosVoucher();
      assert.equal(correos.length, 1);
    } finally {
      liberar();
      voucherBlockDeps.fetch = async (url, init) => { correos.push({ url: String(url), auth: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) }); return responder(); };
    }
  });
});

describe('cuándo NO se envía nada (y no es un error)', () => {
  it('el block sin correo: no se llama a Resend, el pago responde 201 y queda «omitido»', async () => {
    await prisma.estructura.update({ where: { id: block.id }, data: { correo_vouchers: null } });
    const m = await mantenimiento(d.unidadA1);
    const r = await pagar(m);
    assert.equal(r.status, 201, r.texto);
    assert.equal(correos.length, 0);
    const filas = await avisos(r.body.pago_id);
    assert.equal(filas.length, 1);
    assert.equal(detalle(filas[0]!).resultado, 'omitido');
  });

  it('un departamento sin block: tampoco se llama a Resend', async () => {
    const m = await mantenimiento(d.unidadA2);
    const r = await pagarComoResidente(base, await login(base, 'prop2@test.pe'), m.reciboId, m.unidadId);
    await esperarAvisosVoucher();
    assert.equal(r.status, 201, r.texto);
    assert.equal(correos.length, 0);
  });

  it('sin RESEND_API_KEY / MAIL_FROM: no se llama a Resend y el pago responde 201', async () => {
    voucherBlockDeps.env = { RESEND_API_KEY: '', MAIL_FROM: '' };
    const m = await mantenimiento(d.unidadA1);
    const r = await pagar(m);
    assert.equal(r.status, 201, r.texto);
    assert.equal(correos.length, 0);
    assert.equal(detalle((await avisos(r.body.pago_id))[0]!).resultado, 'omitido');
  });
});

describe('si Resend falla, el pago no se entera', () => {
  it('Resend caído: el pago responde 201, se reintenta UNA vez y el fallo queda auditado sin la clave ni la respuesta del proveedor', async () => {
    responder = () => new Response(`{"detalle":"RESPUESTA-DEL-PROVEEDOR ${CLAVE}"}`, { status: 500 });
    const m = await mantenimiento(d.unidadA1);
    const r = await pagar(m);
    assert.equal(r.status, 201, r.texto);
    assert.equal(correos.length, 2, 'el intento y un reintento');
    assert.equal(await prisma.pago.count({ where: { id: r.body.pago_id, estado_validacion: 'por_validar' } }), 1, 'el pago quedó guardado');
    const filas = await avisos(r.body.pago_id);
    assert.equal(filas.length, 1);
    assert.deepEqual({ r: detalle(filas[0]!).resultado, i: detalle(filas[0]!).intentos }, { r: 'fallo', i: 2 });
    assert.match(detalle(filas[0]!).motivo ?? '', /Resend respondió 500/);
    const volcado = JSON.stringify(filas);
    assert.ok(!volcado.includes(CLAVE) && !volcado.includes('RESPUESTA-DEL-PROVEEDOR'));
  });

  it('sin conexión (el fetch lanza): igual 201 y «fallo» auditado', async () => {
    voucherBlockDeps.fetch = async () => { throw new Error(`no conecta Authorization: Bearer ${CLAVE}`); };
    const m = await mantenimiento(d.unidadA1);
    const r = await pagar(m);
    assert.equal(r.status, 201, r.texto);
    const filas = await avisos(r.body.pago_id);
    assert.equal(detalle(filas[0]!).resultado, 'fallo');
    assert.ok(!JSON.stringify(filas).includes(CLAVE));
    voucherBlockDeps.fetch = async (url, init) => { correos.push({ url: String(url), auth: null, body: JSON.parse(String(init?.body)) }); return responder(); };
  });

  it('falla la primera vez y sale a la segunda: queda «enviado» con dos intentos', async () => {
    let n = 0;
    responder = () => (++n === 1 ? new Response('x', { status: 503 }) : new Response('{"id":"y"}', { status: 200 }));
    const m = await mantenimiento(d.unidadA1);
    const r = await pagar(m);
    assert.equal(r.status, 201, r.texto);
    assert.equal(correos.length, 2);
    const f = detalle((await avisos(r.body.pago_id))[0]!);
    assert.deepEqual({ r: f.resultado, i: f.intentos }, { r: 'enviado', i: 2 });
  });
});

describe('«Adjuntar / Reemplazar comprobante» de un pago del vecino', () => {
  /** Un pago suelto (por cargo) del vecino, sin comprobante: la forma de tener uno al que adjuntar. */
  async function pagoSinVoucher() {
    const r = await llamar(base, 'POST', `/api/me/cargos/${d.cargoFuturoA1.id}/pagos`, T.prop1, { metodo_pago: 'plin', referencia: 'PL-9' });
    assert.equal(r.status, 201, r.texto);
    return r.body.id as number;
  }

  it('adjuntar manda el voucher; reemplazar manda el NUEVO; el mismo archivo otra vez no se repite', async () => {
    const pagoId = await pagoSinVoucher();
    assert.equal(correos.length, 0, 'sin voucher no hay nada que mandar');
    const uno = pngUnico();
    assert.equal(await subir(T.prop1, pagoId, uno, 'uno.png'), 201);
    assert.equal(correos.length, 1);
    assert.equal(correos[0]!.body.attachments![0]!.filename, 'uno.png');
    assert.ok(Buffer.from(correos[0]!.body.attachments![0]!.content, 'base64').equals(uno));
    assert.match(correos[0]!.body.subject, /^Voucher de pago · A-101 · .* · S\/ 200\.00$/);
    assert.match(correos[0]!.body.text, /Método: Plin/);

    const dos = pngUnico();
    assert.equal(await subir(T.prop1, pagoId, dos, 'dos.png'), 201);
    assert.equal(correos.length, 2, 'al reemplazar se manda el nuevo');
    assert.equal(correos[1]!.body.attachments![0]!.filename, 'dos.png');
    assert.ok(Buffer.from(correos[1]!.body.attachments![0]!.content, 'base64').equals(dos));

    assert.equal(await subir(T.prop1, pagoId, dos, 'dos.png'), 201);
    assert.equal(correos.length, 2, 'el mismo archivo no se manda dos veces');
    assert.equal((await avisos(pagoId)).filter((a) => detalle(a).resultado === 'enviado').length, 2);
  });

  it('reemplazar el voucher de un pago hecho desde el panel manda el nuevo con el TOTAL del mantenimiento', async () => {
    const m = await mantenimiento(d.unidadA1);
    const r = await pagar(m);
    assert.equal(correos.length, 1);
    assert.equal(await subir(T.prop1, r.body.pago_id, pngUnico(), 'otro.png'), 201);
    assert.equal(correos.length, 2);
    assert.match(correos[1]!.body.subject, /S\/ 115\.00$/);
    assert.equal(correos[1]!.body.attachments![0]!.filename, 'otro.png');
  });
});

describe('lo que registra la administración NO avisa', () => {
  it('la administración sube un comprobante al pago de un vecino: no se manda nada', async () => {
    const m = await mantenimiento(d.unidadA1);
    const r = await pagar(m);
    correos = [];
    assert.equal(await subir(T.adminA, r.body.pago_id, pngUnico(), 'de-la-admin.png'), 201);
    assert.equal(correos.length, 0);
    assert.equal((await avisos(r.body.pago_id)).length, 1, 'sólo el aviso del voucher original del vecino');
  });

  it('la administración registra el pago del mantenimiento con voucher desde su panel: no se manda nada', async () => {
    const m = await mantenimiento(d.unidadA1);
    const fd = new FormData();
    fd.append('metodo_pago', 'transferencia');
    fd.append('voucher', new Blob([new Uint8Array(pngUnico())], { type: 'image/png' }), 'admin.png');
    const r = await fetch(`${base}/api/recibos/${m.reciboId}/mantenimientos/${m.unidadId}/pagos`, { method: 'POST', headers: cabecerasDeSesion(T.adminA), body: fd });
    assert.equal(r.status, 201, await r.text());
    await esperarAvisosVoucher();
    assert.equal(correos.length, 0);
    assert.equal((await avisos()).length, 0);
  });
});

describe('los bots de WhatsApp y Telegram también avisan', () => {
  it('un voucher recibido por el bot se manda al correo del block, adjunto', async () => {
    // Un solo mantenimiento pendiente para que el bot lo registre sin preguntar «¿cuál pagaste?».
    await prisma.reciboConceptoUnidad.deleteMany({ where: { id: { in: [d.cargoVencidoA1.id, d.cargoFuturoA1.id] } } });
    const m = await mantenimiento(d.unidadA1);
    const bytes = pngUnico();
    const user: AuthUser = { id: d.propietario1.id, email: d.propietario1.email, rol: 'propietario', empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, cargo_junta: null, estructura_id: null };
    const respuesta = await manejarMedio({
      transporte: { canal: 'whatsapp', descargarMedio: async () => ({ datos: bytes }) },
      vinculoId: 1, empresaId: d.empresaA.id, user,
      medio: { tipo: 'imagen', mimetype: 'image/png', nombre: 'bot.png', tamano: bytes.length },
    });
    await esperarAvisosVoucher();
    assert.match(respuesta, /Recibido/);
    assert.equal(correos.length, 1);
    assert.deepEqual(correos[0]!.body.to, [CORREO_BLOCK]);
    assert.equal(correos[0]!.body.subject, 'Voucher de pago · A-101 · octubre 2026 · S/ 115.00');
    assert.ok(Buffer.from(correos[0]!.body.attachments![0]!.content, 'base64').equals(bytes));
    const pago = await prisma.pago.findFirstOrThrow({ where: { reciboConceptoUnidad: { unidad_id: m.unidadId, reciboConcepto: { recibo_id: m.reciboId } }, grupo_principal: true } });
    assert.equal(detalle((await avisos(pago.id))[0]!).resultado, 'enviado');
  });
});

describe('enviarCorreo: los adjuntos son opcionales', () => {
  it('sin adjuntos el cuerpo es el de siempre (sin «attachments»); con adjuntos van en base64 con su nombre', async () => {
    await enviarCorreo(voucherBlockDeps, 'a@ejemplo.test', 'Asunto', 'Cuerpo');
    assert.equal(correos.length, 1);
    assert.deepEqual(Object.keys(correos[0]!.body).sort(), ['from', 'subject', 'text', 'to']);
    await enviarCorreo(voucherBlockDeps, 'a@ejemplo.test', 'Asunto', 'Cuerpo', [{ nombre: 'a.pdf', datos: Buffer.from('%PDF-1.4 hola') }]);
    assert.deepEqual(correos[1]!.body.attachments, [{ filename: 'a.pdf', content: Buffer.from('%PDF-1.4 hola').toString('base64') }]);
  });
});
