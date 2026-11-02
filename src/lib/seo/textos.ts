// Textos de las páginas públicas que usan A LA VEZ la app (React) y el servidor (el HTML estático que ven buscadores y LLM).
// Una sola fuente: así lo que lee un rastreador es EXACTAMENTE lo que ve la persona (nada de textos distintos para robots: eso es cloaking).
// Sin React ni red: lo importan los componentes, `src/server/seo/` y las pruebas.
import { dinero } from '../../ui/format';
import { monedaDe } from '../paises';
import type { Catalogo, Plan } from '../../pages/publico/catalogo';
import { plazoGratisTexto } from '../../pages/publico/plazoGratis';
import { tramoDeTarjeta } from '../../pages/publico/precios/tramo';

export const MARCA = 'Torre';
export const MARCA_LARGA = 'Torre · Administración de condominios';

/**
 * Portada (`/`): la landing completa. Las capturas son de la app con los datos de prueba del seed (Los Libertadores), nunca de un cliente.
 * Sólo lo que Torre hace hoy; sin testimonios ni cifras de clientes.
 */
export const PORTADA = {
  h1: 'Cobra sin perseguir a nadie',
  bajada: 'Torre emite los recibos de tu edificio o condominio, recibe el voucher de cada vecino y te dice quién debe. Hecho para el Perú; empiezas gratis.',
  botones: { registro: 'Crear cuenta gratis', precios: 'Ver precios' },
  /** La frase grande de «qué hace»: cada tramo de texto lleva detrás, en la página, un pedacito de la interfaz (`ficha`). */
  enunciado: {
    titulo: 'Qué hace Torre',
    tramos: [
      { texto: 'Emites los recibos', ficha: 'Emitido' },
      { texto: 'desde tu Excel. El vecino sube su voucher', ficha: 'S/ 206.03' },
      { texto: 'desde el celular. La IA lo lee, el banco lo confirma', ficha: 'Conciliado' },
      { texto: 'y tú ves quién debe', ficha: '12 morosos' },
    ],
    cierre: '.',
  },
  pasos: {
    titulo: 'Cómo funciona',
    lista: [
      { nombre: 'Recibo', clausula: 'Primero, emites el recibo del mes', texto: 'Cargas tu Excel o tus conceptos y Torre arma el recibo de cada departamento, por block y con su vencimiento.', imagen: '/portada/admin-periodo.webp', alt: 'Pantalla de Torre con el mantenimiento de octubre: lo emitido, lo cobrado y lo que falta por block.', celular: false },
      { nombre: 'Voucher', clausula: 'Luego, el vecino sube su voucher', texto: 'Paga por transferencia, Yape o Plin a la cuenta del condominio y sube la foto del voucher desde su celular.', imagen: '/portada/vecino-pagar.webp', alt: 'Pantalla del vecino en el celular para pagar el mantenimiento y subir su voucher.', celular: true },
      { nombre: 'Validación', clausula: 'Después, Torre lo revisa contigo', texto: 'En Torre Pro la IA lee el voucher y lo compara con el recibo; el tesorero del block da su check y tú validas el pago.', imagen: '/portada/admin-pagos.webp', alt: 'Lista de pagos por validar con el método, el número de operación y el check del tesorero.', celular: false },
      { nombre: 'Banco', clausula: 'Al final, lo cruzas con tu banco', texto: 'En Torre Pro subes el extracto del banco y Torre marca qué pagos llegaron de verdad y qué vouchers no tienen abono.', imagen: '/portada/admin-conciliacion.webp', alt: 'Conciliación bancaria: abonos del extracto cruzados con los pagos registrados.', celular: false },
    ],
  },
  juntas: {
    una: { opcion: 'Una junta', titulo: 'Una junta para todo el edificio', texto: 'En un edificio de una sola torre, la junta directiva revisa los pagos de todos y publica una sola cuenta.' },
    block: { opcion: 'Junta por block', titulo: 'Una junta para cada block', texto: 'En un condominio con varios blocks, cada block tiene su junta, su tesorero y su cuenta; cada vecino paga a la de su block.' },
  },
  roles: {
    titulo: 'Una pantalla para cada quien',
    bajada: 'Cada persona entra con su correo y ve sólo lo suyo. También hay pantallas para el personal de mantenimiento y de seguridad.',
    lista: [
      { nombre: 'Administración', texto: 'Recibos, pagos, morosidad y conciliación de todos tus condominios en un lugar.', imagen: '/portada/admin-morosidad.webp', alt: 'Pantalla de morosidad: deuda vencida, unidades morosas y mayor atraso.', celular: false },
      { nombre: 'Junta directiva', texto: 'El tesorero da su check a los pagos de su block y publica la cuenta donde pagan los vecinos.', imagen: '/portada/junta-mi-junta.webp', alt: 'Pantalla «Mi junta» del tesorero con los miembros y la cuenta del block.', celular: false },
      { nombre: 'Vecinos', texto: 'Ven qué deben, pagan, suben su voucher y descargan su recibo desde el celular, sin instalar nada.', imagen: '/portada/vecino-inicio.webp', alt: 'Inicio del vecino en el celular: su deuda, lo pagado este año y los mantenimientos por pagar.', celular: true },
    ],
  },
  precios: {
    titulo: 'Lo que pagarías',
    pregunta: '¿Cuántos departamentos tiene tu edificio?',
    nota: 'Precios por condominio, sin permanencia. El detalle de cada plan está en la página de precios.',
  },
  preguntas: {
    titulo: 'Preguntas',
    lista: [
      { p: '¿Puedo empezar con el Excel que ya uso?', r: 'Sí. Torre importa tu Excel de departamentos y conceptos para armar el primer recibo; no tienes que cargar todo a mano.' },
      { p: '¿Mis vecinos tienen que instalar algo?', r: 'No. Entran a Torre desde el navegador del celular o de la computadora, con su correo.' },
      { p: '¿Y si un vecino sube un voucher que no es real?', r: 'El pago queda por validar hasta que la junta o la administración lo revisa. Con la conciliación bancaria de Torre Pro ves qué vouchers no tienen abono en el banco.' },
      { p: '¿Sirve para un condominio con varios blocks?', r: 'Sí. Los recibos, la morosidad y las juntas directivas se ordenan por block; si tu edificio es de una sola torre, trabajas con una sola junta.' },
    ],
  },
} as const;

