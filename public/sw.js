/* Service worker de Torre: SÓLO avisos push (Web Push). No guarda nada en caché ni intercepta las peticiones: la web se comporta igual con o sin él.
 * Lo registra `src/app/push.ts` cuando la persona activa «Recibir avisos en este navegador» (Mi perfil).
 * El servidor manda un JSON cifrado { titulo, cuerpo, ruta } (ver src/server/services/push/webpush.ts); nunca montos ni datos sensibles. */

/** ¿Es una ruta de ESTE sitio? Empieza con «/», no con «//» (otro sitio), sin «\» ni caracteres de control. Lo que no lo sea cae en el inicio. */
function esRutaInterna(ruta) {
  if (typeof ruta !== 'string' || ruta.length > 2000) return false;
  if (ruta.charAt(0) !== '/' || ruta.indexOf('//') === 0) return false;
  return !/[\\\u0000-\u001f\u007f]/.test(ruta);
}

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (event) {
  var datos = {};
  try { datos = event.data ? event.data.json() : {}; } catch (e) { datos = {}; }
  if (!datos || typeof datos !== 'object') datos = {}; // `null`, un número o un texto suelto: JSON válido pero no es un aviso nuestro
  var titulo = typeof datos.titulo === 'string' && datos.titulo ? datos.titulo.slice(0, 120) : 'Torre';
  var cuerpo = typeof datos.cuerpo === 'string' ? datos.cuerpo.slice(0, 300) : '';
  // Safari exige mostrar SIEMPRE una notificación por cada push: aunque el texto venga vacío o roto, se muestra «Torre».
  event.waitUntil(self.registration.showNotification(titulo, {
    body: cuerpo,
    icon: '/icon-192.png',
    badge: '/favicon-32.png',
    data: { ruta: esRutaInterna(datos.ruta) ? datos.ruta : '/' },
  }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var ruta = event.notification.data && esRutaInterna(event.notification.data.ruta) ? event.notification.data.ruta : '/';
  var destino = new URL(ruta, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (ventanas) {
    // Si Torre ya está abierta, se lleva esa pestaña a la ruta; si no, se abre una.
    for (var i = 0; i < ventanas.length; i++) {
      var v = ventanas[i];
      if (new URL(v.url).origin === self.location.origin && 'navigate' in v) {
        return v.navigate(destino).then(function (c) { return c ? c.focus() : undefined; });
      }
    }
    return self.clients.openWindow(destino);
  }));
});
