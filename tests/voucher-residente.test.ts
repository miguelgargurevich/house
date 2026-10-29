// El residente paga su mantenimiento en UN solo pedido: los campos y el voucher (obligatorio) juntos. Pago y comprobante nacen en la misma
// transacción; sin voucher, o con uno que no sirve, no se crea nada. IA SIEMPRE falsa (llaveroDeps.fetch inyectado): nunca hay red.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { cabecerasDeSesion, esperar, iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { hoyLima } from '../src/server/lib/fechas';
import { esperarEvaluaciones } from '../src/server/services/evaluacion';
import { guardar as guardarClaveLlavero, llaveroDeps } from '../src/server/services/llavero';
import { olvidarTodoUso } from '../src/server/services/rotacion';
import { limpiarTodo } from '../src/server/lib/cooldown';
import { pagarComoResidente, pngUnico, voucherPng } from './helpers/pagoResidente';

const ENC = 'clave-maestra-de-pruebas-que-supera-32-caracteres';
const DIA = 86_400_000;
const HOY = hoyLima().getTime();
const HOY_ISO = new Date(HOY).toISOString().slice(0, 10);

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'prop1' | 'propB' | 'adminA', string>;

let llamadas = 0;
const fetchOriginal = llaveroDeps.fetch;
let n = 0;
const lectura = () => JSON.stringify({
  es_comprobante_de_pago: true, legible: true, medio: 'yape', estado_operacion: 'exitosa', monto: 115, moneda: 'PEN', fecha: HOY_ISO,
  numero_operacion: `OP${String(++n).padStart(6, '0')}`, destinatario_nombre: 'Maria Perez Garcia', destino_numero: '321',
});
const respuestaIA = () => new Response(JSON.stringify({ choices: [{ message: { content: lectura() } }], candidates: [{ content: { parts: [{ text: lectura() }] } }] }), { status: 200 });

interface Mant { reciboId: number; unidadId: number; cargos: { id: number }[] }

/** Un recibo con agua 40, limpieza 60 y mora 15 (total 115) para UNA unidad. */
async function mantenimiento(unidad: { id: number }): Promise<Mant> {
  const complejo = d.complejoA;
  const recibo = await prisma.recibo.create({ data: { empresa_id: complejo.empresa_id, complejo_id: complejo.id, mes: 9, anio: 2026, fecha_emision: new Date(HOY - 40 * DIA), fecha_vencimiento: new Date(HOY + 20 * DIA), estado: 'emitido' } });
  const cargos: Mant['cargos'] = [];
  const conceptos: [string, number][] = [['Agua', 40], ['Limpieza', 60], ['Mora', 15]];
  for (const [i, [nombre, monto]] of conceptos.entries()) {
    const concepto = await prisma.concepto.create({ data: { nombre, empresa_id: complejo.empresa_id, tipo_monto: 'fijo' } });
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: concepto.id, monto, orden: i + 1, es_recargo: nombre === 'Mora' } });
    cargos.push(await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidad.id, monto, estado_pago: 'pendiente' } }));
  }
  return { reciboId: recibo.id, unidadId: unidad.id, cargos };
}

const delMant = (m: Mant) => ({ unidad_id: m.unidadId, reciboConcepto: { recibo_id: m.reciboId } });
const pagosDe = (m: Mant) => prisma.pago.findMany({ where: { reciboConceptoUnidad: delMant(m) }, orderBy: { id: 'asc' } });
const estadosCargos = async (m: Mant) => (await prisma.reciboConceptoUnidad.findMany({ where: { id: { in: m.cargos.map((c) => c.id) } }, orderBy: { id: 'asc' } })).map((c) => c.estado_pago);
const archivosDe = (m: Mant) => prisma.archivoComprobante.findMany({ where: { pago: { reciboConceptoUnidad: delMant(m) } } });
const evaluacionesDe = (m: Mant) => prisma.evaluacionComprobante.findMany({ where: { pago: { reciboConceptoUnidad: delMant(m) } } });
const pagar = (token: string, m: Mant, ...resto: [Record<string, string>?, Parameters<typeof pagarComoResidente>[5]?]) => pagarComoResidente(base, token, m.reciboId, m.unidadId, ...resto);

