// Manual y videos en la web pública: la dirección sale de `ConfiguracionComercial.url_manual` (se edita en Superadmin › Precios) por el catálogo
// público; el pie lo enlaza y la portada tiene «Mira cómo funciona». Vacío = no se muestra. Nada escrito a mano en las pantallas.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar } from './helpers/app';

let base: string;
let cerrar: () => Promise<void>;
let T: Record<'super' | 'adminA', string>;

before(async () => {
  await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe') };
});
after(async () => { await cerrar(); await prisma.$disconnect(); });

const catalogo = async () => (await llamar(base, 'GET', '/api/publico/planes', null)).body;

describe('Manual y videos en la web pública', () => {
  it('el catálogo trae la dirección de la configuración y null cuando está vacía; sólo el superadmin la cambia', async () => {
    const original = (await prisma.configuracionComercial.findFirst())?.url_manual ?? null;
    assert.ok(original, 'la configuración trae una dirección de manual por defecto');
    assert.equal((await catalogo()).manual, original);
    const nueva = 'https://ejemplo.test/manual.html';
    assert.equal((await llamar(base, 'PUT', '/api/comercial/configuracion', T.adminA, { url_manual: nueva })).status, 403);
    assert.equal((await llamar(base, 'PUT', '/api/comercial/configuracion', T.super, { url_manual: nueva })).status, 200);
    assert.equal((await catalogo()).manual, nueva, 'lo que dice la configuración');
    assert.equal((await llamar(base, 'PUT', '/api/comercial/configuracion', T.super, { url_manual: '' })).status, 200);
    assert.equal((await catalogo()).manual, null, 'vacío = no se muestra');
    await llamar(base, 'PUT', '/api/comercial/configuracion', T.super, { url_manual: original });
    assert.equal((await catalogo()).manual, original);
  });

  it('el pie y la portada usan el valor del catálogo (sin enlace fijo) y no se pintan sin manual', () => {
    const marco = readFileSync('src/pages/publico/Marco.tsx', 'utf8');
    assert.match(marco, /\{data\?\.manual && \(/, 'el pie sólo muestra el enlace con manual');
    assert.match(marco, /href=\{data\.manual\} target="_blank" rel="noopener noreferrer"/);
    assert.match(marco, /Manual y videos/);
    assert.match(marco, /PlayCircleIcon/);
    const portada = readFileSync('src/pages/publico/Portada.tsx', 'utf8');
    assert.match(portada, /\{cat\?\.manual && <a href=\{cat\.manual\} target="_blank" rel="noopener noreferrer"/);
    assert.match(portada, /Mira cómo funciona/);
    for (const ruta of ['src/pages/publico/Marco.tsx', 'src/pages/publico/Portada.tsx', 'src/server/services/comercial/suscripciones.ts']) {
      assert.doesNotMatch(readFileSync(ruta, 'utf8'), /https:\/\/s3\.gargurevich/, `${ruta} no lleva la dirección escrita a mano`);
    }
  });
});
