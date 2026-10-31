# SEO de la parte pública

Objetivo: que Torre (torrecondominios.com) se encuentre y se indexe en Google y Bing, y que los LLM (ChatGPT, Gemini, Perplexity, Claude) la lean aunque no ejecuten JavaScript. La app se ve y funciona igual que antes.

## Qué se hizo

**El servidor entrega HTML con contenido** (`src/server/seo/`). Antes todas las rutas devolvían el mismo `index.html` con `<div id="root"></div>` vacío. Ahora, en `/`, `/precios`, `/registro`, `/privacidad` y `/terminos`:

- `<head>` propio: `<title>` único (≤ 60), `meta description` (≤ 160), `canonical`, `robots`, Open Graph, Twitter Card, `hreflang es-PE` y `x-default`.
- Datos estructurados (JSON-LD): `Organization`, `WebSite` y `SoftwareApplication` (una `Offer` por plan, precio y `PEN`, sin IGV) en `/`; `SoftwareApplication`, `FAQPage` (las MISMAS preguntas que la página) y `BreadcrumbList` en `/precios`; `BreadcrumbList` en las demás.
- Dentro de `#root`, contenido semántico (h1, h2, planes con precios de la base, preguntas frecuentes, enlaces internos). **Son los mismos textos de la página real**: salen de `src/lib/seo/textos.ts` (que usan los componentes y el servidor) y de los textos legales (se renderizan con React en el servidor). Nada de textos distintos para robots (eso es cloaking). React lo reemplaza al montar (`createRoot`); no hay `display:none`.
- Todo dato de la base se escapa: en HTML (`escapar.ts › esc`) y en JSON-LD (`jsonSeguro`: `<`, `>`, `&` salen como `\uXXXX`; un `</script>` en un nombre de plan no cierra el script).
- `Cache-Control: no-cache` (los precios cambian en la base). Si la base falla, la página sale igual con el head genérico de `index.html`.

**`noindex`** (`<meta robots>` y `X-Robots-Tag`) en `/login` (`noindex, follow`) y en todo lo demás que no es público: `/verificar-correo`, `/invitacion`, las áreas privadas y cualquier ruta desconocida (`noindex, nofollow`). `/registro` pasa a `noindex` si el superadmin cierra el registro.

**Un solo dominio canónico**: el de `ConfiguracionComercial.url_publica` (la edita el superadmin en Suscripciones › Plazos y datos de pago). `www.<ese dominio>` → 301. En cualquier otro host (hoy `house.gargurevich.dev`) las páginas públicas llevan `X-Robots-Tag: noindex` y su `canonical` apunta al dominio bueno; ahí NO se redirige (hay sesiones de clientes). Los enlaces salen de `url_publica`, nunca de la cabecera Host.

**Documentos para rastreadores** (dinámicos):

| URL | Qué es |
|---|---|
| `/robots.txt` | Permite lo público; bloquea `/api/` y las áreas privadas; da paso EXPLÍCITO a GPTBot, OAI-SearchBot, ChatGPT-User, Google-Extended, PerplexityBot, ClaudeBot, Claude-SearchBot, Applebot-Extended, CCBot y Bingbot (cada uno con su grupo, que repite los `Disallow`); línea `Sitemap:` absoluta |
| `/sitemap.xml` | Rutas indexables con `lastmod` real (`/precios`: último cambio de un plan visible; legales: su versión; `/registro` sólo con el registro abierto) |
| `/llms.txt`, `/llms-full.txt` | Formato llmstxt.org: qué es Torre, para quién, funciones, planes y precios DESDE LA BASE, preguntas frecuentes y lo que Torre NO hace. La lista de funciones está en `src/server/seo/contenido.ts`: si agregas o quitas una función de la app, cámbiala ahí |

**Imágenes y manifest**: `public/og-torre.png` (1200×630), `apple-touch-icon.png` (180×180), `icon-192.png`, `icon-512.png` y `site.webmanifest`, enlazados desde `index.html`. Se regeneran con `node scripts/seo/generar-imagenes.mjs` (Playwright global; los PNG se commitean).

**Verificación de buscadores sin variables de entorno**: `ConfiguracionComercial.google_site_verification` y `bing_site_verification` (opcionales, aditivos). El superadmin los edita en Suscripciones › «Buscadores (SEO)» (auditado) y se inyectan como `<meta name="google-site-verification">` y `<meta name="msvalidate.01">` en la portada.

