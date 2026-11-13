import type { CapacitorConfig } from '@capacitor/cli';

declare const require: (m: string) => any;
const { urlTorre, version, esProduccion, INICIO } = require('./scripts/entorno.cjs');

const url = urlTorre();
const prod = esProduccion(url);
const { hostname } = new URL(url);

const config: CapacitorConfig = {
  appId: 'com.torrecondominios.app',
  appName: 'Torre',
  // Carpeta local: sólo trae la pantalla «sin conexión» (offline.html). La app en sí es la web que se carga desde `server.url`.
  webDir: 'www',
  // La web reconoce que corre dentro de la app por este user agent (src/app/instalar.ts) y deja de ofrecer «Instalar Torre».
  appendUserAgent: `TorreApp/${version()}`,
  backgroundColor: '#ffffff',
  server: {
    // La dirección completa con la ruta de inicio: en iOS, `appStartPath` junto a `server.url` se busca como archivo local
    // (public//login) y la app se cierra al abrir. Así funciona igual en las dos plataformas.
    url: `${url}${INICIO}`,
    // Sólo Torre dentro de la app. Todo lo demás (WhatsApp, Instagram, el manual, mailto:, tel:) lo abre el sistema fuera.
    allowNavigation: [hostname, ...(hostname === 'torrecondominios.com' ? ['www.torrecondominios.com'] : [])],
    // Sin red o servidor caído: se muestra www/offline.html (local) con «Reintentar».
    errorPath: 'offline.html',
    // Sólo con TORRE_URL=http://… (desarrollo). El build de producción es siempre https.
    cleartext: !prod && url.startsWith('http:'),
  },
  android: {
    // Chrome DevTools (chrome://inspect) sólo en builds de desarrollo.
    webContentsDebuggingEnabled: !prod,
    allowMixedContent: false,
  },
  ios: {
    // PANTALLA COMPLETA (13-nov, captura de Miguel con franjas blancas arriba y abajo). Con 'automatic' iOS reservaba la barra de
    // estado y la del inicio con el fondo nativo (blanco) y la web quedaba encogida entre dos franjas. Con 'never' la web llega a los
    // bordes y respeta las zonas seguras ella misma: index.html declara viewport-fit=cover y, sólo dentro de la app (user agent
    // TorreApp/, clase `en-app` del <html>), src/index.css pinta el «techo» bajo la hora y deja libre la barra del inicio.
    contentInset: 'never',
    webContentsDebuggingEnabled: !prod,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      launchFadeOutDuration: 300,
      backgroundColor: '#0f766e',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    // Barras del sistema en Android: con `native` y viewport-fit=cover (Chromium ≥ 140) el WebView va de borde a borde y env(safe-area-inset-*)
    // trae los valores reales, que la web usa igual que en iOS; con un Chromium más viejo el WebView queda entre las barras y env() vale 0.
    SystemBars: {
      insetsHandling: 'native',
    },
  },
};

export default config;
