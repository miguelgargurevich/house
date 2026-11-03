// SEO de la parte pública: HTML con contenido real y <head> propio por ruta, datos estructurados, escapado de lo que viene de la base, noindex en lo privado
// y en el host no canónico, robots.txt / sitemap.xml / llms.txt, www → dominio canónico, y que la API y /assets no cambian.
import './helpers/env';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar } from './helpers/app';
import { catalogoPublico } from '../src/server/services/comercial/suscripciones';
import { inyectar } from '../src/server/seo';
import { seoDeps } from '../src/server/seo/contexto';
import { PUBLICAS } from '../src/server/seo/rutas';
import { RASTREADORES_IA } from '../src/server/seo/documentos';
import { MAX_DESCRIPCION, MAX_TITULO } from '../src/server/seo/paginas';
import { PORTADA, PRECIOS_HERO, REGISTRO, preguntas } from '../src/lib/seo/textos';
import { dinero } from '../src/ui/format';
import type { Catalogo } from '../src/pages/publico/catalogo';

const CANONICO = 'torre.ejemplo.test';
const URL_CANONICA = `https://${CANONICO}`;
const PLANTILLA = `<!doctype html>
<html lang="es-PE">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#0f766e" />
    <title>Torre · Administración de condominios</title>
    <meta name="description" content="respaldo genérico" />
    <script type="module" crossorigin src="/assets/index-abc123.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

let base: string;
let cerrar: () => Promise<void>;
let dist: string;
let superadmin: string;

before(async () => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-dist-'));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'index.html'), PLANTILLA);
  fs.writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dist, 'og-torre.png'), 'png');
  await sembrar();
  ({ base, cerrar } = await iniciar({ distDir: dist }));
  superadmin = await login(base, 'super@test.pe');
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
  fs.rmSync(dist, { recursive: true, force: true });
});

beforeEach(async () => {
  await prisma.configuracionComercial.update({ where: { id: 1 }, data: { url_publica: URL_CANONICA, registro_abierto: true, google_site_verification: null, bing_site_verification: null, legal_razon_social: null, legal_ruc: null, legal_domicilio: null, legal_correo: null } });
});
afterEach(() => { mock.restoreAll(); });

interface Resp { status: number; headers: http.IncomingHttpHeaders; texto: string }
/** Petición cruda: deja fijar el Host (con `fetch` no se puede) y no sigue redirecciones. */
function pedir(ruta: string, o: { host?: string; metodo?: string; ua?: string } = {}): Promise<Resp> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path: ruta, method: o.metodo ?? 'GET', headers: { host: o.host ?? CANONICO, ...(o.ua ? { 'user-agent': o.ua } : {}) } }, (r) => {
      let d = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { d += c; });
      r.on('end', () => resolve({ status: r.statusCode ?? 0, headers: r.headers, texto: d }));
    });
    req.on('error', reject);
    req.end();
  });
}

const etiqueta = (html: string, patron: RegExp) => patron.exec(html)?.[1];
const metaContenido = (html: string, clave: string, atributo: 'name' | 'property' = 'name') => etiqueta(html, new RegExp(`<meta ${atributo}="${clave.replace(/\./g, '\\.')}" content="([^"]*)"`));
const canonica = (html: string) => etiqueta(html, /<link rel="canonical" href="([^"]*)"/);
const jsonLd = (html: string): Record<string, any>[] => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])); // eslint-disable-line @typescript-eslint/no-explicit-any
const tipos = (html: string) => jsonLd(html).map((d) => d['@type']);
const raiz = (html: string) => /<div id="root">([\s\S]*)<\/div>\s*<\/body>/.exec(html)?.[1] ?? '';
const titulo = (html: string) => etiqueta(html, /<title>([^<]*)<\/title>/);
const textoPlano = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
/** Un monto como lo dice la página, con el espacio duro (que `textoPlano` ya convirtió en espacio) normalizado. */
const din = (v: string | null, moneda = 'PEN') => dinero(v, moneda).replace(/\u00a0/g, ' ');
const catalogo = async () => (await catalogoPublico()) as Catalogo;

