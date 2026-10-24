import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { cabecerasDeSesion, esperar, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { hoyLima } from '../src/server/lib/fechas';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let e1: { id: number };
let e2: { id: number };
let eB: { id: number };
let ids: Record<'presi1' | 'tesor1' | 'presiTodo' | 'secre1' | 'vocal1' | 'presi2' | 'presiB' | 'presiPropio', number>;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1' | 'prop2' | 'inq1' | 'mttoA' | 'segA' | 'presi1' | 'tesor1' | 'presiTodo' | 'secre1' | 'vocal1' | 'presi2' | 'presiB' | 'presiPropio', string>;

before(async () => {
  d = await sembrar();
  e1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
  e2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'Block', complejo_id: d.complejoA.id } });
  eB = await prisma.estructura.create({ data: { nombre: 'Block B', tipo: 'Block', complejo_id: d.complejoB.id } });
  await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: e1.id } }); // prop1 e inq1
  await prisma.unidad.update({ where: { id: d.unidadA2.id }, data: { estructura_id: e2.id } }); // prop2
  const hash = await bcrypt.hash(PASSWORD, 4);
  const junta = async (nombre: string, email: string, cargo: string, complejo: { id: number; empresa_id: number | null }, estructura_id: number | null) =>
    (await prisma.usuario.create({ data: { nombre, email, rol: 'propietario', password_hash: hash, empresa_id: complejo.empresa_id, complejo_id: complejo.id, cargo_junta: cargo, estructura_id } })).id;
  ids = {
    presi1: await junta('Presidente 1', 'presi1@test.pe', 'presidente', d.complejoA, e1.id),
    tesor1: await junta('Tesorero 1', 'tesor1@test.pe', 'tesorero', d.complejoA, e1.id),
    presiTodo: await junta('Presidente Todo', 'presitodo@test.pe', 'presidente', d.complejoA, null),
    secre1: await junta('Secretario 1', 'secre1@test.pe', 'secretario', d.complejoA, e1.id),
    vocal1: await junta('Vocal 1', 'vocal1@test.pe', 'vocal', d.complejoA, e1.id),
    presi2: await junta('Presidente 2', 'presi2@test.pe', 'presidente', d.complejoA, e2.id),
    presiB: await junta('Presidente B', 'presib@test.pe', 'presidente', d.complejoB, eB.id),
    presiPropio: await junta('Presidente con unidad', 'presipropio@test.pe', 'presidente', d.complejoA, e1.id),
  };
  await prisma.unidad.create({ data: { codigo: 'J-1', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: e1.id, propietario_id: ids.presiPropio, estado: 'activa' } });
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    super: await login(base, 'super@test.pe'),
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    prop1: await login(base, 'prop1@test.pe'),
    prop2: await login(base, 'prop2@test.pe'),
    inq1: await login(base, 'inq1@test.pe'),
    mttoA: await login(base, 'mtto.a@test.pe'),
    segA: await login(base, 'seg.a@test.pe'),
    presi1: await login(base, 'presi1@test.pe'),
    tesor1: await login(base, 'tesor1@test.pe'),
    presiTodo: await login(base, 'presitodo@test.pe'),
    secre1: await login(base, 'secre1@test.pe'),
    vocal1: await login(base, 'vocal1@test.pe'),
    presi2: await login(base, 'presi2@test.pe'),
    presiB: await login(base, 'presib@test.pe'),
    presiPropio: await login(base, 'presipropio@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

const NUMERO = '19412345678901';
const CCI = '12345678901234567890';
const banco = (extra: Record<string, unknown> = {}) => ({ tipo: 'banco', banco: 'BCP', tipo_cuenta: 'ahorros', numero_cuenta: NUMERO, cci: CCI, titular: 'Junta Directiva Block 1', ...extra });
const yape = (extra: Record<string, unknown> = {}) => ({ tipo: 'yape', celular: '987654321', titular: 'María Pérez', ...extra });
const llama = (t: string | null, metodo: string, ruta: string, cuerpo?: unknown) => llamar(base, metodo, ruta, t, cuerpo);
const PNG = (extra = 'qr-de-prueba') => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(extra)]);
const JPG = (extra = 'qr-jpg') => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(extra)]);
const WEBP = (extra = 'qr-webp') => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from(extra)]);
const PDF = Buffer.from('%PDF-1.4\nfalso\n%%EOF');

async function subirQr(token: string | null, id: number, bytes: Buffer, tipo: string, nombre?: string) {
  const r = await fetch(`${base}/api/medios-pago/${id}/qr`, {
    method: 'PUT',
    headers: { 'content-type': tipo, ...cabecerasDeSesion(token), ...(nombre !== undefined ? { 'x-nombre-archivo': nombre } : {}) },
    body: new Uint8Array(bytes),
  });
  const texto = await r.text();
  let body: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = JSON.parse(texto); } catch { /* sin JSON */ }
  return { status: r.status, body, headers: r.headers };
}
async function bajarQr(token: string | null, id: number) {
  const r = await fetch(`${base}/api/medios-pago/${id}/qr`, { headers: cabecerasDeSesion(token) });
  return { status: r.status, headers: r.headers, bytes: Buffer.from(await r.arrayBuffer()) };
}

/** Crea un medio por la API y devuelve su id (comprueba el 201). */
async function crear(token: string, cuerpo: Record<string, unknown>): Promise<number> {
  const r = await llama(token, 'POST', '/api/medios-pago', cuerpo);
  assert.equal(r.status, 201, r.texto);
  return r.body.id;
}
const limpiar = () => prisma.medioPago.deleteMany();

