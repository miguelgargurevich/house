// «Anular recibo» (el periodo queda libre para emitirlo de nuevo) y «Corregir / quitar el cargo» de un departamento.
// Reloj inyectado (`moraDeps.ahora`) y sin red: los avisos sólo quedan en cola (`pendiente`), nunca se envía nada.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { iniciar, llamar, login, PASSWORD, prisma, sembrar, esperar, type Datos } from './helpers/app';
import { CONCEPTO_MORA, moraDeps } from '../src/server/services/mora';
import { invalidarComercial } from '../src/server/services/comercial/modulos';
import { MENSAJE_CARGO_CON_PAGOS, MENSAJE_RECIBO_CON_PAGOS } from '../src/server/services/correccionRecibos';
import { MENSAJE_SOLO_LECTURA } from '../src/server/services/comercial/operativo';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1' | 'tesorero' | 'vecino1', string>;
let torre: { id: number };
let conceptoAgua: { id: number };
const relojOriginal = { ...moraDeps };

const CODIGOS = ['C-101', 'C-102', 'C-103', 'C-104'] as const;
const unidad = new Map<string, { id: number; usuario: number | null }>();
const VENCE_SET = new Date('2026-10-02T00:00:00Z');

const api = (t: string | null, m: string, ruta: string, cuerpo?: unknown) => llamar(base, m, ruta, t, cuerpo);
/** Emite el recibo de octubre del block (mantenimiento S/ 100 + agua S/ 30 a las 4 unidades; sin mora si no hay deuda de setiembre). */
const emitir = (token = T.adminA, mes = 10) => api(token, 'POST', '/api/recibos', {
  complejo_id: d.complejoA.id, estructura_id: torre.id, mes, anio: 2026, fecha_emision: '2026-10-20', fecha_vencimiento: '2026-11-02',
  conceptos: [{ concepto_id: d.conceptoA.id, monto: 100 }, { concepto_id: conceptoAgua.id, monto: 30 }],
});
const anular = (token: string | null, id: number, cuerpo: unknown = { motivo: 'Lo emití con el mes equivocado', avisar: false }) => api(token, 'POST', `/api/recibos/${id}/anular`, cuerpo);
const corregir = (token: string | null, id: number, cuerpo: unknown) => api(token, 'POST', `/api/recibo-concepto-unidades/${id}/corregir`, cuerpo);
const quitar = (token: string | null, id: number, cuerpo: unknown = { motivo: 'Cobro duplicado' }) => api(token, 'POST', `/api/recibo-concepto-unidades/${id}/quitar`, cuerpo);

const cargosDe = (reciboId: number) => prisma.reciboConceptoUnidad.findMany({ where: { reciboConcepto: { recibo_id: reciboId } }, include: { unidad: true, reciboConcepto: { include: { concepto: true } } }, orderBy: { id: 'asc' } });
const cargoDe = async (reciboId: number, codigo: string, concepto = 'Mantenimiento') => (await cargosDe(reciboId)).find((c) => c.unidad?.codigo === codigo && c.reciboConcepto?.concepto?.nombre === concepto)!;
const pago = (cargoId: number, estado: string, monto = 100, extra: Record<string, unknown> = {}) =>
  prisma.pago.create({ data: { recibo_concepto_unidad_id: cargoId, monto, estado_validacion: estado, metodo_pago: 'yape', referencia: `ref-${estado}`, ...extra } });
const auditoria = (accion: string, entidadId: number) => esperar(() => prisma.auditoria.findFirst({ where: { accion, entidad_id: entidadId } }));
const recibosOct = () => prisma.recibo.findMany({ where: { complejo_id: d.complejoA.id, estructura_id: torre.id, mes: 10, anio: 2026 } });
const emitirOk = async () => {
  const r = await emitir();
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id as number;
};