## Cómo probarlo

```bash
# lo que ve un rastreador que no ejecuta JavaScript (debe traer <title>, canonical, JSON-LD y el contenido dentro de #root)
curl -s -A GPTBot https://torrecondominios.com/precios | head -80
curl -s -A ClaudeBot https://torrecondominios.com/ | grep -E '<title>|canonical|application/ld\+json|<h1'

# documentos
curl -s https://torrecondominios.com/robots.txt
curl -s https://torrecondominios.com/sitemap.xml
curl -s https://torrecondominios.com/llms.txt
curl -s https://torrecondominios.com/llms-full.txt

# un solo dominio: www → 301, y el otro host lleva noindex
curl -sI https://www.torrecondominios.com/precios | grep -iE '^HTTP|^location'
curl -sI https://house.gargurevich.dev/precios | grep -i x-robots-tag      # noindex
curl -sI https://torrecondominios.com/login | grep -i x-robots-tag         # noindex, follow
curl -sI https://torrecondominios.com/precios | grep -i x-robots-tag       # (nada: se indexa)
```

Pruebas: `tests/seo-publico.test.ts` (head por ruta, JSON-LD con `JSON.parse`, contenido de `#root`, FAQPage = preguntas de la página, escapado con nombres maliciosos, noindex, robots/sitemap/llms, 301 de www, `/api` y `/assets` intactos, base caída → 200, códigos de verificación).

## Lo que le toca a Miguel (no se puede hacer desde el código)

1. **Antes que nada, con el despliegue**: cambiar `url_publica` a `https://torrecondominios.com` (Suscripciones › Plazos y datos de pago). Mientras valga `https://house.gargurevich.dev`, el dominio «bueno» sería ese y torrecondominios.com saldría con `noindex`.
2. **Google Search Console** (search.google.com/search-console): agregar la propiedad «Prefijo de URL» `https://torrecondominios.com`; elegir verificación «Etiqueta HTML», copiar SÓLO el valor de `content` y pegarlo en Suscripciones › Buscadores (SEO) › Google; guardar y pulsar «Verificar». Después: Sitemaps › enviar `sitemap.xml`; y «Inspección de URL» de `/` y `/precios` › «Solicitar indexación».
3. **Bing Webmaster Tools** (bing.com/webmasters): agregar el sitio (se puede importar desde Search Console) o verificar con la etiqueta `msvalidate.01` (pegar el código en Buscadores › Bing); enviar el sitemap. Esto también alimenta a ChatGPT Search y Copilot, que usan el índice de Bing.
4. Pasado unos días, revisar en Search Console › Páginas que `/`, `/precios`, `/registro`, `/privacidad` y `/terminos` estén indexadas y que `/login` figure como «Excluida por noindex».
5. Dejar `house.gargurevich.dev` como está (con `noindex`). Si algún día ya no hay clientes en ese host, se puede redirigir a torrecondominios.com.
6. Probar la imagen al compartir: pegar `https://torrecondominios.com/` en WhatsApp o LinkedIn (cachean la vista previa; si ya compartiste el enlace antes, puede tardar en actualizarse).

Los LLM no tienen un botón de «enviar»: encuentran el sitio por el índice de Google/Bing y por sus propios rastreadores (permitidos en `robots.txt`); `llms.txt` les da un resumen limpio. Tarda días o semanas.

## Cosas a saber

- El contenido estático de `#root` lo toma `index.html` de `dist/` (Vite). Si cambias `index.html`, conserva un solo `<title>`, un solo `<meta name="description">` y `<div id="root"></div>`: el servidor los reemplaza por regex (la prueba «la plantilla real de index.html» lo vigila).
- Cambiar un texto de la portada, de /precios o de /registro: edítalo en `src/lib/seo/textos.ts` (lo usan la página y el HTML estático). Los legales se editan en `src/pages/publico/legal/textos.tsx` como siempre.
- Una página pública nueva: agregarla a `PUBLICAS` (`rutas.ts`), a `TITULOS`/`DESCRIPCIONES` y a `construirCuerpo` (`paginas.ts`), al sitemap (`documentos.ts`) y a esta lista. Una ruta privada nueva no hace falta tocarla: todo lo que no es público sale con `noindex`.
- `lastmod` de `/` y `/registro` es `FECHA_CONTENIDO` (`contenido.ts`): súbela cuando cambie ese texto.
