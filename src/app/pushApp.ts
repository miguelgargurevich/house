import { esRutaInterna } from './rutaInterna';
import { dentroDeLaApp, agente } from './instalar';

/**
 * **Los avisos push dentro de la APP (Android; iPhone preparado)**. La app (Capacitor, carpeta `mobile/`) carga ESTA web remota, así que el registro del
 * teléfono vive aquí y llega al plugin nativo `PushNotifications` por el puente de Capacitor. Fuera de la app (el navegador) no hace nada.
 *
 * Qué hace, en orden:
 *  1. Con la sesión iniciada (`iniciarPushApp`): pregunta al servidor si FCM está listo (`GET /api/me/push/config`); si lo está, pide el permiso y, si lo dan,
 *     `register()`. Cuando el sistema entrega el token de FCM, se manda a `POST /api/me/push/dispositivos` y se guarda en memoria para poder darlo de baja.
 *  2. Antes de cerrar la sesión (`darDeBajaPushApp`): `POST /api/me/push/dispositivos/baja`, sin bloquear el cierre (un error o unos segundos y sigue).
 * Este módulo NO importa la API (así se prueba en Node): quien lo usa le pasa las llamadas al servidor (`ServidorPush`, ver `pushServidor.ts`).
 *  3. Al tocar un aviso: abre `data.ruta` con la ruta interna (`esRutaInterna`); cualquier otra cosa se ignora.
 *  4. Con la app abierta el sistema no dibuja el aviso (es de primer plano): se muestra como un aviso en pantalla.
 *
 * **Cómo se llega al plugin.** `window.Capacitor.Plugins.PushNotifications` sólo existe si el JS de la web llama `registerPlugin` (esta web no empaqueta
 * `@capacitor/core`). El puente nativo que inyecta la app SÍ trae `nativePromise` y `addListener`, que sirven por nombre de plugin: se usa ese camino
 * y, si algún día existe el proxy, ese primero. Nada de esto toca el token en un log.
 *
 * **Sin `google-services.json` en el APK**, `register()` no es seguro (lanza y Capacitor relanza como RuntimeException, `Bridge.java`): por eso sólo se llama cuando el servidor dice que FCM está configurado (el APK con Firebase
 * y el servidor con la cuenta de servicio se ponen juntos). Si aun así falla, `registrationError` lo atrapa y la app sigue.
 *
 * **iPhone**: el plugin entrega en iOS el token de APNs, no el de FCM, y FCM HTTP v1 lo rechaza. Hasta que la app lleve el SDK de Firebase (ver docs/push/README.md)
 * el puente NO registra en iOS (`IOS_LISTO`). Se enciende cambiando esa constante cuando esté hecho.
 */

export const IOS_LISTO = false;

/** Lo mínimo del plugin que usamos (igual que `@capacitor/push-notifications`). */
export interface PuertoPush {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  addListener(evento: string, fn: (datos: any) => void): unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
}

interface PuenteCapacitor {
  Plugins?: Record<string, unknown>;
  PluginHeaders?: { name: string }[];
  getPlatform?: () => string;
  nativePromise?: (plugin: string, metodo: string, opciones?: unknown) => Promise<unknown>;
  addListener?: (plugin: string, evento: string, fn: (datos: unknown) => void) => unknown;
}

const PLUGIN = 'PushNotifications';

const puente = (): PuenteCapacitor | undefined => (typeof window === 'undefined' ? undefined : (window as Window & { Capacitor?: PuenteCapacitor }).Capacitor);

/** El plugin, por el proxy si existe o por el puente nativo. `null` si no está (fuera de la app o app sin el plugin). */
export function resolverPuerto(cap: PuenteCapacitor | undefined = puente(), enApp: boolean = dentroDeLaApp(agente())): PuertoPush | null {
  if (!enApp || !cap) return null;
  const proxy = cap.Plugins?.[PLUGIN] as PuertoPush | undefined;
  if (proxy && typeof proxy.register === 'function') return proxy;

  const nativePromise = cap.nativePromise?.bind(cap);
  const addListener = cap.addListener?.bind(cap);
  if (!nativePromise || !addListener) return null;
  // La app sin el plugin instalado (un APK anterior a esto): si el puente dice qué plugins trae, y este no está, no hay nada que hacer.
  if (Array.isArray(cap.PluginHeaders) && !cap.PluginHeaders.some((h) => h.name === PLUGIN)) return null;

  return {
    checkPermissions: () => nativePromise(PLUGIN, 'checkPermissions') as Promise<{ receive: string }>,
    requestPermissions: () => nativePromise(PLUGIN, 'requestPermissions') as Promise<{ receive: string }>,
    register: () => nativePromise(PLUGIN, 'register') as Promise<void>,
    addListener: (evento, fn) => addListener(PLUGIN, evento, fn),
  };
}

/** Lo que la app le pide al servidor (implementado en `pushServidor.ts` con `api()`; las pruebas lo reemplazan). */
export interface ServidorPush {
  /** ¿Tiene FCM listo? (`GET /api/me/push/config`). */
  fcmListo: () => Promise<boolean>;
  /** Registra el teléfono (`POST /api/me/push/dispositivos`). */
  registrar: (token: string, plataforma: 'android' | 'ios') => Promise<unknown>;
  /** Da de baja el teléfono (`POST /api/me/push/dispositivos/baja`) con las cabeceras de la sesión. */
  baja: (token: string, cabeceras: Record<string, string>) => Promise<unknown>;
}

