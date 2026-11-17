import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { configPush, estadoPush, leerCuentaDeServicio, mensajeDeArranque } from '../src/server/services/push/config';

import { cuentaDeServicioFalsa, VAPID_FALSO as ENV_WEB } from './helpers/push';

const cuentaJson = (extra: Record<string, unknown> = {}) => cuentaDeServicioFalsa(extra).json;
const PUBLICA = ENV_WEB.VAPID_PUBLIC_KEY;
const PRIVADA = ENV_WEB.VAPID_PRIVATE_KEY;

describe('push: configuración por variables de entorno', () => {
  it('sin variables, los dos canales quedan apagados y se dice qué falta (sólo nombres)', () => {
    const c = configPush({});
    assert.equal(c.fcm, null);
    assert.equal(c.web, null);
    const e = estadoPush({});
    assert.equal(e.fcm.configurado, false);
    assert.deepEqual(e.web.faltan, ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']);
    assert.match(e.fcm.faltan.join(' '), /FCM_PROJECT_ID/);
  });

  it('FCM: proyecto + cuenta de servicio (JSON o base64)', () => {
    assert.ok(configPush({ FCM_PROJECT_ID: 'mi-proyecto', FCM_SERVICE_ACCOUNT_JSON: cuentaJson() }).fcm);
    const b64 = Buffer.from(cuentaJson()).toString('base64');
    const c = configPush({ FCM_PROJECT_ID: 'mi-proyecto', FCM_SERVICE_ACCOUNT_BASE64: b64 });
    assert.equal(c.fcm?.proyecto, 'mi-proyecto');
    assert.equal(c.fcm?.cuenta.correo, 'push@proyecto-falso.iam.gserviceaccount.com');
  });

  it('FCM: a medias (sólo el proyecto, o una cuenta rota) = apagado', () => {
    assert.equal(configPush({ FCM_PROJECT_ID: 'mi-proyecto' }).fcm, null);
    assert.equal(configPush({ FCM_SERVICE_ACCOUNT_JSON: cuentaJson() }).fcm, null);
    assert.equal(configPush({ FCM_PROJECT_ID: 'p', FCM_SERVICE_ACCOUNT_JSON: 'no es json' }).fcm, null);
    assert.equal(configPush({ FCM_PROJECT_ID: 'p', FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'a@b', private_key: 'basura' }) }).fcm, null);
    assert.equal(configPush({ FCM_PROJECT_ID: 'p', FCM_SERVICE_ACCOUNT_BASE64: '%%%' }).fcm, null);
  });

  it('un token_uri que no es https se cambia por el de Google (el JWT firmado viaja ahí)', () => {
    assert.equal(leerCuentaDeServicio(cuentaJson({ token_uri: 'http://evil.test/token' }))?.urlDelToken, 'https://oauth2.googleapis.com/token');
    assert.equal(leerCuentaDeServicio(cuentaJson({ token_uri: undefined }))?.urlDelToken, 'https://oauth2.googleapis.com/token');
  });

  it('Web Push: las tres variables, con forma válida', () => {
    assert.deepEqual(configPush(ENV_WEB).web, { publica: PUBLICA, privada: PRIVADA, sujeto: 'mailto:soporte@ejemplo.test' });
    assert.equal(configPush({ ...ENV_WEB, VAPID_SUBJECT: '' }).web, null);
    assert.equal(configPush({ ...ENV_WEB, VAPID_SUBJECT: 'soporte@ejemplo.test' }).web, null);   // sin mailto:
    assert.equal(configPush({ ...ENV_WEB, VAPID_PUBLIC_KEY: 'corta' }).web, null);
    assert.equal(configPush({ ...ENV_WEB, VAPID_PRIVATE_KEY: PUBLICA }).web, null);              // largo equivocado
    assert.ok(configPush({ ...ENV_WEB, VAPID_SUBJECT: 'https://torrecondominios.com' }).web);
  });

  it('el renglón del log al arrancar nunca trae valores', () => {
    const env = { FCM_PROJECT_ID: 'mi-proyecto', FCM_SERVICE_ACCOUNT_JSON: cuentaJson(), ...ENV_WEB };
    const todo = mensajeDeArranque(env).join('\n');
    assert.match(todo, /FCM.*activo/);
    assert.match(todo, /Web Push.*activo/);
    for (const secreto of ['BEGIN PRIVATE KEY', PRIVADA, 'proyecto-falso']) assert.ok(!todo.includes(secreto));
    assert.match(mensajeDeArranque({}).join('\n'), /FCM.*apagado: falta FCM_PROJECT_ID/);
    assert.match(mensajeDeArranque({}).join('\n'), /Web Push.*apagado: falta VAPID_PUBLIC_KEY/);
  });
});
