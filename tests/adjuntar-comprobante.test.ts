// El administrador adjunta el voucher desde el detalle de un pago YA registrado (validado o por validar). La IA siempre falsa:
// su `fetch` falla a propósito, así que nunca hay red y la evaluación queda «error»: no valida nada sola.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { cabecerasDeSesion, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { pagoSinVoucher } from './helpers/pagoResidente';
import { hoyLima } from '../src/server/lib/fechas';
import { esperarEvaluaciones } from '../src/server/services/evaluacion';
import { llaveroDeps } from '../src/server/services/llavero';

const DIA = 86_400_000;
let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'adminA' | 'adminB' | 'presiA' | 'prop1' | 'propB', string>;
let bloqueV2: { id: number };
let bloqueV1: { id: number };
let contador = 0;

const fetchOriginal = llaveroDeps.fetch;

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, ai: 100_000, llavero: 100_000, evaluacion: 100_000 } }));
  llaveroDeps.fetch = async () => { throw new Error('red prohibida en pruebas'); };
  // Una presidenta de la junta de un block: sólo ve los pagos de SU block.
  const hash = await bcrypt.hash(PASSWORD, 4);
  bloqueV1 = await prisma.estructura.create({ data: { nombre: 'Block AJ1', tipo: 'block', complejo_id: d.complejoA.id } });
  bloqueV2 = await prisma.estructura.create({ data: { nombre: 'Block AJ2', tipo: 'block', complejo_id: d.complejoA.id } });
  await prisma.usuario.create({ data: { nombre: 'Presi AJ1', email: 'presi.aj1@test.pe', rol: 'propietario', password_hash: hash, complejo_id: d.complejoA.id, estructura_id: bloqueV1.id, cargo_junta: 'presidente' } });
  T = {
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    presiA: await login(base, 'presi.aj1@test.pe'),
    prop1: await login(base, 'prop1@test.pe'),
    propB: await login(base, 'propb@test.pe'),
  };
});
after(async () => {
  llaveroDeps.fetch = fetchOriginal;
  await esperarEvaluaciones();
  await cerrar();
  await prisma.$disconnect();
});

// ---------- Archivos de prueba: sólo los bytes mágicos y un relleno reconocible ----------
const PNG = (extra = 'captura-de-prueba') => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(extra)]);
const PDF = () => Buffer.from(`%PDF-1.4\npdf-de-prueba-${++contador}\n%%EOF`);

interface Subida { status: number; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** Sube el cuerpo CRUDO, como lo hace la pantalla (`llamar` serializa a JSON, no sirve para binarios). */
async function subir(token: string | null, pagoId: number, bytes: Buffer, tipo: string, nombre = 'voucher.png'): Promise<Subida> {
  const r = await fetch(`${base}/api/pagos/${pagoId}/comprobante`, {
    method: 'POST',
    headers: { 'content-type': tipo, 'x-nombre-archivo': encodeURIComponent(nombre), ...cabecerasDeSesion(token) },
    body: new Uint8Array(bytes),
  });
  const texto = await r.text();
  let body: unknown = null;
  try { body = JSON.parse(texto); } catch { /* sin JSON */ }
  return { status: r.status, body };
}

// ---------- Datos: un cargo nuevo en una unidad (con su recibo) ----------
async function unidadNueva(propietarioId: number, estructuraId?: number) {
  contador += 1;
  return prisma.unidad.create({ data: { codigo: `AJ-${contador}`, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, propietario_id: propietarioId, estructura_id: estructuraId, estado: 'activa' } });
}

async function cargoDe(unidadId: number, monto = 100) {
  const hoy = hoyLima().getTime();
  const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, mes: 4, anio: 2026, fecha_emision: new Date(hoy - 5 * DIA), fecha_vencimiento: new Date(hoy + 20 * DIA), estado: 'emitido' } });
  const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: d.conceptoA.id, monto, orden: 1 } });
  return prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidadId, monto, estado_pago: 'pendiente' } });
}

