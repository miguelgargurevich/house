// El puente de los avisos push de la app (src/app/pushApp.ts) con un `window.Capacitor` falso y un servidor falso, y las utilidades puras del Web Push.
// pushApp.ts no importa la API (la recibe inyectada): por eso se puede probar en Node.
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { claveVapid, esIphone, estadoLocalWeb, suscripcionParaServidor } from '../src/app/pushLib';
import { ESPERA_DE_LA_BAJA_MS, darDeBajaPushApp, iniciarPushApp, reiniciarPushApp, resolverPuerto, tokenActual, type ServidorPush } from '../src/app/pushApp';
import { esRutaInterna } from '../src/app/rutaInterna';

type Escucha = (datos: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
const TOKEN = `${'a'.repeat(20)}:APA91b${'x'.repeat(100)}`;

/** Un puente de Capacitor falso con el plugin: registra las llamadas y deja disparar los eventos a mano. */
function puente(plataforma = 'android', permiso = 'prompt', opciones: { sinPlugin?: boolean; permisoTrasPedir?: string } = {}) {
  const llamadas: string[] = [];
  const escuchas: Record<string, Escucha> = {};
  const cap = {
    getPlatform: () => plataforma,
    PluginHeaders: opciones.sinPlugin ? [{ name: 'SplashScreen' }] : [{ name: 'PushNotifications' }, { name: 'SplashScreen' }],
    nativePromise: async (plugin: string, metodo: string) => {
      llamadas.push(`${plugin}.${metodo}`);
      if (metodo === 'checkPermissions') return { receive: permiso };
      if (metodo === 'requestPermissions') return { receive: opciones.permisoTrasPedir ?? 'granted' };
      return undefined;
    },
    addListener: (_plugin: string, evento: string, fn: Escucha) => { escuchas[evento] = fn; },
  };
  return { cap, llamadas, escuchas };
}

function servidorFalso(fcm = true) {
  const registrados: Array<[string, string]> = []; const bajas: Array<[string, Record<string, string>]> = [];
  let mandarBaja: () => Promise<unknown> = async () => undefined;
  const servidor: ServidorPush = {
    fcmListo: async () => fcm,
    registrar: async (t, p) => { registrados.push([t, p]); },
    baja: async (t, c) => { bajas.push([t, c]); return mandarBaja(); },
  };
  return { servidor, registrados, bajas, alBajar: (f: () => Promise<unknown>) => { mandarBaja = f; } };
}

const manejadores = () => { const abiertas: string[] = []; const mostradas: string[] = []; return { m: { abrir: (r: string) => abiertas.push(r), mostrar: (t: string) => mostradas.push(t) }, abiertas, mostradas }; };
const iniciar = async (p: ReturnType<typeof puente>, s: ReturnType<typeof servidorFalso>, h = manejadores()) => {
  const puerto = resolverPuerto(p.cap, true);
  await iniciarPushApp(h.m, s.servidor, puerto, p.cap.getPlatform());
  return h;
};
afterEach(() => reiniciarPushApp());

describe('puente de push de la app: llegar al plugin', () => {
  it('fuera de la app, sin puente o sin el plugin instalado (APK anterior): no hay puerto', () => {
    const p = puente();
    assert.equal(resolverPuerto(p.cap, false), null);
    assert.equal(resolverPuerto(undefined, true), null);
    assert.equal(resolverPuerto(puente('android', 'prompt', { sinPlugin: true }).cap, true), null);
    assert.equal(resolverPuerto({ getPlatform: () => 'android' }, true), null, 'sin nativePromise ni addListener');
    assert.ok(resolverPuerto(p.cap, true));
  });

  it('si algún día existe el proxy de Capacitor.Plugins, se usa ese', async () => {
    const llamadas: string[] = [];
    const proxy = { register: async () => { llamadas.push('proxy.register'); }, checkPermissions: async () => ({ receive: 'granted' }), requestPermissions: async () => ({ receive: 'granted' }), addListener: () => ({}) };
    const puerto = resolverPuerto({ Plugins: { PushNotifications: proxy } }, true)!;
    await puerto.register();
    assert.deepEqual(llamadas, ['proxy.register']);
  });
});

describe('puente de push de la app: registrar el teléfono', () => {
  it('Android con FCM listo y permiso por pedir: lo pide, registra y manda el token al servidor', async () => {
    const p = puente('android', 'prompt'); const s = servidorFalso();
    await iniciar(p, s);
    assert.deepEqual(p.llamadas, ['PushNotifications.checkPermissions', 'PushNotifications.requestPermissions', 'PushNotifications.register']);
    p.escuchas.registration!({ value: ` ${TOKEN} ` });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(s.registrados, [[TOKEN, 'android']]);
    assert.equal(tokenActual(), TOKEN);
  });

  it('con el permiso ya dado no vuelve a pedirlo', async () => {
    const p = puente('android', 'granted');
    await iniciar(p, servidorFalso());
    assert.deepEqual(p.llamadas, ['PushNotifications.checkPermissions', 'PushNotifications.register']);
  });

  it('permiso denegado (ya o al pedirlo): no registra', async () => {
    for (const p of [puente('android', 'denied'), puente('android', 'prompt', { permisoTrasPedir: 'denied' })]) {
      reiniciarPushApp();
      await iniciar(p, servidorFalso());
      assert.ok(!p.llamadas.includes('PushNotifications.register'));
    }
  });

  it('el servidor SIN FCM listo: no toca el plugin (register() sin google-services.json tumba la app)', async () => {
    const p = puente('android', 'granted'); const s = servidorFalso(false);
    await iniciar(p, s);
    assert.deepEqual(p.llamadas, []);
    assert.deepEqual(s.registrados, []);
  });

  it('iPhone: no registra mientras IOS_LISTO sea falso (el plugin da el token de APNs y FCM lo rechaza)', async () => {
    const p = puente('ios', 'granted');
    await iniciar(p, servidorFalso());
    assert.deepEqual(p.llamadas, []);
  });

  it('un fallo del plugin o de la red del servidor nunca lanza', async () => {
    const p = puente('android', 'granted');
    p.cap.nativePromise = async () => { throw new Error('FirebaseApp is not initialized'); };
    await assert.doesNotReject(() => iniciar(p, servidorFalso()));
    const s = servidorFalso(); s.servidor.fcmListo = async () => { throw new Error('sin red'); };
    reiniciarPushApp();
    await assert.doesNotReject(() => iniciar(puente(), s));
  });

  it('un token tardío con la sesión ya cerrada no se manda', async () => {
    const p = puente('android', 'granted'); const s = servidorFalso();
    await iniciar(p, s);
    await darDeBajaPushApp({}, s.servidor.baja);
    p.escuchas.registration!({ value: TOKEN });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(s.registrados, []);
    assert.equal(tokenActual(), null);
  });
});

describe('puente de push de la app: tocar y recibir avisos', () => {
  it('al tocar un aviso abre la ruta SOLO si es interna', async () => {
    const p = puente('android', 'granted'); const h = manejadores();
    await iniciar(p, servidorFalso(), h);
    const tocar = (ruta: unknown) => p.escuchas.pushNotificationActionPerformed!({ notification: { data: { ruta } } });
    tocar('/propietario/cargos');
    for (const mala of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '/\\evil', undefined, 42, null]) tocar(mala);
    p.escuchas.pushNotificationActionPerformed!({});
    assert.deepEqual(h.abiertas, ['/propietario/cargos']);
  });

  it('con la app abierta el aviso se muestra como mensaje en pantalla (título · cuerpo)', async () => {
    const p = puente('android', 'granted'); const h = manejadores();
    await iniciar(p, servidorFalso(), h);
    p.escuchas.pushNotificationReceived!({ title: 'Tu recibo vence hoy', body: 'Recibo de octubre de 2026.' });
    p.escuchas.pushNotificationReceived!({ title: 'Sólo título' });
    p.escuchas.pushNotificationReceived!({});
    assert.deepEqual(h.mostradas, ['Tu recibo vence hoy · Recibo de octubre de 2026.', 'Sólo título']);
  });

  it('un registrationError no hace nada (la web sigue)', async () => {
    const p = puente('android', 'granted');
    await iniciar(p, servidorFalso());
    assert.doesNotThrow(() => p.escuchas.registrationError!({ error: 'x' }));
  });
});

