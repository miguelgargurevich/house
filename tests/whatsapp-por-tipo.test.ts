import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { encolarAviso, avisarReciboEmitido, planAvisoRecibo, procesarCola } from '../src/server/services/avisos';
import { MOTIVO_APAGADO_WHATSAPP } from '../src/server/services/avisos/cola';
import type { DepsAvisos } from '../src/server/services/avisos/canales';
import { invalidarComercial } from '../src/server/services/comercial/modulos';

// Qué avisos automáticos salen por WhatsApp según la lista de cada condominio (`whatsapp_avisos`): la cola, el número vinculado del bot,
// la vista previa de «Avisar a los vecinos», el envío de un pendiente cuyo tipo se apagó después, y la API que la cambia.
// Nada sale de verdad: `fetch` es un doble y el envío se mide por las llamadas.

const DEFECTO = ['recibo_emitido', 'vence_hoy', 'vencido', 'cierre_pendiente'];
const ENV_OK: NodeJS.ProcessEnv = {
  RESEND_API_KEY: 're_CLAVE-FALSA-NO-REAL',
  MAIL_FROM: 'Casa <avisos@ejemplo.test>',
  EVOLUTION_URL: 'https://evo.ejemplo.test/',
  EVOLUTION_APIKEY: 'evo-CLAVE-FALSA-NO-REAL',
};

let D: Datos;
let base: string;
let cerrar: () => Promise<void>;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1', string>;

/** Canales de las filas creadas para una persona y un tipo (orden estable). */
async function canalesDeFilas(usuario_id: number, tipo: string) {
  const filas = await prisma.notificacion.findMany({ where: { usuario_id, tipo }, select: { canal: true }, orderBy: { canal: 'asc' } });
  return filas.map((f) => f.canal);
}

/** Pone la lista de WhatsApp del condominio A (`null` = la de por defecto que crea la base). */
async function listaA(lista: string[] | null) {
  await prisma.complejoHabitacional.update({ where: { id: D.complejoA.id }, data: { whatsapp_avisos: lista ?? DEFECTO } });
}

/** Deps del envío: el reloj es el de ahora, la espera no duerme, y `fetch` cuenta los WhatsApp sin tocar la red. */
function depsDePrueba(): { deps: DepsAvisos; whatsapp: () => number } {
  let enviados = 0;
  const deps: DepsAvisos = {
    ahora: () => new Date(),
    env: ENV_OK,
    fetch: (async (url: string | URL | Request) => {
      if (String(url).includes('/message/sendText/')) enviados++;
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
    esperar: async () => {},
    azar: () => 0,
  };
  return { deps, whatsapp: () => enviados };
}

before(async () => {
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, ai: 100_000, llavero: 100_000, evaluacion: 100_000 } }));
});

after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

beforeEach(async () => {
  D = await sembrar();
  // `sembrar` vacía las sesiones: cada prueba entra de nuevo.
  T = {
    super: await login(base, 'super@test.pe'),
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    prop1: await login(base, 'prop1@test.pe'),
  };
  // Todos aceptan correo y WhatsApp; prop1, prop2 e inq1 tienen celular. Sin vínculos del bot salvo donde cada prueba los pone.
  await prisma.usuario.updateMany({ data: { aviso_email: true, aviso_whatsapp: true, telefono: null } });
  await prisma.usuario.update({ where: { id: D.propietario1.id }, data: { telefono: '987654321' } });
  await prisma.usuario.update({ where: { id: D.propietario2.id }, data: { telefono: '922222222' } });
  await prisma.usuario.update({ where: { id: D.inquilino1.id }, data: { telefono: '933333333' } });
  await prisma.usuario.update({ where: { id: D.propietarioB.id }, data: { telefono: '966666666' } });
  await listaA(null);
  invalidarComercial();
});

describe('lista por defecto', () => {
  it('un condominio nuevo nace con la lista por defecto (sin el recordatorio de 2 días antes)', async () => {
    const c = await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: D.complejoA.id }, select: { whatsapp_avisos: true } });
    assert.deepEqual([...c.whatsapp_avisos].sort(), [...DEFECTO].sort());
  });

  it('recibo emitido sale por correo y WhatsApp; por_vencer, apagado por defecto, sólo por correo (a quien paga: el inquilino de A-101)', async () => {
    await encolarAviso('recibo_emitido', D.inquilino1.id, { entidad: 'recibo', id: D.reciboVencidoA.id });
    await encolarAviso('por_vencer', D.inquilino1.id, { entidad: 'recibo', id: D.reciboVencidoA.id });
    assert.deepEqual(await canalesDeFilas(D.inquilino1.id, 'recibo_emitido'), ['email', 'whatsapp']);
    assert.deepEqual(await canalesDeFilas(D.inquilino1.id, 'por_vencer'), ['email']);
  });
});