/** Deja la base como estaba antes de emitir octubre (los recibos de pruebas y todo lo que cuelga de ellos). */
async function limpiar() {
  await prisma.auditoria.deleteMany({ where: { accion: { in: ['anular', 'corregir_cargo', 'quitar_cargo', 'crear'] } } });
  await prisma.notificacion.deleteMany({ where: { tipo: { in: ['recibo_anulado', 'recibo_emitido'] } } });
  await prisma.envioGrupoWhatsapp.deleteMany({});
  await prisma.lecturaAgua.deleteMany({ where: { recibo: { mes: { in: [10, 11] }, anio: 2026, complejo_id: d.complejoA.id } } });
  await prisma.pago.deleteMany({ where: { reciboConceptoUnidad: { reciboConcepto: { recibo: { mes: { in: [10, 11] }, anio: 2026, complejo_id: d.complejoA.id, estructura_id: torre.id } } } } });
  await prisma.reciboConceptoUnidad.deleteMany({ where: { reciboConcepto: { recibo: { mes: { in: [10, 11] }, anio: 2026, complejo_id: d.complejoA.id, estructura_id: torre.id } } } });
  await prisma.reciboConcepto.deleteMany({ where: { recibo: { mes: { in: [10, 11] }, anio: 2026, complejo_id: d.complejoA.id, estructura_id: torre.id } } });
  await prisma.recibo.deleteMany({ where: { mes: { in: [10, 11] }, anio: 2026, complejo_id: d.complejoA.id, estructura_id: torre.id } });
  await prisma.concepto.deleteMany({ where: { nombre: CONCEPTO_MORA } });
}

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, ai: 100_000, llavero: 100_000, evaluacion: 100_000 } }));
  const hash = await bcrypt.hash(PASSWORD, 4);
  torre = await prisma.estructura.create({ data: { nombre: 'B.1', tipo: 'block', complejo_id: d.complejoA.id } });
  conceptoAgua = await prisma.concepto.create({ data: { nombre: 'Agua', empresa_id: d.empresaA.id, tipo_monto: 'fijo' } });
  // Los vecinos de C-101 a C-103 pagan con correo; C-104 no tiene a nadie.
  for (const [i, codigo] of CODIGOS.entries()) {
    const usuario = i < 3 ? await prisma.usuario.create({ data: { nombre: `Vecino ${i + 1}`, email: `vecino${i + 1}@test.pe`, rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, aviso_email: true, aviso_whatsapp: false } }) : null;
    const u = await prisma.unidad.create({ data: { codigo, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: torre.id, estado: 'activa', propietario_id: usuario?.id ?? null } });
    unidad.set(codigo, { id: u.id, usuario: usuario?.id ?? null });
  }
  // La junta (tesorero del block) no puede anular ni corregir: es de la administración.
  await prisma.usuario.create({ data: { nombre: 'Tesorero B.1', email: 'tesorero@test.pe', rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, cargo_junta: 'tesorero', estructura_id: torre.id } });
  T = {
    super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'),
    prop1: await login(base, 'prop1@test.pe'), tesorero: await login(base, 'tesorero@test.pe'), vecino1: await login(base, 'vecino1@test.pe'),
  };
});
after(async () => {
  Object.assign(moraDeps, relojOriginal);
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await limpiar();
  moraDeps.ahora = () => new Date('2026-10-20T15:00:00Z');
  await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { mora_monto: 20 } });
  // El recibo de setiembre de la torre no existe: octubre sale sin mora salvo en la prueba que lo crea.
  await prisma.recibo.deleteMany({ where: { complejo_id: d.complejoA.id, estructura_id: torre.id, mes: 9, anio: 2026 } });
});
afterEach(() => { Object.assign(moraDeps, relojOriginal); });