describe('puente de push de la app: baja al cerrar sesión', () => {
  it('manda la baja con el token y las cabeceras de la sesión que se cierra, y suelta el token ANTES de mandar', async () => {
    const p = puente('android', 'granted'); const s = servidorFalso();
    await iniciar(p, s);
    p.escuchas.registration!({ value: TOKEN });
    let tokenAlBajar: string | null = 'sin llamar';
    s.alBajar(async () => { tokenAlBajar = tokenActual(); });
    await darDeBajaPushApp({ 'X-CSRF-Token': 'csrf-de-la-sesion' }, s.servidor.baja);
    assert.deepEqual(s.bajas, [[TOKEN, { 'X-CSRF-Token': 'csrf-de-la-sesion' }]]);
    assert.equal(tokenAlBajar, null);
    await darDeBajaPushApp({}, s.servidor.baja); // segunda vez (p. ej. el 401 vuelve a llamar a logout): nada que borrar
    assert.equal(s.bajas.length, 1);
  });

  it('sin token (navegador o permiso denegado) termina al instante y no manda nada', async () => {
    const s = servidorFalso();
    await darDeBajaPushApp({}, s.servidor.baja);
    assert.equal(s.bajas.length, 0);
  });

  it('un error del servidor o un servidor que no contesta NO frenan el cierre de sesión', async () => {
    const p = puente('android', 'granted'); const s = servidorFalso();
    await iniciar(p, s);
    p.escuchas.registration!({ value: TOKEN });
    s.alBajar(async () => { throw new Error('500'); });
    await assert.doesNotReject(() => darDeBajaPushApp({}, s.servidor.baja));

    p.escuchas.registration!({ value: TOKEN }); // no hay sesión activa tras la baja: se vuelve a activar
    reiniciarPushApp();
    await iniciar(p, s);
    p.escuchas.registration!({ value: TOKEN });
    s.alBajar(() => new Promise(() => {})); // nunca contesta
    const t0 = Date.now();
    await darDeBajaPushApp({}, s.servidor.baja);
    assert.ok(Date.now() - t0 >= ESPERA_DE_LA_BAJA_MS - 50 && Date.now() - t0 < ESPERA_DE_LA_BAJA_MS + 1500, 'espera como mucho unos segundos');
  });
});

