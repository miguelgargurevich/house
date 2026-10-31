// Genera las imágenes de marca para compartir y para los dispositivos: public/og-torre.png (1200×630), public/apple-touch-icon.png (180×180)
// y los íconos del manifest (192 y 512). Usa el Playwright global; los PNG se commitean (no se generan en el build).
//   node scripts/seo/generar-imagenes.mjs
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const RAIZ = path.resolve(import.meta.dirname, '..', '..');
const PLAYWRIGHT = process.env.PLAYWRIGHT_DIR ?? '/opt/homebrew/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href);

const VERDE = '#0f766e';
const fuente = pathToFileURL(path.join(RAIZ, 'node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2')).href;
// El mismo logo de public/favicon.svg (tarjeta verde con la torre en trazo blanco).
const logo = fs.readFileSync(path.join(RAIZ, 'public/favicon.svg'), 'utf8');

const base = `@font-face{font-family:Figtree;src:url(${fuente});font-weight:300 900}*{box-sizing:border-box;margin:0}body{font-family:Figtree,system-ui,sans-serif}`;

const og = `<!doctype html><meta charset="utf-8"><style>${base}
body{width:1200px;height:630px;background:linear-gradient(135deg,${VERDE} 0%,#115e59 100%);color:#fff;display:flex;flex-direction:column;justify-content:center;padding:0 96px;position:relative;overflow:hidden}
.circ{position:absolute;right:-160px;top:-160px;width:560px;height:560px;border-radius:50%;background:rgba(255,255,255,.07)}
.circ2{position:absolute;right:120px;bottom:-260px;width:520px;height:520px;border-radius:50%;background:rgba(255,255,255,.05)}
.marca{display:flex;align-items:center;gap:28px;position:relative}
.marca svg{width:132px;height:132px;border-radius:30px;box-shadow:0 0 0 6px rgba(255,255,255,.9),0 18px 40px rgba(0,0,0,.25)}
.nombre{font-size:132px;font-weight:700;letter-spacing:-.04em;line-height:1}
.sub{margin-top:36px;font-size:46px;font-weight:600;letter-spacing:-.01em;opacity:.95;position:relative}
.valor{margin-top:22px;font-size:34px;font-weight:400;line-height:1.35;max-width:1010px;opacity:.88;position:relative}
</style><div class="circ"></div><div class="circ2"></div>
<div class="marca">${logo}<div class="nombre">Torre</div></div>
<div class="sub">Administración de condominios</div>
<div class="valor">Recibos por block, cobranza y morosidad al día. Empieza gratis.</div>`;

const icono = (lado) => `<!doctype html><meta charset="utf-8"><style>*{margin:0}body{width:${lado}px;height:${lado}px}svg{width:${lado}px;height:${lado}px;display:block}</style>${logo}`;

const navegador = await chromium.launch();
try {
  const hacer = async (html, ancho, alto, destino) => {
    const pagina = await navegador.newPage({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 1 });
    await pagina.setContent(html, { waitUntil: 'load' });
    await pagina.evaluate(() => document.fonts.ready);
    await pagina.screenshot({ path: path.join(RAIZ, 'public', destino), clip: { x: 0, y: 0, width: ancho, height: alto } });
    await pagina.close();
    console.log(`public/${destino} ${ancho}×${alto}`);
  };
  await hacer(og, 1200, 630, 'og-torre.png');
  // Los íconos cuadrados llevan la tarjeta verde a sangre (iOS redondea las esquinas solo).
  await hacer(icono(180), 180, 180, 'apple-touch-icon.png');
  await hacer(icono(192), 192, 192, 'icon-192.png');
  await hacer(icono(512), 512, 512, 'icon-512.png');
} finally {
  await navegador.close();
}
