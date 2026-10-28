// Datos del recibo impreso que se guardan en la base y se editan en pantallas: foto de cabecera del condominio, logo de la empresa, notas de pago,
// contacto de la administración y «correo del block». Imágenes con tope de 2 MB y tipo verificado; alcance por empresa, junta y residente.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { cabecerasDeSesion, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'adminA' | 'adminB' | 'superadmin' | 'presi1' | 'presi2' | 'prop1' | 'propB', string>;
let b1: { id: number };
let b2: { id: number };

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 7)]);
const crudo = (metodo: string, ruta: string, token: string | null, cuerpo?: Buffer, tipo = 'image/png') =>
  fetch(base + ruta, { method: metodo, headers: { ...cabecerasDeSesion(token), ...(cuerpo ? { 'content-type': tipo, 'x-nombre-archivo': 'foto.png' } : {}) }, body: cuerpo ? new Uint8Array(cuerpo) : undefined });

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  const hash = await bcrypt.hash(PASSWORD, 4);
  b1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'block', complejo_id: d.complejoA.id } });
  b2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'block', complejo_id: d.complejoA.id } });
  await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: b1.id } });
  for (const [n, e] of [[1, b1], [2, b2]] as const) {
    await prisma.usuario.create({ data: { nombre: `Presi ${n}`, email: `presi${n}@test.pe`, rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, estructura_id: e.id, cargo_junta: 'presidente' } });
  }
  T = {
    adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'), superadmin: await login(base, 'super@test.pe'),
    presi1: await login(base, 'presi1@test.pe'), presi2: await login(base, 'presi2@test.pe'),
    prop1: await login(base, 'prop1@test.pe'), propB: await login(base, 'propb@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('foto de cabecera del condominio', () => {
  const ruta = () => `/api/complejos/${d.complejoA.id}/cabecera`;

  it('la sube la administración; la ven la administración y los residentes de ESE condominio; nadie más', async () => {
    const sube = await crudo('PUT', ruta(), T.adminA, PNG);
    assert.equal(sube.status, 200, await sube.clone().text());
    assert.match((await sube.json() as { cabecera_url: string }).cabecera_url, new RegExp(`^/api/complejos/${d.complejoA.id}/cabecera\\?v=\\d+$`));
    for (const t of [T.adminA, T.superadmin, T.prop1]) {
      const r = await crudo('GET', ruta(), t);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await r.arrayBuffer()), PNG);
    }
    // otra empresa y residentes de otro condominio: 404 (no se revela que exista)
    for (const t of [T.adminB, T.propB]) assert.equal((await crudo('GET', ruta(), t)).status, 404);
    assert.equal((await crudo('GET', ruta(), null)).status, 401);
  });

  it('escribir es sólo de la administración de ese condominio: otra empresa 404; junta y residentes 403; sin sesión 401', async () => {
    assert.equal((await crudo('PUT', ruta(), T.adminB, PNG)).status, 404);
    assert.equal((await crudo('PUT', ruta(), T.presi1, PNG)).status, 403);
    assert.equal((await crudo('PUT', ruta(), T.prop1, PNG)).status, 403);
    assert.equal((await crudo('PUT', ruta(), null, PNG)).status, 401);
    assert.equal((await crudo('DELETE', ruta(), T.adminB)).status, 404);
    assert.equal((await crudo('DELETE', ruta(), T.presi1)).status, 403);
  });

  it('la ficha del condominio avisa que tiene foto pero nunca arrastra los bytes', async () => {
    const r = await llamar(base, 'GET', `/api/complejos/${d.complejoA.id}`, T.adminA);
    assert.match(r.body.cabecera_url, /^\/api\/complejos\/\d+\/cabecera\?v=\d+$/);
    assert.ok(!r.texto.includes('datos') && !r.texto.includes('"data"'), 'sin bytes en la ficha');
    const lista = await llamar(base, 'GET', '/api/complejos', T.adminA);
    assert.ok(!lista.texto.includes('"data"'));
    assert.equal((await llamar(base, 'GET', `/api/complejos/${d.complejoB.id}`, T.adminB)).body.cabecera_url, null);
  });

  it('tope de 2 MB (413), sólo JPG/PNG/WebP (415), los bytes deben ser del tipo (422) y no vacía (422)', async () => {
    assert.equal((await crudo('PUT', ruta(), T.adminA, Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]))).status, 413);
    assert.equal((await crudo('PUT', ruta(), T.adminA, PNG, 'image/gif')).status, 415);
    assert.equal((await crudo('PUT', ruta(), T.adminA, PNG, 'image/svg+xml')).status, 415, 'un SVG puede llevar scripts');
    assert.equal((await crudo('PUT', ruta(), T.adminA, Buffer.from('<svg onload=alert(1)>'), 'image/png')).status, 422);
    assert.equal((await crudo('PUT', ruta(), T.adminA, JPG, 'image/png')).status, 422, 'un JPG declarado como PNG');
    assert.equal((await crudo('PUT', ruta(), T.adminA, Buffer.alloc(0))).status, 422);
    assert.equal((await crudo('PUT', ruta(), T.adminA, JPG, 'image/jpeg')).status, 200, 'JPG sí');
    const exacto = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 - PNG.length)]);
    assert.equal((await crudo('PUT', ruta(), T.adminA, exacto)).status, 200, 'justo 2 MB cabe');
    assert.equal((await prisma.imagenRecibo.count({ where: { complejo_id: d.complejoA.id } })), 1, 'una sola imagen por condominio: reemplaza');
  });

  it('se sirve sin que el navegador la reinterprete ni la guarde en cachés compartidas; quitarla la borra', async () => {
    await crudo('PUT', ruta(), T.adminA, PNG);
    const r = await crudo('GET', ruta(), T.adminA);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('content-security-policy'), 'sandbox');
    assert.match(r.headers.get('cache-control') ?? '', /private/);
    assert.match(r.headers.get('content-disposition') ?? '', /^inline/);
    assert.equal((await crudo('DELETE', ruta(), T.adminA)).status, 204);
    assert.equal((await crudo('GET', ruta(), T.adminA)).status, 404);
  });
});

