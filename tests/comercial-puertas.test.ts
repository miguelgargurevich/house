// La puerta por módulo: IA de vouchers, avisos por WhatsApp y asistente (web y bots), con y sin módulo,
// vencida en gracia y pasada la gracia, y cortesía. Nada sale a la red: todo fetch es inyectado.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { cabecerasDeSesion, darCortesia, iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { pagarCargo } from './helpers/pagoResidente';
import { chatOk, instalarIA } from './helpers/ia';
import { hoyLima } from '../src/server/lib/fechas';
import { procesarCola } from '../src/server/services/avisos/cola';
import type { DepsAvisos } from '../src/server/services/avisos/canales';
import { barrerEvaluaciones, esperarEvaluaciones, iniciarEvaluacion, MOTIVO_SIN_MODULO } from '../src/server/services/evaluacion';
import { guardar as guardarClaveLlavero, llaveroDeps } from '../src/server/services/llavero';
import { olvidarTodoUso } from '../src/server/services/rotacion';
import { atenderMensaje } from '../src/server/services/canales/entrante';
import { limpiarLimites } from '../src/server/services/canales/limites';
import type { Transporte } from '../src/server/services/canales/transporte';
import { MENSAJE_SIN_ASISTENTE, invalidarComercial } from '../src/server/services/comercial/modulos';
import { limpiarTodo } from '../src/server/lib/cooldown';

const ENC = 'clave-maestra-de-pruebas-que-supera-32-caracteres';
const DIA = 86_400_000;
const HOY = hoyLima().getTime();
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'prop1', string>;
const fetchOriginal = llaveroDeps.fetch;

// ---------- IA falsa de visión ----------
let llamadasIA: string[] = [];
let contadorOp = 0;
const lectura = () => JSON.stringify({ es_comprobante_de_pago: true, legible: true, medio: 'yape', estado_operacion: 'exitosa', monto: 100, moneda: 'PEN', fecha: iso(HOY), numero_operacion: `OP${String(++contadorOp).padStart(6, '0')}`, destinatario_nombre: 'Maria Perez Garcia', destino_numero: '321' });
const dosShapes = (t: string) => new Response(JSON.stringify({ choices: [{ message: { content: t } }], candidates: [{ content: { parts: [{ text: t }] } }] }), { status: 200 });

const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`captura-${++contadorOp}`)]);
let unidadN = 0;

/** Plan del condominio A: `pro` con vigencia relativa a hoy (días; negativo = ya venció), `gratis`, `cortesia` o módulos sueltos. */
async function fijarPlan(plan: 'gratis' | 'pro' | 'cortesia', opts: { dias?: number | null; modulos?: string[] } = {}) {
  await prisma.suscripcionCondominio.upsert({
    where: { complejo_id: d.complejoA.id },
    create: { complejo_id: d.complejoA.id, plan_clave: plan, modulos: opts.modulos ?? [], vigente_hasta: opts.dias == null ? null : new Date(HOY + opts.dias * DIA) },
    update: { plan_clave: plan, modulos: opts.modulos ?? [], vigente_hasta: opts.dias == null ? null : new Date(HOY + opts.dias * DIA) },
  });
  invalidarComercial();
}

async function cargoNuevo() {
  unidadN += 1;
  const unidad = await prisma.unidad.create({ data: { codigo: `PU-${unidadN}`, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, propietario_id: d.propietario1.id, estado: 'activa' } });
  const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, mes: 1, anio: 2026, fecha_emision: new Date(HOY - 60 * DIA), fecha_vencimiento: new Date(HOY + 30 * DIA), estado: 'emitido' } });
  const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: d.conceptoA.id, monto: 100, orden: 1 } });
  return { recibo, cargo: await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidad.id, monto: 100, estado_pago: 'pendiente' } }) };
}
/** Pago del residente con comprobante subido (sin esperar a la IA). */
async function pagoConVoucher() {
  const { cargo } = await cargoNuevo();
  const p = await pagarCargo(base, T.prop1, cargo.id, { metodo_pago: 'yape' });
  assert.equal(p.status, 201, p.texto);
  const r = await fetch(`${base}/api/pagos/${p.body.id}/comprobante`, { method: 'POST', headers: { 'content-type': 'image/png', ...cabecerasDeSesion(T.prop1) }, body: new Uint8Array(PNG()) });
  assert.equal(r.status, 201);
  return p.body.id as number;
}

