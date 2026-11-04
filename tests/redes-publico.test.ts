// Instagram de Torre en la web (Miguel, 4-nov: «en el landing podríamos incluir las redes; por ahora sólo Instagram»): vive en la base, sale en el
// catálogo público (lo lee el pie de todas las páginas públicas) y en `sameAs` de los datos para buscadores; sólo el superadmin lo cambia.
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

describe('Instagram de Torre', () => {
  it('el catálogo público lo trae (por defecto, la cuenta de Torre) y el superadmin lo cambia o lo quita; nadie más', async () => {
    const r = await llamar(base, 'GET', '/api/publico/planes', null);
    assert.equal(r.body.redes.instagram, 'https://www.instagram.com/torreadministracioncondominios/');
    assert.equal((await llamar(base, 'PUT', '/api/comercial/configuracion', T.adminA, { url_instagram: 'https://www.instagram.com/otra/' })).status, 403);
    assert.equal((await llamar(base, 'PUT', '/api/comercial/configuracion', T.super, { url_instagram: 'https://evil.test/x' })).status, 422, 'sólo instagram.com');
    assert.equal((await llamar(base, 'PUT', '/api/comercial/configuracion', T.super, { url_instagram: '' })).status, 200);
    assert.equal((await llamar(base, 'GET', '/api/publico/planes', null)).body.redes.instagram, null, 'vacío = no se muestra');
    await llamar(base, 'PUT', '/api/comercial/configuracion', T.super, { url_instagram: 'https://www.instagram.com/torreadministracioncondominios/' });
  });

  it('el pie lo enlaza en otra pestaña sólo si hay dirección, y los datos para buscadores lo ponen en sameAs', () => {
    const marco = readFileSync('src/pages/publico/Marco.tsx', 'utf8');
    assert.match(marco, /data\?\.redes\?\.instagram && \(/);
    assert.match(marco, /target="_blank" rel="noopener noreferrer"/);
    assert.match(readFileSync('src/server/seo/paginas.ts', 'utf8'), /sameAs = \[redes\.instagram, redes\.facebook\]/);
  });
});
