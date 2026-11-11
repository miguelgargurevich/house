// Documentos que leen los rastreadores: robots.txt, sitemap.xml, llms.txt y llms-full.txt. Dinámicos (planes y precios salen de la base).
import { dinero } from '../../ui/format';
import { MARCA_LARGA, preguntas, textoTope, unidadPrecio } from '../../lib/seo/textos';
import { VERSION_LEGAL } from '../services/comercial/legal';
import { FECHA_CONTENIDO, FUNCIONES, LIMITES, PARA_QUIEN, QUE_ES } from './contenido';
import type { ContextoSeo } from './contexto';
import { esc } from './escapar';
import { PREFIJOS_PRIVADOS } from './rutas';

/** Rastreadores de IA y de buscadores a los que se les da paso EXPLÍCITO: Miguel quiere que los LLM encuentren Torre. */
export const RASTREADORES_IA = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'Google-Extended', 'PerplexityBot', 'ClaudeBot', 'Claude-SearchBot', 'Applebot-Extended', 'CCBot', 'Bingbot'] as const;

/** Un bot con su propio grupo IGNORA el grupo `*`: por eso cada grupo repite las mismas reglas. */
export function robotsTxt(base: string): string {
  const reglas = ['Allow: /', ...PREFIJOS_PRIVADOS.map(p => `Disallow: ${p}`)].join('\n');
  const grupos = [`User-agent: *\n${reglas}`, ...RASTREADORES_IA.map(b => `User-agent: ${b}\n${reglas}`)];
  return `# ${MARCA_LARGA}. Lo público se puede rastrear; la API y las áreas privadas no.\n\n${grupos.join('\n\n')}\n${base ? `\nSitemap: ${base}/sitemap.xml\n` : ''}`;
}

interface EntradaSitemap { ruta: string; lastmod: string }

const dia = (d: Date) => d.toISOString().slice(0, 10);

/** Las rutas indexables con su `lastmod` real: /precios lleva el cambio más reciente del catálogo; las legales, su versión; /registro sólo con el registro abierto. */
export function entradasSitemap(ctx: ContextoSeo): EntradaSitemap[] {
  const e: EntradaSitemap[] = [
    { ruta: '/', lastmod: FECHA_CONTENIDO },
    { ruta: '/precios', lastmod: ctx.modificadoPrecios ? dia(ctx.modificadoPrecios) : FECHA_CONTENIDO },
  ];
  if (ctx.cfg.registro_abierto) e.push({ ruta: '/registro', lastmod: FECHA_CONTENIDO });
  e.push({ ruta: '/contacto', lastmod: FECHA_CONTENIDO }, { ruta: '/libro-de-reclamaciones', lastmod: FECHA_CONTENIDO }, { ruta: '/app', lastmod: FECHA_CONTENIDO });
  e.push({ ruta: '/privacidad', lastmod: VERSION_LEGAL }, { ruta: '/terminos', lastmod: VERSION_LEGAL });
  return e;
}

export function sitemapXml(ctx: ContextoSeo): string {
  const urls = entradasSitemap(ctx).map(({ ruta, lastmod }) => `  <url>\n    <loc>${esc(`${ctx.base}${ruta}`)}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// ---------- llms.txt (llmstxt.org) ----------
/** Una línea por plan: nombre, precio y a qué tiene derecho, tal como lo publica el catálogo. */
function lineasPlanes(ctx: ContextoSeo, detalle: boolean): string[] {
  const { cat } = ctx;
  return cat.planes.map((p) => {
    const precio = p.precio_por_unidad === null ? 'precio a consultar en tu país' : `${dinero(p.precio_por_unidad, cat.moneda)} ${unidadPrecio(p, cat)}`;
    const tope = textoTope(p, cat);
    const extra = detalle ? `${p.descripcion ? ` ${p.descripcion}` : ''}${p.caracteristicas.length ? ` Incluye: ${p.caracteristicas.join('; ')}.` : ''}` : '';
    return `- **${p.nombre}**: ${precio}.${tope ? ` ${tope}` : ''}${extra}`;
  });
}

const impuestoNota = (ctx: ContextoSeo) => (Number(ctx.cat.impuesto.tasa) > 0 ? `Los precios no incluyen ${ctx.cat.impuesto.nombre}, que se suma al pagar.` : 'En el país elegido no se suma impuesto al pagar.');

function paginas(ctx: ContextoSeo): string[] {
  const u = (r: string) => `${ctx.base}${r}`;
  return [
    `- [Inicio](${u('/')}): qué es Torre y para quién es.`,
    `- [Precios](${u('/precios')}): planes, precio por departamento al mes y preguntas frecuentes.`,
    ...(ctx.cfg.registro_abierto ? [`- [Crear cuenta](${u('/registro')}): registro en Torre Gratis, sin tarjeta.`] : []),
    `- [Contacto](${u('/contacto')}): escríbenos o pide una demo.`,
    `- [Libro de Reclamaciones](${u('/libro-de-reclamaciones')}): registra un reclamo o una queja sobre el servicio.`,
    `- [Términos y condiciones](${u('/terminos')}): condiciones de uso del servicio.`,
    `- [Política de privacidad](${u('/privacidad')}): tratamiento de datos personales (Ley N.º 29733).`,
  ];
}

export function llmsTxt(ctx: ContextoSeo): string {
  return [
    `# ${MARCA_LARGA}`,
    '',
    `> ${QUE_ES}`,
    '',
    `${MARCA_LARGA}. Para quién: ${PARA_QUIEN} Precios en ${ctx.cat.moneda}, por departamento al mes. ${impuestoNota(ctx)}`,
    '',
    '## Páginas',
    '',
    ...paginas(ctx),
    '',
    '## Planes',
    '',
    ...lineasPlanes(ctx, false),
    '',
    '## Más detalle',
    '',
    `- [llms-full.txt](${ctx.base}/llms-full.txt): funciones, planes, preguntas frecuentes y límites en un solo documento.`,
    '',
  ].join('\n');
}

export function llmsFullTxt(ctx: ContextoSeo): string {
  const contacto = ctx.cfg.legal_correo ? ['', `Contacto de privacidad y consultas: ${ctx.cfg.legal_correo}`] : [];
  return [
    `# ${MARCA_LARGA}: documentación completa`,
    '',
    `> ${QUE_ES}`,
    '',
    `${MARCA_LARGA}. País: Perú. Idioma: español. Se usa desde el navegador.`,
    '',
    '## Para quién es',
    '',
    PARA_QUIEN,
    '',
    '## Qué hace',
    '',
    ...FUNCIONES.map(f => `- **${f.nombre}**: ${f.texto}${f.plan ? ` (${f.plan}.)` : ''}`),
    '',
    '## Planes y precios',
    '',
    `Precios en ${ctx.cat.moneda}, por departamento al mes. ${impuestoNota(ctx)} Sin permanencia ni contrato.`,
    '',
    ...lineasPlanes(ctx, true),
    ...(ctx.cat.modulos.length ? ['', 'Módulos que trae Torre Pro (no se venden por separado):', '', ...ctx.cat.modulos.map(m => `- **${m.nombre}**${m.descripcion ? `: ${m.descripcion}` : ''}`)] : []),
    '',
    '## Preguntas frecuentes',
    '',
    ...preguntas(ctx.cat).flatMap(({ p, r }) => [`### ${p}`, '', r, '']),
    '## Lo que Torre no hace hoy',
    '',
    ...LIMITES.map(l => `- ${l}`),
    '',
    '## Páginas',
    '',
    ...paginas(ctx),
    ...contacto,
    '',
  ].join('\n');
}
