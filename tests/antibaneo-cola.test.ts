import './helpers/env';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { prisma, sembrar, type Datos } from './helpers/app';
import { procesarCola, type DepsAvisos } from '../src/server/services/avisos';
import { obtenerConfiguracion } from '../src/server/services/comercial/configuracion';

// Medidas anti-baneo de WhatsApp en la cola: pausa al azar entre envíos de la misma instancia, tope diario por número,
// tope de tiempo por pasada y pie para responder SALIR. Todo con reloj y espera inyectados: ninguna prueba duerme de verdad.

const MIN = 60_000;
const DIA = 86_400_000;
const PIE = '\n\nSi no quieres recibir estos avisos por WhatsApp, responde SALIR.';
const AHORA = new Date('2026-11-02T15:00:00Z'); // 10:00 en Lima
const INST_A = 'instancia-antibaneo-a';
const INST_B = 'instancia-antibaneo-b';
const NUM = { prop1: '987654321', prop2: '922222222', inq1: '933333333', mtto: '955555555', propB: '966666666' };
const ENV_OK: NodeJS.ProcessEnv = {
  RESEND_API_KEY: 're_CLAVE-FALSA-NO-REAL',
  MAIL_FROM: 'Casa <avisos@ejemplo.test>',
  EVOLUTION_URL: 'https://evo.ejemplo.test/',
  EVOLUTION_APIKEY: 'evo-CLAVE-FALSA-NO-REAL',
};

let D: Datos;
let reloj = AHORA.getTime();

interface Llamada { url: string; init: RequestInit }

/**
 * Dependencias de prueba: el reloj avanza con cada espera (`esperarMs` por espera, por defecto lo que se pidió),
 * el azar lo da `azar`, y `fetch` nunca sale a la red. `esperas` guarda cada pausa pedida.
 */
function depsDePrueba(opts: { azar?: () => number; esperarMs?: number; env?: NodeJS.ProcessEnv } = {}) {
  const llamadas: Llamada[] = [];
  const esperas: number[] = [];
  const deps: DepsAvisos = {
    ahora: () => new Date(reloj),
    env: opts.env ?? ENV_OK,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      llamadas.push({ url: String(url), init: init ?? {} });
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
    esperar: async (ms: number) => {
      esperas.push(ms);
      reloj += opts.esperarMs ?? ms;
    },
    azar: opts.azar ?? (() => 0),
  };
  return { deps, llamadas, esperas };
}

const waLlamadas = (llamadas: Llamada[]) => llamadas.filter((l) => l.url.includes('/message/sendText/'));
const textoWa = (l: Llamada) => JSON.parse(String(l.init.body)).text as string;

/** Una notificación de la cola (`pendiente` por defecto, programada justo antes del reloj de la prueba). */
const notif = (usuario_id: number, canal: 'email' | 'whatsapp', extra: { ref_id?: number; tipo?: string; estado?: string; enviada_at?: Date; whatsapp_instancia?: string | null; cuerpo?: string; programada_para?: Date } = {}) =>
  prisma.notificacion.create({
    data: {
      usuario_id,
      canal,
      tipo: extra.tipo ?? 'recibo_emitido',
      asunto: 'Asunto de prueba',
      cuerpo: extra.cuerpo ?? 'Cuerpo de prueba',
      ref_entidad: 'recibo',
      ref_id: extra.ref_id ?? D.reciboVencidoA.id,
      estado: extra.estado ?? 'pendiente',
      programada_para: extra.programada_para ?? new Date(reloj - MIN),
      enviada_at: extra.enviada_at,
      whatsapp_instancia: extra.whatsapp_instancia ?? null,
    },
  });

/** Avisos ya enviados por una instancia (para llenar el tope del día). Usa recibos y personas distintas a las de cada prueba. */
async function yaEnviados(instancia: string, cuantos: number, enviada_at: Date) {
  const personas = [D.adminB.id, D.seguridadA.id, D.mantenimientoA2.id, D.adminSinEmpresa.id, D.propietarioB.id, D.adminA.id];
  for (let i = 0; i < cuantos; i++) {
    await notif(personas[i]!, 'whatsapp', { ref_id: D.reciboFuturoA.id, estado: 'enviada', enviada_at, whatsapp_instancia: instancia, programada_para: enviada_at });
  }
}

const pendiente = (id: number) => prisma.notificacion.findUniqueOrThrow({ where: { id } });

/** Pone la configuración del tope y la pausa (sólo los campos dados). */
async function configurar(c: { whatsapp_tope_diario?: number | null; whatsapp_pausa_min_seg?: number; whatsapp_pausa_max_seg?: number }) {
  const cfg = await obtenerConfiguracion();
  await prisma.configuracionComercial.update({ where: { id: cfg.id }, data: c });
}