describe('medios de pago: matriz de permisos', () => {
  beforeEach(limpiar);

  it('listar: administradora, superadmin y presidente/tesorero sí; secretario, vocal, propietario sin cargo, inquilino y personal no', async () => {
    const esperado: [keyof typeof T | null, number][] = [
      [null, 401], ['super', 200], ['adminA', 200], ['adminB', 200], ['presi1', 200], ['tesor1', 200], ['presiTodo', 200],
      ['secre1', 403], ['vocal1', 403], ['prop1', 403], ['inq1', 403], ['mttoA', 403], ['segA', 403],
    ];
    for (const [quien, status] of esperado) {
      const r = await llama(quien ? T[quien] : null, 'GET', '/api/medios-pago');
      assert.equal(r.status, status, `${quien} → ${r.status}`);
    }
  });

  it('secretario, vocal y propietario sin cargo no pueden crear, editar ni borrar', async () => {
    const id = await crear(T.adminA, banco({ complejo_id: d.complejoA.id, estructura_id: e1.id }));
    for (const quien of ['secre1', 'vocal1', 'prop1', 'inq1', 'mttoA', 'segA'] as const) {
      assert.equal((await llama(T[quien], 'POST', '/api/medios-pago', banco({ complejo_id: d.complejoA.id, estructura_id: e1.id }))).status, 403, quien);
      assert.equal((await llama(T[quien], 'PUT', `/api/medios-pago/${id}`, banco())).status, 403, quien);
      assert.equal((await llama(T[quien], 'PATCH', `/api/medios-pago/${id}`, { activo: false })).status, 403, quien);
      assert.equal((await llama(T[quien], 'DELETE', `/api/medios-pago/${id}`)).status, 403, quien);
    }
    assert.equal(await prisma.medioPago.count(), 1);
  });

  it('un presidente cuyo usuario no tiene condominio no gana permisos', async () => {
    const hash = await bcrypt.hash(PASSWORD, 4);
    await prisma.usuario.create({ data: { nombre: 'Presi sin condominio', email: 'presi.sin@test.pe', rol: 'propietario', password_hash: hash, cargo_junta: 'presidente' } });
    const t = await login(base, 'presi.sin@test.pe');
    assert.equal((await llama(t, 'GET', '/api/medios-pago')).status, 403);
  });

  it('el cargo sólo vale para propietarios: un inquilino con cargo en la base sigue sin permisos', async () => {
    await prisma.usuario.update({ where: { email: 'inq1@test.pe' }, data: { cargo_junta: 'presidente', estructura_id: e1.id } });
    try {
      assert.equal((await llama(T.inq1, 'GET', '/api/medios-pago')).status, 403);
    } finally {
      await prisma.usuario.update({ where: { email: 'inq1@test.pe' }, data: { cargo_junta: null, estructura_id: null } });
    }
  });

  it('ámbito: cada quien sólo ve lo suyo y entre empresas/blocks ajenos responde 404', async () => {
    const idBlock1 = await crear(T.adminA, banco({ complejo_id: d.complejoA.id, estructura_id: e1.id }));
    const idBlock2 = await crear(T.adminA, yape({ complejo_id: d.complejoA.id, estructura_id: e2.id }));
    const idTodo = await crear(T.adminA, yape({ complejo_id: d.complejoA.id }));

    const lista = async (t: string) => ((await llama(t, 'GET', '/api/medios-pago')).body.items as { id: number }[]).map((m) => m.id).sort();
    assert.deepEqual(await lista(T.adminA), [idBlock1, idBlock2, idTodo].sort());
    assert.deepEqual(await lista(T.super), [idBlock1, idBlock2, idTodo].sort());
    assert.deepEqual(await lista(T.adminB), []);
    assert.deepEqual(await lista(T.presi1), [idBlock1]); // su block, no el otro ni el del condominio entero
    assert.deepEqual(await lista(T.tesor1), [idBlock1]);
    assert.deepEqual(await lista(T.presi2), [idBlock2]);
    assert.deepEqual(await lista(T.presiTodo), [idBlock1, idBlock2, idTodo].sort()); // una junta sin block alcanza todo su condominio
    assert.deepEqual(await lista(T.presiB), []);

    for (const [quien, id] of [['adminB', idBlock1], ['presiB', idBlock1], ['presi2', idBlock1], ['presi1', idBlock2], ['presi1', idTodo], ['presi2', idTodo]] as const) {
      assert.equal((await llama(T[quien], 'PUT', `/api/medios-pago/${id}`, yape())).status, 404, `PUT ${quien} ${id}`);
      assert.equal((await llama(T[quien], 'PATCH', `/api/medios-pago/${id}`, { activo: false })).status, 404, `PATCH ${quien} ${id}`);
      assert.equal((await llama(T[quien], 'DELETE', `/api/medios-pago/${id}`)).status, 404, `DELETE ${quien} ${id}`);
    }
    assert.equal(await prisma.medioPago.count(), 3);
    // Quien sí gestiona
    assert.equal((await llama(T.presiTodo, 'PATCH', `/api/medios-pago/${idTodo}`, { orden: 3 })).status, 200);
    assert.equal((await llama(T.tesor1, 'PUT', `/api/medios-pago/${idBlock1}`, banco({ titular: 'Nuevo titular' }))).status, 200);
    assert.equal((await llama(T.adminA, 'DELETE', `/api/medios-pago/${idBlock2}`)).status, 204);
  });

  it('crear en un ámbito ajeno: 404 (otra empresa, otro block, otro condominio, «todo el condominio» para una junta de block)', async () => {
    const casos: [keyof typeof T, Record<string, unknown>][] = [
      ['adminB', { complejo_id: d.complejoA.id }],
      ['adminA', { complejo_id: d.complejoB.id }],
      ['adminA', { complejo_id: d.complejoA.id, estructura_id: eB.id }], // block de otro condominio
      ['presi1', { complejo_id: d.complejoA.id, estructura_id: e2.id }],
      ['presi1', { complejo_id: d.complejoA.id, estructura_id: null }],
      ['presiB', { complejo_id: d.complejoA.id, estructura_id: e1.id }],
    ];
    for (const [quien, ambito] of casos) {
      assert.equal((await llama(T[quien], 'POST', '/api/medios-pago', banco(ambito))).status, 404, `${quien} ${JSON.stringify(ambito)}`);
    }
    assert.equal(await prisma.medioPago.count(), 0);
  });

  it('la junta crea por defecto en su propio ámbito y la administradora debe indicar el condominio', async () => {
    const r1 = await llama(T.presi1, 'POST', '/api/medios-pago', banco());
    assert.equal(r1.status, 201);
    assert.equal(r1.body.complejo_id, d.complejoA.id);
    assert.equal(r1.body.estructura_id, e1.id);
    const r2 = await llama(T.presiTodo, 'POST', '/api/medios-pago', yape());
    assert.equal(r2.status, 201);
    assert.equal(r2.body.estructura_id, null); // una junta sin block crea para todo el condominio
    assert.equal((await llama(T.adminA, 'POST', '/api/medios-pago', yape())).status, 422); // sin complejo_id
  });
});

