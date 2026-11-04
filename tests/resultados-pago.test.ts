import './helpers/env';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { prisma, sembrar, type Datos } from './helpers/app';
import { encolarAviso, procesarCola } from '../src/server/services/avisos';
import { MOTIVO_SOLO_CORREO } from '../src/server/services/avisos/cola';
import type { DepsAvisos } from '../src/server/services/avisos/canales';
import { avisarResultado } from '../src/server/services/validacionPago';

// Resultado de un voucher: un pago VALIDADO no avisa (el vecino lo ve en «Mis recibos»); un RECHAZADO sale sólo por correo, a quien lo registró
// o, si no hay, a quien paga la unidad. Nunca por WhatsApp, ni por Telegram, ni al número vinculado del bot.

const ENV_OK: NodeJS.ProcessEnv = { RESEND_API_KEY: 're_CLAVE-FALSA-NO-REAL', MAIL_FROM: 'Casa <avisos@ejemplo.test>', EVOLUTION_URL: 'https://evo.ejemplo.test/', EVOLUTION_APIKEY: 'evo-CLAVE-FALSA-NO-REAL' };
let D: Datos;

/** Un pago por validar del cargo indicado; `usuarioId` es quien lo registró (null = nadie). */
const pagoEn = (cargoId: number, usuarioId: number | null) =>
  prisma.pago.create({ data: { recibo_concepto_unidad_id: cargoId, monto: 150, usuario_id: usuarioId, estado_validacion: 'por_validar' } });

/** Filas de aviso de un pago: persona, canal y tipo. */
const filasDelPago = (pagoId: number) =>
  prisma.notificacion.findMany({ where: { ref_entidad: 'pago', ref_id: pagoId }, select: { usuario_id: true, canal: true, tipo: true }, orderBy: [{ usuario_id: 'asc' }, { canal: 'asc' }] });

/** Deps de la cola: el correo y Evolution se miden con un `fetch` falso; nada sale de verdad. */
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

beforeEach(async () => {
  D = await sembrar();
  await prisma.usuario.updateMany({ data: { aviso_email: true, aviso_whatsapp: true, telefono: null } });
  await prisma.usuario.update({ where: { id: D.inquilino1.id }, data: { telefono: '933333333' } });
  await prisma.usuario.update({ where: { id: D.propietario1.id }, data: { telefono: '987654321' } });
  // El inquilino de A-101 tiene WhatsApp y Telegram vinculados (verificados): ni así le llega un rechazo por esos canales.
  await prisma.canalVinculado.create({ data: { usuario_id: D.inquilino1.id, canal: 'whatsapp', identificador: '944444444', empresa_id: D.empresaA.id, verificado_at: new Date(), clave_vigente: 'whatsapp:944444444', clave_usuario: `${D.inquilino1.id}:whatsapp` } });
  await prisma.canalVinculado.create({ data: { usuario_id: D.inquilino1.id, canal: 'telegram', identificador: '55555', empresa_id: D.empresaA.id, verificado_at: new Date(), clave_vigente: 'telegram:55555', clave_usuario: `${D.inquilino1.id}:telegram` } });
});

after(async () => {
  await prisma.$disconnect();
});

describe('pago validado', () => {
  it('no crea ningún aviso, aunque la persona tenga correo, WhatsApp y Telegram', async () => {
    const pago = await pagoEn(D.cargoVencidoA1.id, D.inquilino1.id);
    await avisarResultado(pago.id, 'validado');
    assert.deepEqual(await filasDelPago(pago.id), []);
    assert.equal(await encolarAviso('pago_validado', D.inquilino1.id, { entidad: 'pago', id: pago.id }), 0, 'ni a mano se encola');
  });
});

describe('pago rechazado', () => {
  it('sale sólo por correo, a quien lo registró: ni WhatsApp, ni Telegram, ni al número vinculado', async () => {
    const pago = await pagoEn(D.cargoVencidoA1.id, D.inquilino1.id);
    await avisarResultado(pago.id, 'rechazado', 'Voucher ilegible');
    assert.deepEqual(await filasDelPago(pago.id), [{ usuario_id: D.inquilino1.id, canal: 'email', tipo: 'pago_rechazado' }]);
  });

  it('sin quien lo registró, va a quien paga la unidad: el inquilino, y si no hay inquilino, el propietario', async () => {
    const enA101 = await pagoEn(D.cargoVencidoA1.id, null); // A-101 tiene inquilino
    const enA102 = await pagoEn(D.cargoA2.id, null); // A-102 no tiene inquilino
    await avisarResultado(enA101.id, 'rechazado', 'x');
    await avisarResultado(enA102.id, 'rechazado', 'x');
    assert.deepEqual((await filasDelPago(enA101.id)).map((f) => [f.usuario_id, f.canal]), [[D.inquilino1.id, 'email']]);
    assert.deepEqual((await filasDelPago(enA102.id)).map((f) => [f.usuario_id, f.canal]), [[D.propietario2.id, 'email']]);
  });

  it('un WhatsApp o Telegram de un resultado de pago que quedó pendiente de antes no sale: queda omitido con su motivo', async () => {
    const pago = await pagoEn(D.cargoVencidoA1.id, D.inquilino1.id);
    const viejo = { usuario_id: D.inquilino1.id, tipo: 'pago_rechazado', asunto: 'Pago rechazado', cuerpo: 'Tu pago fue rechazado.', estado: 'pendiente', programada_para: new Date(Date.now() - 60_000), ref_entidad: 'pago', ref_id: pago.id };
    await prisma.notificacion.createMany({ data: [{ ...viejo, canal: 'whatsapp' }, { ...viejo, canal: 'telegram' }] });
    const { deps, whatsapp } = depsDePrueba();
    await procesarCola(deps);
    const filas = await prisma.notificacion.findMany({ where: { ref_entidad: 'pago', ref_id: pago.id, canal: { in: ['whatsapp', 'telegram'] } }, select: { canal: true, estado: true, error: true }, orderBy: { canal: 'asc' } });
    assert.deepEqual(filas, [
      { canal: 'telegram', estado: 'omitida', error: MOTIVO_SOLO_CORREO },
      { canal: 'whatsapp', estado: 'omitida', error: MOTIVO_SOLO_CORREO },
    ]);
    assert.equal(whatsapp(), 0, 'no salió ningún WhatsApp');
  });
});
