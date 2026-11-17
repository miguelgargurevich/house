import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { endpointPermitido } from '../src/server/services/push/endpoints';

describe('push: lista cerrada de servidores de Web Push (contra SSRF)', () => {
  it('acepta los servicios de push de los navegadores', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc:APA91bE',
      'https://fcm.googleapis.com/wp/dXNlcg',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB',
      'https://web.push.apple.com/QGxfOFAg',
      'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB',
      'https://FCM.googleapis.com/fcm/send/x',
      'https://fcm.googleapis.com:443/fcm/send/x',
    ]) assert.equal(endpointPermitido(ok), true, ok);
  });

  it('rechaza lo que no es un servicio de push conocido', () => {
    for (const malo of [
      'http://fcm.googleapis.com/fcm/send/x',                // sin https
      'https://fcm.googleapis.com.evil.com/x',                // dominio que sólo empieza igual
      'https://evilfcm.googleapis.com/x',                     // subdominio de googleapis que no es fcm
      'https://evil.com/fcm.googleapis.com',                  // el nombre va en la ruta
      'https://evil.com/?h=updates.push.services.mozilla.com',
      'https://push.services.mozilla.com/x',                  // sin el subdominio exigido
      'https://user:pass@fcm.googleapis.com/x',               // con usuario
      'https://fcm.googleapis.com:8443/x',                    // puerto raro
      'https://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://169.254.169.254/latest/meta-data',
      'https://10.0.0.5/x', 'https://metadata.google.internal/x', 'ftp://fcm.googleapis.com/x', 'javascript:alert(1)',
      '//fcm.googleapis.com/x', '', 'no es una url',
    ]) assert.equal(endpointPermitido(malo), false, malo);
    for (const noTexto of [null, undefined, 42, {}, []]) assert.equal(endpointPermitido(noTexto), false);
  });

  it('rechaza un endpoint demasiado largo', () => {
    assert.equal(endpointPermitido(`https://fcm.googleapis.com/fcm/send/${'a'.repeat(1000)}`), false);
  });
});