async function sinRastro(m: Mant) {
  assert.equal((await pagosDe(m)).length, 0, 'ningún pago');
  assert.deepEqual(await estadosCargos(m), ['pendiente', 'pendiente', 'pendiente']);
  assert.equal((await archivosDe(m)).length, 0);
  assert.equal((await evaluacionesDe(m)).length, 0);
  assert.equal(llamadas, 0, 'la IA no se llamó');
}

before(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, ai: 100_000, llavero: 100_000, evaluacion: 100_000 } }));
  T = { prop1: await login(base, 'prop1@test.pe'), propB: await login(base, 'propb@test.pe'), adminA: await login(base, 'admin.a@test.pe') };
  llaveroDeps.fetch = async () => { llamadas += 1; return respuestaIA(); };
});
after(async () => {
  llaveroDeps.fetch = fetchOriginal;
  delete process.env.LLAVERO_ENC_KEY;
  await esperarEvaluaciones();
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  delete process.env.GEMINI_API_KEY;
  await prisma.claveIntegracion.deleteMany();
  await prisma.medioPago.deleteMany();
  await prisma.medioPago.create({ data: { complejo_id: d.complejoA.id, tipo: 'yape', celular: '987654321', titular: 'María Pérez García', creado_por_id: d.adminA.id } });
  await guardarClaveLlavero({ proveedor: 'gemini', clave: 'clave-falsa-gemini-0001', usuarioId: d.superadmin.id });
  await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { validacion_automatica_ia: false } });
  await prisma.notificacion.deleteMany();
  limpiarTodo();
  olvidarTodoUso();
  llamadas = 0;
});
afterEach(async () => { await esperarEvaluaciones(); });

describe('residente con voucher: un solo pedido, pago y comprobante juntos', () => {
  it('201: nace por_validar con el voucher guardado (una vez, en el pago principal, subido por el residente) y la IA lo lee', async () => {
    const m = await mantenimiento(d.unidadA1);
    const r = await pagar(T.prop1, m, { metodo_pago: 'transferencia', referencia: 'OP-777' }, voucherPng({ nombre: 'Operación ñandú.png' }));
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.cargos, 3);
    const pagos = await pagosDe(m);
    assert.equal(pagos.length, 3);
    assert.ok(pagos.every((p) => p.estado_validacion === 'por_validar' && p.usuario_id === d.propietario1.id && p.metodo_pago === 'transferencia' && p.referencia === 'OP-777'));
    assert.deepEqual(await estadosCargos(m), ['en_revision', 'en_revision', 'en_revision']);
    const principal = pagos.find((p) => p.grupo_principal)!;
    assert.equal(principal.id, r.body.pago_id);
    const archivos = await archivosDe(m);
    assert.equal(archivos.length, 1);
    assert.equal(archivos[0]!.pago_id, principal.id);
    assert.equal(archivos[0]!.subido_por_id, d.propietario1.id);
    assert.equal(archivos[0]!.nombre, 'Operación ñandú.png');
    const detalle = r.body.mantenimiento.pagos.find((p: { id: number }) => p.id === r.body.pago_id);
    assert.equal(detalle.estado_validacion, 'por_validar');
    assert.equal(detalle.comprobante.nombre, 'Operación ñandú.png');

    await esperarEvaluaciones();
    const ev = await evaluacionesDe(m);
    assert.equal(ev.length, 1, 'la IA evaluó el voucher recién subido');
    assert.equal(ev[0]!.estado, 'completada');
    assert.equal(llamadas, 1);
  });

  it('la referencia es opcional; PDF también sirve', async () => {
    const m = await mantenimiento(d.unidadA1);
    const r = await pagar(T.prop1, m, { metodo_pago: 'yape' }, { bytes: Buffer.from(`%PDF-1.4\npdf-${++n}\n%%EOF`), tipo: 'application/pdf', nombre: 'voucher.pdf' });
    assert.equal(r.status, 201, r.texto);
    assert.equal((await archivosDe(m))[0]!.tipo_mime, 'application/pdf');
    assert.ok((await pagosDe(m)).every((p) => p.referencia === null));
  });

  it('auditoría: «crear pago» y «subir_comprobante» (nombre, tipo, tamaño, huella), nunca el contenido del archivo', async () => {
    const bytes = pngUnico();
    const marca = bytes.subarray(8).toString('utf8');
    const m = await mantenimiento(d.unidadA1);
    const r = await pagar(T.prop1, m, undefined, voucherPng({ bytes, nombre: 'voucher-auditado.png' }));
    assert.equal(r.status, 201, r.texto);
    await esperarEvaluaciones();
    const filas = await esperar(async () => {
      const f = await prisma.auditoria.findMany({ where: { entidad: 'pago', entidad_id: r.body.pago_id }, orderBy: { id: 'asc' } });
      return f.some((x) => x.accion === 'crear') && f.some((x) => x.accion === 'subir_comprobante') ? f : null;
    });
    const crear = filas.find((x) => x.accion === 'crear')!;
    assert.equal(crear.usuario_id, d.propietario1.id);
    assert.deepEqual(crear.detalle, { grupo: r.body.grupo, total: '115.00', cargos: 3, recibo_id: m.reciboId, unidad_id: m.unidadId, con_voucher: true });
    const subida = filas.find((x) => x.accion === 'subir_comprobante')!;
    assert.equal(subida.usuario_id, d.propietario1.id);
    const det = subida.detalle as Record<string, unknown>;
    assert.deepEqual(Object.keys(det).sort(), ['nombre', 'sha256', 'tamano', 'tipo_mime']);
    assert.equal(det.sha256, (await archivosDe(m))[0]!.sha256);
    assert.ok(!JSON.stringify(filas).includes(marca), 'el contenido del archivo no se audita');
  });
});

