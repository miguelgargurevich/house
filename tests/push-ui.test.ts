// Cableado de los avisos push en la web y la app: el cierre de sesión da de baja el dispositivo ANTES de cerrar, el Shell los inicia, el perfil los ofrece sólo donde
// corresponde, el service worker se sirve como archivo (no como la SPA) y el APK trae el plugin. Los componentes importan la API (y con ella `import.meta.env` de Vite),
// así que la estructura se fija con la fuente, como en las demás pruebas *-ui; la lógica pura se prueba en push-app.test.ts y push-sw.test.ts.
import './helpers/env';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { iniciar, prisma } from './helpers/app';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
after(() => prisma.$disconnect());

describe('cerrar sesión da de baja el dispositivo push', () => {
  const auth = fuente('src/auth/AuthContext.tsx');
  it('captura las cabeceras (CSRF) ANTES de olvidar la sesión, da de baja app y navegador y recién después cierra en el servidor', () => {
    const logout = /const logout = useCallback\(\(\) => \{([\s\S]*?)\}, \[olvidar\]\);/.exec(auth)?.[1] ?? '';
    assert.match(logout, /const cabeceras = csrfHeader\(\);/);
    assert.match(logout, /Promise\.all\(\[darDeBajaPushApp\(cabeceras, servidorPush\.baja\), darDeBajaWeb\(cabeceras\)\]\)\s*\.then\(\(\) => api\('\/api\/auth\/logout', \{ method: 'POST', json: \{\}, headers: cabeceras \}\)\)\s*\.catch\(\(\) => undefined\);/);
    assert.ok(logout.indexOf('csrfHeader()') < logout.indexOf('olvidar()'), 'las cabeceras se capturan antes de olvidar');
  });
});

describe('inicio de los avisos push', () => {
  it('el Shell llama a usePushInicio con el usuario, antes de cualquier return', () => {
    const shell = fuente('src/app/Shell.tsx');
    assert.match(shell, /usePushInicio\(user\);/);
    assert.ok(shell.indexOf('usePushInicio(user)') < shell.indexOf('if (!user) return null;'), 'un hook va antes del return condicional');
  });

  it('en una sesión prestada («Entrar como») no registra nada: sale antes de tocar el teléfono y el navegador', () => {
    const hook = fuente('src/app/usePush.ts');
    assert.match(hook, /const prestada = !!user\?\.impersonando;/);
    assert.match(hook, /if \(id == null \|\| prestada\) return;/);
    assert.ok(hook.indexOf('if (id == null || prestada) return;') < hook.indexOf('iniciarPushApp('));
    assert.ok(hook.indexOf('if (id == null || prestada) return;') < hook.indexOf('reanudarWeb('));
  });

  it('al tocar un aviso de la app se navega a la ruta; con la app abierta se muestra como mensaje', () => {
    const hook = fuente('src/app/usePush.ts');
    assert.match(hook, /abrir: \(ruta\) => actual\.current\.nav\(ruta\)/);
    assert.match(hook, /mostrar: \(texto\) => actual\.current\.toast\.ok\(texto\)/);
  });
});