/** Texto del pie del marco público (portada, precios, registro y legales). Sin catálogo (cargando) dice «Precios sin impuestos.». */
export const pieMarco = (cat: Catalogo | null): string => `${MARCA_LARGA}. ${cat ? `Precios en ${monedaDe(cat.moneda)?.plural ?? cat.moneda}${Number(cat.impuesto.tasa) > 0 ? `, sin ${cat.impuesto.nombre}` : ''}.` : 'Precios sin impuestos.'}`;

/** Cabecera de /precios. */
export const PRECIOS_HERO = {
  h1: 'Cobra el mantenimiento sin Excel ni WhatsApp sueltos',
  bajada: 'Torre emite los recibos, recibe los vouchers y te dice quién debe. Empiezas gratis por 3 meses y después eliges Torre Básico o, cuando necesites todo, Torre Pro.',
} as const;

/** Cierre de /precios (el texto cambia con el registro abierto o cerrado). */
export const cierrePrecios = (abierto: boolean) => ({
  h2: 'Tu próximo recibo, desde Torre',
  texto: abierto ? 'Crea tu cuenta en Torre Gratis, carga tu Excel y emite el recibo del mes.' : 'Si ya tienes cuenta, ingresa y sigue cobrando desde Torre.',
});

/** Pantalla de registro (`/registro`), paso 1. */
export const REGISTRO = {
  h1: 'Crea tu cuenta gratis',
  paso: 'Paso 1 de 2: tu cuenta',
  texto: 'Sin tarjeta: empiezas en el plan Torre Gratis, que dura 3 meses, y después pasas a Torre Básico o Torre Pro. Te enviaremos un enlace para confirmar tu correo; tu condominio lo creas después, al entrar.',
} as const;

