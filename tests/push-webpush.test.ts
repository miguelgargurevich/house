import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import webpush from 'web-push';
import { enviarWebPush } from '../src/server/services/push/webpush';
import { depsFalsas, suscripcionFalsa } from './helpers/push';

const MSG = { titulo: 'Tu recibo vence hoy', cuerpo: 'Recibo de octubre de 2026.', ruta: '/propietario/cargos' };
const vapid = webpush.generateVAPIDKeys();
const cfg = { publica: vapid.publicKey, privada: vapid.privateKey, sujeto: 'mailto:soporte@ejemplo.test' };
const AHORA = new Date('2026-11-17T15:00:00Z');

function enviar(responder: (status: number) => Response, s = suscripcionFalsa()) {
  const { deps, llamadas } = depsFalsas(AHORA, {}, () => responder(201));
  return { promesa: enviarWebPush(deps, cfg, { endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth }, MSG), llamadas, s };
}

describe('push: Web Push (VAPID + mensaje cifrado)', () => {
  it('manda un POST cifrado (aes128gcm) con la firma VAPID al endpoint de la suscripción', async () => {
    const { promesa, llamadas, s } = enviar(() => new Response(null, { status: 201 }));
    assert.deepEqual(await promesa, { resultado: 'enviado' });
    assert.equal(llamadas.length, 1);
    const l = llamadas[0]!;
    assert.equal(l.url, s.endpoint);
    assert.equal(l.init.method, 'POST');
    const h = l.init.headers as Record<string, string>;
    assert.equal(h['Content-Encoding'], 'aes128gcm');
    assert.match(h.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    assert.ok(h.Authorization.includes(`k=${vapid.publicKey}`));
    assert.equal(String(h.TTL), '86400');
    // el cuerpo va cifrado: el texto del aviso NO aparece en claro
    const cuerpo = Buffer.from(l.init.body as Buffer);
    assert.ok(cuerpo.length > 100);
    assert.ok(!cuerpo.toString('latin1').includes('Tu recibo vence hoy'));
  });

  it('404 y 410 → la suscripción ya no existe (se borra); 201 → enviado; 429/500 → fallo', async () => {
    assert.deepEqual(await enviar(() => new Response(null, { status: 410 })).promesa, { resultado: 'token_invalido' });
    assert.deepEqual(await enviar(() => new Response(null, { status: 404 })).promesa, { resultado: 'token_invalido' });
    assert.deepEqual(await enviar(() => new Response(null, { status: 429 })).promesa, { resultado: 'fallo', motivo: 'Web Push respondió 429' });
    assert.deepEqual(await enviar(() => new Response(null, { status: 500 })).promesa, { resultado: 'fallo', motivo: 'Web Push respondió 500' });
  });

  it('un endpoint fuera de la lista cerrada nunca llega a la red', async () => {
    const s = suscripcionFalsa('http://169.254.169.254/latest/meta-data');
    const { promesa, llamadas } = enviar(() => new Response(null, { status: 201 }), s);
    assert.deepEqual(await promesa, { resultado: 'token_invalido' });
    assert.equal(llamadas.length, 0);
  });

  it('llaves del navegador mal formadas: fallo, sin lanzar', async () => {
    const s = suscripcionFalsa();
    const { deps, llamadas } = depsFalsas(AHORA, {}, () => new Response(null, { status: 201 }));
    const r = await enviarWebPush(deps, cfg, { endpoint: s.endpoint, p256dh: 'corta', auth: 'x' }, MSG);
    assert.equal(r.resultado, 'fallo');
    assert.equal(llamadas.length, 0);
  });
});