describe('la administración elige la lista', () => {
  it('quitar vence_hoy: no se encola por WhatsApp, el correo sí; encender por_vencer lo hace salir por WhatsApp', async () => {
    await listaA([...DEFECTO.filter((t) => t !== 'vence_hoy'), 'por_vencer']);
    await encolarAviso('vence_hoy', D.inquilino1.id, { entidad: 'recibo', id: D.reciboVencidoA.id });
    await encolarAviso('por_vencer', D.inquilino1.id, { entidad: 'recibo', id: D.reciboVencidoA.id });
    assert.deepEqual(await canalesDeFilas(D.inquilino1.id, 'vence_hoy'), ['email']);
    assert.deepEqual(await canalesDeFilas(D.inquilino1.id, 'por_vencer'), ['email', 'whatsapp']);
  });

  it('un resultado de pago nunca sale por WhatsApp, aunque la lista tenga todos los demás avisos', async () => {
    await listaA(['recibo_emitido', 'por_vencer', 'vence_hoy', 'vencido', 'cierre_pendiente']);
    await encolarAviso('pago_rechazado', D.propietario1.id, { entidad: 'cargo', id: D.cargoVencidoA1.id }, { motivo: 'Voucher ilegible' });
    assert.deepEqual(await canalesDeFilas(D.propietario1.id, 'pago_rechazado'), ['email']);
  });

  it('la lista de un condominio no afecta a otro (B conserva la suya)', async () => {
    await listaA([]);
    await encolarAviso('recibo_emitido', D.propietarioB.id, { entidad: 'recibo', id: D.reciboB.id });
    assert.deepEqual(await canalesDeFilas(D.propietarioB.id, 'recibo_emitido'), ['email', 'whatsapp'], 'el condominio B sigue con la lista por defecto');
  });
});

describe('número vinculado del bot', () => {
  // inq1 no acepta WhatsApp ni tiene celular: sólo su número vinculado puede recibir el resultado del voucher. Su correo sí sale.
  const vincularInq1 = async () => {
    await prisma.usuario.update({ where: { id: D.inquilino1.id }, data: { aviso_whatsapp: false, telefono: null } });
    await prisma.canalVinculado.create({ data: { usuario_id: D.inquilino1.id, canal: 'whatsapp', identificador: '944444444', empresa_id: D.empresaA.id, verificado_at: new Date() } });
  };

  it('el rechazo del voucher NO llega al número vinculado: sólo correo, aunque la lista tenga todo', async () => {
    await vincularInq1();
    await listaA(['recibo_emitido', 'por_vencer', 'vence_hoy', 'vencido', 'cierre_pendiente']);
    await encolarAviso('pago_rechazado', D.inquilino1.id, { entidad: 'cargo', id: D.cargoVencidoA1.id }, { motivo: 'Voucher ilegible' });
    assert.deepEqual(await canalesDeFilas(D.inquilino1.id, 'pago_rechazado'), ['email']);
  });

  it('la validación no se encola a nadie, ni al número vinculado', async () => {
    await vincularInq1();
    assert.equal(await encolarAviso('pago_validado', D.inquilino1.id, { entidad: 'cargo', id: D.cargoVencidoA1.id }), 0);
    assert.deepEqual(await canalesDeFilas(D.inquilino1.id, 'pago_validado'), []);
  });
});

describe('lo que la lista no controla', () => {
  it('un comunicado con WhatsApp sale aunque la lista esté vacía', async () => {
    await listaA([]);
    const c = await prisma.comunicado.create({ data: { complejo_id: D.complejoA.id, titulo: 'Corte de agua', cuerpo: 'Mañana no habrá agua.', autor_id: D.adminA.id } });
    await encolarAviso('comunicado', D.propietario1.id, { entidad: 'comunicado', id: c.id }, { canales: ['whatsapp'] });
    assert.deepEqual(await canalesDeFilas(D.propietario1.id, 'comunicado'), ['whatsapp']);
  });

  it('un aviso de la plataforma (IA) no se rige por la lista', async () => {
    await listaA([]);
    await encolarAviso('ia_caida', D.propietario1.id, { entidad: 'ia', id: 1 }, { motivo: 'Prueba de caída' });
    assert.deepEqual(await canalesDeFilas(D.propietario1.id, 'ia_caida'), ['email', 'whatsapp']);
  });
});

describe('la vista previa de «Avisar a los vecinos» cuenta lo mismo que el envío', () => {
  it('con recibo_emitido apagado, la vista previa cuenta cero WhatsApp y el envío sólo encola correo', async () => {
    await listaA(DEFECTO.filter((t) => t !== 'recibo_emitido'));
    const antes = await planAvisoRecibo(D.reciboVencidoA.id);
    assert.equal(antes.por_whatsapp, 0);
    assert.ok(antes.por_correo > 0);
    await avisarReciboEmitido(D.reciboVencidoA.id);
    const filas = await prisma.notificacion.findMany({ where: { tipo: 'recibo_emitido', ref_id: D.reciboVencidoA.id }, select: { canal: true } });
    assert.ok(filas.length > 0);
    assert.ok(filas.every((f) => f.canal === 'email'), 'ningún recibo emitido por WhatsApp');
  });

  it('con la lista por defecto, la vista previa cuenta WhatsApp para quien tiene celular', async () => {
    const plan = await planAvisoRecibo(D.reciboVencidoA.id);
    assert.ok(plan.por_whatsapp > 0);
    assert.equal(plan.por_whatsapp, plan.por_correo, 'todos tienen correo y celular aquí');
  });

  it('la ruta de la vista previa devuelve el mismo conteo', async () => {
    await listaA(DEFECTO.filter((t) => t !== 'recibo_emitido'));
    const r = await llamar(base, 'GET', `/api/recibos/${D.reciboVencidoA.id}/avisar`, T.adminA);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.por_whatsapp, 0);
  });
});