describe('<head> propio de cada ruta pública', () => {
  for (const ruta of PUBLICAS) {
    it(`${ruta}: título único, descripción, canonical, robots, Open Graph, Twitter Card y hreflang`, async () => {
      const r = await pedir(ruta);
      assert.equal(r.status, 200);
      assert.match(String(r.headers['content-type']), /text\/html/);
      assert.equal(r.headers['cache-control'], 'no-cache');
      assert.equal(r.headers['x-robots-tag'], undefined, 'en el dominio canónico no hay X-Robots-Tag');
      const t = titulo(r.texto)!;
      const d = metaContenido(r.texto, 'description')!;
      assert.ok(t && t.length <= MAX_TITULO, `título «${t}» (${t?.length})`);
      assert.ok(d && d.length <= MAX_DESCRIPCION, `descripción (${d?.length})`);
      assert.equal((r.texto.match(/<title>/g) ?? []).length, 1, 'un solo <title>: el genérico se reemplaza');
      assert.equal((r.texto.match(/name="description"/g) ?? []).length, 1, 'una sola descripción');
      assert.doesNotMatch(r.texto, /respaldo genérico/);
      const url = `${URL_CANONICA}${ruta}`;
      assert.equal(canonica(r.texto), url);
      assert.match(metaContenido(r.texto, 'robots')!, /^index, follow/);
      assert.equal(metaContenido(r.texto, 'og:title', 'property'), t);
      assert.equal(metaContenido(r.texto, 'og:description', 'property'), d);
      assert.equal(metaContenido(r.texto, 'og:url', 'property'), url);
      assert.equal(metaContenido(r.texto, 'og:type', 'property'), 'website');
      assert.equal(metaContenido(r.texto, 'og:image', 'property'), `${URL_CANONICA}/og-torre.png`);
      assert.equal(metaContenido(r.texto, 'og:locale', 'property'), 'es_PE');
      assert.equal(metaContenido(r.texto, 'og:site_name', 'property'), 'Torre · Administración de condominios');
      assert.equal(metaContenido(r.texto, 'twitter:card'), 'summary_large_image');
      assert.match(r.texto, new RegExp(`<link rel="alternate" hreflang="es-PE" href="${url.replace(/\./g, '\\.')}" />`));
      assert.match(r.texto, new RegExp(`<link rel="alternate" hreflang="x-default" href="${url.replace(/\./g, '\\.')}" />`));
      assert.ok(jsonLd(r.texto).length >= 1, 'datos estructurados válidos (JSON.parse no falla)');
    });
  }

  it('títulos y descripciones son distintos entre rutas', async () => {
    const paginas = await Promise.all(PUBLICAS.map((p) => pedir(p)));
    assert.equal(new Set(paginas.map((p) => titulo(p.texto))).size, PUBLICAS.length);
    assert.equal(new Set(paginas.map((p) => metaContenido(p.texto, 'description'))).size, PUBLICAS.length);
  });

  it('la barra final y la consulta no cambian la página: el canonical sigue sin ellas', async () => {
    const r = await pedir('/precios/?utm_source=x');
    assert.equal(r.status, 200);
    assert.equal(canonica(r.texto), `${URL_CANONICA}/precios`);
  });

  it('el canonical sale de url_publica, nunca del Host de la petición (un Host falso no arma enlaces)', async () => {
    const r = await pedir('/precios', { host: 'atacante.example' });
    assert.equal(canonica(r.texto), `${URL_CANONICA}/precios`);
    assert.doesNotMatch(r.texto, /atacante\.example/);
    const r2 = await llamar(base, 'GET', '/precios', null, undefined, { 'x-forwarded-host': 'atacante.example' });
    assert.doesNotMatch(r2.texto, /atacante\.example/);
  });
});

