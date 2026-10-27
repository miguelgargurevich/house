// El administrador (o la junta) adjunta el voucher al registrar el pago del mantenimiento: el pago nace por_validar, el archivo se guarda
// en la misma transacción y la IA lo evalúa igual que el del residente. IA SIEMPRE falsa (llaveroDeps.fetch inyectado): nunca hay red.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { cabecerasDeSesion, esperar, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { cambiarAdministradora } from '../src/server/lib/contratos';
import { hoyLima } from '../src/server/lib/fechas';
import { esperarEvaluaciones } from '../src/server/services/evaluacion';
import { guardar as guardarClaveLlavero, llaveroDeps } from '../src/server/services/llavero';
import { pagarMantenimiento } from '../src/server/services/mantenimiento';
import { olvidarTodoUso } from '../src/server/services/rotacion';
import { limpiarTodo } from '../src/server/lib/cooldown';

const ENC = 'clave-maestra-de-pruebas-que-supera-32-caracteres';
const DIA = 86_400_000;
const HOY = hoyLima().getTime();
const HOY_ISO = new Date(HOY).toISOString().slice(0, 10);

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'adminA' | 'adminB' | 'prop1' | 'presiA' | 'tesoJ1', string>;
let blockJ1: { id: number };
let unidadJ1: { id: number };
let unidadJ2: { id: number };

// ---------- IA falsa ----------
let llamadas = 0;
let responder: () => Response | Promise<Response> = () => ok(lec());
const fetchOriginal = llaveroDeps.fetch;
const ok = (texto: string) => new Response(JSON.stringify({ choices: [{ message: { content: texto } }], candidates: [{ content: { parts: [{ text: texto }] } }] }), { status: 200 });
let n = 0;
/** Lectura de un Yape correcto por el TOTAL del mantenimiento (S/ 115) a María Pérez García (…321), de hoy, con n.º de operación único. */
const lec = (extra: Record<string, unknown> = {}) => JSON.stringify({
  es_comprobante_de_pago: true, legible: true, medio: 'yape', estado_operacion: 'exitosa', monto: 115, moneda: 'PEN', fecha: HOY_ISO,
  numero_operacion: `OP${String(++n).padStart(6, '0')}`, destinatario_nombre: 'Maria Perez Garcia', destino_numero: '321', ...extra,
});

const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`captura-falsa-${++n}`)]);
const PDF = () => Buffer.from(`%PDF-1.4\npdf-falso-${++n}\n%%EOF`);
const archivoPng = (extra: Partial<Archivo> = {}): Archivo => ({ bytes: PNG(), tipo: 'image/png', nombre: 'voucher.png', ...extra });

interface Archivo { bytes: Buffer; tipo: string; nombre: string }
interface Mant { reciboId: number; unidadId: number; cargos: { id: number; monto: number; nombre: string }[]; total: number }

/** Un recibo con varios conceptos para UNA unidad: agua 40, limpieza 60, mora 15 (total 115). */
async function mantenimiento(unidad: { id: number }, opts: { complejo?: { id: number; empresa_id: number | null } } = {}): Promise<Mant> {
  const complejo = opts.complejo ?? d.complejoA;
  const conceptos: [string, number][] = [['Agua', 40], ['Limpieza', 60], ['Mora', 15]];
  const recibo = await prisma.recibo.create({
    data: { empresa_id: complejo.empresa_id, complejo_id: complejo.id, mes: 9, anio: 2026, fecha_emision: new Date(HOY - 40 * DIA), fecha_vencimiento: new Date(HOY + 20 * DIA), estado: 'emitido' },
  });
  const cargos: Mant['cargos'] = [];
  for (const [i, [nombre, monto]] of conceptos.entries()) {
    const concepto = await prisma.concepto.create({ data: { nombre, empresa_id: complejo.empresa_id, tipo_monto: 'fijo' } });
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: concepto.id, monto, orden: i + 1, es_recargo: nombre === 'Mora' } });
    const c = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidad.id, monto, estado_pago: 'pendiente' } });
    cargos.push({ id: c.id, monto, nombre });
  }
  return { reciboId: recibo.id, unidadId: unidad.id, cargos, total: 115 };
}