describe('medios de pago: ámbitos disponibles', () => {
  it('la administradora ve los condominios de su empresa con sus blocks; la junta, sólo los suyos', async () => {
    const a = await llama(T.adminA, 'GET', '/api/medios-pago/ambitos');
    assert.equal(a.status, 200);
    assert.deepEqual(a.body.complejos.map((c: { id: number }) => c.id), [d.complejoA.id]);
    assert.deepEqual(a.body.complejos[0].estructuras.map((e: { id: number }) => e.id).sort(), [e1.id, e2.id].sort());
    assert.equal(a.body.fijo, false);
    const todo = await llama(T.presiTodo, 'GET', '/api/medios-pago/ambitos');
    assert.equal(todo.body.complejos[0].estructuras.length, 2);
    assert.equal(todo.body.fijo, false);
    const p1 = await llama(T.presi1, 'GET', '/api/medios-pago/ambitos');
    assert.deepEqual(p1.body.complejos[0].estructuras.map((e: { id: number }) => e.id), [e1.id]);
    assert.equal(p1.body.fijo, true);
    const b = await llama(T.adminB, 'GET', '/api/medios-pago/ambitos');
    assert.deepEqual(b.body.complejos[0].estructuras.map((e: { id: number }) => e.id), [eB.id]);
    for (const quien of ['secre1', 'prop1', 'inq1', 'mttoA'] as const) assert.equal((await llama(T[quien], 'GET', '/api/medios-pago/ambitos')).status, 403, quien);
  });
});