before(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, ai: 100_000, evaluacion: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), prop1: await login(base, 'prop1@test.pe') };
  await guardarClaveLlavero({ proveedor: 'gemini', clave: 'clave-falsa-gemini-0001', usuarioId: d.superadmin.id });
  llaveroDeps.fetch = async () => { llamadasIA.push('visión'); return dosShapes(lectura()); };
});
after(async () => {
  llaveroDeps.fetch = fetchOriginal;
  delete process.env.LLAVERO_ENC_KEY;
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => { llamadasIA = []; olvidarTodoUso(); limpiarTodo(); limpiarLimites(); await fijarPlan('cortesia'); });
afterEach(async () => { await esperarEvaluaciones(); });

describe('módulo «IA que lee y valida vouchers»', () => {
  it('con el módulo (cortesía) la IA lee el comprobante', async () => {
    const pagoId = await pagoConVoucher();
    await esperarEvaluaciones();
    assert.ok(llamadasIA.length >= 1, 'se llamó a la IA');
    assert.equal((await prisma.evaluacionComprobante.findUniqueOrThrow({ where: { pago_id: pagoId } })).estado, 'completada');
  });

  it('SIN el módulo (Gratis) no se llama a la IA: queda «no disponible» con su motivo y el pago sigue por validación manual', async () => {
    await fijarPlan('gratis');
    const pagoId = await pagoConVoucher();
    await esperarEvaluaciones();
    assert.equal(llamadasIA.length, 0, 'ni IA ni OCR');
    const ev = await prisma.evaluacionComprobante.findUniqueOrThrow({ where: { pago_id: pagoId } });
    assert.equal(ev.estado, 'no_disponible');
    assert.equal(ev.error, MOTIVO_SIN_MODULO);
    assert.match(ev.error!, /módulo/);
    const pago = await prisma.pago.findUniqueOrThrow({ where: { id: pagoId } });
    assert.equal(pago.estado_validacion, 'por_validar');
    // La validación manual sigue siendo gratis.
    const v = await llamar(base, 'PATCH', `/api/pagos/${pagoId}/validacion`, T.adminA, { estado: 'validado' });
    assert.equal(v.status, 200, v.texto);
    assert.equal(v.body.validado_por_ia ?? false, false);
  });

  it('iniciarEvaluacion sin módulo no arranca nada en segundo plano (false) y la marca queda «no disponible» al instante; con módulo arranca (true)', async () => {
    const pagoId = await pagoConVoucher();
    await esperarEvaluaciones();
    llamadasIA = [];
    await fijarPlan('gratis');
    assert.equal(await iniciarEvaluacion(pagoId, 'subida'), false);
    assert.equal(llamadasIA.length, 0);
    const ev = await prisma.evaluacionComprobante.findUniqueOrThrow({ where: { pago_id: pagoId } });
    assert.deepEqual({ estado: ev.estado, intentos: ev.intentos, error: ev.error }, { estado: 'no_disponible', intentos: 0, error: MOTIVO_SIN_MODULO }, 'sin pasar por «pendiente»: la pantalla no muestra «Evaluando…»');
    await fijarPlan('cortesia');
    assert.equal(await iniciarEvaluacion(pagoId, 'subida'), true);
    await esperarEvaluaciones();
    assert.equal((await prisma.evaluacionComprobante.findUniqueOrThrow({ where: { pago_id: pagoId } })).estado, 'completada');
  });

  it('sin el módulo, aunque el condominio tenga la validación automática encendida, no valida sola', async () => {
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { validacion_automatica_ia: true } });
    await fijarPlan('gratis');
    const pagoId = await pagoConVoucher();
    await esperarEvaluaciones();
    assert.equal(llamadasIA.length, 0);
    assert.equal((await prisma.pago.findUniqueOrThrow({ where: { id: pagoId } })).estado_validacion, 'por_validar');
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { validacion_automatica_ia: false } });
  });

  it('pedir la evaluación a mano sin el módulo: 403 con code MODULO_NO_ACTIVO y el módulo', async () => {
    const pagoId = await pagoConVoucher();
    await esperarEvaluaciones();
    await fijarPlan('gratis');
    const r = await llamar(base, 'POST', `/api/pagos/${pagoId}/evaluacion`, T.adminA);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'MODULO_NO_ACTIVO');
    assert.equal(r.body.modulo, 'ia_vouchers');
  });

  it('un módulo suelto «ia_vouchers» sobre Gratis (con vigencia) también abre la puerta', async () => {
    await fijarPlan('gratis', { modulos: ['ia_vouchers'], dias: 20 });
    await pagoConVoucher();
    await esperarEvaluaciones();
    assert.ok(llamadasIA.length >= 1);
  });

  it('Pro vencido DENTRO de la gracia: la IA sigue; PASADA la gracia: se apaga (como Gratis)', async () => {
    await fijarPlan('pro', { dias: -3 });
    await pagoConVoucher();
    await esperarEvaluaciones();
    assert.ok(llamadasIA.length >= 1, 'en gracia sigue activo');
    llamadasIA = [];
    await fijarPlan('pro', { dias: -10 });
    const pagoId = await pagoConVoucher();
    await esperarEvaluaciones();
    assert.equal(llamadasIA.length, 0, 'pasada la gracia no se llama a la IA');
    assert.equal((await prisma.evaluacionComprobante.findUniqueOrThrow({ where: { pago_id: pagoId } })).estado, 'no_disponible');
  });

  it('un reintento o barrido que llega cuando el plan ya venció no llama a la IA', async () => {
    const pagoId = await pagoConVoucher();
    await esperarEvaluaciones();
    const sha = (await prisma.archivoComprobante.findUniqueOrThrow({ where: { pago_id: pagoId } })).sha256;
    // Deja la evaluación como «pendiente con reintento vencido» (lo que dejaría un fallo transitorio de la IA) y apaga el módulo.
    await prisma.evaluacionComprobante.update({ where: { pago_id: pagoId }, data: { estado: 'pendiente', veredicto: null, confianza: null, error: 'Reintento programado', intentos: 1, reintentar_at: new Date(Date.now() - 1000) } });
    await fijarPlan('gratis');
    llamadasIA = [];
    const r = await barrerEvaluaciones();
    await esperarEvaluaciones();
    assert.equal(r.reintentadas, 1);
    assert.equal(llamadasIA.length, 0);
    assert.equal((await prisma.evaluacionComprobante.findUniqueOrThrow({ where: { pago_id: pagoId } })).estado, 'no_disponible');
    assert.ok(sha);
  });

  it('un condominio sin fila de suscripción cuenta como Gratis', async () => {
    await prisma.suscripcionCondominio.delete({ where: { complejo_id: d.complejoA.id } });
    invalidarComercial();
    await pagoConVoucher();
    await esperarEvaluaciones();
    assert.equal(llamadasIA.length, 0);
  });
});