describe('residente sin voucher: 422 y no se crea nada', () => {
  const ESPERADO = { error: 'Adjunta la foto o el PDF de tu voucher', campos: { voucher: 'Obligatorio' } };

  it('formulario multipart sin archivo', async () => {
    const m = await mantenimiento(d.unidadA1);
    const r = await pagar(T.prop1, m, { metodo_pago: 'yape', referencia: 'OP-1' }, null);
    assert.equal(r.status, 422, r.texto);
    assert.deepEqual(r.body, ESPERADO);
    await sinRastro(m);
  });

  it('JSON (el pedido de antes): también 422', async () => {
    const m = await mantenimiento(d.unidadA1);
    const r = await llamar(base, 'POST', `/api/me/mantenimientos/${m.reciboId}/${m.unidadId}/pagos`, T.prop1, { metodo_pago: 'yape', referencia: 'OP123456' });
    assert.equal(r.status, 422, r.texto);
    assert.deepEqual(r.body, ESPERADO);
    await sinRastro(m);
  });
});

describe('voucher inválido: no queda ningún pago huérfano', () => {
  it('tipo no permitido → 415; bytes que no son del tipo, vacío y demasiado grande → 422; y el reintento válido funciona', async () => {
    const m = await mantenimiento(d.unidadA1);
    const texto = await pagar(T.prop1, m, undefined, { bytes: Buffer.from('hola'), tipo: 'text/plain', nombre: 'nota.txt' });
    assert.equal(texto.status, 415, texto.texto);
    await sinRastro(m);

    const falso = await pagar(T.prop1, m, undefined, { bytes: Buffer.from('esto no es una imagen'), tipo: 'image/png', nombre: 'falso.png' });
    assert.equal(falso.status, 422, falso.texto);
    assert.equal(falso.body.campos.voucher, 'No corresponde a su tipo');
    await sinRastro(m);

    const vacio = await pagar(T.prop1, m, undefined, { bytes: Buffer.alloc(0), tipo: 'image/png', nombre: 'vacio.png' });
    assert.equal(vacio.status, 422, vacio.texto);
    await sinRastro(m);

    const grande = await pagar(T.prop1, m, undefined, { bytes: Buffer.concat([pngUnico(), Buffer.alloc(2 * 1024 * 1024)]), tipo: 'image/png', nombre: 'grande.png' });
    assert.equal(grande.status, 422, grande.texto);
    assert.match(grande.body.error, /2 MB/);
    await sinRastro(m);

    const bien = await pagar(T.prop1, m);
    assert.equal(bien.status, 201, bien.texto);
    assert.equal((await pagosDe(m)).length, 3);
  });

  it('campos inválidos junto al voucher → 422 sin rastro (método desconocido; el monto no se acepta)', async () => {
    const m = await mantenimiento(d.unidadA1);
    assert.equal((await pagar(T.prop1, m, { metodo_pago: 'bitcoin' })).status, 422);
    assert.equal((await pagar(T.prop1, m, { metodo_pago: 'yape', monto: '1' })).status, 422);
    assert.equal((await pagar(T.prop1, m, {})).status, 422, 'el método es obligatorio');
    await sinRastro(m);
  });

  it('dos archivos o un campo con otro nombre → 422 sin rastro', async () => {
    const m = await mantenimiento(d.unidadA1);
    const ruta = `${base}/api/me/mantenimientos/${m.reciboId}/${m.unidadId}/pagos`;
    const fd = new FormData();
    fd.append('metodo_pago', 'yape');
    fd.append('voucher', new Blob([new Uint8Array(pngUnico())], { type: 'image/png' }), 'a.png');
    fd.append('voucher', new Blob([new Uint8Array(pngUnico())], { type: 'image/png' }), 'b.png');
    assert.equal((await fetch(ruta, { method: 'POST', headers: cabecerasDeSesion(T.prop1), body: fd })).status, 422);
    const fd2 = new FormData();
    fd2.append('metodo_pago', 'yape');
    fd2.append('archivo', new Blob([new Uint8Array(pngUnico())], { type: 'image/png' }), 'a.png');
    assert.equal((await fetch(ruta, { method: 'POST', headers: cabecerasDeSesion(T.prop1), body: fd2 })).status, 422);
    await sinRastro(m);
  });
});