// =====================================================================================================
describe('Anular recibo', () => {
  it('sin pagos: el recibo desaparece con sus conceptos y cargos, y el periodo queda libre para emitirlo otra vez', async () => {
    const id = await emitirOk();
    assert.equal((await cargosDe(id)).length, 8, '4 departamentos × 2 conceptos');
    const antes = await recibosOct();
    assert.equal(antes.length, 1);
    // Mientras existe, el periodo está ocupado.
    assert.equal((await emitir()).status, 409);

    const r = await anular(T.adminA, id);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.recibo_id, r.body.departamentos, r.body.cargos, r.body.total, r.body.periodo, r.body.torre], [id, 4, 8, '520.00', 'octubre de 2026', 'B.1']);
    assert.equal(await prisma.recibo.count({ where: { id } }), 0);
    assert.equal(await prisma.reciboConcepto.count({ where: { recibo_id: id } }), 0);
    assert.equal(await prisma.reciboConceptoUnidad.count({ where: { reciboConcepto: { recibo_id: id } } }), 0);
    assert.equal((await api(T.adminA, 'GET', `/api/recibos/${id}`)).status, 404);

    const nuevo = await emitir();
    assert.equal(nuevo.status, 201, 'el block y el mes quedan libres');
    assert.notEqual(nuevo.body.id, id);
    assert.equal((await cargosDe(nuevo.body.id)).length, 8);
  });

  it('la deuda de los vecinos y el dashboard ya no cuentan el recibo anulado', async () => {
    const id = await emitirOk();
    // Vence el 2-nov: a esta fecha aún no es morosidad, pero SÍ es por cobrar. Un vecino lo ve en sus cargos.
    const dashAntes = (await api(T.adminA, 'GET', '/api/dashboard/resumen')).body;
    const cargosVecino = async () => (await api(T.vecino1, 'GET', '/api/me/cargos')).body.items.filter((c: { recibo?: { id: number } | null }) => c.recibo?.id === id);
    assert.equal((await cargosVecino()).length, 2, 'el vecino ve su mantenimiento y su agua');
    assert.ok(Number(dashAntes.cargos_pendientes_monto) >= 520, `el dashboard cuenta el recibo: ${dashAntes.cargos_pendientes_monto}`);
    assert.equal((await api(T.adminA, 'POST', `/api/recibos/${id}/anular`, { motivo: 'Lo emití mal', avisar: false })).status, 200);
    assert.equal((await cargosVecino()).length, 0, 'el vecino ya no lo debe');
    const dashDespues = (await api(T.adminA, 'GET', '/api/dashboard/resumen')).body;
    assert.equal(Number(dashAntes.cargos_pendientes_monto) - Number(dashDespues.cargos_pendientes_monto), 520, 'el dashboard resta exactamente el recibo anulado');
    assert.equal(dashDespues.recibos_total, dashAntes.recibos_total - 1, 'y deja de contar el recibo');
  });

  it('queda en la auditoría como anular/recibo, con el motivo y la foto completa (montos por departamento)', async () => {
    const id = await emitirOk();
    const motivo = 'Se emitió con el mes equivocado';
    assert.equal((await anular(T.adminA, id, { motivo, avisar: false })).status, 200);
    const a = await auditoria('anular', id);
    assert.equal(a.entidad, 'recibo');
    assert.equal(a.usuario_id, d.adminA.id);
    const det = a.detalle as { motivo: string; avisar: boolean; total: string; departamentos: number; recibo: { mes: number; anio: number; torre: string }; conceptos: { concepto: string; monto: string }[]; unidades: { codigo: string; total: string; cargos: { concepto: string; monto: string }[] }[] };
    assert.equal(det.motivo, motivo);
    assert.equal(det.avisar, false);
    assert.deepEqual([det.recibo.mes, det.recibo.anio, det.recibo.torre], [10, 2026, 'B.1']);
    assert.deepEqual(det.conceptos.map((c) => [c.concepto, c.monto]), [['Mantenimiento', '100.00'], ['Agua', '30.00']]);
    assert.equal(det.total, '520.00');
    assert.equal(det.departamentos, 4);
    assert.deepEqual(det.unidades.map((u) => [u.codigo, u.total]), CODIGOS.map((c) => [c, '130.00']));
    assert.deepEqual(det.unidades[0]!.cargos.map((c) => [c.concepto, c.monto]), [['Mantenimiento', '100.00'], ['Agua', '30.00']]);
  });

  it('con «avisar» encola recibo_anulado a quien paga cada unidad (con el texto pedido) y no manda nada al grupo; sin «avisar» no encola nada', async () => {
    const id = await emitirOk();
    const unoSinAviso = await anular(T.adminA, id, { motivo: 'Lo emití mal otra vez', avisar: false });
    assert.equal(unoSinAviso.status, 200);
    assert.equal(unoSinAviso.body.avisados, 0);
    assert.equal(await prisma.notificacion.count({ where: { tipo: 'recibo_anulado' } }), 0, 'sin avisar no se encola nada');

    const id2 = await emitirOk();
    const r = await anular(T.adminA, id2, { motivo: 'Lo emití mal otra vez', avisar: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.avisados, 3, 'tres unidades tienen quien pague; C-104 no tiene a nadie');
    const filas = await prisma.notificacion.findMany({ where: { tipo: 'recibo_anulado' }, orderBy: { id: 'asc' }, include: { usuario: true } });
    assert.deepEqual(filas.map((f) => [f.usuario.email, f.canal, f.estado]), [['vecino1@test.pe', 'email', 'pendiente'], ['vecino2@test.pe', 'email', 'pendiente'], ['vecino3@test.pe', 'email', 'pendiente']]);
    assert.match(filas[0]!.asunto, /Se anuló tu recibo de octubre de 2026/);
    assert.match(filas[0]!.cuerpo, /^Hola Vecino,/);
    assert.match(filas[0]!.cuerpo, /Se anuló el recibo de octubre de 2026 de C-101 \(B\.1\)\. Si ya lo viste, ignóralo; te llegará el correcto\./);
    assert.doesNotMatch(filas[0]!.cuerpo, /undefined|NaN|\{|\}/);
    assert.equal(filas.every((f) => f.ref_entidad?.startsWith('anulado:2026-10:')), true);
    // Nada al grupo de WhatsApp: ni envío a grupo, ni aviso por un canal de grupo.
    assert.equal(await prisma.envioGrupoWhatsapp.count(), 0);
    assert.equal(filas.some((f) => f.canal !== 'email'), false);
    const a = await auditoria('anular', id2);
    assert.deepEqual([(a.detalle as { avisar: boolean }).avisar, (a.detalle as { avisos_encolados: number }).avisos_encolados], [true, 3]);
  });

  it('el aviso respeta las preferencias del vecino: con el correo apagado no se le encola', async () => {
    await prisma.usuario.update({ where: { id: unidad.get('C-102')!.usuario! }, data: { aviso_email: false } });
    try {
      const id = await emitirOk();
      const r = await anular(T.adminA, id, { motivo: 'Lo emití mal', avisar: true });
      assert.equal(r.body.avisados, 2);
      assert.deepEqual((await prisma.notificacion.findMany({ where: { tipo: 'recibo_anulado' }, include: { usuario: true } })).map((f) => f.usuario.email).sort(), ['vecino1@test.pe', 'vecino3@test.pe']);
    } finally {
      await prisma.usuario.update({ where: { id: unidad.get('C-102')!.usuario! }, data: { aviso_email: true } });
    }
  });

  it('anular el mismo mes dos veces avisa las dos veces (cada emisión tiene su propia referencia) y los avisos pendientes del recibo anulado no salen', async () => {
    const id1 = await emitirOk();
    const emitidoPendiente = await prisma.notificacion.count({ where: { tipo: 'recibo_emitido', ref_entidad: 'recibo', ref_id: id1, estado: 'pendiente' } });
    assert.ok(emitidoPendiente > 0, 'al emitir se encoló «ya está tu recibo»');
    await anular(T.adminA, id1, { motivo: 'Primera anulación', avisar: true });
    assert.equal(await prisma.notificacion.count({ where: { tipo: 'recibo_emitido', ref_id: id1, estado: 'pendiente' } }), 0, '«ya está tu recibo» del recibo anulado ya no sale');
    assert.equal((await prisma.notificacion.findFirstOrThrow({ where: { tipo: 'recibo_emitido', ref_id: id1 } })).estado, 'omitida');
    const id2 = await emitirOk();
    await anular(T.adminA, id2, { motivo: 'Segunda anulación', avisar: true });
    assert.equal(await prisma.notificacion.count({ where: { tipo: 'recibo_anulado' } }), 6);
  });

  it('la mora que la emisión agregó se va con el recibo y al emitir de nuevo no se duplica', async () => {
    // Setiembre vencido sin pagar: C-101 y C-102 deben (a C-103 se le pagó a tiempo; C-104 no tiene cargo).
    const set = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, estructura_id: torre.id, mes: 9, anio: 2026, fecha_emision: new Date('2026-09-15T00:00:00Z'), fecha_vencimiento: VENCE_SET, estado: 'emitido' } });
    const rcSet = await prisma.reciboConcepto.create({ data: { recibo_id: set.id, concepto_id: d.conceptoA.id, monto: 0, orden: 1 } });
    for (const c of ['C-101', 'C-102']) await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rcSet.id, unidad_id: unidad.get(c)!.id, monto: 100, estado_pago: 'pendiente' } });
    const moraDe = async (reciboId: number) => (await cargosDe(reciboId)).filter((c) => c.reciboConcepto?.concepto?.nombre === CONCEPTO_MORA);

    const id1 = await emitirOk();
    assert.deepEqual((await moraDe(id1)).map((c) => c.unidad?.codigo).sort(), ['C-101', 'C-102'], 'la emisión agregó la mora');
    assert.equal(await anular(T.adminA, id1).then((r) => r.status), 200);
    assert.equal(await prisma.reciboConceptoUnidad.count({ where: { reciboConcepto: { concepto: { nombre: CONCEPTO_MORA } } } }), 0, 'la mora se fue con su recibo');
    assert.equal(await prisma.reciboConcepto.count({ where: { recibo_id: id1 } }), 0);
    const det = (await auditoria('anular', id1)).detalle as { conceptos: { concepto: string }[]; unidades: { codigo: string; cargos: { concepto: string; monto: string }[] }[] };
    assert.ok(det.conceptos.some((c) => c.concepto === CONCEPTO_MORA), 'la foto trae la mora');
    assert.deepEqual(det.unidades.find((u) => u.codigo === 'C-101')!.cargos.find((c) => c.concepto === CONCEPTO_MORA)!.monto, '20.00');

    const id2 = await emitirOk();
    assert.deepEqual((await moraDe(id2)).map((c) => [c.unidad?.codigo, c.monto.toString()]).sort(), [['C-101', '20'], ['C-102', '20']], 'una sola mora por departamento, no dos');
  });

  it('las lecturas de agua del recibo se van con él (quedan en la auditoría) y el recibo nuevo empieza sin lecturas', async () => {
    const id = await emitirOk();
    await prisma.lecturaAgua.create({ data: { unidad_id: unidad.get('C-101')!.id, recibo_id: id, fecha_anterior: new Date('2026-09-01'), lectura_anterior: 100.5, fecha_actual: new Date('2026-10-01'), lectura_actual: 112.25, factor: 2.5, foto_nombre: 'foto.jpg', foto_tipo_mime: 'image/jpeg', foto_datos: Buffer.from('x') } });
    const resumen = await api(T.adminA, 'GET', `/api/recibos/${id}/anulacion`);
    assert.equal(resumen.body.lecturas_agua, 1);
    assert.equal((await anular(T.adminA, id)).status, 200);
    assert.equal(await prisma.lecturaAgua.count({ where: { recibo_id: id } }), 0, 'ninguna lectura queda huérfana');
    const det = (await auditoria('anular', id)).detalle as { lecturas_agua: { codigo: string; lectura_actual: string; con_foto: boolean }[] };
    assert.deepEqual(det.lecturas_agua.map((l) => [l.codigo, l.lectura_actual, l.con_foto]), [['C-101', '112.250', true]]);
    const id2 = await emitirOk();
    assert.equal(await prisma.lecturaAgua.count({ where: { recibo_id: id2 } }), 0);
    assert.equal(JSON.stringify(det).includes('foto_datos'), false, 'los bytes de la foto no van a la auditoría');
  });

  describe('con pagos', () => {
    it('un pago validado o por validar lo impide (409) y no se toca nada', async () => {
      for (const estado of ['validado', 'por_validar']) {
        await limpiar();
        const id = await emitirOk();
        await pago((await cargoDe(id, 'C-101')).id, estado);
        const r = await anular(T.adminA, id);
        assert.equal(r.status, 409, `${estado}: ${JSON.stringify(r.body)}`);
        assert.equal(r.body.error, MENSAJE_RECIBO_CON_PAGOS);
        assert.equal(r.body.error, 'Este recibo tiene pagos: anúlalos o recházalos antes');
        assert.equal(await prisma.recibo.count({ where: { id } }), 1);
        assert.equal((await cargosDe(id)).length, 8);
        assert.equal(await prisma.pago.count({ where: { estado_validacion: estado } }), 1, 'el pago sigue ahí');
        assert.equal((await api(T.adminA, 'GET', `/api/recibos/${id}/anulacion`)).body.puede, false);
        assert.equal(await prisma.auditoria.count({ where: { accion: 'anular', entidad_id: id } }), 0);
      }
    });

    it('un cargo marcado pagado o en revisión (sin fila de pago, dato antiguo) también lo impide', async () => {
      for (const estado_pago of ['pagado', 'en_revision']) {
        await limpiar();
        const id = await emitirOk();
        await prisma.reciboConceptoUnidad.update({ where: { id: (await cargoDe(id, 'C-102')).id }, data: { estado_pago } });
        const r = await anular(T.adminA, id);
        assert.equal(r.status, 409, estado_pago);
        assert.equal(await prisma.recibo.count({ where: { id } }), 1);
      }
    });

    it('el aviso previo dice cuántos cargos tienen pagos y por qué no se puede', async () => {
      const id = await emitirOk();
      const libre = (await api(T.adminA, 'GET', `/api/recibos/${id}/anulacion`)).body;
      assert.deepEqual([libre.puede, libre.bloqueo, libre.departamentos, libre.cargos, libre.total, libre.cargos_con_pagos, libre.pagos_rechazados, libre.periodo, libre.torre], [true, null, 4, 8, '520.00', 0, 0, 'octubre de 2026', 'B.1']);
      await pago((await cargoDe(id, 'C-101')).id, 'validado');
      await pago((await cargoDe(id, 'C-102')).id, 'rechazado');
      const r = (await api(T.adminA, 'GET', `/api/recibos/${id}/anulacion`)).body;
      assert.deepEqual([r.puede, r.bloqueo, r.cargos_con_pagos, r.pagos_rechazados], [false, MENSAJE_RECIBO_CON_PAGOS, 1, 1]);
    });

    it('con sólo pagos rechazados se puede anular: el pago se va con el cargo pero su historial queda completo en la auditoría', async () => {
      const id = await emitirOk();
      const cargo = await cargoDe(id, 'C-102');
      const p = await pago(cargo.id, 'rechazado', 100, { motivo_rechazo: 'El voucher es de otro monto', observaciones: 'Pagó por Yape', validado_por_id: d.adminA.id, validado_at: new Date('2026-10-21T15:00:00Z') });
      await prisma.archivoComprobante.create({ data: { pago_id: p.id, nombre: 'voucher.png', tipo_mime: 'image/png', tamano: 4, sha256: 'a'.repeat(64), datos: Buffer.from('secreto'), subido_por_id: null } });
      const r = await anular(T.adminA, id);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(await prisma.pago.count({ where: { id: p.id } }), 0, 'no queda un pago sin cargo');
      assert.equal(await prisma.archivoComprobante.count({ where: { pago_id: p.id } }), 0);
      assert.equal(await prisma.recibo.count({ where: { id } }), 0);
      const det = (await auditoria('anular', id)).detalle as { pagos_retirados: { id: number; codigo: string; concepto: string; monto: string; estado: string; motivo_rechazo: string; metodo_pago: string; referencia: string; comprobante: { nombre: string; sha256: string; tamano: number } }[] };
      assert.equal(det.pagos_retirados.length, 1);
      const x = det.pagos_retirados[0]!;
      assert.deepEqual([x.id, x.codigo, x.concepto, x.monto, x.estado, x.motivo_rechazo, x.metodo_pago, x.referencia], [p.id, 'C-102', 'Mantenimiento', '100.00', 'rechazado', 'El voucher es de otro monto', 'yape', 'ref-rechazado']);
      assert.deepEqual([x.comprobante.nombre, x.comprobante.sha256, x.comprobante.tamano], ['voucher.png', 'a'.repeat(64), 4]);
      assert.equal(JSON.stringify(det).includes('secreto'), false, 'el contenido del comprobante no va a la auditoría');
      assert.equal((await emitir()).status, 201);
    });

    it('un pago «anulado» (estado que traerá «Anular pago») no cuenta como pago vigente: la lista es positiva', async () => {
      const id = await emitirOk();
      await pago((await cargoDe(id, 'C-101')).id, 'anulado');
      const r = await anular(T.adminA, id);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(await prisma.pago.count({ where: { estado_validacion: 'anulado' } }), 0);
      const det = (await auditoria('anular', id)).detalle as { pagos_retirados: { estado: string }[] };
      assert.deepEqual(det.pagos_retirados.map((p) => p.estado), ['anulado']);
    });
  });

  describe('permisos y validación', () => {
    it('la junta (tesorero) y el propietario no pueden anular (403) ni ver la vista previa; sin sesión, 401', async () => {
      const id = await emitirOk();
      for (const t of [T.tesorero, T.prop1, T.vecino1]) {
        assert.equal((await anular(t, id)).status, 403);
        assert.equal((await api(t, 'GET', `/api/recibos/${id}/anulacion`)).status, 403);
      }
      assert.equal((await anular(null, id)).status, 401);
      assert.equal(await prisma.recibo.count({ where: { id } }), 1);
    });

    it('un recibo de otra empresa es 404 (anular y vista previa), y no se toca', async () => {
      const id = await emitirOk();
      assert.equal((await anular(T.adminB, id)).status, 404);
      assert.equal((await api(T.adminB, 'GET', `/api/recibos/${id}/anulacion`)).status, 404);
      assert.equal(await prisma.recibo.count({ where: { id } }), 1);
      assert.equal((await anular(T.adminA, 999_999)).status, 404);
    });

    it('sin motivo, con motivo corto o largo, o con «avisar» que no es verdadero/falso: 422 y no se anula', async () => {
      const id = await emitirOk();
      for (const cuerpo of [{ avisar: false }, { motivo: '', avisar: false }, { motivo: 'abc', avisar: false }, { motivo: '   ', avisar: false }, { motivo: 'x'.repeat(201), avisar: false }, { motivo: 'Motivo válido', avisar: 'si' }, { motivo: 'Motivo válido', otro: 1 }]) {
        const r = await anular(T.adminA, id, cuerpo);
        assert.equal(r.status, 422, JSON.stringify(cuerpo));
      }
      assert.equal(await prisma.recibo.count({ where: { id } }), 1);
      assert.equal(await prisma.auditoria.count({ where: { accion: 'anular', entidad_id: id } }), 0);
    });

    it('el superadmin (entrando como administración) también puede anular', async () => {
      const id = await emitirOk();
      assert.equal((await anular(T.super, id)).status, 200);
      assert.equal(await prisma.recibo.count({ where: { id } }), 0);
    });

    it('un condominio en solo lectura no deja anular (409 SOLO_LECTURA) y no se toca nada', async () => {
      const id = await emitirOk();
      await prisma.suscripcionCondominio.upsert({
        where: { complejo_id: d.complejoA.id },
        create: { complejo_id: d.complejoA.id, plan_clave: 'gratis', estado: 'gratis', gratis_hasta: new Date(Date.now() - 86_400_000) },
        update: { plan_clave: 'gratis', modulos: [], estado: 'gratis', es_prueba: false, vigente_hasta: null, solicitud_plan: null, solicitud_modulos: [], gratis_hasta: new Date(Date.now() - 86_400_000) },
      });
      invalidarComercial();
      try {
        const r = await anular(T.adminA, id);
        assert.equal(r.status, 409);
        assert.deepEqual([r.body.error, r.body.code], [MENSAJE_SOLO_LECTURA, 'SOLO_LECTURA']);
        assert.equal(await prisma.recibo.count({ where: { id } }), 1);
      } finally {
        await prisma.suscripcionCondominio.update({ where: { complejo_id: d.complejoA.id }, data: { plan_clave: 'cortesia', modulos: ['ia_vouchers', 'whatsapp_avisos', 'asistente'], estado: 'activa', gratis_hasta: null } });
        invalidarComercial();
      }
    });
  });
});

