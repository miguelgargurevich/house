// Marca propia de la empresa administradora: guardar nombre comercial y color, qué marca ve cada usuario (la de SU empresa y sólo con la capacidad
// `marca_propia` de Pro, Administradora y Cortesía), el logo público de los correos y el marco del correo con marca. Resend SIEMPRE falso (`fetch` inyectado).
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { cabecerasDeSesion, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { invalidarComercial } from '../src/server/services/comercial/modulos';
import { comercialCorreo } from '../src/server/services/comercial/configuracion';
import { invitarUsuario } from '../src/server/services/invitaciones';
import { encolarAviso, procesarCola, type DepsAvisos } from '../src/server/services/avisos';
import { correoDeAviso } from '../src/server/services/avisos/correoAviso';
import { PIE_ENVIADO_CON_TORRE, plantillaCorreo } from '../src/server/services/avisos/correoHtml';
import { firmaDeLogoValida, urlPublicaDeLogo } from '../src/server/services/marca/firma';
import { empresaTieneMarcaPropia, marcaParaCorreo } from '../src/server/services/marca/servicio';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1' | 'inq1' | 'propB' | 'mttoA' | 'segA' | 'presiA' | 'doble', string>;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 9)]);
const crudo = (metodo: string, ruta: string, token: string | null, cuerpo?: Buffer, tipo = 'image/png') =>
  fetch(base + ruta, { method: metodo, headers: { ...cabecerasDeSesion(token), ...(cuerpo ? { 'content-type': tipo, 'x-nombre-archivo': 'logo.png' } : {}) }, body: cuerpo ? new Uint8Array(cuerpo) : undefined });

const MARCA_A = { nombre_comercial: 'Administradora Torres del Sol', color_marca: '#0057b8' };

/** Pone el plan del condominio (la marca propia la traen `pro`, `administradora` y `cortesia`; `basico` no) y vacía la caché comercial. */
async function plan(complejoId: number, clave: string) {
  await prisma.suscripcionCondominio.upsert({ where: { complejo_id: complejoId }, create: { complejo_id: complejoId, plan_clave: clave, modulos: [], estado: 'activa' }, update: { plan_clave: clave, estado: 'activa', vigente_hasta: null, es_prueba: false } });
  invalidarComercial();
}
const marcaDe = async (token: string) => (await llamar(base, 'GET', '/api/auth/me', token)).body.marca;

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  const hash = await bcrypt.hash(PASSWORD, 4);
  // Junta: un propietario con cargo. Doble: propietario con un departamento en la empresa B (el primero que se creó) y otro en la A.
  const presi = await prisma.usuario.create({ data: { nombre: 'Presidenta A', email: 'presi.a@test.pe', rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, cargo_junta: 'presidente' } });
  await prisma.unidad.create({ data: { codigo: 'A-800', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, propietario_id: presi.id, estado: 'activa' } });
  const doble = await prisma.usuario.create({ data: { nombre: 'Doble', email: 'doble@test.pe', rol: 'propietario', password_hash: hash } });
  await prisma.unidad.create({ data: { codigo: 'B-900', tipo: 'Departamento', complejo_id: d.complejoB.id, empresa_id: d.empresaB.id, propietario_id: doble.id, estado: 'activa' } });
  await prisma.unidad.create({ data: { codigo: 'A-900', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, propietario_id: doble.id, estado: 'activa' } });
  T = {
    super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'),
    prop1: await login(base, 'prop1@test.pe'), inq1: await login(base, 'inq1@test.pe'), propB: await login(base, 'propb@test.pe'),
    mttoA: await login(base, 'mtto.a@test.pe'), segA: await login(base, 'seg.a@test.pe'), presiA: await login(base, 'presi.a@test.pe'), doble: await login(base, 'doble@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.empresaAdministradora.updateMany({ data: { nombre_comercial: null, color_marca: null } });
  await prisma.imagenRecibo.deleteMany();
  await plan(d.complejoA.id, 'administradora');
  await plan(d.complejoB.id, 'basico');
});

describe('capacidad marca_propia en el plan', () => {
  it('Pro, Administradora y Cortesía la traen; Básico y Gratis no', async () => {
    const planes = await prisma.planComercial.findMany({ select: { clave: true, modulos_incluidos: true } });
    const trae = planes.filter((p) => p.modulos_incluidos.includes('marca_propia')).map((p) => p.clave).sort();
    assert.deepEqual(trae, ['administradora', 'cortesia', 'pro']);
  });

  it('una empresa la tiene si AL MENOS uno de sus condominios la tiene activa', async () => {
    assert.equal(await empresaTieneMarcaPropia(d.empresaA.id), true);
    assert.equal(await empresaTieneMarcaPropia(d.empresaB.id), false, 'básico no la incluye');
    // Un segundo condominio de la B, en Administradora: basta uno.
    const otro = await prisma.complejoHabitacional.create({ data: { nombre: 'Complejo B2', tipo: 'Edificio', empresa_id: d.empresaB.id } });
    await plan(otro.id, 'administradora');
    assert.equal(await empresaTieneMarcaPropia(d.empresaB.id), true);
    // Si ese plan vence y se apaga, deja de contar.
    await prisma.suscripcionCondominio.update({ where: { complejo_id: otro.id }, data: { vigente_hasta: new Date('2020-01-01') } });
    invalidarComercial();
    assert.equal(await empresaTieneMarcaPropia(d.empresaB.id), false);
    await prisma.suscripcionCondominio.delete({ where: { complejo_id: otro.id } });
    await prisma.complejoHabitacional.delete({ where: { id: otro.id } });
    invalidarComercial();
  });

  it('Básico no la activa; Pro, Administradora y Cortesía sí (Miguel, 4-nov: «en el plan pro también inclúyelo»)', async () => {
    await plan(d.complejoA.id, 'basico');
    assert.equal(await empresaTieneMarcaPropia(d.empresaA.id), false);
    for (const clave of ['pro', 'administradora', 'cortesia']) {
      await plan(d.complejoA.id, clave);
      assert.equal(await empresaTieneMarcaPropia(d.empresaA.id), true, clave);
    }
  });
});

describe('guardar la marca: PUT /api/empresas/:id', () => {
  it('el admin de la empresa guarda nombre comercial y color; sale en la lista con marca_activa', async () => {
    const r = await llamar(base, 'PUT', `/api/empresas/${d.empresaA.id}`, T.adminA, MARCA_A);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.nombre_comercial, MARCA_A.nombre_comercial);
    assert.equal(r.body.color_marca, '#0057b8');
    assert.equal(r.body.marca_activa, true);
    const lista = await llamar(base, 'GET', '/api/empresas', T.adminA);
    assert.equal(lista.body.items[0].color_marca, '#0057b8');
    assert.equal(lista.body.items[0].nombre, 'Empresa A', 'la razón social no cambia');
  });

  it('el color se guarda en minúsculas; vacío o null lo deja en el verde de Torre', async () => {
    assert.equal((await llamar(base, 'PUT', `/api/empresas/${d.empresaA.id}`, T.adminA, { color_marca: '#0057B8' })).body.color_marca, '#0057b8');
    assert.equal((await llamar(base, 'PUT', `/api/empresas/${d.empresaA.id}`, T.adminA, { color_marca: '' })).body.color_marca, null);
    await llamar(base, 'PUT', `/api/empresas/${d.empresaA.id}`, T.adminA, { color_marca: '#0057b8' });
    assert.equal((await llamar(base, 'PUT', `/api/empresas/${d.empresaA.id}`, T.adminA, { color_marca: null, nombre_comercial: '' })).body.color_marca, null);
    assert.equal((await prisma.empresaAdministradora.findUniqueOrThrow({ where: { id: d.empresaA.id } })).nombre_comercial, null);
  });

  it('color inválido → 422 con el campo; nombre comercial de más de 60 caracteres → 422', async () => {
    for (const malo of ['rojo', '#12345', '#1234567', '#GGGGGG', '007565', 'rgb(1,2,3)', 7, true]) {
      const r = await llamar(base, 'PUT', `/api/empresas/${d.empresaA.id}`, T.adminA, { color_marca: malo });
      assert.equal(r.status, 422, JSON.stringify(malo));
      assert.ok(r.body.campos?.color_marca, JSON.stringify(r.body));
    }
    const largo = await llamar(base, 'PUT', `/api/empresas/${d.empresaA.id}`, T.adminA, { nombre_comercial: 'x'.repeat(61) });
    assert.equal(largo.status, 422);
    assert.ok(largo.body.campos?.nombre_comercial);
    assert.equal((await llamar(base, 'PUT', `/api/empresas/${d.empresaA.id}`, T.adminA, { nombre_comercial: 'x'.repeat(60) })).status, 200);
    assert.equal((await prisma.empresaAdministradora.findUniqueOrThrow({ where: { id: d.empresaA.id } })).color_marca, null, 'nada inválido se guardó');
  });

  it('el admin de OTRA empresa recibe 404 y no cambia nada', async () => {
    const r = await llamar(base, 'PUT', `/api/empresas/${d.empresaA.id}`, T.adminB, MARCA_A);
    assert.equal(r.status, 404);
    const a = await prisma.empresaAdministradora.findUniqueOrThrow({ where: { id: d.empresaA.id } });
    assert.deepEqual([a.nombre_comercial, a.color_marca], [null, null]);
  });

  it('el superadmin edita la de cualquier empresa', async () => {
    const r = await llamar(base, 'PUT', `/api/empresas/${d.empresaB.id}`, T.super, { nombre_comercial: 'Marca de B', color_marca: '#ff0000' });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await prisma.empresaAdministradora.findUniqueOrThrow({ where: { id: d.empresaB.id } })).color_marca, '#ff0000');
  });

  it('personal, junta y residentes no pueden: 403; sin sesión: 401', async () => {
    for (const t of [T.mttoA, T.segA, T.presiA, T.prop1, T.inq1]) {
      const r = await llamar(base, 'PUT', `/api/empresas/${d.empresaA.id}`, t, MARCA_A);
      assert.ok([403, 404].includes(r.status), `${r.status}`);
      assert.equal(r.status, 403);
    }
    assert.equal((await llamar(base, 'PUT', `/api/empresas/${d.empresaA.id}`, null, MARCA_A)).status, 401);
    assert.equal((await prisma.empresaAdministradora.findUniqueOrThrow({ where: { id: d.empresaA.id } })).color_marca, null);
  });

  it('sin la capacidad se guarda igual (la administradora puede prepararla) pero marca_activa es false', async () => {
    const r = await llamar(base, 'PUT', `/api/empresas/${d.empresaB.id}`, T.adminB, { nombre_comercial: 'Marca de B', color_marca: '#ff0000' });
    assert.equal(r.status, 200);
    assert.equal(r.body.color_marca, '#ff0000');
    assert.equal(r.body.marca_activa, false);
  });
});