describe('datos estructurados (JSON-LD)', () => {
  it('/: Organization, WebSite y SoftwareApplication con una oferta por plan desde la base', async () => {
    const r = await pedir('/');
    assert.deepEqual(tipos(r.texto), ['Organization', 'WebSite', 'SoftwareApplication']);
    const [org, web, app] = jsonLd(r.texto);
    assert.equal(org.name, 'Torre');
    assert.equal(org.url, `${URL_CANONICA}/`);
    assert.equal(org.logo, `${URL_CANONICA}/apple-touch-icon.png`);
    assert.equal(web.url, `${URL_CANONICA}/`);
    assert.equal(app.applicationCategory, 'BusinessApplication');
    assert.equal(app.operatingSystem, 'Web');
    const cat = await catalogo();
    assert.equal(app.offers.length, cat.planes.length);
    for (const p of cat.planes) {
      const o = app.offers.find((x: any) => x.name === p.nombre); // eslint-disable-line @typescript-eslint/no-explicit-any
      assert.ok(o, `oferta de ${p.nombre}`);
      assert.equal(o.price, p.precio_por_unidad);
      assert.equal(o.priceCurrency, 'PEN');
      assert.equal(o.priceSpecification.valueAddedTaxIncluded, false);
    }
  });

  it('/precios: SoftwareApplication, FAQPage y BreadcrumbList; las otras páginas, sólo migas', async () => {
    const r = await pedir('/precios');
    assert.deepEqual(tipos(r.texto), ['SoftwareApplication', 'FAQPage', 'BreadcrumbList']);
    const migas = jsonLd(r.texto)[2];
    assert.deepEqual(migas.itemListElement.map((i: any) => i.item), [`${URL_CANONICA}/`, `${URL_CANONICA}/precios`]); // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const ruta of ['/registro', '/privacidad', '/terminos']) assert.deepEqual(tipos((await pedir(ruta)).texto), ['BreadcrumbList'], ruta);
  });

  it('FAQPage tiene EXACTAMENTE las preguntas de la página (la misma función) y las mismas respuestas', async () => {
    const r = await pedir('/precios');
    const faq = jsonLd(r.texto).find((d) => d['@type'] === 'FAQPage')!;
    const esperadas = preguntas(await catalogo());
    assert.deepEqual(faq.mainEntity.map((q: any) => [q.name, q.acceptedAnswer.text]), esperadas.map(({ p, r: resp }) => [p, resp])); // eslint-disable-line @typescript-eslint/no-explicit-any
    // …y el componente que la pinta usa ESA misma función (no una copia): lo que ve la persona es lo que lee el rastreador.
    const componente = fs.readFileSync('src/pages/publico/precios/Preguntas.tsx', 'utf8');
    assert.match(componente, /import \{ preguntas \} from '\.\.\/\.\.\/\.\.\/lib\/seo\/textos'/);
    assert.match(componente, /preguntas\(cat\)\.map\(\(\{ p, r \}/);
    assert.doesNotMatch(componente, /function preguntas/);
  });
});

describe('contenido estático dentro de #root', () => {
  it('/precios: título, planes con los precios de la base, módulos, preguntas y cierre; lo mismo que pintan los componentes', async () => {
    await prisma.planComercial.update({ where: { clave: 'pro' }, data: { precio_por_unidad: '4.25' } });
    const r = await pedir('/precios');
    const cuerpo = raiz(r.texto);
    assert.match(cuerpo, /<h1[^>]*>Cobra el mantenimiento sin Excel ni WhatsApp sueltos<\/h1>/);
    const plano = textoPlano(cuerpo);
    assert.ok(plano.includes(PRECIOS_HERO.bajada));
    const cat = await catalogo();
    assert.equal(cat.planes.find((p) => p.clave === 'pro')!.precio_por_unidad, '4.25');
    for (const p of cat.planes) {
      assert.ok(plano.includes(p.nombre), p.nombre);
      assert.ok(plano.includes(din(p.precio_por_unidad, cat.moneda)), `precio de ${p.nombre}`);
      for (const c of p.caracteristicas) assert.ok(plano.includes(c), c);
    }
    assert.ok(plano.includes(din('4.25')), 'el precio editado en la base');
    for (const q of preguntas(cat)) assert.ok(plano.includes(`${q.p} ${q.r}`.replace(/\u00a0/g, ' ')), q.p);
    for (const m of cat.modulos) assert.ok(plano.includes(m.nombre), m.nombre);
    for (const href of ['/registro', '/privacidad', '/terminos', '/login']) assert.ok(cuerpo.includes(`href="${href}"`), `enlace a ${href}`);
    // Los componentes de la página sacan sus textos de las MISMAS funciones que este contenido (una sola fuente: sin versión distinta para robots).
    const planesTsx = fs.readFileSync('src/pages/publico/precios/Planes.tsx', 'utf8');
    for (const f of ['textoTope', 'tituloPlanes', 'unidadPrecio']) assert.ok(planesTsx.includes(f), `Planes.tsx usa ${f} de lib/seo/textos`);
    const modulosTsx = fs.readFileSync('src/pages/publico/precios/Modulos.tsx', 'utf8');
    assert.ok(modulosTsx.includes('textosModulos(cat)'));
    const preciosTsx = fs.readFileSync('src/pages/publico/Precios.tsx', 'utf8');
    for (const f of ['PRECIOS_HERO.h1', 'PRECIOS_HERO.bajada', 'hechosPrecios(', 'cierre.texto']) assert.ok(preciosTsx.includes(f), `Precios.tsx usa ${f}`);
    assert.ok(plano.includes('Torre Gratis') && cat.modulos.every((m) => m.descripcion && plano.includes(m.descripcion)));
  });

  it('/: título, bajada y las tres tarjetas de la portada', async () => {
    const plano = textoPlano(raiz((await pedir('/')).texto));
    assert.ok(plano.includes(PORTADA.h1) && plano.includes(PORTADA.bajada));
    for (const p of PORTADA.pasos.lista) assert.ok(plano.includes(p.clausula) && plano.includes(p.texto), p.nombre);
    for (const r of PORTADA.roles.lista) assert.ok(plano.includes(r.nombre) && plano.includes(r.texto), r.nombre);
    for (const q of PORTADA.preguntas.lista) assert.ok(plano.includes(q.p) && plano.includes(q.r), q.p);
    assert.ok(plano.includes(PORTADA.juntas.block.titulo) && plano.includes(PORTADA.juntas.una.texto));
  });

  it('/registro: el título y el texto del paso 1', async () => {
    const plano = textoPlano(raiz((await pedir('/registro')).texto));
    assert.ok(plano.includes(REGISTRO.h1) && plano.includes(REGISTRO.paso) && plano.includes(REGISTRO.texto));
  });

  it('/privacidad y /terminos: los mismos textos legales de la página, con los datos del responsable de la base', async () => {
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { legal_razon_social: 'Torre Perú S.A.C.', legal_ruc: '20601234567' } });
    const priv = textoPlano(raiz((await pedir('/privacidad')).texto));
    assert.ok(priv.includes('Política de privacidad') && priv.includes('1. Quién es el responsable') && priv.includes('Torre Perú S.A.C.') && priv.includes('20601234567'));
    assert.ok(priv.includes('11. Cambios a esta política'));
    const ter = textoPlano(raiz((await pedir('/terminos')).texto));
    assert.ok(ter.includes('Términos y condiciones') && ter.includes('11. Ley aplicable') && ter.includes('7. Avisos por WhatsApp') && ter.includes('SALIR'));
  });

  it('el catálogo se refleja al instante: un plan oculto no sale, y el registro cerrado cambia los enlaces', async () => {
    await prisma.planComercial.update({ where: { clave: 'administradora' }, data: { visible: false } });
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { registro_abierto: false } });
    const r = await pedir('/precios');
    assert.doesNotMatch(r.texto, /Torre Administradora/);
    assert.match(raiz(r.texto), /El registro de cuentas nuevas está cerrado por ahora\./);
    assert.doesNotMatch(raiz(r.texto), /href="\/registro"/);
    await prisma.planComercial.update({ where: { clave: 'administradora' }, data: { visible: true } });
  });
});

