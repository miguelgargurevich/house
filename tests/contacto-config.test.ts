// WhatsApp de contacto y Facebook de Torre: viven en ConfiguracionComercial (nada en el código ni en variables de entorno), salen en el catálogo público
// y sólo el superadmin los cambia.
import './helpers/env';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar } from './helpers/app';
import { enlaceWhatsapp, redesPublicas } from '../src/server/services/contacto/redes';

let base: string;
let cerrar: () => Promise<void>;
let T: Record<'super' | 'adminA' | 'prop', string>;

before(async () => {
  await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), prop: await login(base, 'prop1@test.pe') };
});
after(async () => { await cerrar(); await prisma.$disconnect(); });

const redes = async () => (await llamar(base, 'GET', '/api/publico/planes', null)).body.redes;
const poner = (json: Record<string, unknown>, quien = T.super) => llamar(base, 'PUT', '/api/comercial/configuracion', quien, json);

describe('redes y WhatsApp en el catálogo público', () => {
  it('por defecto trae Instagram, Facebook y el WhatsApp de contacto con su enlace wa.me y el mensaje codificado', async () => {
    const r = await redes();
    assert.equal(r.instagram, 'https://www.instagram.com/torreadministracioncondominios/');
    assert.equal(r.facebook, 'https://www.facebook.com/profile.php?id=61596421792856');
    assert.equal(r.whatsapp.numero, '51966918363');
    assert.equal(r.whatsapp.enlace, `https://wa.me/51966918363?text=${encodeURIComponent('Hola, vi Torre y quiero saber más')}`);
  });

  it('el número y el mensaje salen de la config: al cambiarlos, cambia el enlace (el número no está escrito en el código)', async () => {
    assert.equal((await poner({ whatsapp_contacto: '+51 999 111 222', whatsapp_mensaje: 'Quiero una demo & precios' })).status, 200);
    const r = await redes();
    assert.equal(r.whatsapp.numero, '51999111222');
    assert.equal(r.whatsapp.enlace, 'https://wa.me/51999111222?text=Quiero%20una%20demo%20%26%20precios');
    await poner({ whatsapp_contacto: '51966918363', whatsapp_mensaje: 'Hola, vi Torre y quiero saber más' });
  });

  it('vacío = no se muestra: sin número, whatsapp es null; sin Facebook, null; sin mensaje, el enlace va sin texto', async () => {
    assert.equal((await poner({ whatsapp_contacto: '', url_facebook: '', whatsapp_mensaje: '' })).status, 200);
    const r = await redes();
    assert.equal(r.whatsapp, null);
    assert.equal(r.facebook, null);
    await poner({ whatsapp_contacto: '51966918363' });
    assert.equal((await redes()).whatsapp.enlace, 'https://wa.me/51966918363', 'sin mensaje no hay ?text');
    await poner({ whatsapp_mensaje: 'Hola, vi Torre y quiero saber más', url_facebook: 'https://www.facebook.com/profile.php?id=61596421792856' });
  });

  it('valida el formato: número con letras o demasiado corto, Facebook que no es de facebook.com, mensaje con HTML → 422', async () => {
    assert.equal((await poner({ whatsapp_contacto: 'abc' })).status, 422);
    assert.equal((await poner({ whatsapp_contacto: '12345' })).status, 422);
    assert.equal((await poner({ whatsapp_contacto: '0966918363' })).status, 422, 'sin código de país no vale');
    assert.equal((await poner({ url_facebook: 'https://evil.test/facebook.com/' })).status, 422);
    assert.equal((await poner({ url_facebook: 'http://www.facebook.com/x' })).status, 422, 'sólo https');
    assert.equal((await poner({ whatsapp_mensaje: 'Hola <script>' })).status, 422);
    assert.equal((await redes()).whatsapp.numero, '51966918363', 'lo inválido no cambió nada');
  });

  it('un admin o un propietario no pueden cambiarlos (403)', async () => {
    assert.equal((await poner({ whatsapp_contacto: '51911111111' }, T.adminA)).status, 403);
    assert.equal((await poner({ url_facebook: 'https://www.facebook.com/otra' }, T.prop)).status, 403);
    assert.equal((await redes()).whatsapp.numero, '51966918363');
  });

  it('el superadmin ve los tres campos al editar (catálogo de precios)', async () => {
    const c = (await llamar(base, 'GET', '/api/comercial/catalogo', T.super)).body.configuracion;
    assert.equal(c.whatsapp_contacto, '51966918363');
    assert.equal(c.url_facebook, 'https://www.facebook.com/profile.php?id=61596421792856');
    assert.equal(c.whatsapp_mensaje, 'Hola, vi Torre y quiero saber más');
  });
});

describe('redesPublicas (unidad)', () => {
  it('quita todo lo que no sea dígito del número y no inventa enlace sin número', () => {
    const cfg = { url_instagram: null, url_facebook: null, whatsapp_mensaje: null };
    assert.deepEqual(redesPublicas({ ...cfg, whatsapp_contacto: '+51 966-918-363' }).whatsapp, { numero: '51966918363', enlace: 'https://wa.me/51966918363' });
    assert.equal(redesPublicas({ ...cfg, whatsapp_contacto: '  ' }).whatsapp, null);
    assert.equal(redesPublicas({ ...cfg, whatsapp_contacto: null }).whatsapp, null);
    assert.equal(enlaceWhatsapp('51900000000', 'a b'), 'https://wa.me/51900000000?text=a%20b');
  });
});

describe('el número de WhatsApp no está en el código', () => {
  const recorrer = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    return statSync(ruta).isDirectory() ? recorrer(ruta) : /\.(ts|tsx|js|json|html)$/.test(n) ? [ruta] : [];
  });
  it('ningún archivo de src/ ni de public/ lleva el número (sólo lo trae la config; su valor de partida está en prisma/schema.prisma)', () => {
    const conNumero = [...recorrer('src'), ...recorrer('public')].filter((f) => /966\s?918\s?363/.test(readFileSync(f, 'utf8')));
    assert.deepEqual(conNumero, []);
    assert.match(readFileSync('prisma/schema.prisma', 'utf8'), /whatsapp_contacto\s+String\?\s+@default\("51966918363"\)/);
  });
});