/** El administrador registra el pago: nace VALIDADO (sin comprobante todavía). */
async function pagoDelAdmin(cargoId: number, monto: number): Promise<number> {
  const r = await llamar(base, 'POST', '/api/pagos', T.adminA, { recibo_concepto_unidad_id: cargoId, monto, metodo_pago: 'efectivo' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.estado_validacion, 'validado');
  return r.body.id;
}

/** El residente registra el pago de su cargo: nace POR VALIDAR. */
async function pagoDelResidente(cargoId: number): Promise<number> {
  const r = await pagoSinVoucher(base, T.prop1, cargoId, { metodo_pago: 'yape', referencia: `OP-AJ-${++contador}` });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
}

const estadoDel = async (pagoId: number) => (await prisma.pago.findUniqueOrThrow({ where: { id: pagoId } })).estado_validacion;
const archivosDel = (pagoId: number) => prisma.archivoComprobante.count({ where: { pago_id: pagoId } });

describe('el administrador adjunta el voucher a un pago ya registrado', () => {
  it('a un pago VALIDADO: 201, el pago sigue validado y la IA deja su evaluación', async () => {
    const pagoId = await pagoDelAdmin((await cargoDe((await unidadNueva(d.propietario1.id)).id)).id, 100);
    assert.equal(await archivosDel(pagoId), 0, 'sin comprobante antes');

    const r = await subir(T.adminA, pagoId, PNG(), 'image/png');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.tipo_mime, 'image/png');
    assert.ok(!('datos' in r.body), 'la respuesta no devuelve el contenido');

    assert.equal(await archivosDel(pagoId), 1);
    assert.equal(await estadoDel(pagoId), 'validado', 'adjuntar no cambia el estado de un pago ya validado');
    await esperarEvaluaciones();
    const ev = await prisma.evaluacionComprobante.findUnique({ where: { pago_id: pagoId } });
    assert.ok(ev, 'la IA creó la evaluación del voucher');
    assert.equal((await prisma.pago.findUniqueOrThrow({ where: { id: pagoId } })).validado_por_ia, false, 'la IA no lo marca como validado por ella');
  });

  it('a un pago POR VALIDAR del residente: 201, la IA lo evalúa y, si no puede validarlo, queda por validar', async () => {
    const pagoId = await pagoDelResidente((await cargoDe((await unidadNueva(d.propietario1.id)).id)).id);
    const r = await subir(T.adminA, pagoId, PDF(), 'application/pdf', 'voucher.pdf');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    await esperarEvaluaciones();
    assert.ok(await prisma.evaluacionComprobante.findUnique({ where: { pago_id: pagoId } }));
    assert.equal(await estadoDel(pagoId), 'por_validar', 'la IA falló: no valida sola');
  });

  it('un tipo no permitido responde 415 y no guarda nada', async () => {
    const pagoId = await pagoDelAdmin((await cargoDe((await unidadNueva(d.propietario1.id)).id)).id, 60);
    const r = await subir(T.adminA, pagoId, Buffer.from('<svg></svg>'), 'image/svg+xml');
    assert.equal(r.status, 415);
    assert.equal(await archivosDel(pagoId), 0);
  });

  it('admin de OTRA empresa, residente ajeno y junta de otro block: 404 y no guardan nada', async () => {
    const pagoId = await pagoDelAdmin((await cargoDe((await unidadNueva(d.propietario1.id)).id)).id, 80);
    const pagoV2 = await pagoDelAdmin((await cargoDe((await unidadNueva(d.propietario2.id, bloqueV2.id)).id)).id, 80);

    assert.equal((await subir(T.adminB, pagoId, PNG(), 'image/png')).status, 404, 'otra empresa');
    assert.equal((await subir(T.propB, pagoId, PNG(), 'image/png')).status, 404, 'residente de otro condominio');
    // El residente de la unidad NO puede adjuntar al pago que registró el administrador: sólo al suyo.
    assert.equal((await subir(T.prop1, pagoId, PNG(), 'image/png')).status, 404, 'residente sobre pago registrado por la administración');
    assert.equal((await subir(T.presiA, pagoV2, PNG(), 'image/png')).status, 404, 'junta de otro block');
    assert.equal(await archivosDel(pagoId), 0);
    assert.equal(await archivosDel(pagoV2), 0);
  });

  it('el residente sigue adjuntando a SU pago por validar (sin cambios)', async () => {
    const pagoId = await pagoDelResidente((await cargoDe((await unidadNueva(d.propietario1.id)).id)).id);
    const r = await subir(T.prop1, pagoId, PNG(), 'image/png');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    await esperarEvaluaciones();
  });
});