const rutaPago = (m: Mant) => `/api/recibos/${m.reciboId}/mantenimientos/${m.unidadId}/pagos`;
const pagosDe = (m: Mant) => prisma.pago.findMany({ where: { reciboConceptoUnidad: { unidad_id: m.unidadId, reciboConcepto: { recibo_id: m.reciboId } } }, orderBy: { id: 'asc' } });
const estadosCargos = async (m: Mant) => (await prisma.reciboConceptoUnidad.findMany({ where: { id: { in: m.cargos.map((c) => c.id) } }, orderBy: { id: 'asc' } })).map((c) => c.estado_pago);
const archivosDe = (m: Mant) => prisma.archivoComprobante.findMany({ where: { pago: { reciboConceptoUnidad: { unidad_id: m.unidadId, reciboConcepto: { recibo_id: m.reciboId } } } } });
const evaluacionesDe = (m: Mant) => prisma.evaluacionComprobante.findMany({ where: { pago: { reciboConceptoUnidad: { unidad_id: m.unidadId, reciboConcepto: { recibo_id: m.reciboId } } } } });

/** Registra el pago como lo hace la pantalla: formulario multipart con los campos de texto y, opcionalmente, el archivo en `voucher`. */
async function registrar(token: string, m: Mant, campos: Record<string, string> = { metodo_pago: 'transferencia', referencia: 'OP-777' }, archivo?: Archivo) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, v);
  if (archivo) fd.append('voucher', new Blob([new Uint8Array(archivo.bytes)], { type: archivo.tipo }), archivo.nombre);
  const r = await fetch(base + rutaPago(m), { method: 'POST', headers: cabecerasDeSesion(token), body: fd });
  const texto = await r.text();
  let body: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = JSON.parse(texto); } catch { /* sin JSON */ }
  return { status: r.status, body, texto };
}

const configurar = (valor: boolean) => prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { validacion_automatica_ia: valor } });
const validar = (token: string, id: number, cuerpo: unknown = { estado: 'validado' }) => llamar(base, 'PATCH', `/api/pagos/${id}/validacion`, token, cuerpo);

const compuertas: (() => void)[] = [];
function compuerta() {
  let abrir!: () => void;
  const promesa = new Promise<void>((r) => { abrir = r; });
  compuertas.push(abrir);
  return { promesa, abrir };
}

