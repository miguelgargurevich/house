// El voucher es obligatorio para que un pago de residente llegue a «validado»: quien valida (la administradora, el presidente o el tesorero de la junta)
// lo comprueba contra el archivo. Sin voucher: validar → 409 (rechazar sí se puede); el pago suelto del residente exige el voucher igual que el del
// mantenimiento; lo que registra la administración sin voucher (efectivo) sigue naciendo validado. IA sin claves: nunca hay red.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { cabecerasDeSesion, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { pagarCargo, pagarComoResidente, pagoSinVoucher, pngUnico, voucherPng } from './helpers/pagoResidente';
import { esperarEvaluaciones } from '../src/server/services/evaluacion';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'adminA' | 'adminB' | 'prop1' | 'prop2' | 'presi' | 'tesor' | 'secre', string>;

before(async () => {
  d = await sembrar();
  const hash = await bcrypt.hash(PASSWORD, 4);
  const junta = (nombre: string, email: string, cargo: string) =>
    prisma.usuario.create({ data: { nombre, email, rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, cargo_junta: cargo } });
  await junta('Presidenta', 'presi.vo@test.pe', 'presidente');
  await junta('Tesorero', 'tesor.vo@test.pe', 'tesorero');
  await junta('Secretaria', 'secre.vo@test.pe', 'secretario');
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, evaluacion: 100_000 } }));
  T = {
    adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'), prop1: await login(base, 'prop1@test.pe'), prop2: await login(base, 'prop2@test.pe'),
    presi: await login(base, 'presi.vo@test.pe'), tesor: await login(base, 'tesor.vo@test.pe'), secre: await login(base, 'secre.vo@test.pe'),
  };
});
after(async () => {
  await esperarEvaluaciones();
  await cerrar();
  await prisma.$disconnect();
});
afterEach(async () => { await esperarEvaluaciones(); });

const DIA = 86_400_000;
let n = 0;
/** Un cargo nuevo (monto 100, pendiente) en una unidad propia de A-101 (prop1) o A-102 (prop2): cada prueba tiene el suyo. */
async function cargoNuevo(unidad: { id: number } = d.unidadA1) {
  n += 1;
  const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, mes: 1 + (n % 12), anio: 2000 + n, fecha_emision: new Date(Date.now() - 60 * DIA), fecha_vencimiento: new Date(Date.now() + 30 * DIA), estado: 'emitido' } });
  const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: d.conceptoA.id, monto: 100, orden: 1 } });
  return prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidad.id, monto: 100, estado_pago: 'pendiente' } });
}
const pagoDb = (id: number) => prisma.pago.findUniqueOrThrow({ where: { id } });
const cargoDb = (id: number) => prisma.reciboConceptoUnidad.findUniqueOrThrow({ where: { id } });
const archivos = (pagoId: number) => prisma.archivoComprobante.count({ where: { pago_id: pagoId } });
const validar = (token: string, id: number, cuerpo: unknown = { estado: 'validado' }) => llamar(base, 'PATCH', `/api/pagos/${id}/validacion`, token, cuerpo);
const filasDe = (id: number, accion: string) => prisma.auditoria.count({ where: { entidad: 'pago', entidad_id: id, accion } });

/** Quienes validan: la administradora de la empresa y las dos personas de la junta que gestionan pagos. */
const VALIDADORES = ['adminA', 'presi', 'tesor'] as const;

describe('validar un pago sin voucher → 409', () => {
  for (const quien of VALIDADORES) {
    it(`${quien}: el pago queda por validar, el cargo en revisión y nada se audita como validado`, async () => {
      const cargo = await cargoNuevo();
      const pago = await pagoSinVoucher(base, T.prop1, cargo.id);
      const r = await validar(T[quien], pago.body.id);
      assert.equal(r.status, 409, r.texto);
      assert.match(r.body.error, /no tiene voucher/);
      assert.match(r.body.error, /recházalo/);
      assert.equal((await pagoDb(pago.body.id)).estado_validacion, 'por_validar');
      assert.equal((await pagoDb(pago.body.id)).validado_por_id, null);
      assert.equal((await cargoDb(cargo.id)).estado_pago, 'en_revision');
      assert.equal(await filasDe(pago.body.id, 'validar'), 0);
    });
  }

  it('el secretario de la junta sigue sin poder validar (403), con o sin voucher', async () => {
    const pago = await pagoSinVoucher(base, T.prop1, (await cargoNuevo()).id);
    assert.equal((await validar(T.secre, pago.body.id)).status, 403);
    assert.equal((await pagoDb(pago.body.id)).estado_validacion, 'por_validar');
  });

  it('un pago ya revisado dice «ya fue revisado», no «sin voucher» (el 409 de siempre)', async () => {
    const cargo = await cargoNuevo();
    const pago = await pagoSinVoucher(base, T.prop1, cargo.id);
    assert.equal((await validar(T.adminA, pago.body.id, { estado: 'rechazado', motivo: 'No hay voucher' })).status, 200);
    const otra = await validar(T.adminA, pago.body.id);
    assert.equal(otra.status, 409);
    assert.match(otra.body.error, /ya fue revisado/);
  });
});

