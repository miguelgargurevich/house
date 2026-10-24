import './helpers/env';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { esperar, iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { hoyLima } from '../src/server/lib/fechas';
import { detectarTipo, dispositionInline, sanearNombre } from '../src/server/services/comprobantes';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'huerfano' | 'prop1' | 'prop2' | 'propB' | 'inq1' | 'mttoA' | 'segA', string>;

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    super: await login(base, 'super@test.pe'),
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    huerfano: await login(base, 'admin.huerfano@test.pe'),
    prop1: await login(base, 'prop1@test.pe'),
    prop2: await login(base, 'prop2@test.pe'),
    propB: await login(base, 'propb@test.pe'),
    inq1: await login(base, 'inq1@test.pe'),
    mttoA: await login(base, 'mtto.a@test.pe'),
    segA: await login(base, 'seg.a@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

// ---------- Archivos de prueba: sólo los bytes mágicos y un relleno reconocible ----------
const PNG = (extra = 'png-de-prueba') => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(extra)]);
const JPG = (extra = 'jpg-de-prueba') => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(extra)]);
const WEBP = (extra = 'webp-de-prueba') => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from(extra)]);
const PDF = (extra = 'pdf-de-prueba') => Buffer.from(`%PDF-1.4\n${extra}\n%%EOF`);

interface Subida { status: number; body: any; headers: Headers } // eslint-disable-line @typescript-eslint/no-explicit-any

/** Sube el cuerpo CRUDO (`llamar` serializa a JSON, no sirve para binarios). */
async function subir(token: string | null, pagoId: number, bytes: Buffer, tipo: string, nombre?: string): Promise<Subida> {
  const r = await fetch(`${base}/api/pagos/${pagoId}/comprobante`, {
    method: 'POST',
    headers: { 'content-type': tipo, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(nombre !== undefined ? { 'x-nombre-archivo': nombre } : {}) },
    body: new Uint8Array(bytes),
  });
  const texto = await r.text();
  let body: unknown = null;
  try { body = JSON.parse(texto); } catch { /* sin JSON */ }
  return { status: r.status, body, headers: r.headers };
}

async function bajar(token: string | null, pagoId: number) {
  const r = await fetch(`${base}/api/pagos/${pagoId}/comprobante`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.status, headers: r.headers, bytes: Buffer.from(await r.arrayBuffer()) };
}

const DIA = 86_400_000;
let contador = 0;

/** Cargo nuevo (vencido por defecto) en una unidad nueva de la empresa A con un recibo propio. */
async function cargoNuevo(propietarioId: number, monto = 100, vencido = true, inquilinoId?: number) {
  contador += 1;
  const unidad = await prisma.unidad.create({ data: { codigo: `T-${contador}`, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, propietario_id: propietarioId, inquilino_id: inquilinoId, estado: 'activa' } });
  const hoy = hoyLima().getTime();
  const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, mes: 1, anio: 2026, fecha_emision: new Date(hoy - 60 * DIA), fecha_vencimiento: new Date(hoy + (vencido ? -30 : 30) * DIA), estado: 'emitido' } });
  const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: d.conceptoA.id, monto, orden: 1 } });
  const cargo = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidad.id, monto, estado_pago: 'pendiente' } });
  return { unidad, recibo, cargo };
}