before(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, ai: 100_000, llavero: 100_000, evaluacion: 100_000 } }));
  const hash = await bcrypt.hash(PASSWORD, 4);
  await prisma.usuario.create({ data: { nombre: 'Presi A', email: 'presi.a@test.pe', rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, cargo_junta: 'presidente' } });
  blockJ1 = await prisma.estructura.create({ data: { nombre: 'Block V1', tipo: 'block', complejo_id: d.complejoA.id } });
  const blockJ2 = await prisma.estructura.create({ data: { nombre: 'Block V2', tipo: 'block', complejo_id: d.complejoA.id } });
  const unidad = (codigo: string, estructura_id: number) => prisma.unidad.create({ data: { codigo, tipo: 'departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id, propietario_id: d.propietario2.id, estado: 'activa' } });
  unidadJ1 = await unidad('V1-101', blockJ1.id);
  unidadJ2 = await unidad('V2-101', blockJ2.id);
  await prisma.usuario.create({ data: { nombre: 'Tesorera V1', email: 'teso.v1@test.pe', rol: 'propietario', password_hash: hash, complejo_id: d.complejoA.id, estructura_id: blockJ1.id, cargo_junta: 'tesorero' } });
  T = {
    adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'), prop1: await login(base, 'prop1@test.pe'),
    presiA: await login(base, 'presi.a@test.pe'), tesoJ1: await login(base, 'teso.v1@test.pe'),
  };
  llaveroDeps.fetch = async () => { llamadas += 1; return responder(); };
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
  await configurar(true);
  await prisma.notificacion.deleteMany();
  limpiarTodo();
  olvidarTodoUso();
  llamadas = 0;
  responder = () => ok(lec());
});
afterEach(async () => {
  for (const abrir of compuertas.splice(0)) abrir();
  await esperarEvaluaciones();
});

// =====================================================================================================
describe('administrador con voucher: la IA lo revisa igual que el del residente', () => {
  it('IA coincide + validación automática ON: nace por_validar, la IA lo lee y queda pagado y validado_por_ia', async () => {
    const m = await mantenimiento(d.unidadA1);
    const gate = compuerta();
    responder = async () => { await gate.promesa; return ok(lec()); };

    const r = await registrar(T.adminA, m, { metodo_pago: 'transferencia', referencia: 'OP-1', usuario_id: String(d.propietario1.id) }, archivoPng({ nombre: 'Operación ñandú.png' }));
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.estado, 'por_validar');
    assert.equal(r.body.con_voucher, true);
    assert.equal(r.body.cargos, 3);

    // Mientras la IA lee: por validar, cargos en revisión y evaluación pendiente (la pantalla muestra «la IA lo está revisando»).
    const pagos = await pagosDe(m);
    assert.equal(pagos.length, 3);
    assert.ok(pagos.every((p) => p.estado_validacion === 'por_validar' && p.validado_por_id === null && p.validado_por_ia === false && p.usuario_id === d.propietario1.id));
    assert.deepEqual(await estadosCargos(m), ['en_revision', 'en_revision', 'en_revision']);
    const principal = pagos.find((p) => p.grupo_principal)!;
    assert.equal(principal.id, r.body.pago_id);
    assert.equal((await evaluacionesDe(m))[0]!.estado, 'pendiente');
    const detalle = r.body.mantenimiento.pagos.find((p: { id: number }) => p.id === r.body.pago_id);
    assert.equal(detalle.estado_validacion, 'por_validar');
    assert.equal(detalle.comprobante.nombre, 'Operación ñandú.png', 'el nombre UTF-8 llega sano');
    assert.equal(r.body.mantenimiento.estado, 'en_revision');

    // El archivo vive UNA vez, en el pago principal, subido por quien registró.
    const archivos = await archivosDe(m);
    assert.equal(archivos.length, 1);
    assert.equal(archivos[0]!.pago_id, principal.id);
    assert.equal(archivos[0]!.subido_por_id, d.adminA.id);
    assert.equal(archivos[0]!.tipo_mime, 'image/png');

    gate.abrir();
    await esperarEvaluaciones();
    const ev = (await evaluacionesDe(m))[0]!;
    assert.equal(ev.estado, 'completada');
    assert.equal(ev.veredicto, 'coincide');
    const despues = await pagosDe(m);
    assert.ok(despues.every((p) => p.estado_validacion === 'validado' && p.validado_por_ia === true && p.validado_por_id === null), 'validó la IA, no una persona');
    assert.deepEqual(await estadosCargos(m), ['pagado', 'pagado', 'pagado']);
    assert.equal(llamadas, 1);
  });

  it('con validación automática OFF: la IA coincide pero queda por validar, y se valida con el flujo de siempre', async () => {
    await configurar(false);
    const m = await mantenimiento(d.unidadA1);
    const r = await registrar(T.adminA, m, undefined, archivoPng());
    assert.equal(r.status, 201, r.texto);
    await esperarEvaluaciones();
    const ev = (await evaluacionesDe(m))[0]!;
    assert.equal(ev.estado, 'completada');
    assert.equal(ev.veredicto, 'coincide');
    assert.ok((await pagosDe(m)).every((p) => p.estado_validacion === 'por_validar' && !p.validado_por_ia));
    assert.deepEqual(await estadosCargos(m), ['en_revision', 'en_revision', 'en_revision']);

    // Lo ve con la IA en el detalle completo y lo valida con el PATCH que ya existía.
    const det = await llamar(base, 'GET', `/api/recibos/${m.reciboId}/mantenimientos/${m.unidadId}`, T.adminA);
    const pago = det.body.pagos.find((p: { id: number }) => p.id === r.body.pago_id);
    assert.equal(pago.evaluacion.veredicto, 'coincide');
    const v = await validar(T.adminA, r.body.pago_id);
    assert.equal(v.status, 200, v.texto);
    assert.ok((await pagosDe(m)).every((p) => p.estado_validacion === 'validado' && p.validado_por_id === d.adminA.id));
    assert.deepEqual(await estadosCargos(m), ['pagado', 'pagado', 'pagado']);
  });

  it('la IA no coincide (monto distinto): queda en revisión con su motivo y nunca se rechaza sola; se puede rechazar a mano', async () => {
    const m = await mantenimiento(d.unidadA1);
    responder = () => ok(lec({ monto: 40 })); // pagó sólo un concepto
    const r = await registrar(T.adminA, m, undefined, archivoPng());
    assert.equal(r.status, 201, r.texto);
    await esperarEvaluaciones();
    const ev = (await evaluacionesDe(m))[0]!;
    assert.equal(ev.estado, 'completada');
    assert.notEqual(ev.veredicto, 'coincide');
    assert.ok(ev.resumen);
    assert.ok((await pagosDe(m)).every((p) => p.estado_validacion === 'por_validar' && !p.validado_por_ia));
    assert.deepEqual(await estadosCargos(m), ['en_revision', 'en_revision', 'en_revision']);

    const rech = await validar(T.adminA, r.body.pago_id, { estado: 'rechazado', motivo: 'El monto del voucher no es el del recibo' });
    assert.equal(rech.status, 200, rech.texto);
    assert.deepEqual(await estadosCargos(m), ['pendiente', 'pendiente', 'pendiente']);
  });

  it('un voucher repetido (mismo archivo ya usado en otro pago de la empresa) no valida solo', async () => {
    const mismo = PNG();
    const m1 = await mantenimiento(d.unidadA1);
    assert.equal((await registrar(T.adminA, m1, undefined, archivoPng({ bytes: mismo }))).status, 201);
    await esperarEvaluaciones();
    assert.ok((await pagosDe(m1)).every((p) => p.estado_validacion === 'validado'), 'el primero sí valida');

    const m2 = await mantenimiento(d.unidadA2);
    assert.equal((await registrar(T.adminA, m2, undefined, archivoPng({ bytes: mismo }))).status, 201);
    await esperarEvaluaciones();
    assert.ok((await pagosDe(m2)).every((p) => p.estado_validacion === 'por_validar'), 'el repetido queda en revisión');
    assert.ok((await evaluacionesDe(m2))[0]!.alertas, 'con su alerta');
  });

  it('sin IA disponible (sin clave): el pago queda en revisión con el motivo; nada se rompe', async () => {
    await prisma.claveIntegracion.deleteMany();
    const m = await mantenimiento(d.unidadA1);
    const r = await registrar(T.adminA, m, undefined, archivoPng());
    assert.equal(r.status, 201, r.texto);
    await esperarEvaluaciones();
    const ev = (await evaluacionesDe(m))[0]!;
    assert.equal(ev.estado, 'no_disponible');
    assert.ok(ev.error);
    assert.ok((await pagosDe(m)).every((p) => p.estado_validacion === 'por_validar'));
    assert.equal(llamadas, 0);
  });

  it('PDF también sirve', async () => {
    const m = await mantenimiento(d.unidadA1);
    const r = await registrar(T.adminA, m, undefined, { bytes: PDF(), tipo: 'application/pdf', nombre: 'voucher.pdf' });
    assert.equal(r.status, 201, r.texto);
    assert.equal((await archivosDe(m))[0]!.tipo_mime, 'application/pdf');
  });
});