describe('rechazar un pago sin voucher sí se puede', () => {
  for (const quien of VALIDADORES) {
    it(`${quien}: 200, motivo guardado y el cargo vuelve a pendiente`, async () => {
      const cargo = await cargoNuevo();
      const pago = await pagoSinVoucher(base, T.prop1, cargo.id);
      const r = await validar(T[quien], pago.body.id, { estado: 'rechazado', motivo: 'No subiste tu voucher' });
      assert.equal(r.status, 200, r.texto);
      const p = await pagoDb(pago.body.id);
      assert.equal(p.estado_validacion, 'rechazado');
      assert.equal(p.motivo_rechazo, 'No subiste tu voucher');
      assert.equal((await cargoDb(cargo.id)).estado_pago, 'pendiente');
    });
  }
});

describe('validar un pago con voucher sigue funcionando', () => {
  for (const quien of VALIDADORES) {
    it(`${quien}: el pago del vecino (pago suelto con su voucher) queda validado y el cargo pagado`, async () => {
      const cargo = await cargoNuevo();
      const pago = await pagarCargo(base, T.prop1, cargo.id);
      assert.equal(pago.status, 201, pago.texto);
      const r = await validar(T[quien], pago.body.id);
      assert.equal(r.status, 200, r.texto);
      assert.equal(r.body.estado_validacion, 'validado');
      assert.equal((await cargoDb(cargo.id)).estado_pago, 'pagado');
      assert.equal(await filasDe(pago.body.id, 'validar'), 1);
    });
  }

  it('el mantenimiento completo (pagos en grupo): se valida con el voucher del pago principal', async () => {
    const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, mes: 3, anio: 1999, fecha_emision: new Date(Date.now() - 60 * DIA), fecha_vencimiento: new Date(Date.now() + 30 * DIA), estado: 'emitido' } });
    for (const [i, monto] of [40, 60].entries()) {
      const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: d.conceptoA.id, monto, orden: i + 1 } });
      await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: d.unidadA2.id, monto, estado_pago: 'pendiente' } });
    }
    const r = await pagarComoResidente(base, T.prop2, recibo.id, d.unidadA2.id);
    assert.equal(r.status, 201, r.texto);
    const grupo = await prisma.pago.findMany({ where: { reciboConceptoUnidad: { unidad_id: d.unidadA2.id, reciboConcepto: { recibo_id: recibo.id } } } });
    assert.equal(grupo.length, 2);
    const v = await validar(T.adminA, grupo.find((p) => !p.grupo_principal)!.id); // por el pago NO principal: manda el voucher del grupo
    assert.equal(v.status, 200, v.texto);
    assert.ok((await prisma.pago.findMany({ where: { grupo: grupo[0]!.grupo } })).every((p) => p.estado_validacion === 'validado'));
  });

  it('la administradora adjunta el voucher que faltaba y entonces sí valida', async () => {
    const cargo = await cargoNuevo();
    const pago = await pagoSinVoucher(base, T.prop1, cargo.id);
    assert.equal((await validar(T.adminA, pago.body.id)).status, 409);
    const sub = await fetch(`${base}/api/pagos/${pago.body.id}/comprobante`, { method: 'POST', headers: { 'content-type': 'image/png', ...cabecerasDeSesion(T.adminA) }, body: new Uint8Array(pngUnico()) });
    assert.equal(sub.status, 201);
    assert.equal(await archivos(pago.body.id), 1);
    assert.equal((await validar(T.adminA, pago.body.id)).status, 200);
    assert.equal((await cargoDb(cargo.id)).estado_pago, 'pagado');
  });
});

