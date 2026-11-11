// App de Torre para el celular (`/app`): el APK de Android y su versión salen de `ConfiguracionComercial` (Superadmin › Precios) por el catálogo público
// y el HTML estático; sin APK no se pinta el botón; dentro de la app no se ofrece la descarga; el pie enlaza `/app`. La dirección nunca va escrita en `src/`.
import './helpers/env';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { after, afterEach, before, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar } from './helpers/app';
import { muestraBloques, ofreceDescarga } from '../src/pages/publico/appMovil/logica';
import { APP_MOVIL } from '../src/pages/publico/appMovil/textos';

const CANONICO = 'torre.ejemplo.test';
const UA_APP = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile TorreApp/1.0.0';
const PLANTILLA = `<!doctype html>
<html lang="es-PE">
  <head>
    <meta charset="UTF-8" />
    <title>Torre · Administración de condominios</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;
const APK_NUEVO = 'https://ejemplo.test/descargas/torre-nueva.apk';

let base: string;
let cerrar: () => Promise<void>;
let dist: string;
let superadmin: string;
let adminA: string;

before(async () => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'app-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), PLANTILLA);
  await sembrar();
  ({ base, cerrar } = await iniciar({ distDir: dist, rateLimits: { api: 100_000, login: 100_000 } }));
  superadmin = await login(base, 'super@test.pe');
  adminA = await login(base, 'admin.a@test.pe');
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
  fs.rmSync(dist, { recursive: true, force: true });
});

afterEach(async () => {
  // Cada prueba deja la configuración como la sembró el seed (la dirección por defecto y la versión 1.0.0).
  await prisma.configuracionComercial.update({ where: { id: 1 }, data: { url_app_android: 'https://s3.gargurevich.dev/dashboardia-bucket/documentos/b601f104-f838-49e7-9da5-c49efe9dc723/app/torre-android.apk', app_android_version: '1.0.0', url_publica: `https://${CANONICO}` } });
});

interface Resp { status: number; headers: http.IncomingHttpHeaders; texto: string }
/** Petición cruda con el Host canónico (como en `seo-publico.test.ts`) y, si hace falta, un user agent. */
function pedir(ruta: string, o: { ua?: string } = {}): Promise<Resp> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path: ruta, method: 'GET', headers: { host: CANONICO, ...(o.ua ? { 'user-agent': o.ua } : {}) } }, (r) => {
      let d = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { d += c; });
      r.on('end', () => resolve({ status: r.statusCode ?? 0, headers: r.headers, texto: d }));
    });
    req.on('error', reject);
    req.end();
  });
}

const catalogo = async () => (await llamar(base, 'GET', '/api/publico/planes', null)).body;
const cuerpoApp = async () => (await pedir('/app')).texto;