// =====================================================================================================
describe('Corregir el cargo de un departamento', () => {
  it('baja el monto: el cargo y el total del recibo cuadran, queda en la auditoría con el monto anterior, el nuevo y el motivo', async () => {
    const id = await emitirOk();
    const cargo = await cargoDe(id, 'C-101');
    const antes = (await api(T.adminA, 'GET', `/api/recibos/${id}`)).body;
    assert.equal(antes.totales.monto, '520.00');
    const motivo = 'Se le cobró de más: su depa es más pequeño';
    const r = await corregir(T.adminA, cargo.id, { monto: '80.50', motivo });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.monto_anterior, r.body.monto_nuevo, r.body.codigo, r.body.concepto, r.body.estado], ['100.00', '80.50', 'C-101', 'Mantenimiento', 'pendiente']);
    assert.equal((await prisma.reciboConceptoUnidad.findUniqueOrThrow({ where: { id: cargo.id } })).monto.toString(), '80.5');
    const despues = (await api(T.adminA, 'GET', `/api/recibos/${id}`)).body;
    assert.equal(despues.totales.monto, '500.50', 'el total del recibo se suma de sus cargos');
    assert.equal(despues.totales.pendiente, '500.50');
    assert.equal(despues.cargos.find((c: { id: number }) => c.id === cargo.id).monto, '80.5');
    const a = await auditoria('corregir_cargo', cargo.id);
    assert.equal(a.entidad, 'cargo');
    assert.equal(a.usuario_id, d.adminA.id);
    const det = a.detalle as Record<string, unknown>;
    assert.deepEqual([det.monto_anterior, det.monto_nuevo, det.motivo, det.codigo, det.recibo_id], ['100.00', '80.50', motivo, 'C-101', id]);
  });

  it('el estado del cargo cuadra con sus pagos: si lo pagado ya cubre el monto nuevo, queda pagado; si se sube sobre lo pagado, vuelve a pendiente', async () => {
    const id = await emitirOkConPagoValidado();
    async function emitirOkConPagoValidado() {
      const x = await emitirOk();
      await pago((await cargoDe(x, 'C-101')).id, 'validado', 80);
      return x;
    }
    const cargo = await cargoDe(id, 'C-101');
    const r = await corregir(T.adminA, cargo.id, { monto: 80, motivo: 'Ajuste por convenio' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.estado, 'pagado');
    assert.equal((await prisma.reciboConceptoUnidad.findUniqueOrThrow({ where: { id: cargo.id } })).estado_pago, 'pagado');
    const sube = await corregir(T.adminA, cargo.id, { monto: 120, motivo: 'Me equivoqué al bajarlo' });
    assert.equal(sube.status, 200);
    assert.equal(sube.body.estado, 'pendiente');
    assert.equal((await prisma.reciboConceptoUnidad.findUniqueOrThrow({ where: { id: cargo.id } })).estado_pago, 'pendiente');
  });

  it('un pago por validar mantiene el cargo en revisión al corregirlo', async () => {
    const id = await emitirOk();
    const cargo = await cargoDe(id, 'C-102');
    await pago(cargo.id, 'por_validar', 60);
    await prisma.reciboConceptoUnidad.update({ where: { id: cargo.id }, data: { estado_pago: 'en_revision' } });
    const r = await corregir(T.adminA, cargo.id, { monto: 90, motivo: 'Ajuste acordado' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.estado, 'en_revision');
  });

  it('el monto no puede quedar por debajo de lo ya pagado vigente (validado o por validar): 409 y el monto no cambia; un pago rechazado no cuenta', async () => {
    const id = await emitirOk();
    const cargo = await cargoDe(id, 'C-101');
    await pago(cargo.id, 'validado', 50);
    await pago(cargo.id, 'por_validar', 20);
    for (const monto of ['69.99', '10', '0.01']) {
      const r = await corregir(T.adminA, cargo.id, { monto, motivo: 'Probando' });
      assert.equal(r.status, 409, monto);
      assert.match(r.body.error, /El monto no puede ser menor a lo ya pagado \(S\/ 70\.00\)/);
    }
    assert.equal((await prisma.reciboConceptoUnidad.findUniqueOrThrow({ where: { id: cargo.id } })).monto.toString(), '100');
    assert.equal((await corregir(T.adminA, cargo.id, { monto: '70', motivo: 'Justo lo pagado' })).status, 200, 'igual a lo pagado sí');
    // Un rechazado no cuenta como pagado.
    const otro = await cargoDe(id, 'C-102');
    await pago(otro.id, 'rechazado', 100);
    assert.equal((await corregir(T.adminA, otro.id, { monto: '10', motivo: 'Descuento total' })).status, 200);
    // Un pago anulado tampoco.
    const tercero = await cargoDe(id, 'C-103');
    await pago(tercero.id, 'anulado', 100);
    assert.equal((await corregir(T.adminA, tercero.id, { monto: '10', motivo: 'Descuento' })).status, 200);
  });

  it('exige motivo, monto válido y distinto; la junta y el propietario son 403; otra empresa 404; sin sesión 401', async () => {
    const id = await emitirOk();
    const cargo = await cargoDe(id, 'C-101');
    for (const cuerpo of [{ monto: 50 }, { monto: 50, motivo: 'abc' }, { monto: 0, motivo: 'Motivo válido' }, { monto: -5, motivo: 'Motivo válido' }, { monto: 'abc', motivo: 'Motivo válido' }, { monto: 50.123, motivo: 'Motivo válido' }, { motivo: 'Motivo válido' }, { monto: 50, motivo: 'Motivo válido', extra: 1 }, { monto: 100, motivo: 'Mismo monto' }]) {
      assert.equal((await corregir(T.adminA, cargo.id, cuerpo)).status, 422, JSON.stringify(cuerpo));
    }
    for (const t of [T.tesorero, T.prop1, T.vecino1]) assert.equal((await corregir(t, cargo.id, { monto: 50, motivo: 'Motivo válido' })).status, 403);
    assert.equal((await corregir(T.adminB, cargo.id, { monto: 50, motivo: 'Motivo válido' })).status, 404);
    assert.equal((await corregir(T.adminA, 999_999, { monto: 50, motivo: 'Motivo válido' })).status, 404);
    assert.equal((await corregir(null, cargo.id, { monto: 50, motivo: 'Motivo válido' })).status, 401);
    assert.equal((await prisma.reciboConceptoUnidad.findUniqueOrThrow({ where: { id: cargo.id } })).monto.toString(), '100');
    assert.equal(await prisma.auditoria.count({ where: { accion: 'corregir_cargo', entidad_id: cargo.id } }), 0);
  });
});