after(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  D = await sembrar();
  reloj = AHORA.getTime();
  await prisma.usuario.updateMany({ data: { aviso_email: true, aviso_whatsapp: false, telefono: null } });
  await prisma.usuario.update({ where: { id: D.propietario1.id }, data: { telefono: NUM.prop1 } });
  await prisma.usuario.update({ where: { id: D.propietario2.id }, data: { telefono: NUM.prop2 } });
  await prisma.usuario.update({ where: { id: D.inquilino1.id }, data: { telefono: NUM.inq1 } });
  await prisma.usuario.update({ where: { id: D.mantenimientoA.id }, data: { telefono: NUM.mtto } });
  await prisma.usuario.update({ where: { id: D.propietarioB.id }, data: { telefono: NUM.propB } });
  await prisma.empresaAdministradora.update({ where: { id: D.empresaA.id }, data: { whatsapp_instance: INST_A, whatsapp_token: 'token-de-prueba' } });
  await prisma.empresaAdministradora.update({ where: { id: D.empresaB.id }, data: { whatsapp_instance: INST_B, whatsapp_token: 'token-de-prueba' } });
  await configurar({ whatsapp_tope_diario: 200, whatsapp_pausa_min_seg: 5, whatsapp_pausa_max_seg: 15 });
  // Estas pruebas encolan recibos por WhatsApp directo: la lista de antes del cambio (el recibo sale directo si el condominio lo enciende).
  await prisma.complejoHabitacional.updateMany({ data: { whatsapp_avisos: ['recibo_emitido', 'vence_hoy', 'vencido', 'cierre_pendiente'] } });
});

describe('pausa al azar entre WhatsApp de la misma instancia', () => {
  it('entre dos WhatsApp seguidos de la misma instancia espera un tiempo dentro de [min, max] (azar en el medio)', async () => {
    await notif(D.propietario1.id, 'whatsapp');
    await notif(D.propietario2.id, 'whatsapp');
    await notif(D.inquilino1.id, 'whatsapp');
    const valores = [0, 0.999, 0.5];
    let i = 0;
    const { deps, llamadas, esperas } = depsDePrueba({ azar: () => valores[i++ % valores.length]! });
    const r = await procesarCola(deps);
    assert.equal(r.enviadas, 3);
    assert.equal(waLlamadas(llamadas).length, 3);
    assert.equal(esperas.length, 2, 'una pausa entre cada par de la misma instancia');
    assert.equal(esperas[0], 5_000, 'azar 0 → el mínimo (5 s)');
    assert.ok(esperas[1]! >= 5_000 && esperas[1]! <= 15_000, `fuera de rango: ${esperas[1]}`);
    assert.equal(esperas[1], 14_990, 'azar 0,999 → casi el máximo');
  });

  it('la pausa usa la configuración de la base (min/max), no valores fijos', async () => {
    await configurar({ whatsapp_pausa_min_seg: 20, whatsapp_pausa_max_seg: 20 });
    await notif(D.propietario1.id, 'whatsapp');
    await notif(D.propietario2.id, 'whatsapp');
    const { deps, esperas } = depsDePrueba({ azar: () => 0.7 });
    await procesarCola(deps);
    assert.deepEqual(esperas, [20_000]);
  });

  it('el primer WhatsApp de cada instancia no espera; la espera es sólo entre envíos de la MISMA instancia', async () => {
    // Orden de envío: A, B, A → una sola pausa, antes del segundo A.
    await notif(D.propietario1.id, 'whatsapp');
    await notif(D.propietarioB.id, 'whatsapp', { ref_id: D.reciboB.id });
    await notif(D.propietario2.id, 'whatsapp');
    const { deps, llamadas, esperas } = depsDePrueba();
    const r = await procesarCola(deps);
    assert.equal(r.enviadas, 3);
    assert.equal(esperas.length, 1);
    const urls = waLlamadas(llamadas).map((l) => l.url);
    assert.deepEqual(urls.map((u) => u.split('/').pop()), [INST_A, INST_B, INST_A]);
  });

  it('una sola instancia con un solo WhatsApp: ninguna pausa', async () => {
    await notif(D.propietario1.id, 'whatsapp');
    const { deps, esperas } = depsDePrueba();
    await procesarCola(deps);
    assert.deepEqual(esperas, []);
  });

  it('el correo no espera ni cuenta para la pausa', async () => {
    await notif(D.propietario1.id, 'email');
    await notif(D.propietario2.id, 'email');
    await notif(D.inquilino1.id, 'email');
    await notif(D.mantenimientoA.id, 'email');
    await notif(D.propietario1.id, 'whatsapp', { ref_id: D.reciboFuturoA.id });
    const { deps, esperas } = depsDePrueba();
    const r = await procesarCola(deps);
    assert.equal(r.enviadas, 5);
    assert.deepEqual(esperas, [], 'correos y un solo WhatsApp: sin pausa');
  });

  it('un WhatsApp que no sale (sin instancia, plan sin WhatsApp…) no provoca pausa', async () => {
    await prisma.empresaAdministradora.update({ where: { id: D.empresaA.id }, data: { whatsapp_instance: null } });
    await notif(D.propietario1.id, 'whatsapp');
    await notif(D.propietario2.id, 'whatsapp');
    const { deps, esperas, llamadas } = depsDePrueba();
    await procesarCola(deps);
    assert.equal(waLlamadas(llamadas).length, 0);
    assert.deepEqual(esperas, []);
  });
});

