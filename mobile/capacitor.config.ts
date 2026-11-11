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
    contentInset: 'automatic',
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
    // Barras del sistema: la web se muestra dentro de las zonas seguras (notch, barra de estado y de gestos) sin tocar nada de la web.
    // `native` no inyecta CSS en la página remota; Torre no declara viewport-fit=cover, así que el WebView queda entre las barras.
    SystemBars: {
      insetsHandling: 'native',
    },
  },
};

export default config;