describe('administrador sin voucher: todo igual que hoy', () => {
  it('JSON: nace validado, cargos pagados, sin comprobante ni evaluación, sin llamar a la IA', async () => {
    const m = await mantenimiento(d.unidadA1);
    const r = await llamar(base, 'POST', rutaPago(m), T.adminA, { metodo_pago: 'efectivo', usuario_id: d.propietario1.id });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.estado, 'validado');
    assert.equal(r.body.con_voucher, false);
    const pagos = await pagosDe(m);
    assert.ok(pagos.length === 3 && pagos.every((p) => p.estado_validacion === 'validado' && p.validado_por_id === d.adminA.id && !p.validado_por_ia));
    assert.deepEqual(await estadosCargos(m), ['pagado', 'pagado', 'pagado']);
    assert.equal((await archivosDe(m)).length, 0);
    assert.equal((await evaluacionesDe(m)).length, 0);
    assert.equal(llamadas, 0);
  });

  it('formulario multipart sin archivo: también nace validado', async () => {
    const m = await mantenimiento(d.unidadA1);
    const r = await registrar(T.adminA, m, { metodo_pago: 'efectivo', referencia: '', observaciones: '', usuario_id: '', fecha_pago: '' });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.estado, 'validado');
    assert.ok((await pagosDe(m)).every((p) => p.estado_validacion === 'validado' && p.referencia === null));
    assert.deepEqual(await estadosCargos(m), ['pagado', 'pagado', 'pagado']);
    assert.equal(llamadas, 0);
  });
});

