// Avisar a los vecinos que ya está el recibo: la vista previa cuenta bien (un correo `.invalid` es sin canal), el envío encola sin duplicar,
// lo fallido se reintenta, un segundo envío dentro de 2 minutos es 409, la junta sólo alcanza su block, y el texto para el grupo no lleva
// montos ni nombres. Nunca se envía nada de verdad: `encolarAviso` sólo deja filas `pendiente`.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { iniciar, esperar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { encolarAviso } from '../src/server/services/avisos';
import { sincronizarCargos } from '../src/server/services/juntas';

const SIN_CORREO = 'b1-402@sin-correo.invalid';
const MIN = 60_000;

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let R: { vencido: number; bloque1: number };
let U: { prop1: number; inq1: number; prop2: number };
let T: Record<'adminA' | 'adminB' | 'prop1' | 'inq1' | 'juntaB1' | 'juntaB2', string>;

const avisar = (t: string | null, id: number, metodo = 'GET') => llamar(base, metodo, `/api/recibos/${id}/avisar`, t);
const grupo = (t: string | null, id: number) => llamar(base, 'GET', `/api/recibos/${id}/mensaje-grupo`, t);
const avisosDelRecibo = (id: number) => prisma.notificacion.findMany({ where: { tipo: 'recibo_emitido', ref_entidad: 'recibo', ref_id: id }, orderBy: { id: 'asc' } });

/** La auditoría se escribe justo después de responder: espera a que haya `n` envíos y mueve todos 3 minutos atrás, como si hubiera pasado el plazo. */
async function pasarPlazo(reciboId: number, n: number) {
  await esperar(async () => ((await prisma.auditoria.count({ where: { accion: 'avisar_vecinos', entidad: 'recibo', entidad_id: reciboId } })) >= n ? true : null));
  await prisma.auditoria.updateMany({ where: { accion: 'avisar_vecinos', entidad: 'recibo', entidad_id: reciboId }, data: { created_at: new Date(Date.now() - 3 * MIN) } });
}

before(async () => {
  d = await sembrar();
  const hash = await bcrypt.hash(PASSWORD, 4);
  // Block 1 con A-101 (propietario 1 e inquilino 1). El recibo «vencido» sin block tiene cargos de A-101 y A-102 (propietario 2).
  const b1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
  const b2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'Block', complejo_id: d.complejoA.id } });
  await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: b1.id } });
  // Canales a la medida: propietario 1 correo y WhatsApp; inquilino 1 sólo correo; propietario 2 sólo un correo sin buzón (`.invalid`).
  await prisma.usuario.update({ where: { id: d.propietario1.id }, data: { aviso_email: true, aviso_whatsapp: true, telefono: '+51 987 654 321' } });
  await prisma.usuario.update({ where: { id: d.inquilino1.id }, data: { aviso_email: true, aviso_whatsapp: false, telefono: null } });
  await prisma.usuario.update({ where: { id: d.propietario2.id }, data: { email: SIN_CORREO, aviso_email: true, aviso_whatsapp: false, telefono: null } });
  // Presidentes de la junta de cada block (cada uno vive en su block).
  const presidente = async (nombre: string, email: string, codigo: string, estructura_id: number) => {
    const u = await prisma.usuario.create({ data: { nombre, email, rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id } });
    await prisma.unidad.create({ data: { codigo, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id, propietario_id: u.id, estado: 'activa' } });
    await prisma.juntaDirectiva.create({ data: { complejo_id: d.complejoA.id, estructura_id, desde: new Date('2026-01-01T00:00:00Z'), miembros: { create: [{ usuario_id: u.id, cargo: 'presidente' }] } } });
    await sincronizarCargos(d.complejoA.id, estructura_id); // el reflejo `cargo_junta` que la app escribe al guardar la junta
    return email;
  };
  const emailJunta1 = await presidente('Presidente Block 1', 'junta1.avisar@test.pe', 'B01-901', b1.id);
  const emailJunta2 = await presidente('Presidente Block 2', 'junta2.avisar@test.pe', 'B02-901', b2.id);
  // Recibo de la torre 1: sólo A-101 (propietario 1 e inquilino 1).
  const bloque1 = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, estructura_id: b1.id, mes: 9, anio: 2026, fecha_emision: new Date('2026-09-01T00:00:00Z'), fecha_vencimiento: new Date('2026-11-02T00:00:00Z'), estado: 'emitido', descripcion: 'Block 1' } });
  const rc = await prisma.reciboConcepto.create({ data: { recibo_id: bloque1.id, concepto_id: d.conceptoA.id, monto: 150, orden: 1 } });
  await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: d.unidadA1.id, monto: 150, estado_pago: 'pendiente' } });
  R = { vencido: d.reciboVencidoA.id, bloque1: bloque1.id };
  U = { prop1: d.propietario1.id, inq1: d.inquilino1.id, prop2: d.propietario2.id };

  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'), prop1: await login(base, 'prop1@test.pe'), inq1: await login(base, 'inq1@test.pe'),
    juntaB1: await login(base, emailJunta1), juntaB2: await login(base, emailJunta2),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('vista previa', () => {
  it('cuenta por correo y por WhatsApp, y el correo .invalid cuenta como sin canal', async () => {
    const r = await avisar(T.adminA, R.vencido);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { vecinos: 3, por_correo: 2, por_whatsapp: 1, por_avisar: 2, ya_avisados: 0, sin_canal: 1, espera_segundos: 0 });
  });

  it('no trae nombres ni datos de contacto, sólo conteos', async () => {
    const texto = (await avisar(T.adminA, R.vencido)).texto;
    for (const secreto of ['Propietario', 'Inquilino', '@', '987 654', SIN_CORREO]) assert.ok(!texto.includes(secreto), `no debe traer «${secreto}»`);
  });
});