describe('logo de la empresa', () => {
  const ruta = (id = d.empresaA.id) => `/api/empresas/${id}/logo`;

  it('lo sube el admin de ESA empresa; lo ven su admin y los residentes de sus condominios; otra empresa no', async () => {
    assert.equal((await crudo('PUT', ruta(), T.adminA, PNG)).status, 200);
    for (const t of [T.adminA, T.prop1]) assert.equal((await crudo('GET', ruta(), t)).status, 200);
    for (const t of [T.adminB, T.propB]) assert.equal((await crudo('GET', ruta(), t)).status, 404);
    assert.equal((await crudo('PUT', ruta(), T.adminB, PNG)).status, 404, 'otra empresa');
    assert.equal((await crudo('PUT', ruta(d.empresaB.id), T.adminA, PNG)).status, 404);
    assert.equal((await crudo('PUT', ruta(), T.prop1, PNG)).status, 403);
    assert.equal((await crudo('PUT', ruta(), T.presi1, PNG)).status, 403);
    const e = await llamar(base, 'GET', `/api/empresas/${d.empresaA.id}`, T.adminA);
    assert.match(e.body.logo_url, /^\/api\/empresas\/\d+\/logo\?v=\d+$/);
    assert.ok(!e.texto.includes('"data"'));
  });

  it('mismo tope y mismo tipo que la foto del condominio', async () => {
    assert.equal((await crudo('PUT', ruta(), T.adminA, Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]))).status, 413);
    assert.equal((await crudo('PUT', ruta(), T.adminA, PNG, 'application/pdf')).status, 415);
    assert.equal((await crudo('PUT', ruta(), T.adminA, Buffer.from('MZ.exe'), 'image/png')).status, 422);
    assert.equal((await crudo('DELETE', ruta(), T.adminA)).status, 204);
    assert.equal((await crudo('GET', ruta(), T.adminA)).status, 404);
  });
});