/** Cuánto se espera a la baja antes de seguir con el cierre de sesión. */
export const ESPERA_DE_LA_BAJA_MS = 3000;

/** Qué se hace al recibir o tocar un aviso. */
export interface ManejadoresPushApp {
  /** Se tocó un aviso: ir a esta ruta (ya validada como interna). */
  abrir: (ruta: string) => void;
  /** Llegó un aviso con la app abierta: mostrarlo. */
  mostrar: (texto: string) => void;
}

/** El último token que entregó el teléfono. Sólo en memoria: sirve para darlo de baja al cerrar la sesión. */
let token: string | null = null;
/** ¿Hay una sesión que registrar? La baja la apaga; un `registration` tardío no manda nada con la sesión cerrada. */
let sesionActiva = false;
let escuchando = false;
let enCurso = false;
let manejadores: ManejadoresPushApp | null = null;
let plataformaApp: string | undefined;

/** Para las pruebas: vuelve el módulo a su estado de carga. */
export function reiniciarPushApp(): void { token = null; sesionActiva = false; escuchando = false; enCurso = false; manejadores = null; plataformaApp = undefined; }
export const tokenActual = (): string | null => token;

/** Con la sesión iniciada: registra el teléfono. Fuera de la app, sin el plugin, sin FCM en el servidor o con una sesión prestada, no hace nada. Nunca lanza. */
export async function iniciarPushApp(m: ManejadoresPushApp, servidor: Pick<ServidorPush, 'fcmListo' | 'registrar'>, puerto: PuertoPush | null = resolverPuerto(), plataforma: string | undefined = puente()?.getPlatform?.()): Promise<void> {
  if (enCurso || !puerto) return;
  enCurso = true;
  try {
    if (!(await servidor.fcmListo())) return;
    if (plataforma !== 'android' && !(plataforma === 'ios' && IOS_LISTO)) return;
    plataformaApp = plataforma;
    manejadores = m;
    sesionActiva = true;
    escuchar(puerto, servidor.registrar);
    let estado = (await puerto.checkPermissions()).receive;
    if (estado === 'prompt' || estado === 'prompt-with-rationale') estado = (await puerto.requestPermissions()).receive;
    // Denegado: se respeta y no se vuelve a insistir en esta sesión.
    if (estado !== 'granted') return;
    await puerto.register();
  } catch {
    // Sin permiso, sin plugin o sin red: la web sigue igual. No se loguea el error (puede traer datos del teléfono).
  } finally {
    enCurso = false;
  }
}

/**
 * Antes de cerrar la sesión: da de baja el teléfono en el servidor. Siempre termina (un error, o pasados unos segundos, también), para que el cierre de sesión
 * no dependa de esto. Sin token (navegador, o permiso denegado) termina al instante y no manda nada. `cabeceras` son las de la sesión que se cierra (CSRF).
 * El token se suelta ANTES de mandar: si la baja da 401, la segunda vez no encuentra nada que borrar.
 */
export function darDeBajaPushApp(cabeceras: Record<string, string>, baja: ServidorPush['baja']): Promise<void> {
  sesionActiva = false;
  const t = token;
  token = null;
  if (!t) return Promise.resolve();
  return Promise.race([
    baja(t, cabeceras).then(() => undefined),
    new Promise<void>((r) => setTimeout(r, ESPERA_DE_LA_BAJA_MS)),
  ]).catch(() => undefined);
}

/** Los eventos del plugin, una sola vez por carga de la app. */
function escuchar(puerto: PuertoPush, registrar: ServidorPush['registrar']): void {
  if (escuchando) return;
  escuchando = true;

  puerto.addListener('registration', (e: { value?: string }) => {
    const t = typeof e?.value === 'string' ? e.value.trim() : '';
    if (!t || !sesionActiva) return;
    token = t;
    if (plataformaApp !== 'android' && plataformaApp !== 'ios') return;
    // El siguiente inicio de sesión lo reintenta; el 403 de una sesión prestada es lo esperado.
    registrar(t, plataformaApp).catch(() => undefined);
  });

  // Un fallo del registro (sin Google Play Services, sin google-services.json en el APK…): no hay nada que la persona pueda hacer.
  puerto.addListener('registrationError', () => { /* se queda sin push; el resto de la web no se entera */ });

  puerto.addListener('pushNotificationActionPerformed', (e: { notification?: { data?: { ruta?: unknown } } }) => {
    const ruta = e?.notification?.data?.ruta;
    if (esRutaInterna(ruta)) manejadores?.abrir(ruta);
  });

  // Con la app abierta el sistema no muestra el aviso: se muestra aquí.
  puerto.addListener('pushNotificationReceived', (e: { title?: string; body?: string }) => {
    const texto = [e?.title, e?.body].filter((t): t is string => typeof t === 'string' && t.length > 0).join(' · ');
    if (texto) manejadores?.mostrar(texto);
  });
}