describe('lo que registra la administración sin voucher (efectivo) sigue naciendo validado', () => {
  it('POST /api/pagos: 201 validado, cargo pagado, sin comprobante', async () => {
    const cargo = await cargoNuevo();
    const r = await llamar(base, 'POST', '/api/pagos', T.adminA, { recibo_concepto_unidad_id: cargo.id, monto: 100, metodo_pago: 'efectivo' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.estado_validacion, 'validado');
    assert.equal(await archivos(r.body.id), 0);
    assert.equal((await cargoDb(cargo.id)).estado_pago, 'pagado');
  });
});

describe('el pago suelto del residente (POST /api/me/cargos/:id/pagos) exige voucher', () => {
  /** Sin pago, sin archivo y el cargo como estaba. */
  async function sinRastro(cargoId: number) {
    assert.equal(await prisma.pago.count({ where: { recibo_concepto_unidad_id: cargoId } }), 0, 'ningún pago');
    assert.equal((await cargoDb(cargoId)).estado_pago, 'pendiente');
    assert.equal(await prisma.archivoComprobante.count({ where: { pago: { recibo_concepto_unidad_id: cargoId } } }), 0, 'ningún archivo');
  }

  it('multipart SIN archivo → 422 (campo voucher) y no se crea nada', async () => {
    const cargo = await cargoNuevo();
    const r = await pagarCargo(base, T.prop1, cargo.id, { metodo_pago: 'yape', referencia: 'OP-1' }, null);
    assert.equal(r.status, 422, r.texto);
    assert.equal(r.body.campos.voucher, 'Obligatorio');
    await sinRastro(cargo.id);
  });

  it('JSON (como antes, sin archivo) → 422 y no se crea nada', async () => {
    const cargo = await cargoNuevo();
    const r = await llamar(base, 'POST', `/api/me/cargos/${cargo.id}/pagos`, T.prop1, { metodo_pago: 'yape', referencia: 'OP-2' });
    assert.equal(r.status, 422, r.texto);
    await sinRastro(cargo.id);
  });

  it('un archivo que no sirve: contenido que no es del tipo declarado → 422; tipo no permitido → 415; y no se crea nada', async () => {
    const cargo = await cargoNuevo();
    const falso = await pagarCargo(base, T.prop1, cargo.id, { metodo_pago: 'yape' }, voucherPng({ bytes: Buffer.from('esto no es un png') }));
    assert.equal(falso.status, 422, falso.texto);
    const texto = await pagarCargo(base, T.prop1, cargo.id, { metodo_pago: 'yape' }, { bytes: Buffer.from('hola'), tipo: 'text/plain', nombre: 'voucher.txt' });
    assert.equal(texto.status, 415, texto.texto);
    await sinRastro(cargo.id);
  });

  it('con voucher → 201: pago por validar + comprobante en la MISMA transacción, subido por el residente, cargo en revisión', async () => {
    const cargo = await cargoNuevo();
    const r = await pagarCargo(base, T.prop1, cargo.id, { metodo_pago: 'transferencia', referencia: 'OP-3' }, voucherPng({ nombre: 'Operación ñandú.png' }));
    assert.equal(r.status, 201, r.texto);
    const p = await pagoDb(r.body.id);
    assert.equal(p.estado_validacion, 'por_validar');
    assert.equal(p.metodo_pago, 'transferencia');
    assert.equal(p.usuario_id, d.propietario1.id);
    const a = await prisma.archivoComprobante.findUniqueOrThrow({ where: { pago_id: p.id } });
    assert.equal(a.subido_por_id, d.propietario1.id);
    assert.equal(a.nombre, 'Operación ñandú.png');
    assert.equal((await cargoDb(cargo.id)).estado_pago, 'en_revision');
    // Mismo registro que al subir un comprobante: metadatos, nunca el contenido.
    const fila = await prisma.auditoria.findFirstOrThrow({ where: { entidad: 'pago', entidad_id: p.id, accion: 'subir_comprobante' } });
    assert.equal((fila.detalle as { sha256: string }).sha256, a.sha256);
    assert.ok(!JSON.stringify(fila.detalle).includes(Buffer.from(a.datos).toString('base64')));
  });

  it('campos inválidos con voucher (método inexistente) → 422 y no se crea nada', async () => {
    const cargo = await cargoNuevo();
    const r = await pagarCargo(base, T.prop1, cargo.id, { metodo_pago: 'bitcoin' });
    assert.equal(r.status, 422, r.texto);
    await sinRastro(cargo.id);
  });

  it('un cargo ajeno → 404 (con o sin archivo) y la unidad de otro vecino queda intacta', async () => {
    const ajeno = await cargoNuevo(d.unidadA2);
    assert.equal((await pagarCargo(base, T.prop1, ajeno.id)).status, 404);
    assert.equal((await pagarCargo(base, T.prop1, ajeno.id, { metodo_pago: 'yape' }, null)).status, 404);
    assert.equal((await pagarCargo(base, T.adminB, ajeno.id)).status, 403, 'la administración no paga como vecino');
    await sinRastro(ajeno.id);
  });

  it('un segundo pago del mismo cargo en revisión → 409 y no deja un segundo archivo', async () => {
    const cargo = await cargoNuevo();
    assert.equal((await pagarCargo(base, T.prop1, cargo.id)).status, 201);
    const otra = await pagarCargo(base, T.prop1, cargo.id);
    assert.equal(otra.status, 409, otra.texto);
    assert.equal(await prisma.pago.count({ where: { recibo_concepto_unidad_id: cargo.id } }), 1);
    assert.equal(await prisma.archivoComprobante.count({ where: { pago: { recibo_concepto_unidad_id: cargo.id } } }), 1);
  });

  it('sin sesión → 401', async () => {
    const cargo = await cargoNuevo();
    assert.equal((await pagarCargo(base, null, cargo.id)).status, 401);
    await sinRastro(cargo.id);
  });
});