describe('módulo «Avisos por WhatsApp»', () => {
  const ENV = { RESEND_API_KEY: 're_falsa', MAIL_FROM: 'Casa <a@ejemplo.test>', EVOLUTION_URL: 'https://evo.ejemplo.test', EVOLUTION_APIKEY: 'k-falsa' };
  let llamadas: string[] = [];
  const deps = (): DepsAvisos => ({ ahora: () => new Date(), env: ENV, fetch: (async (url: string | URL | Request) => { llamadas.push(String(url)); return new Response('{}', { status: 200 }); }) as typeof fetch });
  let reciboId: number;

  beforeEach(async () => {
    llamadas = [];
    await prisma.notificacion.deleteMany();
    await prisma.usuario.update({ where: { id: d.propietario1.id }, data: { telefono: '+51 987 654 321' } });
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: 'instancia-falsa' } });
    reciboId = d.reciboVencidoA.id;
  });
  const aviso = (canal: string, tipo = 'recibo_emitido', ref: { entidad: string; id: number | null } = { entidad: 'recibo', id: reciboId }) =>
    prisma.notificacion.create({ data: { usuario_id: d.propietario1.id, canal, tipo, asunto: 'Asunto', cuerpo: 'Cuerpo', estado: 'pendiente', programada_para: new Date(Date.now() - 1000), ref_entidad: ref.entidad, ref_id: ref.id } });
  const estados = async () => Object.fromEntries((await prisma.notificacion.findMany()).map((n) => [n.canal, { estado: n.estado, error: n.error }]));

  it('con el módulo salen el correo y el WhatsApp', async () => {
    await aviso('email'); await aviso('whatsapp');
    const r = await procesarCola(deps());
    assert.equal(r.enviadas, 2);
    assert.ok(llamadas.some((u) => u.includes('evo.ejemplo.test')));
  });

  it('SIN el módulo el WhatsApp se omite con «Plan sin WhatsApp» (sin llamar a Evolution) y el correo SIGUE saliendo', async () => {
    await fijarPlan('gratis');
    await aviso('email'); await aviso('whatsapp');
    const r = await procesarCola(deps());
    assert.deepEqual({ enviadas: r.enviadas, omitidas: r.omitidas }, { enviadas: 1, omitidas: 1 });
    assert.ok(!llamadas.some((u) => u.includes('evo.ejemplo.test')), 'Evolution no se toca');
    assert.ok(llamadas.some((u) => u.includes('resend')), 'el correo sale');
    const e = await estados();
    assert.equal(e.whatsapp.estado, 'omitida');
    assert.equal(e.whatsapp.error, 'Plan sin WhatsApp');
    assert.equal(e.email.estado, 'enviada');
  });

  it('el aviso se decide por el condominio del recibo: un recibo de otro condominio con módulo sí sale', async () => {
    await fijarPlan('gratis'); // A sin módulo; B sigue en cortesía
    await prisma.empresaAdministradora.update({ where: { id: d.empresaB.id }, data: { whatsapp_instance: 'instancia-b' } });
    await aviso('whatsapp', 'recibo_emitido', { entidad: 'recibo', id: d.reciboB.id });
    const r = await procesarCola(deps());
    assert.equal(r.enviadas, 1);
  });

  it('vencido pasada la gracia = sin WhatsApp; dentro de la gracia = con WhatsApp', async () => {
    await fijarPlan('pro', { dias: -2 });
    await aviso('whatsapp');
    assert.equal((await procesarCola(deps())).enviadas, 1);
    await prisma.notificacion.deleteMany();
    await fijarPlan('pro', { dias: -30 });
    await aviso('whatsapp');
    assert.equal((await procesarCola(deps())).omitidas, 1);
  });

  it('el resultado de un voucher por WhatsApp sale si hay asistente (el bot) aunque no haya «Avisos por WhatsApp»', async () => {
    await fijarPlan('gratis', { modulos: ['asistente'], dias: 20 });
    await aviso('whatsapp', 'pago_validado', { entidad: 'recibo', id: reciboId });
    assert.equal((await procesarCola(deps())).enviadas, 1);
  });

  it('un aviso de la plataforma (sin condominio, p. ej. «IA caída») no depende de ningún plan', async () => {
    await fijarPlan('gratis');
    await aviso('whatsapp', 'ia_caida', { entidad: 'ia', id: 1 });
    await procesarCola(deps());
    assert.notEqual((await estados()).whatsapp.error, 'Plan sin WhatsApp', 'no se omite por plan (si no sale es por la instancia, como siempre)');
  });

  it('el bot de Telegram (resultado de voucher) sin asistente se omite', async () => {
    await fijarPlan('gratis');
    await prisma.canalVinculado.create({ data: { usuario_id: d.propietario1.id, canal: 'telegram', identificador: '7001', empresa_id: d.empresaA.id, verificado_at: new Date(), clave_vigente: 'telegram:7001', clave_usuario: `${d.propietario1.id}:telegram` } });
    await aviso('telegram', 'pago_validado', { entidad: 'recibo', id: reciboId });
    const r = await procesarCola(deps());
    assert.equal(r.omitidas, 1);
    assert.equal((await estados()).telegram.error, 'Plan sin asistente');
    await prisma.canalVinculado.deleteMany();
  });
});