describe('escapado de lo que viene de la base', () => {
  const MALO = '</script><img src=x onerror=alert(1)>';

  async function conNombresMaliciosos() {
    await prisma.planComercial.update({ where: { clave: 'pro' }, data: { nombre: `Pro ${MALO} US$& $1 "q" 'a'`, descripcion: `Desc "><svg onload=alert(2)> & más`, caracteristicas: [`Viñeta ${MALO}`, 'A & B < C'] } });
    await prisma.moduloComercial.update({ where: { clave: 'asistente' }, data: { nombre: `Mód ${MALO}`, descripcion: '<b>x</b>' } });
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { legal_razon_social: `Razón ${MALO} <i>x</i>`, google_site_verification: 'abc"><script>alert(3)</script>' } });
  }

  for (const ruta of ['/', '/precios', '/privacidad']) {
    it(`${ruta}: ningún HTML inyectado llega crudo y el JSON-LD sigue siendo válido`, async () => {
      await conNombresMaliciosos();
      const r = await pedir(ruta);
      assert.equal(r.status, 200);
      assert.doesNotMatch(r.texto, /<img src=x/, 'una etiqueta <img> inyectada');
      assert.doesNotMatch(r.texto, /<svg onload/);
      assert.doesNotMatch(r.texto, /<script>alert/);
      assert.doesNotMatch(r.texto, /<b>x<\/b>/);
      assert.doesNotMatch(r.texto, /<i>x<\/i>/);
      // El único `</script>` que hay cierra un bloque JSON-LD o el módulo de la plantilla: ninguno viene del dato.
      assert.equal((r.texto.match(/<\/script>/g) ?? []).length, (r.texto.match(/<script\b/g) ?? []).length);
      for (const d of jsonLd(r.texto)) assert.ok(d['@type']); // JSON.parse no falló
    });
  }

  it('el nombre malicioso se recupera idéntico del JSON-LD (se escapa, no se pierde) y el `$&` no rompe la inyección', async () => {
    await conNombresMaliciosos();
    const r = await pedir('/precios');
    const app = jsonLd(r.texto).find((d) => d['@type'] === 'SoftwareApplication')!;
    assert.ok(app.offers.some((o: any) => o.name === `Pro ${MALO} US$& $1 "q" 'a'`)); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.match(r.texto, /Pro &lt;\/script&gt;&lt;img src=x onerror=alert\(1\)&gt; US\$&amp; \$1 &quot;q&quot; &#39;a&#39;/);
    assert.match(r.texto, /<div id="root"><div style=/, 'el contenido sigue yendo dentro de #root');
  });

  it('el código de verificación (aunque lo cargaran a mano en la base) va escapado en el atributo', async () => {
    await conNombresMaliciosos();
    const r = await pedir('/');
    assert.match(r.texto, /<meta name="google-site-verification" content="abc&quot;&gt;&lt;script&gt;alert\(3\)&lt;\/script&gt;" \/>/);
    assert.doesNotMatch(r.texto, /content="abc"><script>/);
  });

  it('la razón social maliciosa del responsable sale escapada en el texto legal', async () => {
    await conNombresMaliciosos();
    const r = await pedir('/privacidad');
    assert.match(r.texto, /Razón &lt;\/script&gt;&lt;img src=x onerror=alert\(1\)&gt; &lt;i&gt;x&lt;\/i&gt;/);
  });
});

