// HTML de las páginas públicas indexables: el `<head>` propio de cada ruta, los datos estructurados (JSON-LD) y el contenido estático que va dentro
// de `#root` (React lo reemplaza al montar; `main.tsx` usa `createRoot`, no `hydrate`). Los textos son LOS MISMOS de la página real
// (`src/lib/seo/textos.ts` y los textos legales): nada distinto para robots. Todo dato de la base pasa por `esc` / `jsonSeguro`.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { dinero } from '../../ui/format';
import { MARCA, MARCA_LARGA, PORTADA, PRECIOS_HERO, REGISTRO, cierrePrecios, hechosPrecios, pieMarco, preguntas, textoTope, textosModulos, tituloPlanes, unidadPrecio } from '../../lib/seo/textos';
import { textosPrivacidad, textosTerminos } from '../../pages/publico/legal/textos';
import { VERSION_LEGAL, datosLegales } from '../services/comercial/legal';
import type { Plan } from '../../pages/publico/catalogo';
import type { ContextoSeo } from './contexto';
import { esc, jsonSeguro, textoMeta } from './escapar';
import { QUE_ES } from './contenido';
import type { RutaPublica } from './rutas';

export const MAX_TITULO = 60;
export const MAX_DESCRIPCION = 160;

export interface InfoPagina { ruta: RutaPublica; titulo: string; descripcion: string; nombre: string }

const TITULOS: Record<RutaPublica, { titulo: string; nombre: string }> = {
  '/': { titulo: 'Torre · Administración de condominios', nombre: 'Inicio' },
  '/precios': { titulo: 'Precios | Torre · Administración de condominios', nombre: 'Precios' },
  '/registro': { titulo: 'Crea tu cuenta | Torre · Administración de condominios', nombre: 'Crear cuenta' },
  '/privacidad': { titulo: 'Privacidad | Torre · Administración de condominios', nombre: 'Política de privacidad' },
  '/terminos': { titulo: 'Términos | Torre · Administración de condominios', nombre: 'Términos y condiciones' },
};

/** Descripción de /precios con el precio más bajo de pago del catálogo (si hay); sin catálogo, la genérica. */
function descripcionPrecios(ctx: ContextoSeo | null): string {
  const base = 'Planes de Torre para administrar condominios en el Perú: Torre Gratis para empezar y planes de pago por departamento al mes, sin permanencia.';
  if (!ctx) return base;
  const precios = ctx.cat.planes.filter(p => p.precio_por_unidad !== null && Number(p.precio_por_unidad) > 0).map(p => Number(p.precio_por_unidad));
  if (!precios.length) return base;
  const desde = dinero(Math.min(...precios), ctx.cat.moneda);
  const imp = Number(ctx.cat.impuesto.tasa) > 0 ? ` + ${ctx.cat.impuesto.nombre}` : '';
  return `Torre Gratis para empezar y planes de pago desde ${desde} por departamento al mes${imp}, sin permanencia. Elige el plan para tu condominio en el Perú.`;
}

const DESCRIPCIONES: Record<Exclude<RutaPublica, '/precios'>, string> = {
  '/': 'Torre ordena recibos, pagos y morosidad de edificios y condominios en el Perú: recibos por block, vouchers con IA y avisos por WhatsApp. Empieza gratis.',
  '/registro': 'Crea tu cuenta en Torre Gratis, sin tarjeta, y emite el primer recibo de tu condominio. Después eliges Torre Básico o Torre Pro.',
  '/privacidad': 'Cómo Torre trata los datos personales de administradoras, juntas, vecinos y personal del edificio, según la Ley N.º 29733 de Protección de Datos Personales.',
  '/terminos': 'Condiciones de uso de Torre, el servicio para administrar edificios y condominios: cuentas, planes y pagos, validación de vouchers y responsabilidades.',
};

export function infoPagina(ruta: RutaPublica, ctx: ContextoSeo | null): InfoPagina {
  const { titulo, nombre } = TITULOS[ruta];
  const descripcion = ruta === '/precios' ? descripcionPrecios(ctx) : DESCRIPCIONES[ruta];
  return { ruta, titulo: textoMeta(titulo, MAX_TITULO), descripcion: textoMeta(descripcion, MAX_DESCRIPCION), nombre };
}

/** URL absoluta de una ruta (`/` lleva barra). `null` si el superadmin no cargó la URL pública: sin ella no se inventan enlaces. */
export const urlDe = (base: string, ruta: string): string | null => (base ? `${base}${ruta}` : null);

