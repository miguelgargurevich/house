// Textos de /app («Torre en tu celular»). Los comparten la pantalla y el HTML estático que ven los buscadores (`src/server/seo/paginas.ts`): una sola fuente.
// Sin direcciones ni versiones: el APK y su versión salen de la configuración (`url_app_android`, `app_android_version`).

export const APP_MOVIL = {
  titulo_pagina: 'App para el celular | Torre · Administración de condominios',
  descripcion: 'Descarga la app de Torre para Android o instálala en tu iPhone desde Safari. Administra tu condominio desde el celular con tu misma cuenta.',
  nombre: 'App para el celular',
  h1: 'Torre en tu celular',
  bajada: 'Usa Torre desde el celular con la misma cuenta que usas en la web. Elige el sistema de tu teléfono.',
  dentro: 'Ya estás usando la app.',
  android: {
    titulo: 'Android',
    boton: 'Descargar para Android',
    version: (v: string) => `Versión ${v}`,
    pasos: [
      { clausula: 'Descarga', texto: 'Toca «Descargar para Android». El archivo se guarda en tu carpeta de Descargas.' },
      { clausula: 'Ábrelo', texto: 'Abre el archivo desde Descargas o desde las notificaciones del navegador.' },
      { clausula: 'Permite la instalación', texto: 'Si el teléfono avisa, permite «Instalar apps de esta fuente» para tu navegador. Sólo se hace una vez.' },
      { clausula: 'Instala y entra', texto: 'Toca «Instalar» y entra con tu correo y tu contraseña de Torre.' },
    ],
    nota: 'Pronto en Google Play. Mientras tanto, esta es la app oficial de Torre, firmada por nosotros.',
  },
  iphone: {
    titulo: 'iPhone',
    texto: 'Por ahora, instala Torre desde Safari.',
    pasos: [
      { clausula: 'Abre Torre', texto: 'Entra a Torre desde Safari, el navegador de tu iPhone.' },
      { clausula: 'Compartir', texto: 'Toca el botón Compartir (el cuadrado con una flecha hacia arriba).' },
      { clausula: 'Agregar a inicio', texto: 'Elige «Agregar a inicio». Torre queda como una app en tu pantalla.' },
    ],
    nota: 'Pronto en App Store.',
  },
} as const;