describe('medios de pago: validación por tipo', () => {
  beforeEach(limpiar);
  const ambito = () => ({ complejo_id: d.complejoA.id, estructura_id: e1.id });
  const intentar = (cuerpo: Record<string, unknown>) => llama(T.adminA, 'POST', '/api/medios-pago', { ...ambito(), ...cuerpo });

  it('banco: catálogo cerrado, tipo de cuenta, número, CCI, titular y documento', async () => {
    assert.equal((await intentar(banco({ banco: 'Banco Inventado' }))).status, 422);
    assert.equal((await intentar(banco({ tipo_cuenta: 'plazo-fijo' }))).status, 422);
    assert.equal((await intentar(banco({ numero_cuenta: '1234567' }))).status, 422); // 7
    assert.equal((await intentar(banco({ numero_cuenta: '1'.repeat(21) }))).status, 422);
    assert.equal((await intentar(banco({ numero_cuenta: '1234abcd5678' }))).status, 422);
    assert.equal((await intentar(banco({ numero_cuenta: '--------' }))).status, 422);
    assert.equal((await intentar(banco({ cci: '1234567890123456789' }))).status, 422); // 19
    assert.equal((await intentar(banco({ cci: '1234567890123456789a' }))).status, 422);
    assert.equal((await intentar(banco({ titular: '' }))).status, 422);
    assert.equal((await intentar(banco({ titular: undefined }))).status, 422);
    assert.equal((await intentar(banco({ documento_titular: '123456789' }))).status, 422);
    assert.equal((await intentar(banco({ numero_cuenta: undefined }))).status, 422);
    assert.equal(await prisma.medioPago.count(), 0);
  });

  it('banco: acepta guiones, CCI opcional, DNI y RUC, y todos los bancos del catálogo', async () => {
    const r = await intentar(banco({ numero_cuenta: '194-1234567-8-90', cci: undefined, documento_titular: '12345678' }));
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.cci, null);
    assert.equal(r.body.numero_cuenta, '194-1234567-8-90');
    assert.equal((await intentar(banco({ cci: '', documento_titular: '20123456789' }))).status, 201);
    await limpiar();
    for (const b of ['BCP', 'BBVA', 'Interbank', 'Scotiabank', 'Banco de la Nación', 'Mibanco', 'BanBif', 'Pichincha', 'Otro']) {
      assert.equal((await intentar(banco({ banco: b }))).status, 201, b);
      await limpiar();
    }
  });

  it('yape y plin: celular peruano de 9 dígitos que empieza en 9 y titular', async () => {
    for (const tipo of ['yape', 'plin']) {
      assert.equal((await intentar(yape({ tipo, celular: '887654321' }))).status, 422);
      assert.equal((await intentar(yape({ tipo, celular: '98765432' }))).status, 422);
      assert.equal((await intentar(yape({ tipo, celular: '9876543210' }))).status, 422);
      assert.equal((await intentar(yape({ tipo, celular: '98765432a' }))).status, 422);
      assert.equal((await intentar(yape({ tipo, titular: '' }))).status, 422);
      assert.equal((await intentar(yape({ tipo, celular: undefined }))).status, 422);
      const ok = await intentar(yape({ tipo, celular: '987 654 321' }));
      assert.equal(ok.status, 201, ok.texto);
      assert.equal(ok.body.celular, '987654321');
      assert.equal(ok.body.numero_cuenta, null); // un yape no arrastra datos de banco
    }
    assert.equal((await intentar({ tipo: 'efectivo', titular: 'X' })).status, 422);
    assert.equal((await intentar({ titular: 'X' })).status, 422);
  });

  it('cambiar de tipo con PUT limpia lo que ya no aplica', async () => {
    const id = await crear(T.adminA, banco(ambito()));
    const r = await llama(T.adminA, 'PUT', `/api/medios-pago/${id}`, yape());
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.tipo, 'yape');
    assert.equal(r.body.banco, null);
    assert.equal(r.body.numero_cuenta, null);
    assert.equal(r.body.cci, null);
    assert.equal(r.body.estructura_id, e1.id); // el ámbito no se cambia con PUT
  });

  it('máximo 6 medios activos por ámbito: el 7.º, reactivar uno y editar al límite', async () => {
    const creados: number[] = [];
    for (let i = 0; i < 6; i++) creados.push(await crear(T.adminA, yape({ ...ambito(), celular: `98765432${i}` })));
    const septimo = await intentar(yape());
    assert.equal(septimo.status, 422);
    assert.match(septimo.body.error, /6/);
    // Otro block y el condominio entero tienen su propio tope
    assert.equal((await llama(T.adminA, 'POST', '/api/medios-pago', yape({ complejo_id: d.complejoA.id, estructura_id: e2.id }))).status, 201);
    assert.equal((await llama(T.adminA, 'POST', '/api/medios-pago', yape({ complejo_id: d.complejoA.id }))).status, 201);
    // Inactivos no cuentan
    const inactivo = await crear(T.adminA, yape({ ...ambito(), activo: false }));
    assert.equal((await llama(T.adminA, 'PATCH', `/api/medios-pago/${inactivo}`, { activo: true })).status, 422);
    assert.equal((await llama(T.adminA, 'PATCH', `/api/medios-pago/${creados[0]}`, { activo: false })).status, 200);
    assert.equal((await llama(T.adminA, 'PATCH', `/api/medios-pago/${inactivo}`, { activo: true })).status, 200);
    // Editar uno que ya está activo en el límite no se bloquea a sí mismo
    assert.equal((await llama(T.adminA, 'PUT', `/api/medios-pago/${creados[1]}`, yape({ titular: 'Otro nombre' }))).status, 200);
  });

  it('PATCH exige activo u orden y filtros de lista', async () => {
    const a = await crear(T.adminA, yape({ ...ambito(), orden: 2 }));
    await crear(T.adminA, yape({ complejo_id: d.complejoA.id, activo: false }));
    assert.equal((await llama(T.adminA, 'PATCH', `/api/medios-pago/${a}`, {})).status, 422);
    const patch = await llama(T.adminA, 'PATCH', `/api/medios-pago/${a}`, { orden: 9 });
    assert.equal(patch.body.orden, 9);
    assert.equal((await llama(T.adminA, 'GET', '/api/medios-pago?activo=false')).body.total, 1);
    assert.equal((await llama(T.adminA, 'GET', '/api/medios-pago?estructura_id=ninguna')).body.total, 1);
    assert.equal((await llama(T.adminA, 'GET', `/api/medios-pago?estructura_id=${e1.id}`)).body.total, 1);
    assert.equal((await llama(T.adminA, 'GET', `/api/medios-pago?complejo_id=${d.complejoB.id}`)).body.total, 0);
  });
});