describe('envío', () => {
  it('encola un aviso por canal a quien lo tiene y no crea nada para quien no tiene canal', async () => {
    const r = await avisar(T.adminA, R.vencido, 'POST');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { encolados: 2, ya_avisados: 0, sin_canal: 1 });
    const filas = await avisosDelRecibo(R.vencido);
    assert.deepEqual(filas.map((f) => `${f.usuario_id}:${f.canal}:${f.estado}`).sort(), [`${U.inq1}:email:pendiente`, `${U.prop1}:email:pendiente`, `${U.prop1}:whatsapp:pendiente`].sort());
  });

  it('un segundo envío dentro de los 2 minutos es 409 y no crea nada', async () => {
    await pasarPlazo(R.vencido, 1);
    const primero = await avisar(T.adminA, R.vencido, 'POST');
    assert.equal(primero.status, 200);
    const r = await avisar(T.adminA, R.vencido, 'POST');
    assert.equal(r.status, 409);
    assert.match(r.body.error, /Vuelve a intentarlo en \d+ s\./);
    assert.equal((await avisosDelRecibo(R.vencido)).length, 3);
  });

  it('pasado el plazo, repetir el envío no duplica: 0 encolados y todos ya avisados', async () => {
    await pasarPlazo(R.vencido, 2);
    const r = await avisar(T.adminA, R.vencido, 'POST');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { encolados: 0, ya_avisados: 2, sin_canal: 1 });
    assert.equal((await avisosDelRecibo(R.vencido)).length, 3, 'sigue habiendo tres avisos, ninguno nuevo');
  });

  it('lo que falló se vuelve a poner en cola; lo pendiente o enviado no se toca', async () => {
    await prisma.notificacion.updateMany({ where: { ref_entidad: 'recibo', ref_id: R.vencido, usuario_id: U.prop1, canal: 'whatsapp' }, data: { estado: 'error', intentos: 3, error: 'Fallo de prueba' } });
    await prisma.notificacion.updateMany({ where: { ref_entidad: 'recibo', ref_id: R.vencido, usuario_id: U.inq1, canal: 'email' }, data: { estado: 'enviada' } });
    await pasarPlazo(R.vencido, 3);
    const r = await avisar(T.adminA, R.vencido, 'POST');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { encolados: 1, ya_avisados: 1, sin_canal: 1 });
    const wa = await prisma.notificacion.findFirst({ where: { ref_entidad: 'recibo', ref_id: R.vencido, usuario_id: U.prop1, canal: 'whatsapp' } });
    assert.equal(wa?.estado, 'pendiente');
    assert.equal(wa?.intentos, 0);
    assert.equal(wa?.error, null);
    const enviado = await prisma.notificacion.findFirst({ where: { ref_entidad: 'recibo', ref_id: R.vencido, usuario_id: U.inq1, canal: 'email' } });
    assert.equal(enviado?.estado, 'enviada', 'un aviso ya enviado no vuelve a la cola');
  });

  it('un correo .invalid nunca genera un aviso por correo, tampoco al encolar directamente', async () => {
    for (const tipo of ['recibo_emitido', 'por_vencer'] as const) {
      assert.equal(await encolarAviso(tipo, U.prop2, { entidad: 'recibo', id: R.vencido }), 0, tipo);
    }
    assert.equal(await prisma.notificacion.count({ where: { usuario_id: U.prop2 } }), 0);
  });

  it('la auditoría registra el envío con conteos, sin correos ni nombres', async () => {
    await esperar(async () => ((await prisma.auditoria.count({ where: { accion: 'avisar_vecinos', entidad_id: R.vencido } })) >= 1 ? true : null));
    const a = await prisma.auditoria.findFirst({ where: { accion: 'avisar_vecinos', entidad: 'recibo', entidad_id: R.vencido }, orderBy: { id: 'asc' } });
    assert.ok(a, 'hay una fila de auditoría');
    assert.equal(a!.usuario_id, d.adminA.id);
    assert.deepEqual(a!.detalle, { mes: 8, anio: 2026, encolados: 2, ya_avisados: 0, sin_canal: 1 });
    assert.ok(!JSON.stringify(a!.detalle).includes('@'));
  });
});