describe('noindex en lo privado y en el host no canónico', () => {
  it('/login: noindex, follow (cabecera y etiqueta); nunca nofollow', async () => {
    const r = await pedir('/login');
    assert.equal(r.status, 200);
    assert.equal(r.headers['x-robots-tag'], 'noindex, follow');
    assert.equal(metaContenido(r.texto, 'robots'), 'noindex, follow');
    assert.equal(r.headers['cache-control'], 'no-cache');
    assert.equal(raiz(r.texto), '', 'sin contenido de marketing en el login');
  });

  for (const ruta of ['/verificar-correo', '/invitacion', '/admin/dashboard', '/superadmin/empresas', '/propietario/inicio', '/inquilino/cargos', '/junta/mi-junta', '/mantenimiento/tareas', '/limpieza/inicio', '/jardineria/inicio', '/seguridad/inicio', '/perfil', '/ruta-que-no-existe']) {
    it(`${ruta}: noindex, nofollow`, async () => {
      const r = await pedir(ruta);
      assert.equal(r.status, 200);
      assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow');
      assert.equal(metaContenido(r.texto, 'robots'), 'noindex, nofollow');
    });
  }

  it('la plantilla de lo privado queda intacta (con su título y su descripción) y sin canonical ni datos estructurados', async () => {
    const r = await pedir('/admin/dashboard');
    assert.match(r.texto, /respaldo genérico/);
    assert.equal(canonica(r.texto), undefined);
    assert.equal(jsonLd(r.texto).length, 0);
  });

  it('house.gargurevich.dev (otro host): las páginas públicas llevan noindex y su canonical apunta al dominio bueno; no se redirige', async () => {
    for (const ruta of ['/', '/precios', '/registro', '/privacidad', '/terminos']) {
      const r = await pedir(ruta, { host: 'house.gargurevich.dev' });
      assert.equal(r.status, 200, ruta);
      assert.equal(r.headers['x-robots-tag'], 'noindex', ruta);
      assert.match(metaContenido(r.texto, 'robots')!, /^noindex/, ruta);
      assert.equal(canonica(r.texto), `${URL_CANONICA}${ruta}`, ruta);
      assert.equal(metaContenido(r.texto, 'og:url', 'property'), `${URL_CANONICA}${ruta}`);
    }
    assert.equal((await pedir('/login', { host: 'house.gargurevich.dev' })).status, 200);
  });

  it('el registro cerrado deja /registro en noindex', async () => {
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { registro_abierto: false } });
    const r = await pedir('/registro');
    assert.equal(r.headers['x-robots-tag'], 'noindex, follow');
    assert.match(metaContenido(r.texto, 'robots')!, /^noindex/);
  });
});

describe('robots.txt', () => {
  it('text/plain, permite lo público, bloquea API y áreas privadas y da paso explícito a los rastreadores de IA', async () => {
    const r = await pedir('/robots.txt', { ua: 'GPTBot' });
    assert.equal(r.status, 200);
    assert.match(String(r.headers['content-type']), /^text\/plain; charset=utf-8/);
    for (const p of ['/api/', '/admin', '/superadmin', '/propietario', '/inquilino', '/junta', '/mantenimiento', '/limpieza', '/jardineria', '/seguridad', '/perfil', '/verificar-correo', '/invitacion']) assert.match(r.texto, new RegExp(`^Disallow: ${p}$`, 'm'), p);
    assert.doesNotMatch(r.texto, /^Disallow: \/login/m, '/login se rastrea para ver su noindex');
    assert.doesNotMatch(r.texto, /^Disallow: \/$/m);
    assert.match(r.texto, /^Allow: \/$/m);
    for (const bot of RASTREADORES_IA) {
      // Cada bot con su propio grupo: ese grupo reemplaza al `*`, así que repite el Allow y los Disallow.
      const grupo = new RegExp(`User-agent: ${bot}\\nAllow: /\\nDisallow: /api/\\n`).test(r.texto);
      assert.ok(grupo, `grupo explícito de ${bot}`);
    }
    for (const bot of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'Google-Extended', 'PerplexityBot', 'ClaudeBot', 'Claude-SearchBot', 'Applebot-Extended', 'CCBot', 'Bingbot']) assert.match(r.texto, new RegExp(`^User-agent: ${bot}$`, 'm'), bot);
    assert.match(r.texto, new RegExp(`^Sitemap: ${URL_CANONICA}/sitemap\\.xml$`, 'm'));
  });
});