/** El residente registra el pago de un cargo y devuelve su id. */
async function pagar(token: string, cargoId: number): Promise<number> {
  const r = await llamar(base, 'POST', `/api/me/cargos/${cargoId}/pagos`, token, { metodo_pago: 'yape', referencia: 'OP-FALSA-1' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
}

const estadoCargo = async (id: number) => (await prisma.reciboConceptoUnidad.findUniqueOrThrow({ where: { id } }));
const resumen = async (token = T.adminA) => (await llamar(base, 'GET', '/api/dashboard/resumen', token)).body;
const validar = (token: string, pagoId: number, cuerpo: unknown = { estado: 'validado' }) => llamar(base, 'PATCH', `/api/pagos/${pagoId}/validacion`, token, cuerpo);

describe('pagos del residente: quedan en revisión', () => {
  it('el pago deja el cargo en_revision y por_validar; un pago del admin queda validado y el cargo pagado', async () => {
    const { cargo } = await cargoNuevo(d.propietario1.id);
    const pagoId = await pagar(T.prop1, cargo.id);
    const pago = await prisma.pago.findUniqueOrThrow({ where: { id: pagoId } });
    assert.equal(pago.estado_validacion, 'por_validar');
    assert.equal(pago.validado_at, null);
    const c = await estadoCargo(cargo.id);
    assert.equal(c.estado_pago, 'en_revision');
    assert.equal(c.fecha_pago, null);
    const vista = await llamar(base, 'GET', `/api/me/cargos/${cargo.id}`, T.prop1);
    assert.equal(vista.body.estado, 'en_revision', 'aunque esté vencido, en revisión no es vencido');
    assert.equal(vista.body.pagos[0].estado_validacion, 'por_validar');

    const otro = await cargoNuevo(d.propietario1.id, 50);
    const admin = await llamar(base, 'POST', '/api/pagos', T.adminA, { recibo_concepto_unidad_id: otro.cargo.id, monto: 50, metodo_pago: 'efectivo' });
    assert.equal(admin.status, 201);
    assert.equal(admin.body.estado_validacion, 'validado');
    assert.equal(admin.body.validado_por_id, d.adminA.id);
    assert.equal((await estadoCargo(otro.cargo.id)).estado_pago, 'pagado');
  });

  it('un admin no puede registrar un pago sobre un cargo que ya tiene uno en revisión (409)', async () => {
    const { cargo } = await cargoNuevo(d.propietario1.id, 70);
    await pagar(T.prop1, cargo.id);
    const r = await llamar(base, 'POST', '/api/pagos', T.adminA, { recibo_concepto_unidad_id: cargo.id, monto: 70, metodo_pago: 'efectivo' });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /revisión/);
  });
});

describe('subida del comprobante: tipo, tamaño y bytes mágicos', () => {
  let pagoId: number;
  before(async () => {
    const { cargo } = await cargoNuevo(d.propietario1.id);
    pagoId = await pagar(T.prop1, cargo.id);
  });

  it('acepta JPG, PNG, WebP y PDF y guarda tipo, tamaño y sha256 reales', async () => {
    for (const [bytes, tipo] of [[JPG(), 'image/jpeg'], [PNG(), 'image/png'], [WEBP(), 'image/webp'], [PDF(), 'application/pdf']] as const) {
      const r = await subir(T.prop1, pagoId, bytes, tipo, 'recibo.x');
      assert.equal(r.status, 201, tipo);
      assert.equal(r.body.tipo_mime, tipo);
      assert.equal(r.body.tamano, bytes.length);
      assert.equal(r.body.sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.ok(!('datos' in r.body), 'la respuesta no devuelve el contenido');
    }
  });

  it('un tipo no permitido responde 415 (texto, JSON, SVG, ejecutable)', async () => {
    for (const tipo of ['text/plain', 'image/svg+xml', 'application/octet-stream', 'text/html', 'image/gif']) {
      const r = await subir(T.prop1, pagoId, PNG(), tipo);
      assert.equal(r.status, 415, tipo);
    }
  });

  it('un cuerpo application/json nunca se guarda como archivo: JSON inválido → 400, JSON válido → 415', async () => {
    assert.equal((await subir(T.prop1, pagoId, PNG(), 'application/json')).status, 400);
    assert.equal((await subir(T.prop1, pagoId, Buffer.from('{}'), 'application/json')).status, 415);
  });

  it('bytes que no corresponden al tipo declarado → 422 (no se fía del header)', async () => {
    assert.equal((await subir(T.prop1, pagoId, Buffer.from('<script>alert(1)</script>'), 'image/png')).status, 422, 'HTML disfrazado de PNG');
    assert.equal((await subir(T.prop1, pagoId, JPG(), 'image/png')).status, 422, 'JPG declarado como PNG');
    assert.equal((await subir(T.prop1, pagoId, PNG(), 'application/pdf')).status, 422, 'PNG declarado como PDF');
    assert.equal((await subir(T.prop1, pagoId, Buffer.concat([Buffer.from('RIFF....'), Buffer.from('WAVE')]), 'image/webp')).status, 422, 'RIFF que no es WebP');
    assert.equal((await subir(T.prop1, pagoId, Buffer.alloc(0), 'image/png')).status, 422, 'vacío');
  });

  it('tope de 2 MB: exactamente 2 MB entra y un byte más responde 413', async () => {
    const tope = 2 * 1024 * 1024;
    assert.equal((await subir(T.prop1, pagoId, Buffer.concat([PNG(), Buffer.alloc(tope - PNG().length)]), 'image/png')).status, 201);
    assert.equal((await subir(T.prop1, pagoId, Buffer.concat([PNG(), Buffer.alloc(tope - PNG().length + 1)]), 'image/png')).status, 413);
  });

  it('lo rechazado no deja nada guardado: sigue el último archivo válido', async () => {
    const ok = PNG('el-bueno');
    assert.equal((await subir(T.prop1, pagoId, ok, 'image/png')).status, 201);
    assert.equal((await subir(T.prop1, pagoId, Buffer.from('basura'), 'image/png')).status, 422);
    assert.deepEqual((await bajar(T.adminA, pagoId)).bytes, ok);
  });

  it('el nombre llega saneado: sin rutas ni caracteres peligrosos; sin nombre usa uno por defecto', async () => {
    const r = await subir(T.prop1, pagoId, PNG(), 'image/png', encodeURIComponent('..\\..\\etc/pa"ss<w>d.png'));
    assert.equal(r.body.nombre, 'passwd.png');
    const u = await subir(T.prop1, pagoId, PNG(), 'image/png', encodeURIComponent('Boleta ñandú 😀.png'));
    assert.equal(u.body.nombre, 'Boleta ñandú 😀.png');
    const sin = await subir(T.prop1, pagoId, PDF(), 'application/pdf');
    assert.equal(sin.body.nombre, 'comprobante.pdf');
    const largo = await subir(T.prop1, pagoId, PNG(), 'image/png', 'a'.repeat(300) + '.png');
    assert.equal(largo.body.nombre.length, 100);
    assert.ok(largo.body.nombre.endsWith('.png'));
  });

  it('funciones puras: detectarTipo y sanearNombre', () => {
    assert.equal(detectarTipo(PNG()), 'image/png');
    assert.equal(detectarTipo(Buffer.from('RIFF\0\0\0\0WEBP')), 'image/webp');
    assert.equal(detectarTipo(Buffer.from('MZ\x90\0')), null);
    assert.equal(sanearNombre('%E0%A4%A', 'image/png'), '%E0%A4%A', 'un % mal formado no revienta');
    assert.equal(sanearNombre('...oculto.png‮', 'image/png'), 'oculto.png', 'sin puntos iniciales ni inversión de texto');
    assert.equal(sanearNombre('   ', 'image/webp'), 'comprobante.webp');
    assert.match(dispositionInline('ñ"x.png'), /filename\*=UTF-8''%C3%B1%22x\.png$/);
  });
});

describe('acceso por rol y por empresa', () => {
  let pagoId: number;
  const png = PNG('acceso');
  before(async () => {
    const { cargo } = await cargoNuevo(d.propietario1.id, 100, true, d.inquilino1.id);
    pagoId = await pagar(T.prop1, cargo.id);
    assert.equal((await subir(T.prop1, pagoId, png, 'image/png')).status, 201);
  });

  it('ven el archivo: admin de la empresa, superadmin y los residentes de la unidad', async () => {
    for (const t of [T.adminA, T.super, T.prop1]) {
      const r = await bajar(t, pagoId);
      assert.equal(r.status, 200);
      assert.deepEqual(r.bytes, png);
    }
    // El inquilino de la misma unidad ve el pago en su lista, y por eso también su comprobante.
    assert.equal((await bajar(T.inq1, pagoId)).status, 200);
  });

  it('otra empresa, otra unidad o un pago inexistente: siempre 404 (nunca 403)', async () => {
    for (const t of [T.adminB, T.propB, T.prop2]) {
      assert.equal((await bajar(t, pagoId)).status, 404);
      assert.equal((await subir(t, pagoId, PNG(), 'image/png')).status, 404);
      assert.equal((await validar(t, pagoId)).status, t === T.adminB ? 404 : 403, 'un residente ni siquiera llega a validar');
    }
    assert.equal((await bajar(T.adminA, 999_999)).status, 404);
    assert.equal((await subir(T.adminA, 999_999, PNG(), 'image/png')).status, 404);
    assert.equal((await validar(T.adminA, 999_999)).status, 404);
    assert.equal((await prisma.pago.findUniqueOrThrow({ where: { id: pagoId } })).estado_validacion, 'por_validar', 'nada cambió');
  });

  it('sólo quien registró el pago lo reemplaza: el inquilino de la unidad no (404); sin sesión 401; mantenimiento y seguridad 403', async () => {
    assert.equal((await subir(T.inq1, pagoId, PNG(), 'image/png')).status, 404);
    assert.equal((await subir(null, pagoId, PNG(), 'image/png')).status, 401);
    assert.equal((await bajar(null, pagoId)).status, 401);
    for (const t of [T.mttoA, T.segA]) {
      assert.equal((await bajar(t, pagoId)).status, 403);
      assert.equal((await subir(t, pagoId, PNG(), 'image/png')).status, 403);
    }
  });

  it('un admin sin empresa no opera (403) y un pago sin comprobante responde 404', async () => {
    assert.equal((await bajar(T.huerfano, pagoId)).status, 403);
    const { cargo } = await cargoNuevo(d.propietario1.id);
    const sinArchivo = await pagar(T.prop1, cargo.id);
    assert.equal((await bajar(T.adminA, sinArchivo)).status, 404);
  });

  it('el residente deja de poder cambiar el archivo cuando el pago ya fue revisado (409); el admin sí', async () => {
    const { cargo } = await cargoNuevo(d.propietario1.id);
    const id = await pagar(T.prop1, cargo.id);
    assert.equal((await subir(T.prop1, id, PNG('uno'), 'image/png')).status, 201);
    assert.equal((await validar(T.adminA, id)).status, 200);
    assert.equal((await subir(T.prop1, id, PNG('dos'), 'image/png')).status, 409);
    assert.equal((await subir(T.adminA, id, PNG('dos'), 'image/png')).status, 201);
  });
});

describe('entrega del archivo', () => {
  it('headers seguros: tipo guardado, inline con filename*, nosniff, sandbox y sin caché', async () => {
    const { cargo } = await cargoNuevo(d.propietario1.id);
    const id = await pagar(T.prop1, cargo.id);
    await subir(T.prop1, id, PDF(), 'application/pdf', encodeURIComponent('Recibo de Ñandú.pdf'));
    const r = await bajar(T.adminA, id);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.match(r.headers.get('content-disposition')!, /^inline; filename="[^"]*"; filename\*=UTF-8''Recibo%20de%20%C3%91and%C3%BA\.pdf$/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('content-security-policy'), 'sandbox');
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
    assert.equal(r.headers.get('content-length'), String(PDF().length));
  });

  it('reemplazar borra el anterior: queda una sola fila y se entrega el archivo nuevo', async () => {
    const { cargo } = await cargoNuevo(d.propietario1.id);
    const id = await pagar(T.prop1, cargo.id);
    const primero = await subir(T.prop1, id, PNG('primero'), 'image/png', 'a.png');
    const segundo = await subir(T.prop1, id, JPG('segundo'), 'image/jpeg', 'b.jpg');
    assert.notEqual(primero.body.sha256, segundo.body.sha256);
    assert.equal(await prisma.archivoComprobante.count({ where: { pago_id: id } }), 1);
    const r = await bajar(T.adminA, id);
    assert.equal(r.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(r.bytes, JPG('segundo'));
  });

  it('las listas traen los metadatos del archivo pero nunca sus bytes', async () => {
    const { cargo } = await cargoNuevo(d.propietario1.id);
    const id = await pagar(T.prop1, cargo.id);
    await subir(T.prop1, id, PNG('MARCA-QUE-NO-DEBE-SALIR'), 'image/png', 'm.png');
    for (const [token, ruta] of [[T.adminA, '/api/pagos?pageSize=100'], [T.prop1, '/api/me/pagos?pageSize=100'], [T.prop1, '/api/me/cargos?pageSize=100'], [T.super, '/api/pagos?pageSize=100']] as const) {
      const r = await llamar(base, 'GET', ruta, token);
      assert.equal(r.status, 200, ruta);
      assert.ok(!r.texto.includes('MARCA-QUE-NO-DEBE-SALIR') && !/"datos"/.test(r.texto), `${ruta} filtra el contenido`);
    }
    const lista = await llamar(base, 'GET', '/api/pagos?pageSize=100', T.adminA);
    const fila = lista.body.items.find((p: { id: number }) => p.id === id);
    assert.deepEqual(Object.keys(fila.comprobante).sort(), ['created_at', 'id', 'nombre', 'tamano', 'tipo_mime']);
  });
});

describe('validación del administrador', () => {
  it('validar: el pago queda validado con quién y cuándo, y el cargo pasa a pagado con fecha', async () => {
    const { cargo } = await cargoNuevo(d.propietario1.id, 120);
    const id = await pagar(T.prop1, cargo.id);
    const r = await validar(T.adminA, id);
    assert.equal(r.status, 200);
    assert.equal(r.body.estado_validacion, 'validado');
    assert.equal(r.body.validado_por_id, d.adminA.id);
    assert.ok(r.body.validado_at);
    assert.equal(r.body.motivo_rechazo, null);
    const c = await estadoCargo(cargo.id);
    assert.equal(c.estado_pago, 'pagado');
    assert.ok(c.fecha_pago);
    const vista = await llamar(base, 'GET', `/api/me/cargos/${cargo.id}`, T.prop1);
    assert.equal(vista.body.estado, 'pagado');
  });

  it('rechazar: exige un motivo de 3 a 300 caracteres, vuelve el cargo a pendiente y guarda el motivo', async () => {
    const { cargo } = await cargoNuevo(d.propietario1.id, 120);
    const id = await pagar(T.prop1, cargo.id);
    for (const cuerpo of [{ estado: 'rechazado' }, { estado: 'rechazado', motivo: '  ab ' }, { estado: 'rechazado', motivo: 'x'.repeat(301) }, { estado: 'rechazado', motivo: '   ' }]) {
      assert.equal((await validar(T.adminA, id, cuerpo)).status, 422, JSON.stringify(cuerpo).slice(0, 60));
    }
    assert.equal((await validar(T.adminA, id, { estado: 'aprobado' })).status, 422);
    assert.equal((await validar(T.adminA, id, {})).status, 422);
    assert.equal((await estadoCargo(cargo.id)).estado_pago, 'en_revision', 'las peticiones inválidas no cambian nada');

    const r = await validar(T.adminA, id, { estado: 'rechazado', motivo: 'El monto del voucher no coincide' });
    assert.equal(r.status, 200);
    assert.equal(r.body.estado_validacion, 'rechazado');
    assert.equal(r.body.motivo_rechazo, 'El monto del voucher no coincide');
    const c = await estadoCargo(cargo.id);
    assert.equal(c.estado_pago, 'pendiente');
    assert.equal(c.fecha_pago, null);

    // El residente ve el motivo en el cargo, el cargo vuelve a ser vencido y puede pagar de nuevo.
    const vista = await llamar(base, 'GET', `/api/me/cargos/${cargo.id}`, T.prop1);
    assert.equal(vista.body.estado, 'vencido');
    assert.equal(vista.body.pagos[0].motivo_rechazo, 'El monto del voucher no coincide');
    const nuevo = await pagar(T.prop1, cargo.id);
    assert.notEqual(nuevo, id);
    assert.equal((await estadoCargo(cargo.id)).estado_pago, 'en_revision');
    assert.equal(await prisma.pago.count({ where: { recibo_concepto_unidad_id: cargo.id } }), 2, 'el rechazado queda en el historial');
  });

  it('validar o rechazar dos veces → 409, y dos revisiones simultáneas: sólo una entra', async () => {
    const a = await cargoNuevo(d.propietario1.id);
    const idA = await pagar(T.prop1, a.cargo.id);
    assert.equal((await validar(T.adminA, idA)).status, 200);
    assert.equal((await validar(T.adminA, idA)).status, 409);
    assert.equal((await validar(T.adminA, idA, { estado: 'rechazado', motivo: 'tarde' })).status, 409);
    assert.equal((await estadoCargo(a.cargo.id)).estado_pago, 'pagado', 'el 409 no deshace la validación');

    const b = await cargoNuevo(d.propietario1.id);
    const idB = await pagar(T.prop1, b.cargo.id);
    const rs = await Promise.all([validar(T.adminA, idB), validar(T.adminA, idB, { estado: 'rechazado', motivo: 'duplicado' }), validar(T.super, idB)]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409, 409]);
  });

  it('un pago registrado por el admin ya está validado: no se vuelve a validar (409)', async () => {
    const { cargo } = await cargoNuevo(d.propietario1.id, 40);
    const p = await llamar(base, 'POST', '/api/pagos', T.adminA, { recibo_concepto_unidad_id: cargo.id, monto: 40, metodo_pago: 'efectivo' });
    assert.equal((await validar(T.adminA, p.body.id)).status, 409);
  });

  it('borrar un pago por validar reabre el cargo y se lleva su archivo (cascada)', async () => {
    const { cargo } = await cargoNuevo(d.propietario1.id);
    const id = await pagar(T.prop1, cargo.id);
    await subir(T.prop1, id, PNG(), 'image/png');
    assert.equal((await llamar(base, 'DELETE', `/api/pagos/${id}`, T.adminA)).status, 204);
    assert.equal((await estadoCargo(cargo.id)).estado_pago, 'pendiente');
    assert.equal(await prisma.archivoComprobante.count({ where: { pago_id: id } }), 0);
  });

  it('un pago rechazado no cuenta como abono: un pago parcial del admin no deja el cargo pagado', async () => {
    const { cargo } = await cargoNuevo(d.propietario1.id, 100);
    const id = await pagar(T.prop1, cargo.id);
    assert.equal((await validar(T.adminA, id, { estado: 'rechazado', motivo: 'Voucher de otra persona' })).status, 200);
    const parcial = await llamar(base, 'POST', '/api/pagos', T.adminA, { recibo_concepto_unidad_id: cargo.id, monto: 30, metodo_pago: 'efectivo' });
    assert.equal(parcial.status, 201, 'el saldo sigue siendo 100: el rechazado no lo reduce');
    assert.equal((await estadoCargo(cargo.id)).estado_pago, 'pendiente');
    assert.equal((await llamar(base, 'DELETE', `/api/pagos/${parcial.body.id}`, T.adminA)).status, 204);
    assert.equal((await estadoCargo(cargo.id)).estado_pago, 'pendiente');
  });

  it('GET /api/pagos?estado_validacion= filtra y valida el valor', async () => {
    const { cargo } = await cargoNuevo(d.propietario1.id);
    const id = await pagar(T.prop1, cargo.id);
    const ids = async (estado: string) => (await llamar(base, 'GET', `/api/pagos?pageSize=100&estado_validacion=${estado}`, T.adminA)).body.items.map((p: { id: number }) => p.id);
    assert.ok((await ids('por_validar')).includes(id));
    assert.ok(!(await ids('validado')).includes(id));
    await validar(T.adminA, id, { estado: 'rechazado', motivo: 'Ilegible' });
    assert.ok((await ids('rechazado')).includes(id));
    assert.ok(!(await ids('por_validar')).includes(id));
    assert.equal((await llamar(base, 'GET', '/api/pagos?estado_validacion=raro', T.adminA)).status, 422);
    const ajeno = (await llamar(base, 'GET', '/api/pagos?pageSize=100', T.adminB)).body.items.map((p: { id: number }) => p.id);
    assert.ok(!ajeno.includes(id), 'otra empresa no lo ve');
  });
});

describe('totales con cargos en revisión', () => {
  it('en revisión: sigue «por cobrar», no es moroso, no suma a cobrado; validar cobra; rechazar devuelve la mora', async () => {
    const propia = await cargoNuevo(d.propietario2.id, 80);
    const { cargo, unidad, recibo } = propia;
    const moroso = async () => (await llamar(base, 'GET', '/api/reportes/morosidad?pageSize=100', T.adminA)).body.items.some((f: { unidad: { id: number } }) => f.unidad.id === unidad.id);
    const cobranza = async () => (await llamar(base, 'GET', `/api/recibos/${recibo.id}`, T.adminA)).body;
    const num = (v: string) => Number(v);

    // Vencido y sin pagar.
    const a = await resumen();
    assert.equal(await moroso(), true);
    assert.equal((await cobranza()).estado_cobranza, 'vencido');

    // Pagó: en revisión.
    const pagoId = await pagar(T.prop2, cargo.id);
    const b = await resumen();
    assert.equal(num(b.cargos_pendientes_monto), num(a.cargos_pendientes_monto), 'sigue contando en por cobrar');
    assert.equal(num(b.cobrado_mes), num(a.cobrado_mes), 'no suma a cobrado');
    assert.equal(b.morosos, a.morosos - 1, 'no es moroso mientras se valida');
    assert.equal(b.estados.vencido, a.estados.vencido - 1);
    assert.equal(b.estados.en_revision, a.estados.en_revision + 1);
    assert.equal(b.pagos_por_validar, a.pagos_por_validar + 1);
    assert.equal(num(b.cobrado_por_mes[5].cobrado), num(a.cobrado_por_mes[5].cobrado));
    assert.equal(await moroso(), false);
    const c1 = await cobranza();
    assert.equal(c1.estado_cobranza, 'pendiente', 'todo lo que falta está en revisión: el recibo no es vencido');
    assert.deepEqual(c1.totales, { monto: '80.00', cobrado: '0.00', pendiente: '80.00', en_revision: '80.00' });
    assert.equal(c1.cargos[0].estado, 'en_revision');
    const filtro = await llamar(base, 'GET', '/api/recibo-concepto-unidades?estado=en_revision&pageSize=100', T.adminA);
    assert.ok(filtro.body.items.some((x: { id: number }) => x.id === cargo.id) && filtro.body.items.every((x: { estado: string }) => x.estado === 'en_revision'));
    const venc = await llamar(base, 'GET', '/api/recibo-concepto-unidades?estado=vencido&pageSize=100', T.adminA);
    assert.ok(!venc.body.items.some((x: { id: number }) => x.id === cargo.id));
    const propio = await resumen(T.prop2);
    assert.equal(propio.pagado_ano, '0.00', 'el residente tampoco ve pagado lo que está en revisión');

    // Rechazado: vuelve la mora.
    await validar(T.adminA, pagoId, { estado: 'rechazado', motivo: 'No se ve el número de operación' });
    const c = await resumen();
    assert.equal(c.morosos, a.morosos);
    assert.equal(c.estados.vencido, a.estados.vencido);
    assert.equal(c.estados.en_revision, a.estados.en_revision);
    assert.equal(num(c.cobrado_mes), num(a.cobrado_mes), 'un pago rechazado nunca fue cobrado');
    assert.equal(await moroso(), true);
    assert.equal((await cobranza()).estado_cobranza, 'vencido');

    // Paga de nuevo y el admin valida: ahora sí cobrado.
    const pagoDos = await pagar(T.prop2, cargo.id);
    await validar(T.adminA, pagoDos);
    const e = await resumen();
    assert.equal(num(e.cargos_pendientes_monto), num(a.cargos_pendientes_monto) - 80);
    assert.equal(num(e.cobrado_mes), num(a.cobrado_mes) + 80);
    assert.equal(num(e.cobrado_por_mes[5].cobrado), num(a.cobrado_por_mes[5].cobrado) + 80);
    assert.equal(e.estados.pagado, a.estados.pagado + 1);
    assert.equal(e.morosos, a.morosos - 1);
    assert.equal(e.pagos_por_validar, a.pagos_por_validar);
    assert.equal(await moroso(), false);
    const fin = await cobranza();
    assert.equal(fin.estado_cobranza, 'pagado');
    assert.deepEqual(fin.totales, { monto: '80.00', cobrado: '80.00', pendiente: '0.00', en_revision: '0.00' });
    assert.equal((await resumen(T.prop2)).pagado_ano, '80.00', 'ahora sí cuenta como pagado');
  });

  it('el aislamiento sigue: el resumen de la empresa B no ve los pagos por validar de la A', async () => {
    const { cargo } = await cargoNuevo(d.propietario1.id);
    const antes = await resumen(T.adminB);
    await pagar(T.prop1, cargo.id);
    const despues = await resumen(T.adminB);
    assert.equal(despues.pagos_por_validar, antes.pagos_por_validar);
    assert.deepEqual(despues.estados, antes.estados);
  });
});

describe('auditoría de comprobantes', () => {
  it('registra subir, ver, validar y rechazar con quién y qué pago, y NUNCA el contenido', async () => {
    const marca = 'CONTENIDO-SECRETO-DEL-VOUCHER';
    const { cargo } = await cargoNuevo(d.propietario1.id);
    const id = await pagar(T.prop1, cargo.id);
    const bytes = PDF(marca);
    assert.equal((await subir(T.prop1, id, bytes, 'application/pdf', 'voucher.pdf')).status, 201);
    assert.equal((await bajar(T.adminA, id)).status, 200);
    assert.equal((await validar(T.adminA, id, { estado: 'rechazado', motivo: 'Falta la fecha' })).status, 200);
    const otro = await cargoNuevo(d.propietario1.id);
    const idOtro = await pagar(T.prop1, otro.cargo.id);
    assert.equal((await validar(T.adminA, idOtro)).status, 200);

    const fila = (accion: string, entidadId: number) => esperar(() => prisma.auditoria.findFirst({ where: { entidad: 'pago', accion, entidad_id: entidadId } }));
    const subida = await fila('subir_comprobante', id);
    assert.equal(subida.usuario_id, d.propietario1.id);
    assert.deepEqual(subida.detalle, { nombre: 'voucher.pdf', tipo_mime: 'application/pdf', tamano: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    const vista = await fila('ver_comprobante', id);
    assert.equal(vista.usuario_id, d.adminA.id);
    const rechazo = await fila('rechazar', id);
    assert.deepEqual(rechazo.detalle, { estado: 'rechazado', motivo: 'Falta la fecha' });
    assert.equal(rechazo.usuario_id, d.adminA.id);
    assert.deepEqual((await fila('validar', idOtro)).detalle, { estado: 'validado' });

    const todas = await prisma.auditoria.findMany({ where: { entidad: 'pago', entidad_id: id } });
    const serializado = JSON.stringify(todas);
    assert.ok(!serializado.includes(marca) && !serializado.includes(bytes.toString('base64')), 'el contenido no va a la auditoría');
    assert.ok(serializado.length < 3000, 'ninguna fila guarda el cuerpo crudo');
  });

  it('las subidas rechazadas (415/422) y las lecturas ajenas (404) no dejan rastro de éxito', async () => {
    const { cargo } = await cargoNuevo(d.propietario1.id);
    const id = await pagar(T.prop1, cargo.id);
    await subir(T.prop1, id, Buffer.from('no soy png'), 'image/png');
    await bajar(T.adminB, id);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(await prisma.auditoria.count({ where: { entidad: 'pago', entidad_id: id, accion: { in: ['subir_comprobante', 'ver_comprobante'] } } }), 0);
  });
});