describe('módulo «Asistente con IA»: chat web', () => {
  let ia: ReturnType<typeof instalarIA>;
  beforeEach(() => { ia = instalarIA(() => chatOk('Respuesta de la IA falsa')); });
  afterEach(() => { ia.restaurar(); llaveroDeps.fetch = async () => { llamadasIA.push('visión'); return dosShapes(lectura()); }; });

  it('con el módulo responde', async () => {
    const r = await llamar(base, 'POST', '/api/ai-chat', T.prop1, { message: 'Hola, ¿cuánto debo este mes?' });
    assert.equal(r.status, 200, r.texto);
    assert.ok(ia.llamadas.length >= 1);
  });

  it('SIN el módulo: 403 MODULO_NO_ACTIVO con el aviso claro, y la IA no se llama (ni en /stream)', async () => {
    await fijarPlan('gratis');
    const r = await llamar(base, 'POST', '/api/ai-chat', T.prop1, { message: 'Hola, ¿cuánto debo este mes?' });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'MODULO_NO_ACTIVO');
    assert.equal(r.body.modulo, 'asistente');
    assert.match(r.body.error.message, /no tiene el asistente activo/);
    const s = await llamar(base, 'POST', '/api/ai-chat/stream', T.prop1, { message: 'Hola, ¿cuánto debo este mes?' });
    assert.equal(s.status, 403);
    assert.equal(s.body.code, 'MODULO_NO_ACTIVO');
    assert.equal(ia.llamadas.length, 0);
  });

  it('el admin de la empresa también lo pierde, pero el superadmin siempre lo tiene', async () => {
    await fijarPlan('gratis');
    await prisma.suscripcionCondominio.update({ where: { complejo_id: d.complejoA.id }, data: { plan_clave: 'gratis' } });
    assert.equal((await llamar(base, 'POST', '/api/ai-chat', T.adminA, { message: 'Hola, ¿cuánto debo este mes?' })).status, 403);
    // adminA solo tiene el condominio A (Gratis): sin módulo. El superadmin no depende de un condominio.
    assert.equal((await llamar(base, 'POST', '/api/ai-chat', T.super, { message: 'Hola, ¿cuánto debo este mes?' })).status, 200);
  });

  it('basta con UN condominio con el módulo (administradora con varios condominios)', async () => {
    await fijarPlan('gratis');
    const otro = await prisma.complejoHabitacional.create({ data: { nombre: 'Segundo de A', tipo: 'Edificio', empresa_id: d.empresaA.id } });
    await darCortesia(otro.id);
    assert.equal((await llamar(base, 'POST', '/api/ai-chat', T.adminA, { message: 'Hola, ¿cuánto debo este mes?' })).status, 200);
    await prisma.complejoHabitacional.delete({ where: { id: otro.id } });
  });

  it('vencido pasada la gracia: sin asistente; en gracia: con asistente', async () => {
    await fijarPlan('pro', { dias: -4 });
    assert.equal((await llamar(base, 'POST', '/api/ai-chat', T.prop1, { message: 'Hola, ¿cuánto debo este mes?' })).status, 200);
    await fijarPlan('pro', { dias: -20 });
    assert.equal((await llamar(base, 'POST', '/api/ai-chat', T.prop1, { message: 'Hola, ¿cuánto debo este mes?' })).status, 403);
  });
});