describe('sitemap.xml', () => {
  it('application/xml con las rutas indexables, URL absolutas de url_publica y lastmod real', async () => {
    const fecha = new Date('2026-03-04T10:00:00Z');
    await prisma.planComercial.updateMany({ data: { updated_at: new Date('2026-01-01T00:00:00Z') } });
    await prisma.planComercial.update({ where: { clave: 'basico' }, data: { updated_at: fecha } });
    const r = await pedir('/sitemap.xml');
    assert.equal(r.status, 200);
    assert.match(String(r.headers['content-type']), /^application\/xml; charset=utf-8/);
    assert.match(r.texto, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    const locs = [...r.texto.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    assert.deepEqual(locs, ['/', '/precios', '/registro', '/privacidad', '/terminos'].map((p) => `${URL_CANONICA}${p}`));
    assert.match(r.texto, new RegExp(`<loc>${URL_CANONICA}/precios</loc>\\s*<lastmod>2026-03-04</lastmod>`), 'lastmod de /precios = último cambio del catálogo');
    for (const l of r.texto.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)) assert.match(l[1], /^\d{4}-\d{2}-\d{2}$/);
    assert.doesNotMatch(r.texto, /\/login|\/admin|\/api/);
  });

  it('con el registro cerrado /registro sale del sitemap', async () => {
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { registro_abierto: false } });
    assert.doesNotMatch((await pedir('/sitemap.xml')).texto, /\/registro/);
  });

  it('sin url_publica no hay URL absolutas que publicar: 404 (y robots.txt sale sin la línea Sitemap)', async () => {
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { url_publica: null } });
    assert.equal((await pedir('/sitemap.xml')).status, 404);
    assert.doesNotMatch((await pedir('/robots.txt')).texto, /Sitemap:/);
  });
});

describe('llms.txt y llms-full.txt', () => {
  it('llms.txt: formato llmstxt.org (título, cita, secciones con enlaces), planes y precios de la base, enlaces al dominio canónico', async () => {
    await prisma.planComercial.update({ where: { clave: 'pro' }, data: { precio_por_unidad: '4.25' } });
    const r = await pedir('/llms.txt', { ua: 'ClaudeBot' });
    assert.equal(r.status, 200);
    assert.match(String(r.headers['content-type']), /^text\/plain; charset=utf-8/);
    assert.match(r.texto, /^# Torre · Administración de condominios\n\n> .+/);
    assert.match(r.texto, /^## Páginas$/m);
    for (const p of ['/', '/precios', '/registro', '/privacidad', '/terminos', '/llms-full.txt']) assert.ok(r.texto.includes(`](${URL_CANONICA}${p})`), p);
    const cat = await catalogo();
    for (const p of cat.planes) assert.ok(r.texto.includes(`**${p.nombre}**: ${dinero(p.precio_por_unidad, cat.moneda)}`), p.nombre); // llms.txt conserva el espacio duro del monto
    assert.ok(r.texto.includes(dinero('4.25', 'PEN')));
  });

  it('llms-full.txt: qué es, para quién, funciones, planes, preguntas frecuentes y lo que NO hace', async () => {
    const r = await pedir('/llms-full.txt');
    assert.equal(r.status, 200);
    for (const s of ['## Para quién es', '## Qué hace', '## Planes y precios', '## Preguntas frecuentes', '## Lo que Torre no hace hoy']) assert.ok(r.texto.includes(s), s);
    for (const f of ['Recibos por block', 'Vouchers de pago', 'Avisos', 'Reservas de áreas comunes', 'Portal del vecino', 'Juntas directivas']) assert.ok(r.texto.includes(`**${f}**`), f);
    for (const { p } of preguntas(await catalogo())) assert.ok(r.texto.includes(`### ${p}`), p);
    assert.match(r.texto, /No hay pagos en línea/);
  });

  it('dice la verdad sobre la conciliación bancaria: es de Torre Pro y se hace con el extracto, no leyendo el banco', async () => {
    for (const ruta of ['/llms-full.txt']) {
      const t = (await pedir(ruta)).texto;
      assert.match(t, /- \*\*Conciliación bancaria\*\*: .*extracto.* \(De Torre Pro\.\)/, ruta);
      assert.doesNotMatch(t, /No hay conciliación bancaria automática/, ruta);
      assert.match(t, /No hay conexión directa con el banco/, ruta);
    }
  });

  it('nada falso: sin «House», sin «para siempre», sin promesas que no existen', async () => {
    for (const ruta of ['/llms.txt', '/llms-full.txt']) {
      const t = (await pedir(ruta)).texto;
      assert.doesNotMatch(t, /House/, ruta);
      assert.doesNotMatch(t, /para siempre/i, ruta);
      assert.doesNotMatch(t, /(app nativa|aplicación nativa) (para|de) (iOS|Android)|votaciones en línea (disponibles|incluidas)|pasarela de pagos (integrada|incluida)/i, ruta);
    }
  });
});

describe('www y un solo dominio canónico', () => {
  it('www.<dominio> → 301 al dominio de url_publica (GET y HEAD de páginas), conservando ruta y consulta', async () => {
    const r = await pedir('/precios?plan=pro', { host: `www.${CANONICO}` });
    assert.equal(r.status, 301);
    assert.equal(r.headers.location, `${URL_CANONICA}/precios?plan=pro`);
    assert.equal((await pedir('/', { host: `www.${CANONICO}`, metodo: 'HEAD' })).status, 301);
    assert.equal((await pedir('/robots.txt', { host: `www.${CANONICO}` })).headers.location, `${URL_CANONICA}/robots.txt`);
  });

  it('no redirige /api ni /assets ni otros métodos, ni a quien no es www del dominio canónico', async () => {
    const www = `www.${CANONICO}`;
    assert.equal((await pedir('/api/health', { host: www })).status, 200);
    assert.equal((await pedir('/assets/index-abc123.js', { host: www })).status, 200);
    assert.notEqual((await pedir('/precios', { host: www, metodo: 'POST' })).status, 301);
    assert.notEqual((await pedir('/precios', { host: 'www.otro-dominio.test' })).status, 301);
    assert.notEqual((await pedir('/precios', { host: 'house.gargurevich.dev' })).status, 301);
  });

  it('el destino sale de url_publica (un Host con trampa no cambia a dónde se redirige)', async () => {
    const r = await pedir('//atacante.example/x', { host: `www.${CANONICO}` });
    assert.equal(r.status, 301);
    assert.ok(String(r.headers.location).startsWith(`${URL_CANONICA}/`));
  });
});

describe('lo que no cambia: /api y /assets', () => {
  it('la API sigue respondiendo (JSON, sin X-Robots-Tag de páginas)', async () => {
    const r = await llamar(base, 'GET', '/api/publico/planes');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.planes));
    assert.equal((await llamar(base, 'GET', '/api/no-existe')).status, 401, 'igual que antes: sin sesión, la API pide ingresar');
  });

  it('/assets: archivo con hash inmutable; uno que falta es 404 real (no index.html)', async () => {
    const ok = await pedir('/assets/index-abc123.js');
    assert.equal(ok.status, 200);
    assert.match(String(ok.headers['cache-control']), /immutable/);
    const falta = await pedir('/assets/no-existe-1.js');
    assert.equal(falta.status, 404);
    assert.doesNotMatch(falta.texto, /<html/);
  });

  it('un archivo estático de public/ (og-torre.png) se sirve tal cual', async () => {
    const r = await pedir('/og-torre.png');
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'image/png');
  });
});

