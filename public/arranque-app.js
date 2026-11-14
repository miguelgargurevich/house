// Pantalla de arranque de la app de Torre para iOS y Android (index.html, #arranque-app). Sólo dentro de la app: en el navegador
// retira el marcado en seguida y no hace nada más. Dentro de la app:
//  1. Tras la primera pintura, oculta el splash NATIVO con el puente de Capacitor (`nativePromise`, que la app inyecta en la web remota;
//     `Capacitor.Plugins.SplashScreen` no existe aquí porque la web no importa @capacitor/*). Así el verde nativo empalma con el verde de la pantalla.
//  2. Se quita sola cuando la app llama a `window.torreArranque.quitar()` (src/app/pantallaDeArranque.ts, al montar App) y, como red de seguridad,
//     a los 8 s aunque la app no haya montado (un error de carga no debe dejar la pantalla tapando todo).
// Este archivo es clásico (no módulo) y va al final del <body>, antes del bundle: así la pantalla sale aunque el JS de la app tarde o falle.
(function () {
  var el = document.getElementById('arranque-app');
  if (!el) return;

  // `en-app` lo pone public/theme-init.js (síncrono, en el <head>) según el user agent TorreApp/, antes de pintar.
  var enApp = document.documentElement.classList.contains('en-app');
  if (!enApp) {
    el.parentNode.removeChild(el);
    return;
  }

  var quitado = false;
  function quitar() {
    if (quitado) return;
    quitado = true;
    el.classList.add('salir'); // opacidad a 0 en 250 ms (index.html); no bloquea clics en ningún momento
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 260);
  }

  function ocultarSplashNativo() {
    try {
      if (window.Capacitor && typeof window.Capacitor.nativePromise === 'function') {
        var r = window.Capacitor.nativePromise('SplashScreen', 'hide', {});
        if (r && typeof r.catch === 'function') r.catch(function () {});
      }
    } catch (e) {
      // Sin puente, el temporizador nativo (launchShowDuration, mobile/capacitor.config.ts) oculta el splash de todos modos.
    }
  }

  // Dos cuadros después de la primera pintura: la pantalla verde ya está en pantalla cuando se va el splash nativo.
  var raf = window.requestAnimationFrame || function (f) { setTimeout(f, 16); };
  raf(function () { raf(ocultarSplashNativo); });

  setTimeout(quitar, 8000);
  window.torreArranque = { quitar: quitar };
})();