describe('medios de pago: QR', () => {
  let medio: number;
  beforeEach(async () => {
    await limpiar();
    medio = await crear(T.adminA, yape({ complejo_id: d.complejoA.id, estructura_id: e1.id }));
  });

  it('acepta PNG, JPG y WebP; la lista dice tiene_qr y nunca trae los bytes', async () => {
    for (const [bytes, tipo] of [[PNG(), 'image/png'], [JPG(), 'image/jpeg'], [WEBP(), 'image/webp']] as const) {
      const r = await subirQr(T.adminA, medio, bytes, tipo, 'mi qr.png');
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.tiene_qr, true);
      assert.equal(r.body.qr_datos, undefined);
    }
    const lista = await llama(T.adminA, 'GET', '/api/medios-pago');
    assert.equal(lista.body.items[0].tiene_qr, true);
    assert.equal(lista.body.items[0].qr_datos, undefined);
    assert.doesNotMatch(lista.texto, /qr_datos/);
    const uno = await llama(T.adminA, 'PUT', `/api/medios-pago/${medio}`, yape());
    assert.equal(uno.body.tiene_qr, true); // editar los datos no borra el QR
  });

  it('rechaza tipos no permitidos, bytes falsos, vacío y más de 500 KB', async () => {
    assert.equal((await subirQr(T.adminA, medio, Buffer.from('GIF89a....'), 'image/gif')).status, 415);
    assert.equal((await subirQr(T.adminA, medio, PDF, 'application/pdf')).status, 415);
    assert.equal((await subirQr(T.adminA, medio, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')).status, 415);
    assert.equal((await subirQr(T.adminA, medio, Buffer.from('esto no es una imagen'), 'image/png')).status, 422);
    assert.equal((await subirQr(T.adminA, medio, JPG(), 'image/png')).status, 422); // bytes de JPG con cabecera PNG
    assert.equal((await subirQr(T.adminA, medio, PDF, 'image/png')).status, 422);
    assert.equal((await subirQr(T.adminA, medio, Buffer.alloc(0), 'image/png')).status, 422);
    assert.equal((await subirQr(T.adminA, medio, PNG('x'.repeat(500 * 1024)), 'image/png')).status, 413);
    assert.equal((await subirQr(T.adminA, medio, PNG('x'.repeat(100 * 1024)), 'image/png')).status, 200); // bajo el tope
    const r = await llama(T.adminA, 'PUT', `/api/medios-pago/${medio}/qr`, { hola: 'json' });
    assert.equal(r.status, 415);
  });

  it('entrega los mismos bytes con los headers seguros', async () => {
    const bytes = PNG('bytes-unicos-123');
    await subirQr(T.adminA, medio, bytes, 'image/png', 'qr-junta.png');
    const r = await bajarQr(T.adminA, medio);
    assert.equal(r.status, 200);
    assert.deepEqual(r.bytes, bytes);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('content-security-policy'), 'sandbox');
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
    assert.match(r.headers.get('content-disposition') ?? '', /^inline; filename="qr-junta.png"/);
  });

  it('acceso a subir y quitar: admin de la empresa y junta del ámbito; el resto 404/403', async () => {
    assert.equal((await subirQr(T.adminB, medio, PNG(), 'image/png')).status, 404);
    assert.equal((await subirQr(T.presi2, medio, PNG(), 'image/png')).status, 404);
    assert.equal((await subirQr(T.presiB, medio, PNG(), 'image/png')).status, 404);
    for (const quien of ['secre1', 'prop1', 'inq1', 'mttoA'] as const) assert.equal((await subirQr(T[quien], medio, PNG(), 'image/png')).status, 403, quien);
    assert.equal((await subirQr(null, medio, PNG(), 'image/png')).status, 401);
    assert.equal((await subirQr(T.presi1, medio, PNG(), 'image/png')).status, 200);
    assert.equal((await llama(T.adminB, 'DELETE', `/api/medios-pago/${medio}/qr`)).status, 404);
    assert.equal((await llama(T.secre1, 'DELETE', `/api/medios-pago/${medio}/qr`)).status, 403);
    assert.equal((await llama(T.tesor1, 'DELETE', `/api/medios-pago/${medio}/qr`)).status, 204);
    assert.equal((await bajarQr(T.adminA, medio)).status, 404);
    assert.equal((await llama(T.adminA, 'GET', '/api/medios-pago')).body.items[0].tiene_qr, false);
  });

  it('ver el QR: admin, junta del ámbito y residentes del ámbito (sólo activo); los demás no', async () => {
    await subirQr(T.adminA, medio, PNG(), 'image/png');
    const todo = await crear(T.adminA, yape({ complejo_id: d.complejoA.id }));
    await subirQr(T.adminA, todo, JPG(), 'image/jpeg');
    const esperado: [keyof typeof T | null, number, number][] = [
      // [quien, medio del block 1, medio de todo el condominio]
      [null, 401, 401], ['super', 200, 200], ['adminA', 200, 200], ['adminB', 404, 404],
      ['presi1', 200, 404], ['tesor1', 200, 404], ['presiTodo', 200, 200], ['presi2', 404, 404], ['presiB', 404, 404],
      ['prop1', 200, 200], ['inq1', 200, 200], // viven en el block 1
      ['prop2', 404, 200], // vive en el block 2: no ve el QR del block 1, sí el del condominio
      ['secre1', 404, 404], // sin unidad
      ['mttoA', 403, 403], ['segA', 403, 403],
    ];
    for (const [quien, a, b] of esperado) {
      const t = quien ? T[quien] : null;
      assert.equal((await bajarQr(t, medio)).status, a, `${quien} block`);
      assert.equal((await bajarQr(t, todo)).status, b, `${quien} condominio`);
    }
    // Presidente que además es residente de ese condominio ve el del condominio como vecino
    await llama(T.adminA, 'PATCH', `/api/medios-pago/${medio}`, { activo: false });
    assert.equal((await bajarQr(T.prop1, medio)).status, 404); // inactivo: ya no es de los vecinos
    assert.equal((await bajarQr(T.presi1, medio)).status, 200); // la junta sí lo gestiona
  });
});

describe('medios de pago: lo que ve el residente (GET /api/me/medios-pago)', () => {
  let cargoA1: number;
  before(async () => { cargoA1 = d.cargoVencidoA1.id; });
  beforeEach(limpiar);

  const nuevo = (extra: Record<string, unknown>) =>
    prisma.medioPago.create({ data: { complejo_id: d.complejoA.id, tipo: 'yape', celular: '987654321', titular: 'Titular', creado_por_id: d.adminA.id, ...extra } });

  it('primero los de su block, luego los del condominio, cada grupo por orden; sólo activos y de su ámbito', async () => {
    const condominioOrden0 = await nuevo({ orden: 0 });
    const blockOrden5 = await nuevo({ estructura_id: e1.id, orden: 5, tipo: 'banco', banco: 'BCP', tipo_cuenta: 'ahorros', numero_cuenta: NUMERO, cci: CCI, celular: null, documento_titular: '12345678' });
    const blockOrden1 = await nuevo({ estructura_id: e1.id, orden: 1, tipo: 'plin' });
    await nuevo({ estructura_id: e1.id, orden: 0, activo: false });
    await nuevo({ estructura_id: e2.id, orden: 0 }); // otro block
    await prisma.medioPago.create({ data: { complejo_id: d.complejoB.id, tipo: 'yape', celular: '999999999', titular: 'Otro condominio' } });
    const r = await llama(T.prop1, 'GET', `/api/me/medios-pago?cargo_id=${cargoA1}`);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.body.map((m: { id: number }) => m.id), [blockOrden1.id, blockOrden5.id, condominioOrden0.id]);
    assert.deepEqual(r.body.map((m: { ambito: string }) => m.ambito), ['block', 'block', 'condominio']);
    const banco1 = r.body[1];
    assert.equal(banco1.banco, 'BCP');
    assert.equal(banco1.tipo_cuenta, 'ahorros');
    assert.equal(banco1.numero_cuenta, NUMERO);
    assert.equal(banco1.cci, CCI);
    assert.equal(banco1.titular, 'Titular');
    assert.equal(banco1.tiene_qr, false);
  });

  it('no filtra datos internos: ni quién lo creó, ni el documento del titular, ni bytes', async () => {
    await nuevo({ estructura_id: e1.id, tipo: 'banco', banco: 'BBVA', tipo_cuenta: 'corriente', numero_cuenta: NUMERO, documento_titular: '12345678', celular: null, qr_tipo_mime: 'image/png', qr_datos: PNG() });
    const r = await llama(T.prop1, 'GET', `/api/me/medios-pago?cargo_id=${cargoA1}`);
    assert.equal(r.body[0].tiene_qr, true);
    assert.doesNotMatch(r.texto, /creado_por|documento_titular|qr_datos|12345678"|qr_tipo_mime|updated_at/);
    assert.deepEqual(Object.keys(r.body[0]).sort(), ['ambito', 'banco', 'cci', 'celular', 'id', 'numero_cuenta', 'orden', 'tiene_qr', 'tipo', 'tipo_cuenta', 'titular']);
  });

  it('el inquilino ve los de la unidad que habita; sin medios la lista es vacía', async () => {
    assert.deepEqual((await llama(T.inq1, 'GET', `/api/me/medios-pago?cargo_id=${cargoA1}`)).body, []);
    const m = await nuevo({ estructura_id: e1.id });
    assert.deepEqual((await llama(T.inq1, 'GET', `/api/me/medios-pago?cargo_id=${cargoA1}`)).body.map((x: { id: number }) => x.id), [m.id]);
  });

  it('cargo ajeno 404, sin cargo_id 422, y sólo residentes', async () => {
    await nuevo({});
    assert.equal((await llama(T.prop2, 'GET', `/api/me/medios-pago?cargo_id=${cargoA1}`)).status, 404); // cargo de otra unidad
    assert.equal((await llama(T.prop1, 'GET', `/api/me/medios-pago?cargo_id=${d.cargoB1.id}`)).status, 404); // de otra empresa
    assert.equal((await llama(T.prop1, 'GET', '/api/me/medios-pago')).status, 422);
    assert.equal((await llama(T.prop1, 'GET', '/api/me/medios-pago?cargo_id=abc')).status, 422);
    assert.equal((await llama(null, 'GET', `/api/me/medios-pago?cargo_id=${cargoA1}`)).status, 401);
    for (const quien of ['mttoA', 'segA', 'adminA'] as const) assert.equal((await llama(T[quien], 'GET', `/api/me/medios-pago?cargo_id=${cargoA1}`)).status, 403, quien);
  });
});

describe('junta: pagos por validar de su ámbito', () => {
  const DIA = 86_400_000;
  let n = 0;
  /** Cargo nuevo en una unidad (nueva o dada) y el pago por validar que registra su dueño. */
  async function pagoPorValidar(propietarioToken: string, unidadId: number): Promise<{ pagoId: number; cargoId: number }> {
    n += 1;
    const hoy = hoyLima().getTime();
    const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, mes: 1 + (n % 12), anio: 2025, fecha_emision: new Date(hoy - 60 * DIA), fecha_vencimiento: new Date(hoy - 30 * DIA), estado: 'emitido' } });
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: d.conceptoA.id, monto: 100, orden: 1 } });
    const cargo = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidadId, monto: 100, estado_pago: 'pendiente' } });
    const r = await llama(propietarioToken, 'POST', `/api/me/cargos/${cargo.id}/pagos`, { metodo_pago: 'yape', referencia: 'OP-FALSA' });
    assert.equal(r.status, 201, r.texto);
    return { pagoId: r.body.id, cargoId: cargo.id };
  }
  const ids2 = (r: { body: { items: { id: number }[] } }) => r.body.items.map((p) => p.id);

  it('ve y valida los pagos de su block; no los de otro block ni condominio', async () => {
    const enBlock1 = await pagoPorValidar(T.prop1, d.unidadA1.id);
    const enBlock2 = await pagoPorValidar(T.prop2, d.unidadA2.id);
    const lista = (t: string) => llama(t, 'GET', '/api/pagos?estado_validacion=por_validar');
    assert.deepEqual(ids2(await lista(T.presi1)), [enBlock1.pagoId]);
    assert.deepEqual(ids2(await lista(T.tesor1)), [enBlock1.pagoId]);
    assert.deepEqual(ids2(await lista(T.presi2)), [enBlock2.pagoId]);
    assert.deepEqual(ids2(await lista(T.presiTodo)).sort(), [enBlock1.pagoId, enBlock2.pagoId].sort());
    assert.deepEqual(ids2(await lista(T.presiB)), []);
    assert.equal((await llama(T.presi1, 'GET', `/api/pagos/${enBlock1.pagoId}`)).status, 200);
    assert.equal((await llama(T.presi1, 'GET', `/api/pagos/${enBlock2.pagoId}`)).status, 404);
    assert.equal((await llama(T.presiB, 'GET', `/api/pagos/${enBlock1.pagoId}`)).status, 404);

    // Valida/rechaza sólo dentro del block
    assert.equal((await llama(T.presi1, 'PATCH', `/api/pagos/${enBlock2.pagoId}/validacion`, { estado: 'validado' })).status, 404);
    assert.equal((await llama(T.presiB, 'PATCH', `/api/pagos/${enBlock1.pagoId}/validacion`, { estado: 'validado' })).status, 404);
    const ok = await llama(T.presi1, 'PATCH', `/api/pagos/${enBlock1.pagoId}/validacion`, { estado: 'validado' });
    assert.equal(ok.status, 200, ok.texto);
    assert.equal(ok.body.estado_validacion, 'validado');
    assert.equal((await prisma.reciboConceptoUnidad.findUniqueOrThrow({ where: { id: enBlock1.cargoId } })).estado_pago, 'pagado');
    const rech = await llama(T.tesor1, 'PATCH', `/api/pagos/${(await pagoPorValidar(T.inq1, d.unidadA1.id)).pagoId}/validacion`, { estado: 'rechazado', motivo: 'No coincide el monto' });
    assert.equal(rech.status, 200, rech.texto);
    assert.equal(rech.body.estado_validacion, 'rechazado');
    assert.equal((await llama(T.presiTodo, 'PATCH', `/api/pagos/${enBlock2.pagoId}/validacion`, { estado: 'validado' })).status, 200);
  });

  it('secretario, vocal y propietario sin cargo no ven ni validan pagos ajenos', async () => {
    const p = await pagoPorValidar(T.prop1, d.unidadA1.id);
    for (const quien of ['secre1', 'vocal1', 'prop2'] as const) {
      assert.equal((await llama(T[quien], 'GET', '/api/pagos')).status, 403, quien);
      assert.equal((await llama(T[quien], 'GET', `/api/pagos/${p.pagoId}`)).status, 403, quien);
      assert.equal((await llama(T[quien], 'PATCH', `/api/pagos/${p.pagoId}/validacion`, { estado: 'validado' })).status, 403, quien);
    }
    assert.equal((await prisma.pago.findUniqueOrThrow({ where: { id: p.pagoId } })).estado_validacion, 'por_validar');
  });

  it('la junta no registra pagos manuales ni edita, borra, emite recibos ni administra usuarios', async () => {
    const p = await pagoPorValidar(T.prop1, d.unidadA1.id);
    const cuerpo = { recibo_concepto_unidad_id: d.cargoFuturoA1.id, monto: 10, metodo_pago: 'efectivo' };
    for (const quien of ['presi1', 'tesor1', 'presiTodo'] as const) {
      assert.equal((await llama(T[quien], 'POST', '/api/pagos', cuerpo)).status, 403, quien);
      assert.equal((await llama(T[quien], 'PUT', `/api/pagos/${p.pagoId}`, { metodo_pago: 'efectivo' })).status, 403, quien);
      assert.equal((await llama(T[quien], 'DELETE', `/api/pagos/${p.pagoId}`)).status, 403, quien);
      assert.equal((await llama(T[quien], 'GET', '/api/recibos')).status, 403, quien);
      assert.equal((await llama(T[quien], 'POST', '/api/recibos', {})).status, 403, quien);
      assert.equal((await llama(T[quien], 'GET', '/api/usuarios')).status, 403, quien);
      assert.equal((await llama(T[quien], 'PUT', `/api/usuarios/${ids.secre1}`, { cargo_junta: 'presidente' })).status, 403, quien);
      assert.equal((await llama(T[quien], 'GET', '/api/recibo-concepto-unidades')).status, 403, quien);
    }
    assert.equal(await prisma.pago.count({ where: { id: p.pagoId } }), 1);
  });

  it('no puede validar su propio pago, aunque sea presidente de ese block; la administradora sí', async () => {
    const unidadPropia = await prisma.unidad.findFirstOrThrow({ where: { codigo: 'J-1' } });
    const p = await pagoPorValidar(T.presiPropio, unidadPropia.id);
    const r = await llama(T.presiPropio, 'PATCH', `/api/pagos/${p.pagoId}/validacion`, { estado: 'validado' });
    assert.equal(r.status, 403);
    assert.equal((await llama(T.presi1, 'PATCH', `/api/pagos/${p.pagoId}/validacion`, { estado: 'validado' })).status, 200); // otro miembro de la junta
  });

  it('el comprobante lo ven el admin, la junta del ámbito y los dueños; otra junta, 404', async () => {
    const p = await pagoPorValidar(T.prop1, d.unidadA1.id);
    const subida = await fetch(`${base}/api/pagos/${p.pagoId}/comprobante`, { method: 'POST', headers: { 'content-type': 'image/png', ...cabecerasDeSesion(T.prop1) }, body: new Uint8Array(PNG('voucher')) });
    assert.equal(subida.status, 201);
    const ver = async (t: string) => (await fetch(`${base}/api/pagos/${p.pagoId}/comprobante`, { headers: cabecerasDeSesion(t) })).status;
    assert.equal(await ver(T.presi1), 200);
    assert.equal(await ver(T.tesor1), 200);
    assert.equal(await ver(T.presiTodo), 200);
    assert.equal(await ver(T.adminA), 200);
    assert.equal(await ver(T.presi2), 404);
    assert.equal(await ver(T.presiB), 404);
    assert.equal(await ver(T.secre1), 404); // propietario sin gestión: sólo ve lo suyo
    // la junta no sube comprobantes por otro
    const ajeno = await fetch(`${base}/api/pagos/${p.pagoId}/comprobante`, { method: 'POST', headers: { 'content-type': 'image/png', ...cabecerasDeSesion(T.presi1) }, body: new Uint8Array(PNG('otro')) });
    assert.equal(ajeno.status, 404);
  });
});

