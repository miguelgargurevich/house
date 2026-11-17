// Prueba de PROTOCOLO del Web Push, sin red: lo que `enviarWebPush` manda lo descifra el «navegador» con SUS llaves (como lo haría Chrome/Firefox/Safari) y la
// firma VAPID se verifica con la llave pública. Sin esto sólo sabríamos que el POST tiene la forma correcta, no que el servicio de push le entregaría el mensaje
// intacto al navegador.
import assert from 'node:assert/strict';
import { createECDH, createPublicKey, randomBytes, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import webpush from 'web-push';
import { enviarWebPush } from '../src/server/services/push/webpush';
import { depsFalsas } from './helpers/push';

const require = createRequire(import.meta.url);
const ece = require('http_ece') as { decrypt: (buf: Buffer, params: Record<string, unknown>) => Buffer };

const vapid = webpush.generateVAPIDKeys();
const cfg = { publica: vapid.publicKey, privada: vapid.privateKey, sujeto: 'mailto:soporte@ejemplo.test' };

describe('Web Push: lo que sale se puede descifrar y verificar como lo haría un navegador', () => {
  it('el mensaje se descifra con las llaves de la suscripción y trae título, cuerpo y ruta; la firma VAPID verifica', async () => {
    const navegador = createECDH('prime256v1'); navegador.generateKeys();
    const auth = randomBytes(16);
    const endpoint = `https://fcm.googleapis.com/fcm/send/${randomBytes(8).toString('hex')}`;
    const { deps, llamadas } = depsFalsas(new Date('2026-11-17T15:00:00Z'), {}, () => new Response(null, { status: 201 }));
    const msg = { titulo: 'Tu recibo vence hoy', cuerpo: 'Recibo de octubre de 2026. Paga y sube tu voucher hoy.', ruta: '/propietario/cargos' };
    const r = await enviarWebPush(deps, cfg, { endpoint, p256dh: navegador.getPublicKey().toString('base64url'), auth: auth.toString('base64url') }, msg);
    assert.deepEqual(r, { resultado: 'enviado' });

    const { init } = llamadas[0]!;
    const claro = ece.decrypt(Buffer.from(init.body as Buffer), { version: 'aes128gcm', privateKey: navegador, authSecret: auth });
    assert.deepEqual(JSON.parse(claro.toString('utf8')), msg);

    // Firma VAPID (JWT ES256): audiencia = origen del servicio de push, sujeto = el contacto, firmado con la llave privada del servidor.
    const cab = (init.headers as Record<string, string>).Authorization;
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(cab);
    assert.ok(m, cab);
    const [, h, c, f, k] = m!;
    assert.equal(k, vapid.publicKey);
    const reclamos = JSON.parse(Buffer.from(c!, 'base64url').toString());
    assert.equal(reclamos.aud, 'https://fcm.googleapis.com');
    assert.equal(reclamos.sub, 'mailto:soporte@ejemplo.test');
    assert.ok(reclamos.exp > Date.now() / 1000 - 60 && reclamos.exp - Date.now() / 1000 <= 24 * 3600 + 60, 'vence dentro de las 24 h que permite el estándar');
    const x = Buffer.from(vapid.publicKey, 'base64url');
    const llave = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: x.subarray(1, 33).toString('base64url'), y: x.subarray(33).toString('base64url') }, format: 'jwk' });
    assert.equal(verify('sha256', Buffer.from(`${h}.${c}`), { key: llave, dsaEncoding: 'ieee-p1363' }, Buffer.from(f!, 'base64url')), true, 'la firma ES256 debe verificar con la llave pública VAPID');
  });

  it('con las llaves de OTRO navegador el mensaje NO se puede descifrar (el cifrado es de verdad)', async () => {
    const dueno = createECDH('prime256v1'); dueno.generateKeys();
    const otro = createECDH('prime256v1'); otro.generateKeys();
    const auth = randomBytes(16);
    const { deps, llamadas } = depsFalsas(new Date(), {}, () => new Response(null, { status: 201 }));
    await enviarWebPush(deps, cfg, { endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh: dueno.getPublicKey().toString('base64url'), auth: auth.toString('base64url') }, { titulo: 'secreto', cuerpo: 'c', ruta: '/' });
    assert.throws(() => ece.decrypt(Buffer.from(llamadas[0]!.init.body as Buffer), { version: 'aes128gcm', privateKey: otro, authSecret: auth }));
  });
});