describe('App para el celular: APK y versión desde la configuración', () => {
  it('el catálogo trae el APK y la versión de la configuración; vacío = android null; sólo el superadmin lo cambia', async () => {
    const cfg = await prisma.configuracionComercial.findUniqueOrThrow({ where: { id: 1 } });
    assert.ok(cfg.url_app_android, 'la configuración trae el APK por defecto');
    assert.deepEqual((await catalogo()).app, { android: { url: cfg.url_app_android, version: cfg.app_android_version } });

    assert.equal((await llamar(base, 'PUT', '/api/comercial/configuracion', adminA, { url_app_android: APK_NUEVO })).status, 403);
    assert.equal((await llamar(base, 'PUT', '/api/comercial/configuracion', superadmin, { url_app_android: APK_NUEVO, app_android_version: '1.2.0' })).status, 200);
    assert.deepEqual((await catalogo()).app, { android: { url: APK_NUEVO, version: '1.2.0' } }, 'lo que dice la configuración');

    assert.equal((await llamar(base, 'PUT', '/api/comercial/configuracion', superadmin, { app_android_version: '' })).status, 200);
    assert.deepEqual((await catalogo()).app, { android: { url: APK_NUEVO, version: null } }, 'versión vacía = no se muestra');

    assert.equal((await llamar(base, 'PUT', '/api/comercial/configuracion', superadmin, { url_app_android: '' })).status, 200);
    assert.deepEqual((await catalogo()).app, { android: null }, 'APK vacío = no se ofrece la descarga');
  });

  it('valida la dirección (https) y la versión (número de versión)', async () => {
    const httpRes = await llamar(base, 'PUT', '/api/comercial/configuracion', superadmin, { url_app_android: 'http://ejemplo.test/torre.apk' });
    assert.equal(httpRes.status, 422);
    const version = await llamar(base, 'PUT', '/api/comercial/configuracion', superadmin, { app_android_version: 'version uno' });
    assert.equal(version.status, 422);
    const ok = await llamar(base, 'PUT', '/api/comercial/configuracion', superadmin, { app_android_version: '1.0.0' });
    assert.equal(ok.status, 200);
  });

  it('/app sin APK no pinta el botón de Android, pero sí lo de iPhone; con APK lo pinta con su versión', async () => {
    await llamar(base, 'PUT', '/api/comercial/configuracion', superadmin, { url_app_android: '' });
    const sin = await cuerpoApp();
    assert.match(sin, /Torre en tu celular/);
    assert.doesNotMatch(sin, /Descargar para Android/, 'sin APK no hay botón');
    assert.doesNotMatch(sin, /torre-android\.apk|ejemplo\.test\/descargas/);
    assert.match(sin, /Agregar a inicio/, 'iPhone siempre');

    await llamar(base, 'PUT', '/api/comercial/configuracion', superadmin, { url_app_android: APK_NUEVO, app_android_version: '1.2.0' });
    const con = await cuerpoApp();
    assert.match(con, /Descargar para Android/);
    assert.match(con, new RegExp(`href="${APK_NUEVO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.match(con, /Versión 1\.2\.0/);
  });

  it('dentro de la app no se ofrece la descarga ni la instalación (sólo el texto «Ya estás usando la app»)', async () => {
    // El HTML estático no conoce el user agent: en la app lo decide el navegador (`muestraBloques` / `ofreceDescarga` al montar la página).
    assert.equal(ofreceDescarga({ url: APK_NUEVO, version: '1.2.0' }, UA_APP), false);
    assert.equal(muestraBloques(UA_APP), false);
    assert.equal(ofreceDescarga({ url: APK_NUEVO, version: '1.2.0' }, 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile'), true);
    assert.equal(ofreceDescarga(null, 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile'), false, 'sin APK no se ofrece');
    assert.equal(muestraBloques('Mozilla/5.0 (iPhone) Version/17 Mobile Safari/604.1'), true);
    assert.equal(APP_MOVIL.dentro, 'Ya estás usando la app.');
  });

  it('el pie de las páginas públicas enlaza /app (en el HTML estático y en el componente)', async () => {
    assert.match((await pedir('/precios')).texto, /<a href="\/app">App para el celular<\/a>/);
    assert.match((await pedir('/privacidad')).texto, /href="\/app"/);
    assert.match(readFileSync('src/pages/publico/Marco.tsx', 'utf8'), /<Link to="\/app"/);
  });

  it('/app está en el sitemap con su título y descripción en el HTML', async () => {
    assert.match((await pedir('/sitemap.xml')).texto, new RegExp(`<loc>https://${CANONICO}/app</loc>`));
    const html = (await pedir('/app')).texto;
    assert.match(html, /<title>App para el celular \| Torre · Administración de condominios<\/title>/);
    assert.match(html, /<meta name="description" content="Descarga la app de Torre para Android/);
  });

  it('la dirección del APK no está escrita en src/ (sólo en el esquema)', () => {
    const archivos: string[] = [];
    const recorrer = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) recorrer(p);
        else if (/\.(ts|tsx|js|jsx|css|html)$/.test(e.name)) archivos.push(p);
      }
    };
    recorrer('src');
    for (const f of archivos) {
      const t = readFileSync(f, 'utf8');
      assert.doesNotMatch(t, /torre-android\.apk/, `${f} no lleva el APK escrito a mano`);
      assert.doesNotMatch(t, /b601f104-f838-49e7-9da5-c49efe9dc723\/app\//, `${f} no lleva la ruta del APK`);
    }
  });
});