describe('tope diario por número (instancia)', () => {
  it('al llegar al tope del día, el WhatsApp siguiente queda pendiente para mañana a las 08:00 de Lima, sin intento ni omisión', async () => {
    await configurar({ whatsapp_tope_diario: 2 });
    await yaEnviados(INST_A, 2, new Date(reloj - 60 * MIN));
    const n = await notif(D.propietario1.id, 'whatsapp');
    const { deps, llamadas } = depsDePrueba();
    const r = await procesarCola(deps);
    assert.equal(waLlamadas(llamadas).length, 0, 'no sale');
    assert.deepEqual(r, { enviadas: 0, omitidas: 0, fallos: 0, errores: 0 }, 'ni enviada ni omitida');
    const f = await pendiente(n.id);
    assert.equal(f.estado, 'pendiente');
    assert.equal(f.intentos, 0, 'no cuenta como intento');
    assert.equal(f.error, null);
    // 10:00 del 2-nov en Lima → 08:00 del 3-nov en Lima (UTC−5, sin horario de verano) = 13:00 UTC.
    assert.equal(f.programada_para.toISOString(), '2026-11-03T13:00:00.000Z');
  });

  it('el tope cuenta por instancia: llena A no frena a B', async () => {
    await configurar({ whatsapp_tope_diario: 1 });
    await yaEnviados(INST_A, 1, new Date(reloj - 60 * MIN));
    const a = await notif(D.propietario1.id, 'whatsapp');
    const b = await notif(D.propietarioB.id, 'whatsapp', { ref_id: D.reciboB.id });
    const { deps, llamadas } = depsDePrueba();
    await procesarCola(deps);
    assert.equal(waLlamadas(llamadas).length, 1);
    assert.equal(waLlamadas(llamadas)[0]!.url.split('/').pop(), INST_B);
    assert.equal((await pendiente(a.id)).estado, 'pendiente');
    assert.equal((await pendiente(b.id)).estado, 'enviada');
  });

  it('los envíos de AYER no cuentan para hoy', async () => {
    await configurar({ whatsapp_tope_diario: 1 });
    await yaEnviados(INST_A, 3, new Date(reloj - DIA - 2 * 60 * MIN));
    const n = await notif(D.propietario1.id, 'whatsapp');
    const { deps, llamadas } = depsDePrueba();
    await procesarCola(deps);
    assert.equal(waLlamadas(llamadas).length, 1);
    assert.equal((await pendiente(n.id)).estado, 'enviada');
  });

  it('el día es el de Lima, no el de UTC: un envío a las 23:30 de Lima (04:30 UTC del día siguiente) es de AYER', async () => {
    reloj = Date.parse('2026-11-02T06:00:00Z'); // 01:00 del 2-nov en Lima
    await configurar({ whatsapp_tope_diario: 1 });
    await yaEnviados(INST_A, 1, new Date('2026-11-02T04:30:00Z')); // 23:30 del 1-nov en Lima
    const n = await notif(D.propietario1.id, 'whatsapp');
    const { deps, llamadas } = depsDePrueba();
    await procesarCola(deps);
    assert.equal(waLlamadas(llamadas).length, 1, 'con el día de UTC este envío contaría y frenaría el aviso');
    assert.equal((await pendiente(n.id)).estado, 'enviada');
  });

  it('el día es el de Lima: un envío a las 00:10 de Lima del 2-nov SÍ cuenta para hoy', async () => {
    reloj = Date.parse('2026-11-02T06:00:00Z'); // 01:00 del 2-nov en Lima
    await configurar({ whatsapp_tope_diario: 1 });
    await yaEnviados(INST_A, 1, new Date('2026-11-02T05:10:00Z')); // 00:10 del 2-nov en Lima
    const n = await notif(D.propietario1.id, 'whatsapp');
    const { deps, llamadas } = depsDePrueba();
    await procesarCola(deps);
    assert.equal(waLlamadas(llamadas).length, 0);
    assert.equal((await pendiente(n.id)).estado, 'pendiente');
  });

  it('tope 0 o vacío = sin tope', async () => {
    for (const tope of [0, null]) {
      await prisma.notificacion.deleteMany();
      await configurar({ whatsapp_tope_diario: tope });
      await yaEnviados(INST_A, 5, new Date(reloj - 60 * MIN));
      await notif(D.propietario1.id, 'whatsapp');
      await notif(D.propietario2.id, 'whatsapp');
      const { deps, llamadas } = depsDePrueba();
      await procesarCola(deps);
      assert.equal(waLlamadas(llamadas).length, 2, `tope ${tope}`);
    }
  });

  it('el envío guarda la instancia por la que salió (para contar el tope después)', async () => {
    const n = await notif(D.propietario1.id, 'whatsapp');
    await procesarCola(depsDePrueba().deps);
    const f = await pendiente(n.id);
    assert.equal(f.estado, 'enviada');
    assert.equal(f.whatsapp_instancia, INST_A);
  });
});