describe('voucher inválido: no queda ningún pago huérfano (se verifica ANTES de crear nada)', () => {
  async function sinRastro(m: Mant) {
    assert.equal((await pagosDe(m)).length, 0, 'ningún pago');
    assert.deepEqual(await estadosCargos(m), ['pendiente', 'pendiente', 'pendiente']);
    assert.equal((await archivosDe(m)).length, 0);
    assert.equal((await evaluacionesDe(m)).length, 0);
    assert.equal(llamadas, 0);
  }

  it('tipo no permitido → 415; bytes que no son del tipo declarado, vacío y demasiado grande → 422; y el reintento válido funciona', async () => {
    const m = await mantenimiento(d.unidadA1);
    const texto = await registrar(T.adminA, m, undefined, { bytes: Buffer.from('hola'), tipo: 'text/plain', nombre: 'nota.txt' });
    assert.equal(texto.status, 415, texto.texto);
    await sinRastro(m);

    const falso = await registrar(T.adminA, m, undefined, { bytes: Buffer.from('esto no es una imagen'), tipo: 'image/png', nombre: 'falso.png' });
    assert.equal(falso.status, 422, falso.texto);
    await sinRastro(m);

    const vacio = await registrar(T.adminA, m, undefined, { bytes: Buffer.alloc(0), tipo: 'image/png', nombre: 'vacio.png' });
    assert.equal(vacio.status, 422, vacio.texto);
    await sinRastro(m);

    const grande = await registrar(T.adminA, m, undefined, { bytes: Buffer.concat([PNG(), Buffer.alloc(2 * 1024 * 1024)]), tipo: 'image/png', nombre: 'grande.png' });
    assert.equal(grande.status, 422, grande.texto);
    assert.match(grande.body.error, /2 MB/);
    await sinRastro(m);

    const bien = await registrar(T.adminA, m, undefined, archivoPng());
    assert.equal(bien.status, 201, bien.texto);
    assert.equal((await pagosDe(m)).length, 3);
  });

  it('campos inválidos junto al voucher → 422 sin pago ni archivo (monto no se acepta; usuario ajeno no sirve)', async () => {
    const m = await mantenimiento(d.unidadA1);
    assert.equal((await registrar(T.adminA, m, { metodo_pago: 'efectivo', monto: '1' }, archivoPng())).status, 422);
    assert.equal((await registrar(T.adminA, m, { metodo_pago: 'bitcoin' }, archivoPng())).status, 422);
    assert.equal((await registrar(T.adminA, m, { metodo_pago: 'efectivo', usuario_id: String(d.propietarioB.id) }, archivoPng())).status, 422);
    assert.equal((await registrar(T.adminA, m, { metodo_pago: 'efectivo', usuario_id: 'abc' }, archivoPng())).status, 422);
    await sinRastro(m);
  });

  it('dos archivos o un campo con otro nombre → 422 sin rastro', async () => {
    const m = await mantenimiento(d.unidadA1);
    const fd = new FormData();
    fd.append('metodo_pago', 'efectivo');
    fd.append('voucher', new Blob([new Uint8Array(PNG())], { type: 'image/png' }), 'a.png');
    fd.append('voucher', new Blob([new Uint8Array(PNG())], { type: 'image/png' }), 'b.png');
    const dos = await fetch(base + rutaPago(m), { method: 'POST', headers: cabecerasDeSesion(T.adminA), body: fd });
    assert.equal(dos.status, 422);
    const fd2 = new FormData();
    fd2.append('metodo_pago', 'efectivo');
    fd2.append('archivo', new Blob([new Uint8Array(PNG())], { type: 'image/png' }), 'a.png');
    const otro = await fetch(base + rutaPago(m), { method: 'POST', headers: cabecerasDeSesion(T.adminA), body: fd2 });
    assert.equal(otro.status, 422);
    await sinRastro(m);
  });

  it('atómico de verdad: si guardar el comprobante falla dentro de la transacción, el pago, el grupo y los cargos se revierten', async () => {
    const m = await mantenimiento(d.unidadA1);
    await assert.rejects(pagarMantenimiento({
      reciboId: m.reciboId, unidadId: m.unidadId, usuarioId: null, modo: 'administracion', validadorId: d.adminA.id, metodo_pago: 'transferencia',
      comprobante: { nombre: 'x.png', tipo_mime: 'image/png', tamano: 2 ** 40 /* no cabe en un INT: la base lo rechaza */, sha256: 'a'.repeat(64), datos: PNG(), subidoPorId: d.adminA.id },
    }));
    await sinRastro(m);
    const ok2 = await registrar(T.adminA, m, undefined, archivoPng());
    assert.equal(ok2.status, 201, 'el mantenimiento sigue disponible para pagar');
  });
});