describe('notas de pago, contacto de la administración y correo del block', () => {
  it('la administración guarda notas de pago (varias líneas) y el contacto del condominio', async () => {
    const r = await llamar(base, 'PUT', `/api/complejos/${d.complejoA.id}`, T.adminA, {
      notas_pago: 'Enviar voucher al correo del block\nPagos desde provincia: cobro adicional de S/ 9',
      admin_nombre: 'Administradora Uno', admin_celular: '999 111 222', admin_correo: 'ADMIN@Condominio.pe',
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.notas_pago, 'Enviar voucher al correo del block\nPagos desde provincia: cobro adicional de S/ 9');
    assert.equal(r.body.admin_correo, 'admin@condominio.pe', 'el correo se normaliza');
    assert.equal((await llamar(base, 'PUT', `/api/complejos/${d.complejoA.id}`, T.adminA, { admin_correo: 'no-es-correo' })).status, 422);
    assert.equal((await llamar(base, 'PUT', `/api/complejos/${d.complejoA.id}`, T.adminA, { admin_celular: 'llámame' })).status, 422);
    assert.equal((await llamar(base, 'PUT', `/api/complejos/${d.complejoA.id}`, T.adminA, { notas_pago: 'x'.repeat(2001) })).status, 422);
    assert.equal((await llamar(base, 'PUT', `/api/complejos/${d.complejoA.id}`, T.adminA, { notas_pago: '' })).body.notas_pago, null, 'vacío = sin notas');
    await llamar(base, 'PUT', `/api/complejos/${d.complejoA.id}`, T.adminA, { notas_pago: 'Enviar voucher al correo del block' });
  });

  it('otra empresa no los cambia (404) y la junta tampoco (403)', async () => {
    assert.equal((await llamar(base, 'PUT', `/api/complejos/${d.complejoA.id}`, T.adminB, { admin_nombre: 'Intruso' })).status, 404);
    assert.equal((await llamar(base, 'PUT', `/api/complejos/${d.complejoA.id}`, T.presi1, { admin_nombre: 'Intruso' })).status, 403);
    assert.equal((await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: d.complejoA.id } })).admin_nombre, 'Administradora Uno');
  });

  it('el correo del block lo cambian la administración y la junta DE ESE BLOCK; la de otro block y los residentes no', async () => {
    const ruta = (id: number) => `/api/estructuras/${id}/correo-vouchers`;
    assert.equal((await llamar(base, 'PUT', ruta(b1.id), T.adminA, { correo_vouchers: 'juntadirectiva.block.b1@gmail.com' })).status, 200);
    assert.equal((await llamar(base, 'PUT', ruta(b1.id), T.presi1, { correo_vouchers: 'Block1@Gmail.com' })).body.correo_vouchers, 'block1@gmail.com');
    assert.equal((await llamar(base, 'PUT', ruta(b1.id), T.presi2, { correo_vouchers: 'intruso@gmail.com' })).status, 404, 'la junta del Block 2 no toca el Block 1');
    assert.equal((await llamar(base, 'PUT', ruta(b1.id), T.adminB, { correo_vouchers: 'intruso@gmail.com' })).status, 404);
    assert.equal((await llamar(base, 'PUT', ruta(b1.id), T.prop1, { correo_vouchers: 'intruso@gmail.com' })).status, 404, 'un vecino sin cargo');
    assert.equal((await llamar(base, 'PUT', ruta(b1.id), T.adminA, { correo_vouchers: 'no-es-correo' })).status, 422);
    assert.equal((await prisma.estructura.findUniqueOrThrow({ where: { id: b1.id } })).correo_vouchers, 'block1@gmail.com');
    assert.equal((await llamar(base, 'PUT', ruta(b1.id), T.adminA, { correo_vouchers: '' })).body.correo_vouchers, null, 'vacío lo quita');
    await llamar(base, 'PUT', ruta(b1.id), T.presi1, { correo_vouchers: 'block1@gmail.com' });
  });

  it('el residente ve todo esto en el detalle de su mantenimiento: notas, contacto, correo del block, foto y logo', async () => {
    await crudo('PUT', `/api/complejos/${d.complejoA.id}/cabecera`, T.adminA, PNG);
    await crudo('PUT', `/api/empresas/${d.empresaA.id}/logo`, T.adminA, PNG);
    const r = await llamar(base, 'GET', `/api/me/mantenimientos/${d.reciboVencidoA.id}/${d.unidadA1.id}`, T.prop1);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.correo_vouchers, 'block1@gmail.com');
    assert.equal(r.body.condominio.notas_pago, 'Enviar voucher al correo del block');
    assert.deepEqual([r.body.condominio.admin_nombre, r.body.condominio.admin_celular, r.body.condominio.admin_correo], ['Administradora Uno', '999 111 222', 'admin@condominio.pe']);
    assert.match(r.body.condominio.cabecera_url, /^\/api\/complejos\/\d+\/cabecera\?v=\d+$/);
    assert.match(r.body.empresa.logo_url, /^\/api\/empresas\/\d+\/logo\?v=\d+$/);
    assert.equal(r.body.agua, null, 'sin lectura cargada');
    assert.equal(r.body.fecha_corte_agua, null);
    assert.ok(!r.texto.includes('"data"'), 'los bytes nunca viajan en el detalle');
    // la imagen que apunta la URL es servible por ese mismo residente
    assert.equal((await crudo('GET', r.body.condominio.cabecera_url, T.prop1)).status, 200);
    assert.equal((await crudo('GET', r.body.empresa.logo_url, T.prop1)).status, 200);
  });

  it('sin foto, sin contacto y sin correo, el detalle trae nulos (el recibo omite el bloque, no se rompe)', async () => {
    await crudo('DELETE', `/api/complejos/${d.complejoA.id}/cabecera`, T.adminA);
    await llamar(base, 'PUT', `/api/estructuras/${b1.id}/correo-vouchers`, T.adminA, { correo_vouchers: null });
    await llamar(base, 'PUT', `/api/complejos/${d.complejoA.id}`, T.adminA, { notas_pago: null, admin_nombre: null, admin_celular: null, admin_correo: null });
    const r = await llamar(base, 'GET', `/api/recibos/${d.reciboVencidoA.id}/mantenimientos/${d.unidadA1.id}`, T.adminA);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual([r.body.condominio.cabecera_url, r.body.condominio.notas_pago, r.body.condominio.admin_nombre, r.body.correo_vouchers], [null, null, null, null]);
    assert.equal(r.body.deuda_acumulada, '0.00');
    assert.equal(r.body.total_general, r.body.total);
  });
});