describe('alcance: la unidad se comprueba ANTES de recibir el archivo', () => {
  it('unidad ajena (otro propietario, otra empresa) → 404 aunque el voucher sea válido; nada se crea', async () => {
    const m = await mantenimiento(d.unidadA1);
    assert.equal((await pagar(T.propB, m)).status, 404, 'otra empresa');
    await sinRastro(m);
    const otro = await mantenimiento(d.unidadA2);
    assert.equal((await pagar(T.prop1, otro)).status, 404, 'otro propietario de la misma empresa');
    await sinRastro(otro);
  });

  it('unidad ajena con un archivo de más de 2 MB → 404 (no 422 «pesa más de 2 MB»): no se leyó el cuerpo', async () => {
    const m = await mantenimiento(d.unidadA2);
    const r = await pagar(T.prop1, m, undefined, { bytes: Buffer.concat([pngUnico(), Buffer.alloc(3 * 1024 * 1024)]), tipo: 'image/png', nombre: 'grande.png' });
    assert.equal(r.status, 404, r.texto);
    await sinRastro(m);
  });

  it('un administrador no paga por esta ruta (403) y sin sesión → 401', async () => {
    const m = await mantenimiento(d.unidadA1);
    assert.equal((await pagar(T.adminA, m)).status, 403);
    const sin = await fetch(`${base}/api/me/mantenimientos/${m.reciboId}/${m.unidadId}/pagos`, { method: 'POST' });
    assert.equal(sin.status, 401);
    await sinRastro(m);
  });
});

describe('el pago por cargo (/api/me/cargos/:id/pagos) queda como estaba', () => {
  it('JSON sin voucher sigue entrando como pago por validar', async () => {
    const m = await mantenimiento(d.unidadA1);
    const r = await llamar(base, 'POST', `/api/me/cargos/${m.cargos[0]!.id}/pagos`, T.prop1, { metodo_pago: 'yape', referencia: 'OP-9' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await archivosDe(m)).length, 0);
  });
});