// ---------- Datos estructurados ----------
type Json = Record<string, unknown>;

/** Una oferta por plan con precio en la moneda del catálogo (sin impuesto: `valueAddedTaxIncluded: false`). Un plan «Consúltanos» no lleva oferta. */
function ofertas(ctx: ContextoSeo): Json[] {
  const { cat, base } = ctx;
  return cat.planes.filter(p => p.precio_por_unidad !== null).map((p) => ({
    '@type': 'Offer',
    name: p.nombre,
    description: [p.descripcion, textoTope(p, cat)].filter(Boolean).join(' '),
    price: p.precio_por_unidad,
    priceCurrency: cat.moneda,
    ...(base ? { url: `${base}/precios` } : {}),
    availability: 'https://schema.org/InStock',
    priceSpecification: { '@type': 'UnitPriceSpecification', price: p.precio_por_unidad, priceCurrency: cat.moneda, unitText: 'departamento al mes', valueAddedTaxIncluded: false },
  }));
}

function aplicacion(ctx: ContextoSeo): Json {
  const { base } = ctx;
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: MARCA,
    alternateName: MARCA_LARGA,
    description: QUE_ES,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    inLanguage: 'es-PE',
    ...(base ? { url: `${base}/`, publisher: { '@id': `${base}/#organizacion` } } : {}),
    offers: ofertas(ctx),
  };
}

function organizacion(ctx: ContextoSeo): Json {
  const { cfg, base } = ctx;
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    ...(base ? { '@id': `${base}/#organizacion`, url: `${base}/`, logo: `${base}/apple-touch-icon.png` } : {}),
    name: MARCA,
    ...(cfg.legal_razon_social ? { legalName: cfg.legal_razon_social } : {}),
    ...(cfg.legal_correo ? { email: cfg.legal_correo } : {}),
  };
}

function sitioWeb(ctx: ContextoSeo): Json {
  const { base } = ctx;
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    ...(base ? { '@id': `${base}/#sitio`, url: `${base}/`, publisher: { '@id': `${base}/#organizacion` } } : {}),
    name: MARCA,
    alternateName: MARCA_LARGA,
    inLanguage: 'es-PE',
  };
}

function migas(ctx: ContextoSeo, info: InfoPagina): Json {
  const { base } = ctx;
  const inicio = TITULOS['/'].nombre;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: inicio, ...(base ? { item: `${base}/` } : {}) },
      { '@type': 'ListItem', position: 2, name: info.nombre, ...(base ? { item: `${base}${info.ruta}` } : {}) },
    ],
  };
}

/** Las MISMAS preguntas que la página (`preguntas(cat)`), como `FAQPage`. */
const faq = (ctx: ContextoSeo): Json => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: preguntas(ctx.cat).map(({ p, r }) => ({ '@type': 'Question', name: p, acceptedAnswer: { '@type': 'Answer', text: r } })),
});

export function datosEstructurados(info: InfoPagina, ctx: ContextoSeo): Json[] {
  switch (info.ruta) {
    case '/': return [organizacion(ctx), sitioWeb(ctx), aplicacion(ctx)];
    case '/precios': return [aplicacion(ctx), faq(ctx), migas(ctx, info)];
    default: return [migas(ctx, info)];
  }
}

// ---------- <head> ----------
export interface OpcionesHead {
  /** Valor de `<meta name="robots">`. */
  robots: string;
  /** Sólo en la portada: los códigos de verificación de buscadores (de la base). */
  verificacion?: { google?: string | null; bing?: string | null };
}

const meta = (atributo: 'name' | 'property', clave: string, contenido: string) => `<meta ${atributo}="${esc(clave)}" content="${esc(contenido)}" />`;