describe('marca en /api/auth/me y en el login: la de SU empresa', () => {
  beforeEach(async () => {
    await llamar(base, 'PUT', `/api/empresas/${d.empresaA.id}`, T.adminA, MARCA_A);
    // La B también la deja guardada (sin capacidad): ningún usuario de la A ni de ningún lado debe verla, y los de la B tampoco la ven activa.
    await prisma.empresaAdministradora.update({ where: { id: d.empresaB.id }, data: { nombre_comercial: 'Marca de B', color_marca: '#ff0000' } });
    assert.equal((await crudo('PUT', `/api/empresas/${d.empresaA.id}/logo`, T.adminA, PNG)).status, 200);
  });

  it('administración, personal, junta, propietario e inquilino de la empresa A reciben la marca de A', async () => {
    for (const [quien, token] of Object.entries({ adminA: T.adminA, mttoA: T.mttoA, segA: T.segA, presiA: T.presiA, prop1: T.prop1, inq1: T.inq1 })) {
      const m = await marcaDe(token);
      assert.equal(m.nombre, 'Administradora Torres del Sol', quien);
      assert.equal(m.color, '#0057b8', quien);
      assert.equal(m.activa, true, quien);
      assert.match(m.logo_url, new RegExp(`^/api/empresas/${d.empresaA.id}/logo\\?v=\\d+$`), quien);
    }
  });

  it('el login devuelve la misma marca que /auth/me', async () => {
    const r = await llamar(base, 'POST', '/api/auth/login', null, { email: 'prop1@test.pe', password: PASSWORD });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body.marca).sort(), ['activa', 'color', 'empresa_id', 'logo_url', 'nombre', 'razon_social']);
    assert.equal(r.body.marca.empresa_id, d.empresaA.id);
    assert.equal(r.body.marca.razon_social, 'Empresa A', 'la razón social viaja siempre (el recibo la usa si la marca no corresponde)');
    assert.equal(r.body.marca.nombre, 'Administradora Torres del Sol');
    assert.equal(r.body.marca.color, '#0057b8');
  });

  it('un residente de la empresa B NUNCA ve la marca de la A (ni nada de ella), y la de B no está activa', async () => {
    for (const token of [T.propB, T.adminB]) {
      const m = await marcaDe(token);
      assert.equal(m.activa, false);
      assert.equal(m.color, null, 'sin capacidad no sale el color guardado');
      assert.equal(m.nombre, 'Empresa B', 'sin capacidad: razón social, no el nombre comercial guardado');
      assert.equal(m.logo_url, null, 'B no subió logo: no hereda el de A');
      assert.ok(!JSON.stringify(m).includes('Torres del Sol') && !JSON.stringify(m).includes('0057b8'));
    }
  });

  it('el superadmin ve a Torre', async () => {
    assert.deepEqual(await marcaDe(T.super), { empresa_id: null, razon_social: null, nombre: 'Torre', logo_url: null, color: null, activa: false });
  });

  it('con departamentos en dos empresas gana el primero (menor id): aquí el de la B, que no tiene marca activa', async () => {
    const m = await marcaDe(T.doble);
    assert.equal(m.nombre, 'Empresa B');
    assert.equal(m.activa, false);
  });

  it('sin la capacidad: activa false, razón social y sin color (el logo, que va en todos los planes, se conserva)', async () => {
    await plan(d.complejoA.id, 'basico');
    for (const token of [T.adminA, T.prop1, T.mttoA]) {
      const m = await marcaDe(token);
      assert.equal(m.activa, false);
      assert.equal(m.color, null);
      assert.equal(m.nombre, 'Empresa A');
      assert.match(m.logo_url, /^\/api\/empresas\/\d+\/logo\?v=\d+$/);
    }
  });

  it('con un nombre comercial vacío y la marca activa, el nombre es la razón social', async () => {
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { nombre_comercial: null } });
    const m = await marcaDe(T.adminA);
    assert.equal(m.activa, true);
    assert.equal(m.nombre, 'Empresa A');
    assert.equal(m.color, '#0057b8');
  });

  it('el personal de la empresa ve el logo; el de otra empresa y quien no es de ella reciben 404', async () => {
    const ruta = `/api/empresas/${d.empresaA.id}/logo`;
    for (const t of [T.adminA, T.mttoA, T.segA, T.prop1, T.super]) assert.equal((await crudo('GET', ruta, t)).status, 200);
    for (const t of [T.adminB, T.propB]) assert.equal((await crudo('GET', ruta, t)).status, 404);
    assert.equal((await crudo('GET', ruta, null)).status, 401);
  });
});

