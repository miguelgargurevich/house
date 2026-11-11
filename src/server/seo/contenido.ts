// Descripción de Torre para buscadores y LLM (llms.txt, datos estructurados). TODO lo que dice existe hoy en la app; no se promete lo que no hay.
// Los planes y precios NO viven aquí: salen del catálogo de la base.

/** Qué es Torre, en una frase (la usan llms.txt y el JSON-LD). */
export const QUE_ES = 'Torre es un servicio web para administrar edificios y condominios en el Perú: emite los recibos de cada block, recibe y valida los vouchers de pago, lleva la morosidad y le da a cada vecino un portal para ver lo que debe.';

export const PARA_QUIEN = 'Administradoras de edificios y condominios, juntas directivas y los vecinos (propietarios e inquilinos) y el personal del edificio que trabajan con ellas.';

/** Funciones que existen hoy en la app. `plan` dice dónde empiezan cuando no son de todos los planes. */
export const FUNCIONES: { nombre: string; texto: string; plan?: string }[] = [
  { nombre: 'Recibos por block', texto: 'La administración emite el recibo de cada block desde su Excel, con cada concepto desglosado; el vecino ve qué debe desde su celular.' },
  { nombre: 'Cobranza y morosidad', texto: 'Seguimiento de lo cobrado y de lo vencido, con los medios de pago del condominio a la vista del vecino y el cierre del mes.' },
  { nombre: 'Vouchers de pago', texto: 'El vecino sube el voucher de su pago y la administración lo valida a mano. Con IA, Torre lee el comprobante, lo contrasta con el recibo y valida solo los que coinciden.', plan: 'La validación con IA es de Torre Pro' },
  { nombre: 'Avisos', texto: 'Recibos y recordatorios de pago por correo y, además, por WhatsApp.', plan: 'WhatsApp es de Torre Pro' },
  { nombre: 'Conciliación bancaria', texto: 'La administración sube el extracto de la cuenta del condominio (Excel o CSV) y Torre cruza cada abono con los pagos registrados: marca los conciliados, avisa de los abonos sin voucher y de los vouchers sin abono en el banco.', plan: 'De Torre Pro' },
  { nombre: 'Mora automática y reportes', texto: 'Cálculo automático de la mora y reportes con exportes.', plan: 'De Torre Pro' },
  { nombre: 'Asistente con IA', texto: 'Responde dudas de recibos y pagos en la web y por los bots de WhatsApp y Telegram.', plan: 'De Torre Pro' },
  { nombre: 'Portal del vecino', texto: 'Propietarios e inquilinos ven sus recibos, su historial de pagos, los comunicados, su junta y los proveedores del edificio.' },
  { nombre: 'Juntas directivas', texto: 'Panel para la junta: medios de pago, pagos por validar, cierre del mes, lecturas de agua y comunicados.' },
  { nombre: 'Reservas de áreas comunes', texto: 'La administración define las áreas y sus horarios; los vecinos piden su reserva y la administración la aprueba.' },
  { nombre: 'Comunicados, proveedores y tareas', texto: 'Comunicados a los vecinos, directorio de proveedores y tareas para el personal de mantenimiento, seguridad, limpieza y jardinería.' },
  { nombre: 'Lecturas de agua', texto: 'Registro de las lecturas de agua por departamento, con foto del contómetro.' },
  { nombre: 'Varios condominios', texto: 'Una cuenta puede administrar varios condominios (Torre Gratis incluye 1 condominio).' },
];

/** Lo que Torre NO hace hoy: para que un asistente no se lo invente. */
export const LIMITES = [
  'No hay pagos en línea ni pasarela de pagos: los vecinos pagan por los medios que indica su condominio (transferencia, Yape…), suben el voucher y la administración lo valida.',
  'No hay app nativa para celular: Torre se usa desde el navegador, en celular o computadora.',
  'No hay votaciones ni asambleas en línea.',
  'No hay conexión directa con el banco: la conciliación bancaria se hace subiendo el extracto de la cuenta (Excel o CSV), no se lee sola del banco.',
];

/** Fecha (AAAA-MM-DD) del contenido fijo de las páginas que no dependen de la base: es el `lastmod` de `/` y `/registro` en el sitemap. Súbela cuando cambie ese texto. */
export const FECHA_CONTENIDO = '2026-11-10';