describe('Quitar el cargo de un departamento', () => {
  it('sin pagos: el cargo se va, el vecino ya no lo debe y el total del recibo baja; queda en la auditoría con el monto anterior y el motivo', async () => {
    const id = await emitirOk();
    const cargo = await cargoDe(id, 'C-101', 'Agua');
    const vecino = async () => (await api(T.vecino1, 'GET', '/api/me/cargos')).body.items.filter((c: { recibo?: { id: number } | null }) => c.recibo?.id === id);
    assert.equal((await vecino()).length, 2);
    const motivo = 'El agua se cobró en el recibo anterior';
    const r = await quitar(T.adminA, cargo.id, { motivo });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.monto_anterior, r.body.monto_nuevo, r.body.codigo, r.body.concepto], ['30.00', null, 'C-101', 'Agua']);
    assert.equal(await prisma.reciboConceptoUnidad.count({ where: { id: cargo.id } }), 0);
    const v = await vecino();
    assert.deepEqual(v.map((c: { concepto: { nombre: string } }) => c.concepto.nombre), ['Mantenimiento'], 'el vecino ya no debe el agua');
    assert.equal((await api(T.adminA, 'GET', `/api/recibos/${id}`)).body.totales.monto, '490.00');
    const a = await auditoria('quitar_cargo', cargo.id);
    const det = a.detalle as Record<string, unknown>;
    assert.deepEqual([a.entidad, a.usuario_id, det.monto_anterior, det.motivo, det.codigo, det.recibo_id], ['cargo', d.adminA.id, '30.00', motivo, 'C-101', id]);
  });

  it('con un pago validado o por validar, o ya pagado/en revisión: 409 y no se toca', async () => {
    const id = await emitirOk();
    const casos: [string, () => Promise<number>][] = [
      ['validado', async () => { const c = await cargoDe(id, 'C-101'); await pago(c.id, 'validado'); return c.id; }],
      ['por_validar', async () => { const c = await cargoDe(id, 'C-102'); await pago(c.id, 'por_validar'); return c.id; }],
      ['pagado sin pago', async () => { const c = await cargoDe(id, 'C-103'); await prisma.reciboConceptoUnidad.update({ where: { id: c.id }, data: { estado_pago: 'pagado' } }); return c.id; }],
    ];
    for (const [nombre, preparar] of casos) {
      const cargoId = await preparar();
      const r = await quitar(T.adminA, cargoId);
      assert.equal(r.status, 409, nombre);
      assert.equal(r.body.error, MENSAJE_CARGO_CON_PAGOS);
      assert.equal(await prisma.reciboConceptoUnidad.count({ where: { id: cargoId } }), 1, nombre);
    }
  });

  it('con sólo pagos rechazados se puede: el cargo y su pago se van y el detalle del pago queda en la auditoría', async () => {
    const id = await emitirOk();
    const cargo = await cargoDe(id, 'C-101');
    const p = await pago(cargo.id, 'rechazado', 100, { motivo_rechazo: 'Voucher ilegible' });
    const r = await quitar(T.adminA, cargo.id, { motivo: 'Cobro duplicado' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await prisma.pago.count({ where: { id: p.id } }), 0);
    const det = (await auditoria('quitar_cargo', cargo.id)).detalle as { pagos_retirados: { id: number; estado: string; motivo_rechazo: string; monto: string; codigo: string }[] };
    assert.deepEqual(det.pagos_retirados.map((x) => [x.id, x.estado, x.motivo_rechazo, x.monto, x.codigo]), [[p.id, 'rechazado', 'Voucher ilegible', '100.00', 'C-101']]);
  });

  it('exige motivo; la junta y el propietario son 403; otra empresa 404', async () => {
    const id = await emitirOk();
    const cargo = await cargoDe(id, 'C-101');
    for (const cuerpo of [{}, { motivo: 'abc' }, { motivo: 'Motivo válido', monto: 5 }]) assert.equal((await quitar(T.adminA, cargo.id, cuerpo)).status, 422, JSON.stringify(cuerpo));
    for (const t of [T.tesorero, T.prop1, T.vecino1]) assert.equal((await quitar(t, cargo.id)).status, 403);
    assert.equal((await quitar(T.adminB, cargo.id)).status, 404);
    assert.equal(await prisma.reciboConceptoUnidad.count({ where: { id: cargo.id } }), 1);
  });
});

describe('el aviso «recibo anulado»', () => {
  it('es un tipo del catálogo con texto en tuteo, sin montos ni enlaces rotos', async () => {
    const { plantilla, TIPOS } = await import('../src/server/services/avisos/plantillas');
    assert.ok(TIPOS.includes('recibo_anulado'));
    const { asunto, cuerpo } = plantilla('recibo_anulado', { nombre: 'María Elena Quispe', periodo: 'octubre de 2026', monto: '', vencimiento: '', departamentos: [{ codigo: 'B01-804', torre: 'Block 1' }] });
    assert.equal(asunto, 'Se anuló tu recibo de octubre de 2026');
    assert.match(cuerpo, /^Hola María,/);
    assert.match(cuerpo, /Se anuló el recibo de octubre de 2026 de B01-804 \(Block 1\)\. Si ya lo viste, ignóralo; te llegará el correcto\./);
    assert.doesNotMatch(cuerpo, /Quispe|undefined|NaN|\{|\}/);
  });
});