describe('logo público para los correos', () => {
  const ruta = (u: string) => u.replace(/^https?:\/\/[^/]+/, '');
  beforeEach(async () => {
    assert.equal((await crudo('PUT', `/api/empresas/${d.empresaA.id}/logo`, T.adminA, PNG)).status, 200);
  });

  it('con la firma de la URL se ve SIN sesión; con caché pública corta y sin interpretarse como otra cosa', async () => {
    const url = urlPublicaDeLogo(d.empresaA.id, '123');
    assert.match(url, new RegExp(`^https://torrecondominios\\.com/api/publico/marca/${d.empresaA.id}/logo\\?f=[A-Za-z0-9_-]{22}&v=123$`));
    const r = await crudo('GET', ruta(url), null);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('cache-control') ?? '', /^public, max-age=\d+$/);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), PNG);
  });

  it('sin firma, con firma errónea o con la de otra empresa: 404 igual que si no existiera', async () => {
    const buena = ruta(urlPublicaDeLogo(d.empresaA.id, '1'));
    const firma = /f=([^&]+)/.exec(buena)![1]!;
    for (const mala of [`/api/publico/marca/${d.empresaA.id}/logo`, `/api/publico/marca/${d.empresaA.id}/logo?f=`, `/api/publico/marca/${d.empresaA.id}/logo?f=${'a'.repeat(22)}`, `/api/publico/marca/${d.empresaA.id}/logo?f=${firma}x`, `/api/publico/marca/${d.empresaA.id}/logo?f=${firma.slice(1)}`, ruta(urlPublicaDeLogo(d.empresaB.id, '1')).replace(`/${d.empresaB.id}/`, `/${d.empresaA.id}/`)]) {
      assert.equal((await crudo('GET', mala, null)).status, 404, mala);
    }
    assert.equal((await crudo('GET', buena, null)).status, 200);
  });

  it('id inexistente, sin logo o mal escrito: 404 (aunque la firma sea la correcta de ese id)', async () => {
    for (const id of [d.empresaB.id, 9999]) assert.equal((await crudo('GET', ruta(urlPublicaDeLogo(id, '1')), null)).status, 404, `empresa ${id} sin logo`);
    for (const id of ['abc', '0', '-1', '1.5', '99999999999999']) assert.equal((await crudo('GET', `/api/publico/marca/${id}/logo?f=${'a'.repeat(22)}`, null)).status, 404, id);
  });

  it('sólo entrega logos de empresa: nunca la cabecera de un condominio (aunque el id y la firma cuadren)', async () => {
    // La cabecera del condominio B vive en la misma tabla con `complejo_id`; el id 2 también es el de la empresa B (que no tiene logo).
    await prisma.imagenRecibo.create({ data: { complejo_id: d.complejoB.id, nombre: 'cabecera.jpg', tipo_mime: 'image/jpeg', tamano: JPG.length, datos: JPG } });
    assert.equal(d.complejoB.id, d.empresaB.id, 'el escenario necesita ids iguales');
    const r = await crudo('GET', ruta(urlPublicaDeLogo(d.empresaB.id, '1')), null);
    assert.equal(r.status, 404);
    assert.ok(!(r.headers.get('content-type') ?? '').includes('image'), 'no entregó la imagen del condominio');
    // Y la ruta de la API (con sesión) tampoco la mezcla.
    assert.equal((await crudo('GET', `/api/empresas/${d.empresaB.id}/logo`, T.adminB)).status, 404);
  });

  it('el reemplazo del logo cambia la versión de la URL pero NO la firma: un correo viejo muestra el logo vigente', async () => {
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { nombre_comercial: MARCA_A.nombre_comercial } }); // con algo personalizado
    const antes = await marcaParaCorreo((await prisma.empresaAdministradora.findUniqueOrThrow({ where: { id: d.empresaA.id } })).id);
    await new Promise((r) => setTimeout(r, 15));
    assert.equal((await crudo('PUT', `/api/empresas/${d.empresaA.id}/logo`, T.adminA, JPG, 'image/jpeg')).status, 200);
    const despues = await marcaParaCorreo(d.empresaA.id);
    const [fa, va] = [/f=([^&]+)&v=(\d+)/.exec(antes!.logoUrl!)!.slice(1), /f=([^&]+)&v=(\d+)/.exec(despues!.logoUrl!)!.slice(1)];
    assert.equal(fa[0], va[0]);
    assert.notEqual(fa[1], va[1]);
    const viejo = await crudo('GET', ruta(antes!.logoUrl!), null);
    assert.equal(viejo.status, 200);
    assert.deepEqual(Buffer.from(await viejo.arrayBuffer()), JPG);
  });

  it('con el plan pero sin nombre comercial ni color, el correo sale como siempre (no cambia a la razón social)', async () => {
    const antes = await prisma.empresaAdministradora.findUniqueOrThrow({ where: { id: d.empresaA.id } });
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { nombre_comercial: null, color_marca: null } });
    assert.equal(await empresaTieneMarcaPropia(d.empresaA.id), true);
    assert.equal(await marcaParaCorreo(d.empresaA.id), null);
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { nombre_comercial: antes.nombre_comercial, color_marca: antes.color_marca } });
  });

  it('la firma sólo vale para su empresa', () => {
    const f = /f=([^&]+)/.exec(urlPublicaDeLogo(d.empresaA.id, '1'))![1]!;
    assert.equal(firmaDeLogoValida(d.empresaA.id, f), true);
    assert.equal(firmaDeLogoValida(d.empresaB.id, f), false);
    assert.equal(firmaDeLogoValida(d.empresaA.id, undefined), false);
    assert.equal(firmaDeLogoValida(d.empresaA.id, ['a', 'b']), false);
  });
});