/** Los «hechos» bajo el título de /precios. Sin catálogo (todavía cargando) salen los genéricos. */
export function hechosPrecios(cat: Catalogo | null): string[] {
  const tope = cat?.planes.find(p => p.clave === 'gratis')?.unidades_maximas;
  const impuesto = cat && Number(cat.impuesto.tasa) > 0 ? `Más ${cat.impuesto.nombre}` : 'Sin impuesto adicional';
  return [
    cat ? `Precios en ${monedaDe(cat.moneda)?.plural ?? cat.moneda}` : 'Precios por país',
    impuesto,
    ...(tope != null ? [`Torre Gratis ${plazoGratisTexto(cat!)}, hasta ${tope} departamentos`] : cat ? [`Torre Gratis ${plazoGratisTexto(cat)}`, 'Torre Pro sin tope de departamentos'] : ['Empiezas gratis']),
    'Sin permanencia',
  ];
}

/** Título de la sección de planes. */
export const tituloPlanes = (cat: Catalogo): string => (cat.dias_gratis ? `Torre Gratis ${plazoGratisTexto(cat)}; después, Torre Básico o Torre Pro` : 'Torre Gratis con límite, o Torre Pro con todo');

/** «+ IGV» / «+ IVA»: el impuesto del país elegido; sin impuesto (tasa 0) no se menciona. */
export const masImpuesto = (cat: Catalogo): string => (Number(cat.impuesto.tasa) > 0 ? ` + ${cat.impuesto.nombre}` : '');

/** La línea bajo el precio grande de una tarjeta: por departamento al mes (con el impuesto del país) o el plazo de Gratis. `null` si el plan no tiene precio en la moneda («Consúltanos»). */
export function unidadPrecio(plan: Plan, cat: Catalogo): string | null {
  if (plan.precio_por_unidad === null) return null;
  return Number(plan.precio_por_unidad) === 0 ? plazoGratisTexto(cat) : `por departamento al mes${masImpuesto(cat)}`;
}

/** El tope de departamentos (Gratis), o el monto mínimo por condominio en soles (Básico, Torre Pro y Torre Administradora): «Desde S/ 30.00 al mes + IGV.» y, con tramo, «; desde el departamento 61, S/ 2.00 cada uno.». `null` si no aplica. */
export function textoTope(plan: Plan, cat: Catalogo): string | null {
  // Con tope y mínimo (Básico): el tope y el monto mínimo en soles, sin «mínimo N cobrados» (Miguel, 31-oct: se leía como un mínimo de departamentos).
  if (plan.unidades_maximas != null && plan.unidades_minimas != null) return `Hasta ${plan.unidades_maximas} departamentos por condominio${plan.total_minimo_mes ? ` · desde ${dinero(plan.total_minimo_mes, cat.moneda)} al mes${masImpuesto(cat)}` : ''}.`;
  if (plan.unidades_maximas != null) return `Hasta ${plan.unidades_maximas} departamentos por condominio.`;
  // Sólo el monto mínimo en soles: no se dice cuántos departamentos incluye (eso confundía: parecía que el departamento 21 pagaba otro precio).
  if (plan.unidades_minimas != null && plan.total_minimo_mes) return `Desde ${dinero(plan.total_minimo_mes, cat.moneda)} al mes${masImpuesto(cat)}${tramoDeTarjeta(plan, cat.moneda, dinero)}.`;
  return null;
}

/** Título y bajada de «Lo que trae Torre Pro». */
export function textosModulos(cat: Catalogo): { h2: string; bajada: string } {
  const nombre = cat.planes.find(p => p.clave === 'pro')?.nombre ?? 'Torre Pro';
  return { h2: `Lo que trae ${nombre}`, bajada: `Estos módulos van incluidos en ${nombre}; no se venden por separado y el plan Torre Gratis no los trae.` };
}