describe('si la base falla', () => {
  it('/ y /precios responden 200 con el head genérico (sin canonical, sin datos estructurados, #root vacío) y lo privado sigue con su noindex', async () => {
    mock.method(seoDeps, 'cargarContexto', async () => { throw new Error('base caída'); });
    mock.method(seoDeps, 'obtenerConfiguracion', async () => { throw new Error('base caída'); });
    mock.method(console, 'error', () => undefined);
    for (const ruta of ['/', '/precios']) {
      const r = await pedir(ruta);
      assert.equal(r.status, 200, ruta);
      assert.ok(titulo(r.texto) && metaContenido(r.texto, 'description'), ruta);
      assert.equal(canonica(r.texto), undefined, ruta);
      assert.equal(jsonLd(r.texto).length, 0, ruta);
      assert.equal(raiz(r.texto), '', ruta);
      assert.match(r.texto, /<script type="module" crossorigin src="\/assets\/index-abc123\.js">/, 'la app sigue cargando');
    }
    assert.equal((await pedir('/login')).headers['x-robots-tag'], 'noindex, follow');
    assert.equal((await pedir('/admin/dashboard')).status, 200);
    assert.equal((await pedir('/robots.txt')).status, 200);
    assert.equal((await pedir('/sitemap.xml')).status, 503);
    assert.equal((await pedir('/', { host: `www.${CANONICO}` })).status, 200, 'sin base no se redirige (se sirve igual)');
  });
});

