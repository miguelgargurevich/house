import assert from 'node:assert/strict';
import { verify } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';
import { leerCuentaDeServicio } from '../src/server/services/push/config';
import { clasificarErrorFcm, cuerpoFcm, enviarFcm, olvidarAccesosFcm } from '../src/server/services/push/fcm';
import { cuentaDeServicioFalsa, depsFalsas, tokenFcmFalso, type Llamada } from './helpers/push';

const AHORA = new Date('2026-11-17T15:00:00Z');
const MSG = { titulo: 'Tu recibo de octubre de 2026 ya está', cuerpo: 'Vence el lunes 2 de noviembre.', ruta: '/propietario/cargos' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => olvidarAccesosFcm());

function armar(extraCuenta: Record<string, unknown> = {}) {
  const f = cuentaDeServicioFalsa(extraCuenta);
  const cuenta = leerCuentaDeServicio(f.json)!;
  return { f, cfg: { proyecto: 'torre-prueba', cuenta } };
}
const esToken = (l: Llamada) => l.url.includes('oauth2');
const errorFcm = (status: number, estado: string, codigo?: string, mensaje = 'x') =>
  json({ error: { code: status, status: estado, message: mensaje, ...(codigo ? { details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: codigo }] } : {}) } }, status);

describe('push: FCM HTTP v1', () => {
  it('firma un JWT RS256 con la cuenta de servicio, pide el token de acceso y manda el mensaje', async () => {
    const { f, cfg } = armar();
    const token = tokenFcmFalso();
    const { deps, llamadas } = depsFalsas(AHORA, {}, (l) => (esToken(l) ? json({ access_token: 'ACCESO-FALSO', expires_in: 3600 }) : json({ name: 'projects/x/messages/1' })));
    const r = await enviarFcm(deps, cfg, token, MSG);
    assert.deepEqual(r, { resultado: 'enviado' });
    assert.equal(llamadas.length, 2);

    // 1) el intercambio del token: jwt-bearer con una aserción RS256 que se verifica con la llave PÚBLICA de la cuenta
    const [pedidoToken, pedidoEnvio] = llamadas;
    assert.equal(pedidoToken!.url, 'https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(String(pedidoToken!.init.body));
    assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [cab, rec, firma] = form.get('assertion')!.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(cab!, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
    const reclamos = JSON.parse(Buffer.from(rec!, 'base64url').toString());
    assert.equal(reclamos.iss, f.correo);
    assert.equal(reclamos.scope, 'https://www.googleapis.com/auth/firebase.messaging');
    assert.equal(reclamos.aud, 'https://oauth2.googleapis.com/token');
    assert.equal(reclamos.iat, Math.floor(AHORA.getTime() / 1000));
    assert.equal(reclamos.exp, reclamos.iat + 3600);
    assert.equal(verify('RSA-SHA256', Buffer.from(`${cab}.${rec}`), f.publica, Buffer.from(firma!, 'base64url')), true, 'la firma debe verificar con la llave pública');

    // 2) el envío: proyecto en la URL, Bearer del token de acceso, token del teléfono y ruta en `data`
    assert.equal(pedidoEnvio!.url, 'https://fcm.googleapis.com/v1/projects/torre-prueba/messages:send');
    assert.equal((pedidoEnvio!.init.headers as Record<string, string>).authorization, 'Bearer ACCESO-FALSO');
    const cuerpo = JSON.parse(String(pedidoEnvio!.init.body));
    assert.equal(cuerpo.message.token, token);
    assert.deepEqual(cuerpo.message.notification, { title: MSG.titulo, body: MSG.cuerpo });
    assert.deepEqual(cuerpo.message.data, { ruta: '/propietario/cargos' });
  });

  it('guarda el token de acceso hasta un minuto antes de que venza', async () => {
    const { cfg } = armar();
    const { deps, llamadas } = depsFalsas(AHORA, {}, (l) => (esToken(l) ? json({ access_token: 'A', expires_in: 3600 }) : json({})));
    await enviarFcm(deps, cfg, tokenFcmFalso(), MSG);
    await enviarFcm(deps, cfg, tokenFcmFalso(), MSG);
    assert.equal(llamadas.filter(esToken).length, 1, 'el segundo envío reutiliza el token de acceso');
    const despues = depsFalsas(new Date(AHORA.getTime() + 3600_000), {}, (l) => (esToken(l) ? json({ access_token: 'B', expires_in: 3600 }) : json({})));
    await enviarFcm(despues.deps, cfg, tokenFcmFalso(), MSG);
    assert.equal(despues.llamadas.filter(esToken).length, 1, 'vencido: pide otro');
  });

  it('un 401 renueva el token de acceso y reintenta UNA vez', async () => {
    const { cfg } = armar();
    let envios = 0;
    const { deps, llamadas } = depsFalsas(AHORA, {}, (l) => {
      if (esToken(l)) return json({ access_token: `A${llamadas.filter(esToken).length}`, expires_in: 3600 });
      return ++envios === 1 ? json({ error: { status: 'UNAUTHENTICATED' } }, 401) : json({});
    });
    assert.deepEqual(await enviarFcm(deps, cfg, tokenFcmFalso(), MSG), { resultado: 'enviado' });
    assert.equal(llamadas.filter(esToken).length, 2);
    // dos 401 seguidos: no insiste
    olvidarAccesosFcm();
    const siempre401 = depsFalsas(AHORA, {}, (l) => (esToken(l) ? json({ access_token: 'A', expires_in: 3600 }) : json({}, 401)));
    const r = await enviarFcm(siempre401.deps, cfg, tokenFcmFalso(), MSG);
    assert.equal(r.resultado, 'fallo');
    assert.equal(siempre401.llamadas.filter((l) => !esToken(l)).length, 2);
  });

  it('SÓLO un dispositivo que FCM dice que no existe se marca inválido (para borrarlo)', () => {
    assert.equal(clasificarErrorFcm(404, JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } })), 'token_invalido');
    assert.equal(clasificarErrorFcm(400, JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' } })), 'token_invalido');
    // NO se borra: un 404 a secas (proyecto mal escrito borraría los teléfonos de todos), un 400 por el mensaje, credenciales, cuota, caída
    assert.equal(clasificarErrorFcm(404, JSON.stringify({ error: { status: 'NOT_FOUND', message: 'Requested entity was not found.' } })), 'fallo');
    assert.equal(clasificarErrorFcm(404, ''), 'fallo');
    assert.equal(clasificarErrorFcm(400, JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'Invalid JSON payload received' } })), 'fallo');
    assert.equal(clasificarErrorFcm(403, JSON.stringify({ error: { status: 'PERMISSION_DENIED' } })), 'fallo');
    assert.equal(clasificarErrorFcm(429, JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED' } })), 'fallo');
    assert.equal(clasificarErrorFcm(503, 'no es json'), 'fallo');
  });

  it('enviarFcm: UNREGISTERED → token_invalido; 404 de proyecto, 403, 429, 500 → fallo con sólo el estado', async () => {
    const { cfg } = armar();
    const intento = async (resp: Response) => {
      olvidarAccesosFcm();
      return enviarFcm(depsFalsas(AHORA, {}, (l) => (esToken(l) ? json({ access_token: 'A', expires_in: 3600 }) : resp.clone())).deps, cfg, tokenFcmFalso(), MSG);
    };
    assert.deepEqual(await intento(errorFcm(404, 'NOT_FOUND', 'UNREGISTERED')), { resultado: 'token_invalido' });
    assert.deepEqual(await intento(errorFcm(404, 'NOT_FOUND')), { resultado: 'fallo', motivo: 'FCM respondió 404' });
    assert.deepEqual(await intento(errorFcm(403, 'PERMISSION_DENIED')), { resultado: 'fallo', motivo: 'FCM respondió 403' });
    assert.deepEqual(await intento(errorFcm(429, 'RESOURCE_EXHAUSTED')), { resultado: 'fallo', motivo: 'FCM respondió 429' });
    assert.deepEqual(await intento(new Response('boom', { status: 500 })), { resultado: 'fallo', motivo: 'FCM respondió 500' });
  });

  it('sin token de acceso (Google rechaza la cuenta) o sin red: fallo, sin lanzar ni filtrar la llave', async () => {
    const { cfg } = armar();
    const sinAcceso = await enviarFcm(depsFalsas(AHORA, {}, () => json({ error: 'invalid_grant' }, 400)).deps, cfg, tokenFcmFalso(), MSG);
    assert.deepEqual(sinAcceso, { resultado: 'fallo', motivo: 'FCM sin token de acceso' });
    olvidarAccesosFcm();
    const sinRed = depsFalsas(AHORA, {}, () => { throw new Error('ECONNRESET con https://x?key=SECRETO'); });
    const r = await enviarFcm(sinRed.deps, cfg, tokenFcmFalso(), MSG);
    assert.equal(r.resultado, 'fallo');
    assert.ok(!JSON.stringify(r).includes('SECRETO'));
  });

  it('el cuerpo no manda número en el ícono ni datos más allá de la ruta', () => {
    const c = JSON.parse(cuerpoFcm('t'.repeat(30), MSG));
    assert.deepEqual(Object.keys(c.message.data), ['ruta']);
    assert.equal(c.message.android.priority, 'HIGH');
    assert.equal(c.message.apns.payload.aps.badge, undefined);
  });
});