/** Etiquetas del `<head>` de una página pública. Sin contexto (la base falló) sólo lleva lo que no depende de ella: título, descripción y robots. */
export function construirHead(info: InfoPagina, ctx: ContextoSeo | null, o: OpcionesHead): string {
  const canonica = ctx ? urlDe(ctx.base, info.ruta) : null;
  const imagen = ctx?.base ? `${ctx.base}/og-torre.png` : null;
  const l: string[] = [
    `<title>${esc(info.titulo)}</title>`,
    meta('name', 'description', info.descripcion),
    meta('name', 'robots', o.robots),
  ];
  if (o.verificacion?.google) l.push(meta('name', 'google-site-verification', o.verificacion.google));
  if (o.verificacion?.bing) l.push(meta('name', 'msvalidate.01', o.verificacion.bing));
  if (canonica) {
    l.push(`<link rel="canonical" href="${esc(canonica)}" />`);
    l.push(`<link rel="alternate" hreflang="es-PE" href="${esc(canonica)}" />`);
    l.push(`<link rel="alternate" hreflang="x-default" href="${esc(canonica)}" />`);
  }
  l.push(meta('property', 'og:type', 'website'), meta('property', 'og:site_name', MARCA_LARGA), meta('property', 'og:locale', 'es_PE'), meta('property', 'og:title', info.titulo), meta('property', 'og:description', info.descripcion));
  if (canonica) l.push(meta('property', 'og:url', canonica));
  if (imagen) l.push(meta('property', 'og:image', imagen), meta('property', 'og:image:width', '1200'), meta('property', 'og:image:height', '630'), meta('property', 'og:image:alt', MARCA_LARGA));
  l.push(meta('name', 'twitter:card', 'summary_large_image'), meta('name', 'twitter:title', info.titulo), meta('name', 'twitter:description', info.descripcion));
  if (imagen) l.push(meta('name', 'twitter:image', imagen));
  if (ctx) for (const d of datosEstructurados(info, ctx)) l.push(`<script type="application/ld+json">${jsonSeguro(d)}</script>`);
  return l.join('\n    ');
}

// ---------- Contenido estático dentro de #root ----------
const A = (href: string, texto: string) => `<a href="${esc(href)}">${esc(texto)}</a>`;

/** Marco mínimo (cabecera con navegación, contenido y pie): los mismos textos del marco real; React lo reemplaza al montar. */
function marco(ctx: ContextoSeo, contenido: string): string {
  const abierto = ctx.cfg.registro_abierto;
  return `<div style="max-width:64rem;margin:0 auto;padding:1rem 1.25rem;line-height:1.6">
<header style="display:flex;flex-wrap:wrap;gap:.75rem 1.25rem;align-items:center;justify-content:space-between"><a href="/" style="font-weight:600;font-size:1.25rem;text-decoration:none">${esc(MARCA)}</a>
<nav aria-label="Principal" style="display:flex;gap:1rem">${A('/precios', 'Precios')} ${A('/login', 'Ingresar')}${abierto ? ` ${A('/registro', 'Crear cuenta')}` : ''}</nav></header>
<main style="padding:2rem 0">${contenido}</main>
<footer style="font-size:.75rem"><p>${esc(pieMarco(ctx.cat))}</p>
<nav aria-label="Legal">${A('/privacidad', 'Privacidad')} · ${A('/terminos', 'Términos')}</nav></footer>
</div>`;
}

const estiloH1 = 'font-size:1.875rem;line-height:1.2;font-weight:600;margin:0 0 1rem';
const estiloH2 = 'font-size:1.5rem;line-height:1.25;font-weight:600;margin:2rem 0 .75rem';

function cuerpoPortada(): string {
  return `<section><h1 style="${estiloH1}">${esc(PORTADA.h1)}</h1>
<p>${esc(PORTADA.bajada)}</p>
<p>${A('/registro', PORTADA.botones.registro)} · ${A('/precios', PORTADA.botones.precios)}</p></section>
<ul style="list-style:none;padding:0">${PORTADA.beneficios.map(b => `<li><h2 style="${estiloH2}">${esc(b.titulo)}</h2><p>${esc(b.texto)}</p></li>`).join('')}</ul>`;
}