describe('alcance: igual que el pago sin voucher', () => {
  it('la junta del condominio (presidente) también adjunta voucher: queda por validar y la IA lo evalúa', async () => {
    await configurar(false);
    const m = await mantenimiento(d.unidadA1);
    const r = await registrar(T.presiA, m, undefined, archivoPng());
    assert.equal(r.status, 201, r.texto);
    await esperarEvaluaciones();
    assert.ok((await pagosDe(m)).every((p) => p.estado_validacion === 'por_validar'));
    assert.equal((await archivosDe(m))[0]!.subido_por_id, (await prisma.usuario.findUniqueOrThrow({ where: { email: 'presi.a@test.pe' } })).id);
    assert.equal((await evaluacionesDe(m))[0]!.veredicto, 'coincide');
  });

  it('junta de OTRO block → 404 y no se crea nada; en su propio block sí', async () => {
    const otro = await mantenimiento(unidadJ2);
    const r = await registrar(T.tesoJ1, otro, undefined, archivoPng());
    assert.equal(r.status, 404, r.texto);
    assert.equal((await pagosDe(otro)).length, 0);
    assert.equal((await archivosDe(otro)).length, 0);
    assert.equal((await evaluacionesDe(otro)).length, 0);
    assert.equal(llamadas, 0);

    const suyo = await mantenimiento(unidadJ1);
    assert.equal((await registrar(T.tesoJ1, suyo, undefined, archivoPng())).status, 201);
  });

  it('otra empresa → 404; un residente sin cargo → 403; sin sesión → 401; nada se crea', async () => {
    const m = await mantenimiento(d.unidadA1);
    assert.equal((await registrar(T.adminB, m, undefined, archivoPng())).status, 404);
    assert.equal((await registrar(T.prop1, m, undefined, archivoPng())).status, 403);
    assert.equal((await registrar('', m, undefined, archivoPng())).status, 401);
    assert.equal((await pagosDe(m)).length, 0);
    assert.equal((await archivosDe(m)).length, 0);
    assert.equal(llamadas, 0);
  });

  it('la administradora anterior (sin contrato vigente) no puede registrar ni con voucher → 404; la vigente sí', async () => {
    const complejoC = await prisma.complejoHabitacional.create({ data: { nombre: 'Complejo C', tipo: 'Edificio', empresa_id: d.empresaA.id } });
    const unidadC = await prisma.unidad.create({ data: { codigo: 'C-101', tipo: 'departamento', complejo_id: complejoC.id, empresa_id: d.empresaA.id, propietario_id: d.propietario2.id, estado: 'activa' } });
    const m = await mantenimiento(unidadC, { complejo: complejoC });
    await cambiarAdministradora(complejoC.id, d.empresaB.id); // el condominio pasa a la empresa B: la A sólo consulta
    const anterior = await registrar(T.adminA, m, undefined, archivoPng());
    assert.equal(anterior.status, 404, anterior.texto);
    assert.equal((await pagosDe(m)).length, 0);
    assert.equal((await archivosDe(m)).length, 0);
    assert.equal(llamadas, 0);
    const vigente = await registrar(T.adminB, m, undefined, archivoPng());
    assert.equal(vigente.status, 201, vigente.texto);
  });
});