describe('pendiente que se encoló antes de apagar su tipo', () => {
  it('un WhatsApp pendiente de un tipo apagado no sale: queda omitido con su motivo, sin llamada a la API', async () => {
    await prisma.notificacion.create({
      data: { usuario_id: D.propietario1.id, canal: 'whatsapp', tipo: 'vence_hoy', asunto: 'Vence hoy', cuerpo: 'Tu recibo vence hoy.', estado: 'pendiente', programada_para: new Date(Date.now() - 60_000), ref_entidad: 'recibo', ref_id: D.reciboVencidoA.id },
    });
    await listaA(DEFECTO.filter((t) => t !== 'vence_hoy'));
    const { deps, whatsapp } = depsDePrueba();
    await procesarCola(deps);
    const fila = await prisma.notificacion.findFirstOrThrow({ where: { usuario_id: D.propietario1.id, canal: 'whatsapp', tipo: 'vence_hoy' } });
    assert.equal(fila.estado, 'omitida');
    assert.equal(fila.error, MOTIVO_APAGADO_WHATSAPP);
    assert.equal(whatsapp(), 0, 'no salió ningún WhatsApp');
  });
});

describe('API: PATCH /api/complejos/:id { whatsapp_avisos }', () => {
  const ruta = () => `/api/complejos/${D.complejoA.id}`;

  it('el admin del condominio guarda una lista válida y la devuelve', async () => {
    const r = await llamar(base, 'PATCH', ruta(), T.adminA, { whatsapp_avisos: ['vence_hoy', 'por_vencer'] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.whatsapp_avisos, ['vence_hoy', 'por_vencer']);
    const guardada = await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: D.complejoA.id }, select: { whatsapp_avisos: true } });
    assert.deepEqual(guardada.whatsapp_avisos, ['vence_hoy', 'por_vencer']);
  });

  it('lista vacía = ningún aviso automático por WhatsApp (válido)', async () => {
    const r = await llamar(base, 'PATCH', ruta(), T.adminA, { whatsapp_avisos: [] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.whatsapp_avisos, []);
  });

  it('rechaza tipos que no se configuran (resultados de pago, IA, comunicado, uno inventado), repetidos y un valor que no es lista → 422', async () => {
    for (const malo of [['pago_validado'], ['pago_rechazado'], ['ia_caida'], ['comunicado'], ['tipo_inventado'], ['vence_hoy', 'vence_hoy'], 'vence_hoy']) {
      const r = await llamar(base, 'PATCH', ruta(), T.adminA, { whatsapp_avisos: malo });
      assert.equal(r.status, 422, JSON.stringify(malo) + ' → ' + JSON.stringify(r.body));
    }
    const guardada = await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: D.complejoA.id }, select: { whatsapp_avisos: true } });
    assert.deepEqual([...guardada.whatsapp_avisos].sort(), [...DEFECTO].sort(), 'nada cambió tras los rechazos');
  });

  it('la junta (propietario) no la cambia → 403', async () => {
    const r = await llamar(base, 'PATCH', ruta(), T.prop1, { whatsapp_avisos: [] });
    assert.equal(r.status, 403);
  });

  it('otra administradora no la alcanza → 404', async () => {
    const r = await llamar(base, 'PATCH', ruta(), T.adminB, { whatsapp_avisos: [] });
    assert.equal(r.status, 404);
  });

  it('el superadmin sí la cambia', async () => {
    const r = await llamar(base, 'PATCH', ruta(), T.super, { whatsapp_avisos: ['recibo_emitido'] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  it('la ficha dice si el plan trae WhatsApp (cortesía sí; sin el módulo, no)', async () => {
    const con = await llamar(base, 'GET', ruta(), T.adminA);
    assert.equal(con.body.whatsapp_plan, true);
    // Torre Básico no incluye WhatsApp: la ficha lo debe decir (no se puede usar), aunque la lista quede guardada.
    await prisma.suscripcionCondominio.update({ where: { complejo_id: D.complejoA.id }, data: { plan_clave: 'basico', modulos: [] } });
    invalidarComercial();
    const sin = await llamar(base, 'GET', ruta(), T.adminA);
    assert.equal(sin.body.whatsapp_plan, false);
    const cambio = await llamar(base, 'PATCH', ruta(), T.adminA, { whatsapp_avisos: ['recibo_emitido'] });
    assert.equal(cambio.status, 200, 'la lista se guarda aunque el plan no la use todavía');
    await prisma.suscripcionCondominio.update({ where: { complejo_id: D.complejoA.id }, data: { plan_clave: 'cortesia', modulos: ['ia_vouchers', 'whatsapp_avisos', 'asistente'] } });
    invalidarComercial();
  });
});
