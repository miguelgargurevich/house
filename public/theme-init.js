try {
  var t = localStorage.getItem('house-theme');
  var dark = t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (dark) document.documentElement.classList.add('dark');
} catch (e) {}
// Dentro de la app de Torre para iOS/Android (user agent TorreApp/, mobile/capacitor.config.ts): la app va a pantalla completa y la web
// deja libres la barra de estado y la del inicio (src/index.css, html.en-app). Se marca aquí, antes de pintar, para que no salte.
if (/\bTorreApp\//.test(navigator.userAgent)) document.documentElement.classList.add('en-app');
