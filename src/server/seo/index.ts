// SEO de la parte pública: el servidor entrega el HTML de la SPA con su `<head>` y su contenido propios (lo que ven buscadores y LLM que no
// ejecutan JavaScript), los documentos para rastreadores (robots.txt, sitemap.xml, llms.txt) y un solo dominio canónico.
// La URL base sale SIEMPRE de `ConfiguracionComercial.url_publica` (nunca de la cabecera Host: un enlace envenenable). El Host sólo se COMPARA.
import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type RequestHandler } from 'express';
import { llmsFullTxt, llmsTxt, robotsTxt, sitemapXml } from './documentos';
import { baseDe, cargarContexto, hostDe, seoDeps, type ContextoSeo } from './contexto';
import { construirCuerpo, construirHead, infoPagina } from './paginas';
import { esDesconocida, esPublica, normalizarRuta, robotsPrivado } from './rutas';

const TEXTO = 'text/plain; charset=utf-8';
const CACHE_DOCUMENTOS = 'public, max-age=300';
/** Rutas a las que no se les aplica el redirect de www ni nada de esto. */
const NO_PAGINA = /^\/(api|mcp|assets)(\/|$)/;

const hostDe_ = (req: Request): string => (req.hostname || '').toLowerCase();

/** Lee `dist/index.html` y lo recuerda mientras no cambie el archivo (un redespliegue lo reemplaza). */
function plantillaDe(distDir: string) {
  const archivo = path.join(distDir, 'index.html');
  let guardada: { mtime: number; html: string } | null = null;
  return (): string | null => {
    try {
      const mtime = fs.statSync(archivo).mtimeMs;
      if (!guardada || guardada.mtime !== mtime) guardada = { mtime, html: fs.readFileSync(archivo, 'utf8') };
      return guardada.html;
    } catch { return null; }
  };
}

/** Pone `head` antes de `</head>` y `cuerpo` dentro de `#root`. Los reemplazos van como función: un `$&` o `$1` en un nombre de plan no se interpreta. */
export function inyectar(plantilla: string, head: string, cuerpo: string | null, reemplazaTitulo: boolean): string {
  let html = plantilla;
  if (reemplazaTitulo) html = html.replace(/<title>[\s\S]*?<\/title>\s*/i, () => '').replace(/<meta\s+name=["']description["'][^>]*>\s*/i, () => '');
  html = html.replace(/<\/head>/i, () => `    ${head}\n  </head>`);
  if (cuerpo) html = html.replace('<div id="root"></div>', () => `<div id="root">${cuerpo}</div>`);
  return html;
}

/** Antes de servir cualquier cosa: `www.<dominio canónico>` → 301 al dominio canónico (sólo GET/HEAD de páginas, nunca la API). */
const redirigirWww: RequestHandler = async (req, res, next) => {
  if ((req.method !== 'GET' && req.method !== 'HEAD') || NO_PAGINA.test(req.path)) return next();
  const host = hostDe_(req);
  if (!host.startsWith('www.')) return next(); // lo común: ni se toca la base
  try {
    const base = baseDe(await seoDeps.obtenerConfiguracion());
    const canonico = hostDe(base);
    if (canonico && host === `www.${canonico}`) { res.redirect(301, `${base}${req.originalUrl}`); return; }
  } catch (e) { console.error('[seo] no se pudo leer la URL pública para el redirect de www:', e instanceof Error ? e.message : e); }
  next();
};

/** www → canónico y los documentos de los rastreadores. Va ANTES de los archivos estáticos y funciona aunque no haya `dist/`. */
export function seoDocumentos(): Router {
  const r = Router();
  r.use(redirigirWww);

  r.get('/robots.txt', async (_req, res) => {
    let base = '';
    try { base = baseDe(await seoDeps.obtenerConfiguracion()); } catch { /* sin base: robots sin la línea Sitemap */ }
    res.set('Cache-Control', CACHE_DOCUMENTOS).type(TEXTO).send(robotsTxt(base));
  });

  const conContexto = (cuerpo: (ctx: ContextoSeo) => string, tipo: string, exigeBase: boolean): RequestHandler => async (_req, res) => {
    let ctx: ContextoSeo;
    try { ctx = await cargarContexto(); } catch (e) {
      console.error('[seo] no se pudo cargar el catálogo:', e instanceof Error ? e.message : e);
      res.status(503).set('Retry-After', '60').type(TEXTO).send('No disponible por ahora');
      return;
    }
    if (exigeBase && !ctx.base) { res.status(404).type(TEXTO).send('No encontrado'); return; } // sin URL pública no hay URLs absolutas que publicar
    res.set('Cache-Control', CACHE_DOCUMENTOS).type(tipo).send(cuerpo(ctx));
  };
  r.get('/sitemap.xml', conContexto(sitemapXml, 'application/xml; charset=utf-8', true));
  r.get('/llms.txt', conContexto(llmsTxt, TEXTO, false));
  r.get('/llms-full.txt', conContexto(llmsFullTxt, TEXTO, false));
  return r;
}

/**
 * La SPA con SEO: `dist/index.html` + `<head>` y contenido propios en las páginas públicas indexables; `noindex` en todo lo demás.
 * Cache-Control: no-cache (los precios cambian en la base). Si la base falla, la página pública sale igual con su head genérico (nunca un 500).
 */
export function paginaSpa(distDir: string): RequestHandler {
  const plantilla = plantillaDe(distDir);
  return async (req, res, next) => {
    const html = plantilla();
    if (!html) return next();
    const ruta = normalizarRuta(req.path);
    res.set('Cache-Control', 'no-cache').type('html');

    if (!esPublica(ruta)) { // privadas, de un solo uso o desconocidas: nunca se indexan
      const robots = robotsPrivado(ruta);
      if (esDesconocida(ruta)) res.status(404); // una ruta que no es de nadie: 404 real (la SPA pinta «No encontramos esta página»)
      res.set('X-Robots-Tag', robots).send(inyectar(html, `<meta name="robots" content="${robots}" />`, null, false));
      return;
    }

    let ctx: ContextoSeo | null = null;
    try { ctx = await cargarContexto(); } catch (e) { console.error('[seo] la base falló; se sirve el head genérico:', e instanceof Error ? e.message : e); }

    // Fuera del dominio canónico (p. ej. house.gargurevich.dev) y con el registro cerrado, la página no se indexa.
    const canonico = ctx ? hostDe(ctx.base) : null;
    const otroHost = !!canonico && hostDe_(req) !== canonico;
    const registroCerrado = ruta === '/registro' && !!ctx && !ctx.cfg.registro_abierto;
    const robots = otroHost ? 'noindex, follow' : registroCerrado ? 'noindex, follow' : 'index, follow, max-image-preview:large';
    if (otroHost) res.set('X-Robots-Tag', 'noindex'); else if (registroCerrado) res.set('X-Robots-Tag', 'noindex, follow');

    const info = infoPagina(ruta, ctx);
    let head: string; let cuerpo: string | null = null;
    try {
      head = construirHead(info, ctx, { robots, verificacion: ruta === '/' && ctx ? { google: ctx.cfg.google_site_verification, bing: ctx.cfg.bing_site_verification } : undefined });
      if (ctx) cuerpo = construirCuerpo(ruta, ctx);
    } catch (e) {
      console.error('[seo] no se pudo armar la página; se sirve el head genérico:', e instanceof Error ? e.message : e);
      head = construirHead(info, null, { robots }); cuerpo = null;
    }
    res.send(inyectar(html, head, cuerpo, true));
  };
}