describe('verificación de buscadores (todo en la base, editable por el superadmin)', () => {
  it('los códigos se inyectan sólo en la portada', async () => {
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { google_site_verification: 'g-ABC_123', bing_site_verification: 'B1NG0123456789ABCDEF' } });
    const inicio = await pedir('/');
    assert.equal(metaContenido(inicio.texto, 'google-site-verification'), 'g-ABC_123');
    assert.equal(metaContenido(inicio.texto, 'msvalidate.01'), 'B1NG0123456789ABCDEF');
    for (const ruta of ['/precios', '/registro', '/privacidad', '/login']) {
      const t = (await pedir(ruta)).texto;
      assert.equal(metaContenido(t, 'google-site-verification'), undefined, ruta);
      assert.equal(metaContenido(t, 'msvalidate.01'), undefined, ruta);
    }
  });

  it('sin códigos no hay etiquetas', async () => {
    const t = (await pedir('/')).texto;
    assert.doesNotMatch(t, /google-site-verification|msvalidate/);
  });

  it('el superadmin los guarda (PUT /api/comercial/configuracion), quedan auditados y se ven en la portada; vaciarlos los quita', async () => {
    const put = await llamar(base, 'PUT', '/api/comercial/configuracion', superadmin, { google_site_verification: '  tok-Google_1  ', bing_site_verification: 'bing1234' });
    assert.equal(put.status, 200, put.texto);
    assert.equal(put.body.google_site_verification, 'tok-Google_1');
    // La auditoría se escribe después de responder: se espera un momento.
    let aud = null;
    for (let i = 0; i < 40 && !aud; i++) { aud = await prisma.auditoria.findFirst({ where: { entidad: 'configuracion_comercial', accion: 'editar' }, orderBy: { id: 'desc' } }); if (!aud) await new Promise((r) => setTimeout(r, 25)); }
    assert.ok(aud, 'auditoría de la edición');
    assert.match(JSON.stringify(aud.detalle), /google_site_verification/);
    assert.match(JSON.stringify(aud.detalle), /bing_site_verification/);
    assert.doesNotMatch(JSON.stringify(aud.detalle), /tok-Google_1/, 'la auditoría guarda qué campos cambiaron, no sus valores');
    assert.equal(metaContenido((await pedir('/')).texto, 'google-site-verification'), 'tok-Google_1');
    const vacio = await llamar(base, 'PUT', '/api/comercial/configuracion', superadmin, { google_site_verification: '', bing_site_verification: '   ' });
    assert.equal(vacio.status, 200);
    assert.equal(vacio.body.google_site_verification, null);
    assert.equal(vacio.body.bing_site_verification, null);
    assert.doesNotMatch((await pedir('/')).texto, /google-site-verification|msvalidate/);
  });

  it('rechaza lo que no es un código (comillas, menor que, espacios, demasiado largo) con 422 y nada se guarda', async () => {
    for (const malo of ['abc"def', '<script>', 'dos palabras', 'x'.repeat(101)]) {
      const r = await llamar(base, 'PUT', '/api/comercial/configuracion', superadmin, { google_site_verification: malo });
      assert.equal(r.status, 422, malo);
    }
    const cfg = await prisma.configuracionComercial.findUniqueOrThrow({ where: { id: 1 } });
    assert.equal(cfg.google_site_verification, null);
  });

  it('sólo el superadmin: la administración recibe 403', async () => {
    const admin = await login(base, 'admin.a@test.pe');
    const r = await llamar(base, 'PUT', '/api/comercial/configuracion', admin, { google_site_verification: 'abc' });
    assert.equal(r.status, 403);
  });
});

describe('la plantilla real de index.html', () => {
  const real = fs.readFileSync('index.html', 'utf8');

  it('conserva lo que el servidor reemplaza (un solo <title>, una descripción y #root vacío) y enlaza manifest e ícono de Apple', () => {
    assert.equal((real.match(/<title>/g) ?? []).length, 1);
    assert.equal((real.match(/<meta name="description"/g) ?? []).length, 1);
    assert.ok(real.includes('<div id="root"></div>'));
    assert.match(real, /<link rel="manifest" href="\/site\.webmanifest" \/>/);
    assert.match(real, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png" \/>/);
  });

  it('inyectar() deja un solo título y una sola descripción y pone el contenido en #root', () => {
    const html = inyectar(real, '<title>Nuevo</title>\n    <meta name="description" content="Nueva" />', '<p>hola $&amp; $1</p>', true);
    assert.equal((html.match(/<title>/g) ?? []).length, 1);
    assert.equal((html.match(/name="description"/g) ?? []).length, 1);
    assert.ok(html.includes('<div id="root"><p>hola $&amp; $1</p></div>'), 'los $ del contenido no se interpretan');
    assert.ok(html.indexOf('<title>Nuevo</title>') < html.indexOf('</head>'));
  });

  it('los archivos de marca existen y el manifest es JSON válido con sus íconos', () => {
    for (const f of ['og-torre.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'site.webmanifest']) assert.ok(fs.existsSync(path.join('public', f)), f);
    const png = (f: string) => { const b = fs.readFileSync(path.join('public', f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
    assert.deepEqual(png('og-torre.png'), [1200, 630]);
    assert.deepEqual(png('apple-touch-icon.png'), [180, 180]);
    const m = JSON.parse(fs.readFileSync('public/site.webmanifest', 'utf8'));
    assert.equal(m.name, 'Torre · Administración de condominios');
    assert.equal(m.theme_color, '#0f766e');
    for (const i of m.icons) assert.ok(fs.existsSync(path.join('public', i.src)), i.src);
  });
});