describe('el navegador: «Recibir avisos en este navegador»', () => {
  const tarjeta = fuente('src/pages/shared/_parts/AvisosPushPerfil.tsx');
  const web = fuente('src/app/push.ts');

  it('Mi perfil la muestra junto a los demás avisos', () => {
    const perfil = fuente('src/pages/shared/Perfil.tsx');
    assert.match(perfil, /import \{ AvisosPushPerfil \} from '\.\/_parts\/AvisosPushPerfil';/);
    assert.ok(perfil.indexOf('<AvisosPerfil />') < perfil.indexOf('<AvisosPushPerfil />') && perfil.indexOf('<AvisosPushPerfil />') < perfil.indexOf('<CanalesPerfil />'));
  });

  it('no aparece en una sesión prestada, dentro de la app, sin soporte del navegador ni sin las llaves VAPID del servidor', () => {
    assert.match(tarjeta, /if \(!user \|\| user\.impersonando \|\| !estado \|\| estado === 'no_soportado' \|\| estado === 'sin_servidor'\) return null;/);
    assert.match(web, /if \(dentroDeLaApp\(ua\)\) return 'no_soportado';/);
    assert.match(web, /if \(!config\?\.web \|\| !config\.vapid_public\) return 'sin_servidor';/);
  });

  it('iPhone: sin Torre en la pantalla de inicio explica el paso en vez de fallar', () => {
    assert.match(web, /if \(esIphone\(ua\) && !estaInstalada\(\)\) return 'iphone_sin_instalar';/);
    assert.match(fuente('src/pages/shared/_parts/AvisosPushPerfil.tsx'), /Agregar a inicio/);
  });

  it('registra el service worker en «/», pide permiso a petición (nunca solo) y se suscribe sólo con userVisibleOnly', () => {
    assert.match(web, /navigator\.serviceWorker\.register\('\/sw\.js', \{ scope: '\/' \}\)/);
    assert.match(web, /userVisibleOnly: true, applicationServerKey: claveVapid\(config\.vapid_public\)/);
    const reanudar = /export async function reanudarWeb[\s\S]*?\n}\n/.exec(web)?.[0] ?? '';
    assert.doesNotMatch(reanudar, /requestPermission|\.subscribe\(/, 'reanudar es silencioso: nunca pide permiso ni crea una suscripción nueva');
    assert.match(reanudar, /Notification\.permission !== 'granted'\) return;/);
  });

  it('si el servidor rechaza el registro, la suscripción local se cancela (no queda una a medias)', () => {
    assert.match(web, /catch \(e\) \{\s*\n\s*await sub\.unsubscribe\(\)\.catch\(\(\) => false\);[\s\S]*?throw e;/);
  });

  it('la elección se recuerda POR USUARIO (un navegador compartido no registra a otra cuenta sin que lo pida)', () => {
    assert.match(web, /const CLAVE = \(usuarioId: number\) => `torre-push-web:\$\{usuarioId\}`;/);
  });
});

describe('el service worker se sirve como archivo, no como la página de la SPA', () => {
  it('GET /sw.js devuelve el archivo (JavaScript), con la CSP de siempre (sin abrir worker-src), y las rutas de la SPA siguen devolviendo el HTML', async () => {
    const dist = mkdtempSync(path.join(tmpdir(), 'torre-dist-'));
    copyFileSync('public/sw.js', path.join(dist, 'sw.js'));
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><title>Torre</title></head><body><div id="root"></div></body></html>');
    const { base, cerrar } = await iniciar({ distDir: dist });
    try {
      const sw = await fetch(`${base}/sw.js`);
      assert.equal(sw.status, 200);
      assert.match(sw.headers.get('content-type') ?? '', /javascript/);
      assert.equal(await sw.text(), fuente('public/sw.js'));
      const csp = sw.headers.get('content-security-policy') ?? '';
      assert.match(csp, /script-src 'self'/);
      assert.doesNotMatch(csp, /worker-src/, 'el worker hereda script-src \'self\': mismo origen, sin abrir nada más');
      const spa = await fetch(`${base}/propietario/cargos`);
      assert.match(await spa.text(), /<div id="root">/);
    } finally { await cerrar(); }
  });
});

describe('la app de iOS/Android', () => {
  const movil = JSON.parse(fuente('mobile/package.json')) as { dependencies: Record<string, string> };
  it('lleva @capacitor/push-notifications y el APK declara el permiso de avisos de Android 13', () => {
    assert.match(movil.dependencies['@capacitor/push-notifications'] ?? '', /^\^8\./);
    assert.match(fuente('mobile/android/app/src/main/AndroidManifest.xml'), /android\.permission\.POST_NOTIFICATIONS/);
    assert.match(fuente('mobile/android/app/capacitor.build.gradle'), /project\(':capacitor-push-notifications'\)/);
    assert.match(fuente('mobile/android/capacitor.settings.gradle'), /capacitor-push-notifications/);
  });

  it('iPhone queda preparado pero apagado: el puente no registra en iOS hasta que se encienda a propósito', () => {
    assert.match(fuente('src/app/pushApp.ts'), /export const IOS_LISTO = false;/);
  });

  it('verificar.mjs avisa si el APK no trae google-services.json (register() sin él tumba la app)', () => {
    assert.match(fuente('mobile/scripts/verificar.mjs'), /google-services\.json no existe/);
  });
});
