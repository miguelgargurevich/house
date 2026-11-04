// Torre instalable en el celular: el manifest abre como app, el HTML trae las metas de iPhone y el aviso «Instalar Torre» decide bien qué mostrar.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { modoInstalar } from '../src/app/instalar';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
const base = { instalada: false, descartado: false, hayAviso: false };

describe('Torre instalable', () => {
  it('el manifest abre como app (standalone) desde el inicio de sesión, con ícono de 192 y 512', () => {
    const m = JSON.parse(fuente('public/site.webmanifest'));
    assert.equal(m.display, 'standalone');
    assert.equal(m.start_url, '/login');
    assert.equal(m.short_name, 'Torre');
    assert.deepEqual(m.icons.map((i: { sizes: string }) => i.sizes).slice(0, 2), ['192x192', '512x512']);
  });

  it('el HTML enlaza el manifest y trae las metas para «Agregar a inicio» en iPhone', () => {
    const h = fuente('index.html');
    for (const t of ['rel="manifest"', 'rel="apple-touch-icon"', 'name="apple-mobile-web-app-capable" content="yes"', 'name="apple-mobile-web-app-title" content="Torre"', 'name="mobile-web-app-capable" content="yes"']) assert.ok(h.includes(t), t);
  });

  it('el aviso está en el Shell y el aviso de Chrome se escucha desde la primera pantalla', () => {
    assert.match(fuente('src/app/Shell.tsx'), /<InstalarApp \/>\s*<Outlet \/>/);
    assert.match(fuente('src/main.tsx'), /import '\.\/app\/instalar'/);
  });

  it('modoInstalar: botón con el aviso de Chrome, explicación en Safari de iPhone, nada si ya está instalada, descartada u otro navegador', () => {
    assert.equal(modoInstalar({ ...base, hayAviso: true, userAgent: ANDROID }), 'boton');
    assert.equal(modoInstalar({ ...base, userAgent: IPHONE }), 'iphone');
    assert.equal(modoInstalar({ ...base, userAgent: IPHONE_CHROME }), null);
    assert.equal(modoInstalar({ ...base, userAgent: ANDROID }), null);
    assert.equal(modoInstalar({ ...base, instalada: true, hayAviso: true, userAgent: ANDROID }), null);
    assert.equal(modoInstalar({ ...base, descartado: true, userAgent: IPHONE }), null);
  });
});

describe('íconos para instalar y para la pestaña (4-nov, comparado con el Portal de Dealers)', () => {
  it('el manifest trae íconos «maskable» (Android no lo recorta) y el HTML favicons PNG y el tamaño del de iPhone', () => {
    const m = JSON.parse(fuente('public/site.webmanifest'));
    const maskable = m.icons.filter((i: { purpose?: string }) => i.purpose === 'maskable').map((i: { sizes: string }) => i.sizes);
    assert.deepEqual(maskable, ['192x192', '512x512']);
    for (const i of m.icons as { src: string }[]) assert.ok(existsSync(`public${i.src}`), i.src);
    const h = fuente('index.html');
    for (const t of ['href="/favicon-32.png"', 'href="/favicon-16.png"', 'rel="apple-touch-icon" sizes="180x180"']) assert.ok(h.includes(t), t);
  });
});

describe('ícono de Torre: la torre con ventanas (Miguel, 4-nov: la casa quedó de cuando se llamaba House)', () => {
  it('el logo de la app, del inicio de sesión y de la portada es el mismo componente; ya no queda la casa', () => {
    for (const ruta of ['src/app/Shell.tsx', 'src/pages/Login.tsx', 'src/pages/publico/Marco.tsx']) {
      const t = fuente(ruta);
      assert.match(t, /<IconoTorre className=/, ruta);
      assert.equal(t.includes('12.5L16 8'), false, `${ruta}: sin la casa`);
    }
    const svg = fuente('public/favicon.svg');
    assert.match(svg, /<rect x="10" y="5.5" width="12" height="21"/);
    assert.equal(svg.includes('<path'), false, 'el favicon ya no es la casa');
    assert.equal(fuente('scripts/marketing/grabar-video.mjs').includes('12.5L16 8'), false, 'el cierre de los videos tampoco');
  });
});
