// Torre instalable en el celular: el manifest abre como app, el HTML trae las metas de iPhone y el aviso «Instalar Torre» decide bien qué mostrar.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
