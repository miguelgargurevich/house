// Textos de /contacto, del Libro de Reclamaciones y de la página 404. Los comparten las pantallas y el HTML estático que ven los buscadores
// (`src/server/seo/paginas.ts`): una sola fuente. Sin números ni direcciones: el WhatsApp, el correo y las redes salen de la base.

export const CONTACTO = {
  h1: 'Habla con nosotros',
  bajada: 'Cuéntanos de tu condominio y te respondemos en menos de 1 día hábil. Si prefieres, escríbenos por WhatsApp.',
  exito: 'Recibimos tu mensaje. Te escribimos en menos de 1 día hábil.',
  cta_demo: 'Solicita una demo',
  enlace_demo: '/contacto?tema=demo',
  demo: 'Pide una demo y te mostramos Torre con los datos de tu condominio.',
  eliminar: 'Cuéntanos con qué correo tienes tu cuenta de Torre y te ayudamos a eliminarla. Por seguridad, podemos pedirte que confirmes que eres tú.',
} as const;

export const LIBRO = {
  h1: 'Libro de Reclamaciones',
  bajada: 'Aquí puedes registrar un reclamo o una queja sobre el servicio de Torre. Al enviar la hoja recibes un número y una copia en tu correo.',
  base_legal: 'Este Libro de Reclamaciones virtual se ofrece conforme al Código de Protección y Defensa del Consumidor (Ley N.º 29571) y su reglamento (D.S. N.º 011-2011-PCM) y sus modificatorias.',
  reclamo: 'Disconformidad relacionada con los productos o servicios.',
  queja: 'Disconformidad no relacionada con los productos o servicios, o malestar o descontento respecto a la atención al público.',
  plazo: 'Respondemos a tu correo en un plazo de 15 días hábiles desde que registras la hoja (sábados y domingos no cuentan; los feriados sí).',
  indecopi: 'La formulación del reclamo no impide acudir a otras vías de solución de controversias ni es requisito previo para interponer una denuncia ante el INDECOPI.',
} as const;

export const NO_ENCONTRADA = {
  h1: 'No encontramos esta página',
  bajada: 'La dirección no existe o cambió de lugar. Puedes volver al inicio, mirar los precios o escribirnos.',
} as const;