function tarjetaPlan(p: Plan, ctx: ContextoSeo): string {
  const precio = p.precio_por_unidad === null ? 'Consúltanos' : dinero(p.precio_por_unidad, ctx.cat.moneda);
  const unidad = p.precio_por_unidad === null ? 'el precio para tu país' : unidadPrecio(p, ctx.cat);
  const tope = textoTope(p, ctx.cat);
  return `<article><h3 style="font-size:1.25rem;font-weight:600;margin:1.25rem 0 .25rem">${esc(p.nombre)}</h3>
${p.descripcion ? `<p>${esc(p.descripcion)}</p>` : ''}<p><strong>${esc(precio)}</strong> ${esc(unidad)}</p>
${tope ? `<p>${esc(tope)}</p>` : ''}${p.caracteristicas.length ? `<ul>${p.caracteristicas.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}</article>`;
}

function cuerpoPrecios(ctx: ContextoSeo): string {
  const { cat } = ctx;
  const abierto = ctx.cfg.registro_abierto;
  const modulos = textosModulos(cat);
  const cierre = cierrePrecios(abierto);
  const orden = ['gratis', 'basico', 'pro', 'administradora'];
  const planes = orden.map(c => cat.planes.find(p => p.clave === c)).filter((p): p is Plan => !!p);
  return `<header><h1 style="${estiloH1}">${esc(PRECIOS_HERO.h1)}</h1>
<p>${esc(PRECIOS_HERO.bajada)}</p>
<ul>${hechosPrecios(cat).map(h => `<li>${esc(h)}</li>`).join('')}</ul>
<p>${abierto ? A('/registro', 'Crear cuenta gratis') : A('/login', 'Ingresar')}</p>${abierto ? '' : '<p>El registro de cuentas nuevas está cerrado por ahora.</p>'}</header>
<section aria-labelledby="planes-titulo"><h2 id="planes-titulo" style="${estiloH2}">${esc(tituloPlanes(cat))}</h2>${planes.map(p => tarjetaPlan(p, ctx)).join('\n')}</section>
<section aria-labelledby="modulos-titulo"><h2 id="modulos-titulo" style="${estiloH2}">${esc(modulos.h2)}</h2><p>${esc(modulos.bajada)}</p>
<ul>${cat.modulos.map(m => `<li><h3 style="font-size:1.125rem;font-weight:600;margin:1rem 0 .25rem">${esc(m.nombre)}</h3>${m.descripcion ? `<p>${esc(m.descripcion)}</p>` : ''}</li>`).join('')}</ul></section>
<section aria-labelledby="preguntas-titulo"><h2 id="preguntas-titulo" style="${estiloH2}">Preguntas frecuentes</h2>
${preguntas(cat).map(({ p, r }) => `<p><strong>${esc(p)}</strong> ${esc(r)}</p>`).join('\n')}</section>
<section aria-labelledby="cierre-titulo"><h2 id="cierre-titulo" style="${estiloH2}">${esc(cierre.h2)}</h2><p>${esc(cierre.texto)}</p>
<p>${abierto ? A('/registro', 'Crear cuenta gratis') : A('/login', 'Ingresar')}</p></section>`;
}

function cuerpoRegistro(): string {
  return `<h1 style="${estiloH1}">${esc(REGISTRO.h1)}</h1>
<p><strong>${esc(REGISTRO.paso)}</strong></p>
<p>${esc(REGISTRO.texto)}</p>
<p>Al crear tu cuenta aceptas los ${A('/terminos', 'Términos y condiciones')} y la ${A('/privacidad', 'Política de privacidad')}.</p>
<p>¿Ya tienes cuenta? ${A('/login', 'Ingresa')}</p>`;
}

/** Los textos legales son los MISMOS componentes de la página (se renderizan con React): una sola fuente, sin copia que se desactualice. */
function cuerpoLegal(ruta: '/privacidad' | '/terminos', ctx: ContextoSeo): string {
  const legal = { datos: datosLegales(ctx.cfg), cargando: false };
  const esPrivacidad = ruta === '/privacidad';
  const { intro, secciones } = esPrivacidad ? textosPrivacidad(legal) : textosTerminos(legal);
  const articulo = createElement('article', null,
    createElement('h1', { style: { fontSize: '1.875rem', lineHeight: 1.2, fontWeight: 600, margin: '0 0 .5rem' } }, esPrivacidad ? 'Política de privacidad' : 'Términos y condiciones'),
    createElement('p', { style: { fontSize: '.75rem' } }, `Versión: ${VERSION_LEGAL} · Borrador sujeto a revisión legal`),
    intro ? createElement('div', null, intro) : null,
    ...secciones.map(s => createElement('section', { key: s.id, id: s.id }, createElement('h2', { style: { fontSize: '1.125rem', fontWeight: 600, margin: '1.5rem 0 .5rem' } }, s.titulo), createElement('div', null, s.cuerpo))),
  );
  return renderToStaticMarkup(createElement(StaticRouter, { location: ruta }, articulo));
}

/** Contenido de `#root` para una ruta pública. */
export function construirCuerpo(ruta: RutaPublica, ctx: ContextoSeo): string {
  switch (ruta) {
    case '/': return marco(ctx, cuerpoPortada());
    case '/precios': return marco(ctx, cuerpoPrecios(ctx));
    case '/registro': return marco(ctx, cuerpoRegistro());
    default: return marco(ctx, cuerpoLegal(ruta, ctx));
  }
}