describe('módulo «Asistente con IA»: bots de WhatsApp y Telegram', () => {
  let ia: ReturnType<typeof instalarIA>;
  beforeEach(async () => {
    ia = instalarIA(() => chatOk('Respuesta del bot'));
    await prisma.canalVinculado.deleteMany();
    await prisma.canalVinculado.createMany({ data: [
      { usuario_id: d.propietario1.id, canal: 'whatsapp', identificador: '51987654321', empresa_id: d.empresaA.id, verificado_at: new Date(), clave_vigente: 'whatsapp:51987654321', clave_usuario: `${d.propietario1.id}:whatsapp` },
      { usuario_id: d.propietario1.id, canal: 'telegram', identificador: '7001', empresa_id: d.empresaA.id, verificado_at: new Date(), clave_vigente: 'telegram:7001', clave_usuario: `${d.propietario1.id}:telegram` },
    ] });
  });
  afterEach(() => { ia.restaurar(); llaveroDeps.fetch = async () => { llamadasIA.push('visión'); return dosShapes(lectura()); }; });

  const transporte = (canal: 'whatsapp' | 'telegram') => {
    const dicho: string[] = [];
    let descargas = 0;
    const t: Transporte = {
      canal, identificador: canal === 'whatsapp' ? '51987654321' : '7001', empresaId: canal === 'whatsapp' ? d.empresaA.id : null,
      responder: async (x) => { dicho.push(x); },
      descargarMedio: async () => { descargas++; return { datos: PNG() }; },
    };
    return { t, dicho, descargas: () => descargas };
  };
  let n = 0;
  const escribe = (t: Transporte, texto: string) => atenderMensaje(t, { mensajeId: `m${++n}`, texto, medio: null, otro: false });

  for (const canal of ['whatsapp', 'telegram'] as const) {
    it(`${canal}: con el módulo responde con la IA`, async () => {
      const { t, dicho } = transporte(canal);
      await escribe(t, '¿Cuánto debo este mes?');
      assert.ok(dicho.join(' ').includes('Respuesta del bot'), dicho.join('|'));
    });

    it(`${canal}: SIN el módulo responde el aviso claro y no llama a la IA`, async () => {
      await fijarPlan('gratis');
      const { t, dicho } = transporte(canal);
      await escribe(t, '¿Cuánto debo este mes?');
      assert.deepEqual(dicho, [MENSAJE_SIN_ASISTENTE]);
      assert.match(dicho[0], /no tiene el asistente activo/);
      assert.equal(ia.llamadas.length, 0);
    });

    it(`${canal}: sin el módulo tampoco procesa la foto del voucher (ni la descarga)`, async () => {
      await fijarPlan('gratis');
      const { t, dicho, descargas } = transporte(canal);
      await atenderMensaje(t, { mensajeId: `f${++n}`, texto: '', medio: { tipo: 'imagen', mimetype: 'image/png', nombre: null, tamano: 100, fileId: 'f1' }, otro: false });
      assert.deepEqual(dicho, [MENSAJE_SIN_ASISTENTE]);
      assert.equal(descargas(), 0);
    });

    it(`${canal}: sin el módulo sigue funcionando «desvincular»`, async () => {
      await fijarPlan('gratis');
      const { t } = transporte(canal);
      await escribe(t, 'desvincular');
      assert.equal(await prisma.canalVinculado.count({ where: { canal, revocado_at: null } }), 0);
    });
  }
});

describe('cortesía', () => {
  it('cortesía = todos los módulos aunque tuviera una fecha de vencimiento vieja (no vence nunca)', async () => {
    await prisma.suscripcionCondominio.update({ where: { complejo_id: d.complejoA.id }, data: { vigente_hasta: new Date(HOY - 400 * DIA) } });
    invalidarComercial();
    const ia = instalarIA(() => chatOk('Respuesta de la IA falsa'));
    try {
      assert.equal((await llamar(base, 'POST', '/api/ai-chat', T.prop1, { message: 'Hola, ¿cuánto debo este mes?' })).status, 200);
    } finally {
      ia.restaurar();
      llaveroDeps.fetch = async () => { llamadasIA.push('visión'); return dosShapes(lectura()); };
    }
    await pagoConVoucher();
    await esperarEvaluaciones();
    assert.ok(llamadasIA.length >= 1, 'la IA de vouchers también');
  });
});