describe('cargo en la junta: asignación y sesiones', () => {
  it('la administradora asigna un cargo; el usuario pierde su sesión y /auth/me lo muestra', async () => {
    const tp = await login(base, 'prop2@test.pe');
    assert.equal((await llama(tp, 'GET', '/api/medios-pago')).status, 403);
    const r = await llama(T.adminA, 'PUT', `/api/usuarios/${d.propietario2.id}`, { cargo_junta: 'tesorero', complejo_id: d.complejoA.id, estructura_id: e2.id });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.cargo_junta, 'tesorero');
    assert.equal(r.body.estructura_id, e2.id);
    assert.equal((await llama(tp, 'GET', '/api/auth/me')).status, 401); // sesión revocada
    const t2 = await login(base, 'prop2@test.pe');
    const me = await llama(t2, 'GET', '/api/auth/me');
    assert.equal(me.body.cargo_junta, 'tesorero');
    assert.equal(me.body.estructura_id, e2.id);
    assert.equal(me.body.complejo.id, d.complejoA.id);
    assert.equal((await llama(t2, 'GET', '/api/medios-pago')).status, 200);
    // Quitar el cargo también cierra la sesión y devuelve los permisos
    assert.equal((await llama(T.adminA, 'PUT', `/api/usuarios/${d.propietario2.id}`, { cargo_junta: null })).status, 200);
    assert.equal((await llama(t2, 'GET', '/api/medios-pago')).status, 401);
    const t3 = await login(base, 'prop2@test.pe');
    assert.equal((await llama(t3, 'GET', '/api/medios-pago')).status, 403);
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: d.propietario2.id } })).estructura_id, null); // sin cargo no hay block
  });

  it('un cargo exige propietario y condominio, y el block debe ser de ese condominio y de la empresa', async () => {
    const u = d.propietario2.id;
    assert.equal((await llama(T.adminA, 'PUT', `/api/usuarios/${d.inquilino1.id}`, { cargo_junta: 'presidente' })).status, 422); // inquilino
    assert.equal((await llama(T.adminA, 'PUT', `/api/usuarios/${u}`, { cargo_junta: 'presidente', complejo_id: null })).status, 422); // sin condominio
    assert.equal((await llama(T.adminA, 'PUT', `/api/usuarios/${u}`, { cargo_junta: 'jefe' })).status, 422); // cargo inexistente
    assert.equal((await llama(T.adminA, 'PUT', `/api/usuarios/${u}`, { cargo_junta: 'presidente', complejo_id: d.complejoA.id, estructura_id: eB.id })).status, 422); // block de otro condominio
    assert.equal((await llama(T.adminA, 'PUT', `/api/usuarios/${u}`, { cargo_junta: 'presidente', complejo_id: d.complejoA.id, estructura_id: 999999 })).status, 422);
    assert.equal((await llama(T.adminB, 'PUT', `/api/usuarios/${u}`, { cargo_junta: 'presidente' })).status, 404); // otra empresa
    assert.equal((await llama(T.adminA, 'POST', '/api/usuarios', { nombre: 'Nuevo', email: 'nuevo.inq@test.pe', rol: 'inquilino', password: 'Passw0rd!123', cargo_junta: 'vocal', complejo_id: d.complejoA.id })).status, 422);
    const ok = await llama(T.adminA, 'POST', '/api/usuarios', { nombre: 'Nueva presidenta', email: 'nueva.presi@test.pe', rol: 'propietario', password: 'Passw0rd!123', cargo_junta: 'presidente', complejo_id: d.complejoA.id, estructura_id: e1.id });
    assert.equal(ok.status, 201, ok.texto);
    assert.equal(ok.body.cargo_junta, 'presidente');
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: u } })).cargo_junta, null);
  });

  it('dejar de ser propietario quita el cargo; el usuario no se asigna cargo por su cuenta', async () => {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const x = await prisma.usuario.create({ data: { nombre: 'X', email: 'x.cargo@test.pe', rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, cargo_junta: 'tesorero', estructura_id: e1.id } });
    const r = await llama(T.adminA, 'PUT', `/api/usuarios/${x.id}`, { rol: 'inquilino' });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.cargo_junta, null);
    assert.equal(r.body.estructura_id, null);
    // Un presidente no se sube el cargo ni cambia a otros por /api/me ni /api/usuarios
    await llama(T.presi1, 'PUT', '/api/me', { nombre: 'Presidente 1', telefono: '', cargo_junta: 'presidente', estructura_id: null });
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: ids.presi1 } })).estructura_id, e1.id);
    assert.equal((await llama(T.vocal1, 'PUT', `/api/usuarios/${ids.vocal1}`, { cargo_junta: 'presidente' })).status, 403);
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: ids.vocal1 } })).cargo_junta, 'vocal');
  });
});