describe('correo con marca', () => {
  const base1 = { titulo: 'Tu recibo de octubre', parrafos: ['Hola Ana,', 'Ya emitimos tu recibo.'], resumen: { total: { etiqueta: 'Total a pagar', valor: 'S/ 150.00' } }, boton: { texto: 'Ver mi recibo', url: 'https://torrecondominios.com/propietario/cargos' }, piePagina: ['Te escribe la administración de Complejo A desde Torre.', 'Torre · Administración de condominios'] };
  const marca = { nombre: 'Administradora <Torres> del Sol', logoUrl: 'https://torrecondominios.com/api/publico/marca/1/logo?f=abcdefghijklmnopqrstuv&v=5', claro: { brand: '#0057b8', onBrand: '#f8fbff', brandSoft: '#e3eefb' }, oscuro: { brand: '#7ab3ff', onBrand: '#07101c', brandSoft: '#0e2a4f' } };

  it('la plantilla con marca lleva el nombre (escapado), el color, el logo y «Enviado con Torre»', () => {
    const { html } = plantillaCorreo({ ...base1, marca });
    assert.ok(html.includes('Administradora &lt;Torres&gt; del Sol'));
    assert.ok(!html.includes('<Torres>'));
    assert.ok(html.includes('#0057b8'), 'color de marca en claro');
    assert.ok(html.includes('#7ab3ff'), 'color de marca en oscuro');
    assert.ok(html.includes(marca.logoUrl.replace(/&/g, '&amp;')), 'logo con URL absoluta y versión');
    assert.ok(html.includes(PIE_ENVIADO_CON_TORRE));
    assert.ok(!html.includes('Torre · Administración de condominios'), 'la línea de Torre se reemplaza');
    assert.ok(!html.includes('/icon-192.png') && !html.includes('>Torre</td>'), 'sin el ícono ni la palabra de Torre en la cabecera');
    assert.ok(!html.includes('#007565'), 'sin el verde de Torre en los acentos');
  });

  it('sin marca sale exactamente igual que antes: cara de Torre y su pie', () => {
    const sin = plantillaCorreo(base1).html;
    assert.equal(plantillaCorreo({ ...base1, marca: null }).html, sin);
    assert.ok(sin.includes('/icon-192.png') && sin.includes('>Torre</td>') && sin.includes('Torre · Administración de condominios'));
    assert.ok(!sin.includes(PIE_ENVIADO_CON_TORRE));
    assert.ok(sin.includes('#007565'));
  });

  it('sin logo queda la inicial del nombre en un cuadro de color; sin color elegido, los acentos siguen en el verde de Torre', () => {
    const { html } = plantillaCorreo({ ...base1, marca: { ...marca, logoUrl: null } });
    assert.ok(/class="logo"[^>]*>A<\/td>/.test(html), 'inicial «A»');
    assert.ok(!html.includes('<img'), 'sin imagen');
    const sinColor = plantillaCorreo({ ...base1, marca: { nombre: 'Casa Sur', logoUrl: null, claro: null, oscuro: null } }).html;
    assert.ok(sinColor.includes('Casa Sur') && sinColor.includes('#007565') && sinColor.includes(PIE_ENVIADO_CON_TORRE));
  });

  it('correoDeAviso pasa la marca al marco; sin marca no cambia', () => {
    const datos = { nombre: 'Ana', periodo: 'octubre de 2026', monto: 'S/ 150.00', vencimiento: '10/11/2026', condominio: 'Complejo A' };
    const con = correoDeAviso('recibo_emitido', datos, undefined, marca).html;
    assert.ok(con.includes('#0057b8') && con.includes(PIE_ENVIADO_CON_TORRE));
    assert.equal(correoDeAviso('recibo_emitido', datos).html, correoDeAviso('recibo_emitido', datos, undefined, null).html);
  });

  describe('invitación a un usuario nuevo', () => {
    const original = comercialCorreo.deps;
    after(() => { comercialCorreo.deps = original; });
    const invitar = async (empresaId: number) => {
      const u = await prisma.usuario.create({ data: { nombre: 'Nuevo Personal', email: `nuevo${empresaId}@test.pe`, rol: 'seguridad', empresa_id: empresaId } });
      const enviados: { from: string; html: string }[] = [];
      comercialCorreo.deps = () => ({
        ahora: () => new Date(), esperar: async () => {}, azar: () => 0, env: { RESEND_API_KEY: 're_CLAVE-FALSA-NO-REAL', MAIL_FROM: 'Torre <avisos@ejemplo.test>' },
        fetch: (async (_u: string | URL | Request, init?: RequestInit) => { enviados.push(JSON.parse(String(init?.body))); return new Response('{}', { status: 200 }); }) as typeof fetch,
      });
      assert.deepEqual(await invitarUsuario(u.id, null), { estado: 'enviada' });
      return enviados[0]!;
    };

    it('con marca activa la invitación lleva la marca de SU empresa; sin ella, la cara de Torre', async () => {
      await llamar(base, 'PUT', `/api/empresas/${d.empresaA.id}`, T.adminA, MARCA_A);
      const conMarca = await invitar(d.empresaA.id);
      assert.ok(conMarca.html.includes('Administradora Torres del Sol') && conMarca.html.includes('#0057b8') && conMarca.html.includes(PIE_ENVIADO_CON_TORRE));
      assert.equal(conMarca.from, 'Administradora Torres del Sol vía Torre <avisos@ejemplo.test>');
      await prisma.empresaAdministradora.update({ where: { id: d.empresaB.id }, data: { nombre_comercial: 'Marca de B', color_marca: '#ff0000' } });
      const sinMarca = await invitar(d.empresaB.id);
      assert.ok(!sinMarca.html.includes('Marca de B') && !sinMarca.html.includes('#ff0000') && !sinMarca.html.includes('Torres del Sol'));
      assert.ok(sinMarca.html.includes('#007565'));
      assert.equal(sinMarca.from, 'Torre <avisos@ejemplo.test>');
    });
  });

  describe('de punta a punta: la cola de avisos con Resend falso', () => {
    const AHORA = new Date();
    const ENV: NodeJS.ProcessEnv = { RESEND_API_KEY: 're_CLAVE-FALSA-NO-REAL', MAIL_FROM: 'Torre <avisos@ejemplo.test>' };
    const enviar = async (usuarioId: number, reciboId: number) => {
      await prisma.notificacion.deleteMany();
      await prisma.usuario.updateMany({ data: { aviso_email: true, aviso_whatsapp: false } });
      await encolarAviso('recibo_emitido', usuarioId, { entidad: 'recibo', id: reciboId }, { canales: ['email'] });
      const cuerpos: { from: string; html: string; to: string[] }[] = [];
      const deps: DepsAvisos = {
        ahora: () => new Date(AHORA.getTime() + 60_000), esperar: async () => {}, azar: () => 0, env: ENV,
        fetch: (async (_u: string | URL | Request, init?: RequestInit) => { cuerpos.push(JSON.parse(String(init?.body))); return new Response('{}', { status: 200 }); }) as typeof fetch,
      };
      const r = await procesarCola(deps);
      assert.equal(r.enviadas, 1, JSON.stringify(r));
      return cuerpos[0]!;
    };

    it('empresa con marca activa: el correo lleva su nombre, color y logo; el remitente dice «<Nombre comercial> vía Torre» y la dirección no cambia', async () => {
      await llamar(base, 'PUT', `/api/empresas/${d.empresaA.id}`, T.adminA, MARCA_A);
      await crudo('PUT', `/api/empresas/${d.empresaA.id}/logo`, T.adminA, PNG);
      const c = await enviar(d.inquilino1.id, d.reciboVencidoA.id); // el inquilino es quien paga A-101
      assert.ok(c.html.includes('Administradora Torres del Sol'));
      assert.ok(c.html.includes('#0057b8'));
      assert.match(c.html, new RegExp(`https://torrecondominios\\.com/api/publico/marca/${d.empresaA.id}/logo\\?f=[A-Za-z0-9_-]{22}&amp;v=\\d+`));
      assert.ok(c.html.includes(PIE_ENVIADO_CON_TORRE));
      assert.equal(c.from, 'Administradora Torres del Sol vía Torre <avisos@ejemplo.test>');
    });

    it('empresa sin la capacidad (aunque tenga nombre y color guardados): el correo sale como siempre, con «<Condominio> vía Torre»', async () => {
      await prisma.empresaAdministradora.update({ where: { id: d.empresaB.id }, data: { nombre_comercial: 'Marca de B', color_marca: '#ff0000' } });
      await crudo('PUT', `/api/empresas/${d.empresaB.id}/logo`, T.adminB, PNG);
      const c = await enviar(d.propietarioB.id, d.reciboB.id);
      assert.ok(!c.html.includes('Marca de B') && !c.html.includes('#ff0000') && !c.html.includes('/api/publico/marca/'));
      assert.ok(c.html.includes('#007565') && c.html.includes('Torre · Administración de condominios'));
      assert.equal(c.from, 'Complejo B vía Torre <avisos@ejemplo.test>');
    });

    it('el correo de la empresa B nunca lleva la marca de la A, aunque A esté activa', async () => {
      await llamar(base, 'PUT', `/api/empresas/${d.empresaA.id}`, T.adminA, MARCA_A);
      const c = await enviar(d.propietarioB.id, d.reciboB.id);
      assert.ok(!c.html.includes('Torres del Sol') && !c.html.includes('#0057b8'));
    });
  });
});