describe('auditoría: metadatos del pago y del comprobante, nunca el contenido del archivo', () => {
  it('queda «crear pago» (con_voucher), «subir_comprobante» (nombre, tipo, tamaño y huella) y «evaluar_comprobante»', async () => {
    const bytes = PNG();
    const marca = bytes.subarray(8).toString('utf8');
    const m = await mantenimiento(d.unidadA1);
    const r = await registrar(T.adminA, m, undefined, archivoPng({ bytes, nombre: 'voucher-auditado.png' }));
    assert.equal(r.status, 201, r.texto);
    await esperarEvaluaciones();
    const filas = await esperar(async () => {
      const f = await prisma.auditoria.findMany({ where: { entidad: 'pago', entidad_id: r.body.pago_id }, orderBy: { id: 'asc' } });
      return f.some((x) => x.accion === 'crear') && f.some((x) => x.accion === 'subir_comprobante') && f.some((x) => x.accion === 'evaluar_comprobante') ? f : null;
    });
    const crear = filas.find((x) => x.accion === 'crear')!;
    assert.equal(crear.usuario_id, d.adminA.id);
    assert.deepEqual(crear.detalle, { grupo: r.body.grupo, total: '115.00', cargos: 3, recibo_id: m.reciboId, unidad_id: m.unidadId, con_voucher: true });
    const subida = filas.find((x) => x.accion === 'subir_comprobante')!;
    assert.equal(subida.usuario_id, d.adminA.id);
    const det = subida.detalle as Record<string, unknown>;
    assert.deepEqual(Object.keys(det).sort(), ['nombre', 'sha256', 'tamano', 'tipo_mime']);
    assert.equal(det.nombre, 'voucher-auditado.png');
    assert.equal(det.tamano, bytes.length);
    assert.equal(det.sha256, (await archivosDe(m))[0]!.sha256);
    assert.ok(!JSON.stringify(filas).includes(marca), 'el contenido del archivo no se audita');
  });
});