describe('medios de pago: auditoría', () => {
  beforeEach(limpiar);

  it('crear, editar, borrar y subir el QR quedan registrados con los últimos 4, nunca el número ni los bytes', async () => {
    const antes = (await prisma.auditoria.aggregate({ _max: { id: true } }))._max.id ?? 0;
    const id = await crear(T.presi1, banco());
    await llama(T.presi1, 'PUT', `/api/medios-pago/${id}`, banco({ titular: 'Otro' }));
    await subirQr(T.presi1, id, PNG('bytes-secretos-del-qr'), 'image/png');
    await llama(T.presi1, 'DELETE', `/api/medios-pago/${id}/qr`);
    await llama(T.presi1, 'DELETE', `/api/medios-pago/${id}`);
    const yapeId = await crear(T.adminA, yape({ complejo_id: d.complejoA.id }));
    const filas = await esperar(async () => {
      const f = await prisma.auditoria.findMany({ where: { entidad: 'medio-pago', id: { gt: antes } }, orderBy: { id: 'asc' } });
      return f.length >= 6 ? f : null;
    });
    assert.deepEqual(filas.map((f) => f.accion), ['crear', 'editar', 'subir_qr', 'quitar_qr', 'eliminar', 'crear']);
    const detalle = JSON.stringify(filas.map((f) => f.detalle));
    assert.doesNotMatch(detalle, new RegExp(NUMERO));
    assert.doesNotMatch(detalle, new RegExp(CCI));
    assert.doesNotMatch(detalle, /987654321/);
    assert.doesNotMatch(detalle, /bytes-secretos|qr_datos/);
    assert.match(detalle, /"ultimos4":"8901"/);
    assert.match(detalle, /"ultimos4":"4321"/);
    assert.equal(filas[0]!.usuario_id, ids.presi1);
    assert.equal(filas[0]!.entidad_id, id);
    assert.equal(filas[5]!.entidad_id, yapeId);
    assert.equal((filas[0]!.detalle as { estructura_id: number }).estructura_id, e1.id);
  });
});