describe('utilidades del Web Push', () => {
  it('esRutaInterna: sólo «/ruta»', () => {
    for (const ok of ['/', '/propietario/cargos', '/junta/cierre?mes=10', '/a#b']) assert.equal(esRutaInterna(ok), true, ok);
    for (const mal of ['', 'cargos', '//evil.example', 'https://evil.example', 'javascript:alert(1)', '/\\evil', '/a\nb', `/${'a'.repeat(2000)}`, null, undefined, 1, {}]) assert.equal(esRutaInterna(mal), false, String(mal));
  });

  it('claveVapid decodifica base64url a los mismos bytes', () => {
    const bytes = Buffer.from([4, 255, 250, 0, 63, 62, 1, 2, 3]);
    assert.deepEqual([...claveVapid(bytes.toString('base64url'))], [...bytes]);
    const larga = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 251)]);
    assert.equal(claveVapid(larga.toString('base64url')).length, 65);
  });

  it('suscripcionParaServidor pide endpoint y las dos llaves', () => {
    assert.deepEqual(suscripcionParaServidor({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } }), { tipo: 'web', endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } });
    assert.equal(suscripcionParaServidor({ endpoint: 'https://x' }), null);
    assert.equal(suscripcionParaServidor({ endpoint: 'https://x', keys: { p256dh: 'a' } }), null);
    assert.equal(suscripcionParaServidor({ keys: { p256dh: 'a', auth: 'b' } }), null);
  });

  it('esIphone', () => {
    assert.equal(esIphone('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), true);
    assert.equal(esIphone('Mozilla/5.0 (Linux; Android 14)'), false);
  });
});

describe('navegador compartido: «activo» es de ESTA cuenta', () => {
  it('sólo es activo con permiso, suscripción local y que esta cuenta lo haya activado aquí', () => {
    assert.equal(estadoLocalWeb({ permiso: 'granted', haySuscripcion: true, recordadoPorEstaCuenta: true }), 'activo');
    // la cuenta A activó y cerró sesión; entra B en el mismo navegador: la suscripción de A sigue, pero para B no está activo (y su botón es «Recibir»)
    assert.equal(estadoLocalWeb({ permiso: 'granted', haySuscripcion: true, recordadoPorEstaCuenta: false }), 'inactivo');
    assert.equal(estadoLocalWeb({ permiso: 'granted', haySuscripcion: false, recordadoPorEstaCuenta: true }), 'inactivo');
    assert.equal(estadoLocalWeb({ permiso: 'default', haySuscripcion: true, recordadoPorEstaCuenta: true }), 'inactivo');
    assert.equal(estadoLocalWeb({ permiso: 'denied', haySuscripcion: true, recordadoPorEstaCuenta: true }), 'inactivo');
  });
});