describe('tope de tiempo por pasada', () => {
  it('si la pasada lleva más de 10 min, los WhatsApp que faltan quedan pendientes sin intento; el correo sigue saliendo', async () => {
    await configurar({ whatsapp_pausa_min_seg: 5, whatsapp_pausa_max_seg: 5 });
    const w1 = await notif(D.propietario1.id, 'whatsapp');
    const w2 = await notif(D.propietario2.id, 'whatsapp');
    const w3 = await notif(D.inquilino1.id, 'whatsapp');
    const w4 = await notif(D.mantenimientoA.id, 'whatsapp');
    // Cada pausa «tarda» 6 min: el 1.º sale a los 0 min, el 2.º a los 6, el 3.º a los 12 (ya pasado el mínimo al mirar el 4.º).
    const { deps, llamadas } = depsDePrueba({ esperarMs: 6 * MIN });
    // El correo va después de los WhatsApp (id más alto): debe salir aunque la pasada ya haya cortado.
    const correo = await notif(D.propietario1.id, 'email', { ref_id: D.reciboFuturoA.id });
    const r = await procesarCola(deps);
    assert.equal(waLlamadas(llamadas).length, 3, 'sólo tres WhatsApp dentro de los 10 min');
    assert.equal(r.enviadas, 4, 'tres WhatsApp y el correo');
    assert.equal((await pendiente(correo.id)).estado, 'enviada');
    const dejado = await pendiente(w4.id);
    assert.equal(dejado.estado, 'pendiente');
    assert.equal(dejado.intentos, 0, 'no cuenta como intento');
    assert.equal(dejado.error, null);
    assert.equal(dejado.programada_para.getTime(), w4.programada_para.getTime(), 'sigue vencido: la siguiente pasada lo toma');
    assert.equal((await pendiente(w1.id)).estado, 'enviada');
    assert.equal((await pendiente(w2.id)).estado, 'enviada');
    assert.equal((await pendiente(w3.id)).estado, 'enviada');
  });

  it('una pasada corta no corta nada', async () => {
    await notif(D.propietario1.id, 'whatsapp');
    await notif(D.propietario2.id, 'whatsapp');
    await notif(D.inquilino1.id, 'whatsapp');
    const { deps, llamadas } = depsDePrueba({ esperarMs: 2 * MIN });
    await procesarCola(deps);
    assert.equal(waLlamadas(llamadas).length, 3);
  });
});

describe('pie para responder SALIR', () => {
  it('el WhatsApp de aviso lleva el pie al final; el correo no; lo guardado en la notificación queda sin pie', async () => {
    const w = await notif(D.propietario1.id, 'whatsapp', { cuerpo: 'Tu recibo ya está.' });
    const c = await notif(D.propietario1.id, 'email', { cuerpo: 'Tu recibo ya está.' });
    const { deps, llamadas } = depsDePrueba();
    await procesarCola(deps);
    const wa = waLlamadas(llamadas);
    assert.equal(wa.length, 1);
    assert.equal(textoWa(wa[0]!), `Tu recibo ya está.${PIE}`);
    const correo = llamadas.find((l) => l.url.includes('resend'))!;
    assert.equal(JSON.parse(String(correo.init.body)).text, 'Tu recibo ya está.', 'el correo no lleva el pie');
    assert.equal((await pendiente(w.id)).cuerpo, 'Tu recibo ya está.');
    assert.equal((await pendiente(c.id)).cuerpo, 'Tu recibo ya está.');
  });

  it('el pie no pasa del límite de mensaje: se recorta el cuerpo, pero el pie siempre va', async () => {
    const largo = 'a'.repeat(3990);
    await notif(D.propietario1.id, 'whatsapp', { cuerpo: largo });
    const { deps, llamadas } = depsDePrueba();
    await procesarCola(deps);
    const texto = textoWa(waLlamadas(llamadas)[0]!);
    assert.ok(texto.length <= 4000, `mide ${texto.length}`);
    assert.ok(texto.endsWith(PIE));
    assert.ok(texto.startsWith('aaa'));
  });
});