/** Respuestas cortas a lo que más preguntan; sólo lo que Torre hace hoy (cobro manual, sin pasarela ni contrato). Los topes salen del catálogo. */
export function preguntas(cat: Catalogo): { p: string; r: string }[] {
  const tope = cat.planes.find(x => x.clave === 'gratis')?.unidades_maximas;
  const pro = cat.planes.find(x => x.clave === 'pro');
  const basico = cat.planes.find(x => x.clave === 'basico');
  // Los planes de pago con monto mínimo en soles, en el orden del catálogo: «Torre Básico desde S/ 30.00 y Torre Pro desde S/ 60.00».
  const minimos = [basico, pro].flatMap(p => (p?.total_minimo_mes ? [`${p.nombre} desde ${dinero(p.total_minimo_mes, cat.moneda)}`] : []));
  const plazo = plazoGratisTexto(cat);
  const imp = Number(cat.impuesto.tasa);
  const nombreImp = cat.impuesto.nombre;
  return [
    { p: '¿Cómo se paga?', r: 'Por transferencia, Yape o Plin. Desde «Mi plan» ves el monto y la referencia de tu pago; cuando lo confirmamos, activamos tu plan.' },
    { p: '¿Cómo paso a un plan de pago?', r: 'Desde «Mi plan» lo pides por condominio. No se activa nada hasta confirmar el pago, así que no hay cobros por sorpresa. Torre Pro trae todo: ya no hay módulos sueltos.' },
    imp > 0
      ? { p: `¿El precio incluye ${nombreImp}?`, r: `No. Los precios de esta página no incluyen ${nombreImp}: se suma al pagar, según el país de tu condominio. La calculadora te muestra también el total con ${nombreImp}.` }
      : { p: '¿El precio incluye impuestos?', r: 'En el país elegido no se suma ningún impuesto al pagar: el precio de esta página es el que pagas.' },
    { p: '¿Hay permanencia o contrato?', r: 'No. No te atamos a un plazo mínimo.' },
    { p: '¿Cuánto dura y hasta cuántos departamentos llega Torre Gratis?', r: `${cat.dias_gratis ? `Torre Gratis dura ${plazo.replace('por ', '')} desde que creas tu cuenta` : 'Torre Gratis no tiene plazo'}${tope != null ? ` y llega hasta ${tope} departamentos por condominio` : ''}, con recibos, cobranza, portal del vecino, vouchers validados a mano y avisos por correo. Si quieres IA, WhatsApp, asistente, mora automática, reportes y conciliación bancaria, pasas a Torre Pro.` },
    ...(cat.dias_gratis ? [{ p: '¿Qué pasa cuando termina el plan Torre Gratis?', r: `El condominio queda en solo lectura: puedes ver todo, pero no registrar recibos, pagos ni comunicados nuevos. No se borra nada, y vuelves a registrar apenas pases a ${basico ? `${basico.nombre} o ` : ''}Torre Pro. Te avisamos al empezar, siete días antes y el día que termina.` }] : []),
    ...(basico && basico.unidades_maximas != null ? [{ p: `¿Qué es ${basico.nombre}?`, r: `Es el plan para edificios chicos que ya terminaron su periodo gratis: lo mismo que Torre Gratis, sin plazo, hasta ${basico.unidades_maximas} departamentos${basico.precio_por_unidad !== null ? `, a ${dinero(basico.precio_por_unidad, cat.moneda)} por departamento al mes${basico.total_minimo_mes ? `, desde ${dinero(basico.total_minimo_mes, cat.moneda)} al mes por condominio` : ''}` : ''}. No trae IA, WhatsApp, asistente, mora automática ni reportes: eso es de Torre Pro.` }] : []),
    { p: '¿Y si mi edificio tiene pocos departamentos?', r: minimos.length > 0 ? `Cada plan de pago tiene un monto mínimo por condominio (${minimos.join(' y ')} al mes${masImpuesto(cat)}). Si tu edificio tiene pocos departamentos, pagas ese mínimo; si tiene más, pagas cada departamento al precio del plan.` : 'Pagas sólo por los departamentos que tengas.' },
  ];
}

/** Las preguntas de la portada: las propias del producto y, del catálogo, las de pago, permanencia y plazo de Gratis (las mismas de /precios). */
export function preguntasPortada(cat: Catalogo | null): { p: string; r: string }[] {
  const delCatalogo = cat ? preguntas(cat).filter(q => /^¿(Cómo se paga|Hay permanencia|Cuánto dura)/.test(q.p)) : [];
  return [...PORTADA.preguntas.lista, ...delCatalogo];
}