describe('permisos y alcance', () => {
  it('otra empresa → 404 en la vista previa, el envío y el mensaje', async () => {
    assert.equal((await avisar(T.adminB, R.vencido)).status, 404);
    assert.equal((await avisar(T.adminB, R.vencido, 'POST')).status, 404);
    assert.equal((await grupo(T.adminB, R.vencido)).status, 404);
  });

  it('un inquilino o un propietario sin junta → 403', async () => {
    assert.equal((await avisar(T.inq1, R.vencido)).status, 403);
    assert.equal((await avisar(T.prop1, R.vencido, 'POST')).status, 403);
    assert.equal((await grupo(T.prop1, R.vencido)).status, 403);
  });

  it('la junta de un block ve y avisa los recibos de SU block', async () => {
    assert.equal((await avisar(T.juntaB1, R.bloque1)).status, 200);
    assert.equal((await grupo(T.juntaB1, R.bloque1)).status, 200);
  });

  it('la junta de otro block → 404 (el recibo de la torre 1 no es de la torre 2)', async () => {
    assert.equal((await avisar(T.juntaB2, R.bloque1)).status, 404);
    assert.equal((await avisar(T.juntaB2, R.bloque1, 'POST')).status, 404);
    assert.equal((await grupo(T.juntaB2, R.bloque1)).status, 404);
  });
});

describe('mensaje para el grupo de WhatsApp', () => {
  it('dice el periodo, el block, el vencimiento y dónde pagar', async () => {
    const r = await grupo(T.adminA, R.bloque1);
    assert.equal(r.status, 200);
    assert.equal(r.body.texto, 'Ya está el mantenimiento de setiembre de 2026 del Block 1. Vence el 2 de noviembre. Míralo y págalo con tu voucher en Torre: https://house.gargurevich.dev');
  });

  it('sin block dice el condominio', async () => {
    const r = await grupo(T.adminA, R.vencido);
    assert.match(r.body.texto, /^Ya está el mantenimiento de agosto de 2026 del Condominio Complejo A\. Vence el \d+ de \w+\./);
  });

  it('nunca lleva montos ni nombres de vecinos', async () => {
    for (const id of [R.vencido, R.bloque1]) {
      const { texto } = (await grupo(T.adminA, id)).body as { texto: string };
      assert.doesNotMatch(texto, /S\/|\d+\.\d\d|\b150\b/, 'sin montos');
      for (const nombre of ['Propietario', 'Inquilino', 'Presidente']) assert.ok(!texto.includes(nombre), `sin «${nombre}»`);
    }
  });
});
