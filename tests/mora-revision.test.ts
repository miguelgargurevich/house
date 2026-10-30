// Revisión de morosos antes de emitir (vista = emisión), «Quitar la multa» y el aviso «según el voucher pagó a tiempo».
// Reloj inyectado (`moraDeps.ahora`) y sin red: ninguna IA se llama aquí.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import XLSX from 'xlsx';
import { cabecerasDeSesion, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { CONCEPTO_MORA, moraDeps } from '../src/server/services/mora';
import { invalidarComercial } from '../src/server/services/comercial/modulos';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1' | 'junta', string>;
let torre1: { id: number };
const relojOriginal = { ...moraDeps };

const VENCE_SET = new Date('2026-10-02T00:00:00Z'); // el recibo de setiembre vence el 2-oct

/**
 * Departamentos de la torre B.1 con su pago del recibo de setiembre (cargo de S/ 100).
 * `tarde` = lo que decide `evaluarMora`; `revisar` = la marca de la vista (fecha no leída del voucher o pago aún por validar).
 */
interface Esc { pago: { fecha: string; origen: string; estado?: string } | null; sinCargo?: boolean; estado: 'a_tiempo' | 'tarde' | 'sin_deuda'; revisar: boolean }
const ESC: Record<string, Esc> = {
  'B.1-101': { pago: { fecha: '2026-10-01T15:00:00Z', origen: 'voucher' }, estado: 'a_tiempo', revisar: false },
  'B.1-102': { pago: { fecha: '2026-10-03T15:00:00Z', origen: 'voucher' }, estado: 'tarde', revisar: false },
  'B.1-103': { pago: { fecha: '2026-10-01T15:00:00Z', origen: 'voucher', estado: 'por_validar' }, estado: 'a_tiempo', revisar: true },
  'B.1-104': { pago: { fecha: '2026-10-01T15:00:00Z', origen: 'declarada' }, estado: 'a_tiempo', revisar: true },
  'B.1-105': { pago: null, estado: 'tarde', revisar: false },
  'B.1-106': { pago: { fecha: '2026-10-05T15:00:00Z', origen: 'no_leida' }, estado: 'tarde', revisar: true },
  'B.1-107': { pago: { fecha: '2026-10-01T15:00:00Z', origen: 'invalida' }, estado: 'a_tiempo', revisar: true },
  'B.1-108': { pago: { fecha: '2026-10-01T15:00:00Z', origen: 'voucher', estado: 'rechazado' }, estado: 'tarde', revisar: false },
  'B.1-109': { pago: null, sinCargo: true, estado: 'sin_deuda', revisar: false },
  'B.1-110': { pago: { fecha: '2026-10-01T15:00:00Z', origen: 'manual' }, estado: 'a_tiempo', revisar: false },
};
const CODIGOS = Object.keys(ESC);
const TARDE = CODIGOS.filter((c) => ESC[c]!.estado === 'tarde').sort();
const unidades = new Map<string, number>();
const pagos = new Map<string, number>();
const dpto = (codigo: string) => unidades.get(codigo)!;

const URL_VISTA = (extra = '') => `/api/recibos/vista-mora?complejo_id=${d.complejoA.id}&estructura_id=${torre1.id}&mes=10&anio=2026${extra}`;
const emitirOctubre = (estructura_id = torre1.id, token = T.adminA) => llamar(base, 'POST', '/api/recibos', token, {
  complejo_id: d.complejoA.id, estructura_id, mes: 10, anio: 2026, fecha_emision: '2026-10-20', fecha_vencimiento: '2026-11-02', conceptos: [{ concepto_id: d.conceptoA.id, monto: 100 }],
});
const limpiarOctubre = async () => {
  await prisma.auditoria.deleteMany({ where: { accion: { in: ['quitar_multa'] } } });
  await prisma.pago.deleteMany({ where: { reciboConceptoUnidad: { reciboConcepto: { recibo: { mes: 10, anio: 2026 } } } } });
  await prisma.reciboConceptoUnidad.deleteMany({ where: { reciboConcepto: { recibo: { mes: 10, anio: 2026 } } } });
  await prisma.reciboConcepto.deleteMany({ where: { recibo: { mes: 10, anio: 2026, complejo_id: d.complejoA.id } } });
  await prisma.recibo.deleteMany({ where: { mes: 10, anio: 2026, complejo_id: d.complejoA.id } });
  await prisma.concepto.deleteMany({ where: { nombre: CONCEPTO_MORA } });
};
const cargosMora = (codigo: string) => prisma.reciboConceptoUnidad.findMany({ where: { unidad: { codigo }, reciboConcepto: { recibo: { mes: 10, anio: 2026 }, concepto: { nombre: CONCEPTO_MORA } } }, include: { reciboConcepto: true } });
const reciboOct = () => prisma.recibo.findFirstOrThrow({ where: { complejo_id: d.complejoA.id, estructura_id: torre1.id, mes: 10, anio: 2026 } });

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, ai: 100_000, llavero: 100_000, evaluacion: 100_000 } }));
  const hash = await bcrypt.hash(PASSWORD, 4);
  torre1 = await prisma.estructura.create({ data: { nombre: 'B.1', tipo: 'block', complejo_id: d.complejoA.id } });
  const torre2 = await prisma.estructura.create({ data: { nombre: 'B.2', tipo: 'block', complejo_id: d.complejoA.id } });
  await prisma.unidad.create({ data: { codigo: 'B.2-101', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: torre2.id, estado: 'activa' } });
  await prisma.usuario.create({ data: { nombre: 'Presidente B.1', email: 'junta@test.pe', rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, cargo_junta: 'presidente', estructura_id: torre1.id } });
  T = {
    super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'),
    prop1: await login(base, 'prop1@test.pe'), junta: await login(base, 'junta@test.pe'),
  };
  for (const c of CODIGOS) unidades.set(c, (await prisma.unidad.create({ data: { codigo: c, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: torre1.id, estado: 'activa' } })).id);
  const set = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, estructura_id: torre1.id, mes: 9, anio: 2026, fecha_emision: new Date('2026-09-15T00:00:00Z'), fecha_vencimiento: VENCE_SET, estado: 'emitido' } });
  const rc = await prisma.reciboConcepto.create({ data: { recibo_id: set.id, concepto_id: d.conceptoA.id, monto: 0, orden: 1 } });
  for (const [codigo, e] of Object.entries(ESC)) {
    if (e.sinCargo) continue;
    const cargo = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: dpto(codigo), monto: 100, estado_pago: 'pendiente' } });
    if (!e.pago) continue;
    const p = await prisma.pago.create({ data: { recibo_concepto_unidad_id: cargo.id, monto: 100, fecha_pago: new Date(e.pago.fecha), fecha_origen: e.pago.origen, estado_validacion: e.pago.estado ?? 'validado', metodo_pago: 'yape' } });
    pagos.set(codigo, p.id);
  }
});
after(async () => {
  Object.assign(moraDeps, relojOriginal);
  await cerrar();
  await prisma.$disconnect();
});
/** Deja los pagos de setiembre como los sembró `before` (los tests de abajo los mueven). */
const restaurarSetiembre = async () => {
  for (const [codigo, id] of pagos) {
    const p = ESC[codigo]!.pago!;
    await prisma.archivoComprobante.deleteMany({ where: { pago_id: id } });
    await prisma.pago.update({ where: { id }, data: { fecha_pago: new Date(p.fecha), fecha_origen: p.origen, estado_validacion: p.estado ?? 'validado', validado_at: null } });
  }
};
beforeEach(async () => {
  await limpiarOctubre();
  await restaurarSetiembre();
  moraDeps.ahora = () => new Date('2026-10-20T15:00:00Z'); // el recibo de setiembre ya venció
  await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { mora_monto: 20 } });
});
afterEach(() => { Object.assign(moraDeps, relojOriginal); });

// =====================================================================================================
describe('GET /api/recibos/vista-mora: revisar morosos antes de emitir', () => {
  it('dice por departamento si pagó a tiempo, tarde o no tiene deuda, con la fecha, su origen y el estado de cada pago', async () => {
    const r = await llamar(base, 'GET', URL_VISTA(), T.adminA);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.aplica, true);
    assert.equal(r.body.monto, '20.00');
    assert.equal(r.body.torres.length, 1);
    const t = r.body.torres[0];
    assert.equal(t.torre, 'B.1');
    assert.deepEqual([t.anterior.mes, t.anterior.anio], [9, 2026]);
    assert.equal(t.aun_no_vence, false);
    for (const [codigo, e] of Object.entries(ESC)) {
      const u = t.unidades.find((x: { codigo: string }) => x.codigo === codigo);
      assert.ok(u, `${codigo} aparece`);
      assert.equal(u.estado, e.estado, `${codigo}: estado`);
      assert.equal(u.revisar, e.revisar, `${codigo}: revisar`);
      const vistos = u.pagos.map((p: { fecha_pago: string; fecha_origen: string; estado_validacion: string }) => [p.fecha_pago, p.fecha_origen, p.estado_validacion]);
      if (e.pago && e.pago.estado !== 'rechazado') assert.deepEqual(vistos, [[new Date(e.pago.fecha).toISOString(), e.pago.origen, e.pago.estado ?? 'validado']], `${codigo}: pagos`);
      else assert.deepEqual(vistos, [], `${codigo}: sin pagos que contar`);
      if (e.pago && e.pago.estado !== 'rechazado') {
        assert.equal(u.pagos[0].id, pagos.get(codigo));
        assert.equal(u.pagos[0].dia, e.pago.fecha.slice(0, 10), `${codigo}: el día del condominio (Lima)`);
      }
    }
    assert.deepEqual(r.body.resumen, { a_tiempo: 5, tarde: TARDE.length, sin_deuda: 1, revisar: 4 });
  });

  it('la vista y la emisión no pueden diferir: los que la vista marca «tarde» son exactamente los que reciben la multa al emitir', async () => {
    const vista = await llamar(base, 'GET', URL_VISTA(), T.adminA);
    const tardeVista = vista.body.torres[0].unidades.filter((u: { estado: string }) => u.estado === 'tarde').map((u: { codigo: string }) => u.codigo).sort();
    const r = await emitirOctubre();
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const conMulta = (await prisma.reciboConceptoUnidad.findMany({ where: { reciboConcepto: { recibo: { mes: 10, anio: 2026 }, concepto: { nombre: CONCEPTO_MORA } } }, include: { unidad: true } })).map((c) => c.unidad!.codigo).sort();
    assert.deepEqual(conMulta, tardeVista);
    assert.deepEqual(conMulta, TARDE);
    assert.deepEqual(r.body.mora.departamentos.map((x: { codigo: string }) => x.codigo).sort(), tardeVista);
  });

  it('también coincide con la emisión por Excel (el Excel evalúa con el mismo cálculo)', async () => {
    const filas = [
      [null, 'GRUPO PRUEBA'],
      [null, null, null, 'MES: Octubre 2026', null, null, 'VENCIMIENTO:', null, '02 DE NOVIEMBRE DE 2026'],
      ['BLOCK', 'Dpto.', 'Apellidos y Nombres', 'ADMINISTRACION', 'TOTAL MANT'],
      // El Excel NO trae B.1-105 (tarde): ni la vista ni la emisión por Excel la evalúan.
      ...CODIGOS.filter((c) => c !== 'B.1-105').map((c) => ['B.1', Number(c.split('-')[1]), `VECINO ${c}`, 100, 100]),
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Consolidado');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const f = new FormData();
    f.append('complejo_id', String(d.complejoA.id));
    f.append('archivo', new Blob([new Uint8Array(buffer)]), 'recibos.xlsx');
    // La vista del Excel: mismo archivo, sin crear nada.
    const vistaX = await fetch(`${base}/api/recibos/excel/vista-mora`, { method: 'POST', headers: cabecerasDeSesion(T.adminA), body: f });
    const cuerpo = (await vistaX.json()) as { mes: number; anio: number; torres: { unidades: { codigo: string; estado: string }[] }[] };
    assert.equal(vistaX.status, 200, JSON.stringify(cuerpo));
    assert.deepEqual([cuerpo.mes, cuerpo.anio], [10, 2026]);
    assert.equal(await prisma.recibo.count({ where: { mes: 10, anio: 2026 } }), 0, 'la vista no crea el recibo');
    const tardeVista = cuerpo.torres[0]!.unidades.filter((u) => u.estado === 'tarde').map((u) => u.codigo).sort();
    const f2 = new FormData();
    f2.append('complejo_id', String(d.complejoA.id));
    f2.append('archivo', new Blob([new Uint8Array(buffer)]), 'recibos.xlsx');
    const emitido = await fetch(`${base}/api/recibos/excel`, { method: 'POST', headers: cabecerasDeSesion(T.adminA), body: f2 });
    assert.equal(emitido.status, 201);
    const conMulta = (await prisma.reciboConceptoUnidad.findMany({ where: { reciboConcepto: { recibo: { mes: 10, anio: 2026 }, concepto: { nombre: CONCEPTO_MORA } } }, include: { unidad: true } })).map((c) => c.unidad!.codigo).sort();
    assert.deepEqual(conMulta, tardeVista);
    assert.deepEqual(conMulta, TARDE.filter((c) => c !== 'B.1-105'));
    assert.ok(!cuerpo.torres[0]!.unidades.some((u) => u.codigo === 'B.1-105'), 'la vista sólo trae las unidades del archivo');
  });

  it('un pago del mantenimiento (un Pago por cargo con el mismo grupo) sale como UN pago, con el id del principal y el monto total', async () => {
    const un = await prisma.unidad.create({ data: { codigo: 'B.1-111', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: torre1.id, estado: 'activa' } });
    const set = await prisma.recibo.findFirstOrThrow({ where: { mes: 9, anio: 2026, estructura_id: torre1.id } });
    const rc2 = await prisma.reciboConcepto.create({ data: { recibo_id: set.id, concepto_id: d.conceptoA.id, monto: 0, orden: 2 } });
    const rc1 = await prisma.reciboConcepto.findFirstOrThrow({ where: { recibo_id: set.id, orden: 1 } });
    const c1 = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc1.id, unidad_id: un.id, monto: 60, estado_pago: 'pagado' } });
    const c2 = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc2.id, unidad_id: un.id, monto: 40, estado_pago: 'pagado' } });
    const datos = { fecha_pago: new Date('2026-10-01T15:00:00Z'), fecha_origen: 'voucher', estado_validacion: 'validado', metodo_pago: 'yape', grupo: 'grupo-prueba-111' };
    await prisma.pago.create({ data: { ...datos, recibo_concepto_unidad_id: c2.id, monto: 40, grupo_principal: false } });
    const principal = await prisma.pago.create({ data: { ...datos, recibo_concepto_unidad_id: c1.id, monto: 60, grupo_principal: true } });
    try {
      const u = (await llamar(base, 'GET', URL_VISTA(), T.adminA)).body.torres[0].unidades.find((x: { codigo: string }) => x.codigo === 'B.1-111');
      assert.equal(u.estado, 'a_tiempo');
      assert.equal(u.deuda, '100.00');
      assert.equal(u.pagos.length, 1, 'un solo pago del mantenimiento');
      assert.equal(u.pagos[0].id, principal.id);
      assert.equal(u.pagos[0].monto, '100.00');
    } finally {
      await prisma.pago.deleteMany({ where: { grupo: 'grupo-prueba-111' } });
      await prisma.reciboConceptoUnidad.deleteMany({ where: { unidad_id: un.id } });
      await prisma.reciboConcepto.delete({ where: { id: rc2.id } });
      await prisma.unidad.delete({ where: { id: un.id } });
    }
  });

  it('corregir la fecha de un pago desde la revisión (queda «manual») cambia el veredicto, y la emisión lo respeta', async () => {
    assert.equal((await llamar(base, 'GET', URL_VISTA(), T.adminA)).body.torres[0].unidades.find((u: { codigo: string }) => u.codigo === 'B.1-106').estado, 'tarde');
    const c = await llamar(base, 'PUT', `/api/pagos/${pagos.get('B.1-106')}`, T.adminA, { fecha_pago: '2026-10-01T12:00:00Z' });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    const u = (await llamar(base, 'GET', URL_VISTA(), T.adminA)).body.torres[0].unidades.find((x: { codigo: string }) => x.codigo === 'B.1-106');
    assert.equal(u.estado, 'a_tiempo');
    assert.equal(u.pagos[0].fecha_origen, 'manual');
    assert.equal(u.revisar, false, 'una fecha corregida por una persona ya no se marca para revisar');
    const aud = await prisma.auditoria.findFirst({ where: { entidad: 'pago', entidad_id: pagos.get('B.1-106'), accion: 'editar' } });
    assert.ok(aud, 'la corrección queda auditada');
    await emitirOctubre();
    assert.deepEqual((await cargosMora('B.1-106')), [], 'con la fecha corregida ya no se le cobra la multa');
  });

  it('sin torre elegida trae una entrada por torre; si el recibo anterior aún no venció, no evalúa a nadie y lo dice', async () => {
    const r = await llamar(base, 'GET', `/api/recibos/vista-mora?complejo_id=${d.complejoA.id}&mes=10&anio=2026`, T.adminA);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    // B.1 y B.2 (con unidades) y las unidades sin torre (A-101, A-102): cada grupo mira SU recibo anterior.
    assert.deepEqual(r.body.torres.map((t: { torre: string | null }) => t.torre), ['B.1', 'B.2', null]);
    for (const nombre of ['B.2', null]) {
      const t = r.body.torres.find((x: { torre: string | null }) => x.torre === nombre);
      assert.equal(t.anterior, null, `${nombre ?? 'sin torre'} no tiene recibo de setiembre`);
      assert.deepEqual(t.unidades, []);
    }
    moraDeps.ahora = () => new Date('2026-10-03T04:59:59Z'); // 2-oct 23:59:59 en Lima
    const antes = await llamar(base, 'GET', URL_VISTA(), T.adminA);
    assert.equal(antes.body.torres[0].aun_no_vence, true);
    assert.deepEqual(antes.body.torres[0].unidades, []);
    assert.equal(antes.body.resumen.tarde, 0);
  });

  it('en el plan Gratis la mora no aplica: la vista lo dice (aplica: false) y la emisión no agrega nada', async () => {
    const sus = await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: d.complejoA.id } });
    await prisma.suscripcionCondominio.update({ where: { complejo_id: d.complejoA.id }, data: { plan_clave: 'gratis', modulos: [], estado: 'gratis' } });
    invalidarComercial();
    try {
      const v = await llamar(base, 'GET', URL_VISTA(), T.adminA);
      assert.equal(v.body.aplica, false);
      assert.equal(v.body.monto, '0.00');
      const r = await emitirOctubre();
      assert.equal(r.body.mora.cantidad, 0);
    } finally {
      await prisma.suscripcionCondominio.update({ where: { complejo_id: d.complejoA.id }, data: { plan_clave: sus.plan_clave, modulos: sus.modulos, estado: sus.estado } });
      invalidarComercial();
    }
  });

  it('permisos y entrada: sólo la administración; otro tenant → 404; sin mes → 422; la junta y el vecino → 403; sin sesión → 401', async () => {
    assert.equal((await llamar(base, 'GET', URL_VISTA(), T.junta)).status, 403);
    assert.equal((await llamar(base, 'GET', URL_VISTA(), T.prop1)).status, 403);
    assert.equal((await llamar(base, 'GET', URL_VISTA(), null)).status, 401);
    assert.equal((await llamar(base, 'GET', URL_VISTA(), T.adminB)).status, 404);
    assert.equal((await llamar(base, 'GET', URL_VISTA(), T.super)).status, 200);
    assert.equal((await llamar(base, 'GET', `/api/recibos/vista-mora?complejo_id=${d.complejoA.id}&anio=2026`, T.adminA)).status, 422);
    assert.equal((await llamar(base, 'GET', `/api/recibos/vista-mora?complejo_id=${d.complejoA.id}&mes=13&anio=2026`, T.adminA)).status, 422);
    assert.equal((await llamar(base, 'GET', `/api/recibos/vista-mora?complejo_id=${d.complejoA.id}&estructura_id=999999&mes=10&anio=2026`, T.adminA)).status, 422);
    // Otro tenant ni siquiera con una torre mía.
    assert.equal((await llamar(base, 'GET', `/api/recibos/vista-mora?complejo_id=${d.complejoB.id}&estructura_id=${torre1.id}&mes=10&anio=2026`, T.adminA)).status, 404);
  });
});

// =====================================================================================================
describe('POST /api/recibos/:id/mantenimientos/:unidadId/quitar-multa', () => {
  const quitar = (reciboId: number, codigo: string, token: string, cuerpo: unknown = { motivo: 'Pagó el recibo de setiembre a tiempo; lo acordó con la administradora' }) =>
    llamar(base, 'POST', `/api/recibos/${reciboId}/mantenimientos/${dpto(codigo)}/quitar-multa`, token, cuerpo);
  let reciboId: number;
  beforeEach(async () => {
    const r = await emitirOctubre();
    assert.equal(r.status, 201, JSON.stringify(r.body));
    reciboId = (await reciboOct()).id;
  });

  it('quita la línea de multa, deja el resto del recibo y el detalle del mantenimiento se actualiza solo', async () => {
    const antes = await llamar(base, 'GET', `/api/recibos/${reciboId}/mantenimientos/${dpto('B.1-102')}`, T.adminA);
    assert.equal(antes.body.total, '120.00');
    const r = await quitar(reciboId, 'B.1-102', T.adminA);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.monto_quitado, '20.00');
    assert.equal(r.body.mantenimiento.total, '100.00');
    assert.deepEqual(r.body.mantenimiento.conceptos.map((c: { concepto: string }) => c.concepto), ['Mantenimiento']);
    assert.equal(r.body.mantenimiento.linea_mora, CONCEPTO_MORA, 'el impreso muestra la línea de multa en 0.00');
    assert.deepEqual(await cargosMora('B.1-102'), []);
    assert.equal(await prisma.reciboConceptoUnidad.count({ where: { unidad_id: dpto('B.1-102'), reciboConcepto: { recibo_id: reciboId } } }), 1, 'el mantenimiento sigue');
    // El resto de las multas no se toca.
    assert.equal((await cargosMora('B.1-105')).length, 1);
    const vecino = await prisma.unidad.update({ where: { id: dpto('B.1-102') }, data: { propietario_id: d.propietario1.id } });
    try {
      const v = await llamar(base, 'GET', `/api/me/mantenimientos/${reciboId}/${vecino.id}`, T.prop1);
      assert.equal(v.body.total, '100.00');
      assert.ok(!v.body.conceptos.some((c: { es_recargo: boolean }) => c.es_recargo));
    } finally {
      await prisma.unidad.update({ where: { id: dpto('B.1-102') }, data: { propietario_id: null } });
    }
  });

  it('queda auditado: quién, el motivo, el monto y el departamento', async () => {
    const r = await quitar(reciboId, 'B.1-102', T.adminA, { motivo: '  Pagó a tiempo, lo acordó con la administradora  ' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const fila = await (async () => { for (let i = 0; i < 30; i++) { const a = await prisma.auditoria.findFirst({ where: { accion: 'quitar_multa' } }); if (a) return a; await new Promise((x) => setTimeout(x, 50)); } return null; })();
    assert.ok(fila, 'hay una fila de auditoría');
    assert.equal(fila.usuario_id, d.adminA.id);
    assert.equal(fila.entidad, 'recibo');
    assert.equal(fila.entidad_id, reciboId);
    const det = fila.detalle as Record<string, unknown>;
    assert.equal(det.motivo, 'Pagó a tiempo, lo acordó con la administradora');
    assert.equal(det.monto, '20.00');
    assert.equal(det.unidad_id, dpto('B.1-102'));
    assert.equal(det.codigo, 'B.1-102');
  });

  it('si la multa ya está pagada → 409 con un mensaje claro y no se toca nada', async () => {
    await prisma.reciboConceptoUnidad.updateMany({ where: { unidad_id: dpto('B.1-102'), reciboConcepto: { recibo_id: reciboId, concepto: { nombre: CONCEPTO_MORA } } }, data: { estado_pago: 'pagado', fecha_pago: new Date() } });
    const r = await quitar(reciboId, 'B.1-102', T.adminA);
    assert.equal(r.status, 409);
    assert.match(r.body.error, /ya está pagada/);
    assert.equal((await cargosMora('B.1-102')).length, 1);
  });

  it('con un pago en revisión (o uno parcial ya validado) → 409: primero se resuelve ese pago', async () => {
    await prisma.reciboConceptoUnidad.updateMany({ where: { unidad_id: dpto('B.1-102'), reciboConcepto: { recibo_id: reciboId, concepto: { nombre: CONCEPTO_MORA } } }, data: { estado_pago: 'en_revision' } });
    const r = await quitar(reciboId, 'B.1-102', T.adminA);
    assert.equal(r.status, 409);
    assert.match(r.body.error, /pago en revisión/);
    assert.equal((await cargosMora('B.1-102')).length, 1);
    const [cargo] = await cargosMora('B.1-105');
    await prisma.pago.create({ data: { recibo_concepto_unidad_id: cargo!.id, monto: 5, estado_validacion: 'validado', metodo_pago: 'yape' } });
    const parcial = await quitar(reciboId, 'B.1-105', T.adminA);
    assert.equal(parcial.status, 409);
    assert.match(parcial.body.error, /ya tiene pagos/);
  });

  it('un pago rechazado de esa multa no la protege: la multa queda en 0.00 con el motivo (el pago rechazado se conserva)', async () => {
    const [cargo] = await cargosMora('B.1-102');
    const rechazado = await prisma.pago.create({ data: { recibo_concepto_unidad_id: cargo!.id, monto: 20, estado_validacion: 'rechazado', metodo_pago: 'yape' } });
    const r = await quitar(reciboId, 'B.1-102', T.adminA);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.mantenimiento.total, '100.00');
    const queda = await prisma.reciboConceptoUnidad.findUniqueOrThrow({ where: { id: cargo!.id } });
    assert.equal(queda.monto.toString(), '0');
    assert.match(queda.observaciones ?? '', /^Multa quitada: /);
    assert.equal((await prisma.pago.findUniqueOrThrow({ where: { id: rechazado.id } })).recibo_concepto_unidad_id, cargo!.id);
  });

  it('la junta, el vecino y quien no tiene sesión no pueden: 403/401', async () => {
    assert.equal((await quitar(reciboId, 'B.1-102', T.junta)).status, 403);
    assert.equal((await quitar(reciboId, 'B.1-102', T.prop1)).status, 403);
    assert.equal((await quitar(reciboId, 'B.1-102', null as unknown as string)).status, 401);
    assert.equal((await cargosMora('B.1-102')).length, 1);
  });

  it('otro tenant → 404 (y no se toca nada)', async () => {
    const r = await quitar(reciboId, 'B.1-102', T.adminB);
    assert.equal(r.status, 404);
    assert.equal((await cargosMora('B.1-102')).length, 1);
  });

  it('el motivo es obligatorio (≥ 5 caracteres, ≤ 300) y no admite campos de más → 422', async () => {
    for (const cuerpo of [{}, { motivo: '' }, { motivo: '    ' }, { motivo: 'abcd' }, { motivo: 'x'.repeat(301) }, { motivo: 'motivo válido', monto: 0 }, []]) {
      const r = await quitar(reciboId, 'B.1-102', T.adminA, cuerpo);
      assert.equal(r.status, 422, `cuerpo: ${JSON.stringify(cuerpo)}`);
    }
    assert.equal((await cargosMora('B.1-102')).length, 1);
  });

  it('un departamento sin multa en ese recibo → 409; repetir la acción después de quitarla también', async () => {
    const sin = await quitar(reciboId, 'B.1-101', T.adminA);
    assert.equal(sin.status, 409);
    assert.match(sin.body.error, /no tiene multa/);
    assert.equal((await quitar(reciboId, 'B.1-102', T.adminA)).status, 200);
    assert.equal((await quitar(reciboId, 'B.1-102', T.adminA)).status, 409);
  });

  it('también quita la multa que la administradora puso a mano en el Excel (sin motivo automático)', async () => {
    const multa = await prisma.concepto.create({ data: { nombre: 'MULTA PAGO FUERA DE FECHA', empresa_id: d.empresaA.id, tipo_monto: 'fijo' } });
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: reciboId, concepto_id: multa.id, monto: 0, orden: 9 } });
    await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: dpto('B.1-101'), monto: 35, estado_pago: 'pendiente' } });
    const r = await quitar(reciboId, 'B.1-101', T.adminA);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.monto_quitado, '35.00');
  });

  it('un departamento de otro recibo/tenant (id que no corresponde) → 404', async () => {
    const r = await llamar(base, 'POST', `/api/recibos/${reciboId}/mantenimientos/${d.unidadB1.id}/quitar-multa`, T.adminA, { motivo: 'motivo válido' });
    assert.equal(r.status, 404);
  });
});

// =====================================================================================================
describe('aviso «según el voucher pagó a tiempo; tiene la multa de …»', () => {
  const aviso = async (codigo: string, token = T.adminA) => {
    const r = await llamar(base, 'GET', `/api/recibos/${(await prisma.recibo.findFirstOrThrow({ where: { mes: 9, anio: 2026, estructura_id: torre1.id } })).id}/mantenimientos/${dpto(codigo)}`, token);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return (r.body.pagos as { aviso_multa?: { texto: string; recibo_id: number; unidad_id: number; monto: string } | null }[])[0]?.aviso_multa ?? null;
  };
  /** B.1-104 pagó (declarada) a tiempo: al emitir se le dio por válido; B.1-106 («no_leida», tarde) recibe la multa. */
  beforeEach(async () => {
    assert.equal((await emitirOctubre()).status, 201);
  });

  it('el pago cuya fecha (del voucher) es ≤ al vencimiento y cuyo departamento tiene la multa de ese recibo sin pagar lleva el aviso, con el id del recibo donde está la multa', async () => {
    // B.1-106: la IA no leyó la fecha (tarde, multa puesta). Después se lee el voucher: 1-oct → pagó a tiempo.
    assert.equal(await aviso('B.1-106'), null, 'mientras la fecha es la declarada tarde, no hay aviso');
    await prisma.pago.update({ where: { id: pagos.get('B.1-106')! }, data: { fecha_pago: new Date('2026-10-01T12:00:00Z'), fecha_origen: 'voucher' } });
    const a = await aviso('B.1-106');
    assert.ok(a, 'ahora sí hay aviso');
    assert.equal(a.texto, 'Según el voucher pagó a tiempo; tiene la multa de setiembre de 2026.');
    assert.equal(a.recibo_id, (await reciboOct()).id);
    assert.equal(a.unidad_id, dpto('B.1-106'));
    assert.equal(a.monto, '20.00');
    // …y en «Por validar» (lista de pagos) y en la respuesta de validar.
    await prisma.pago.update({ where: { id: pagos.get('B.1-106')! }, data: { estado_validacion: 'por_validar' } });
    const lista = await llamar(base, 'GET', '/api/pagos?estado_validacion=por_validar&pageSize=100', T.adminA);
    const fila = lista.body.items.find((p: { id: number }) => p.id === pagos.get('B.1-106'));
    assert.equal(fila.aviso_multa.texto, a.texto);
    assert.equal(fila.aviso_multa.recibo_id, a.recibo_id);
    const sinAviso = lista.body.items.find((p: { id: number }) => p.id === pagos.get('B.1-103'));
    assert.ok(sinAviso, 'B.1-103 también está por validar');
    assert.equal(sinAviso.aviso_multa ?? null, null, 'B.1-103 pagó a tiempo y no tiene multa: sin aviso');
    await prisma.archivoComprobante.create({ data: { pago_id: pagos.get('B.1-106')!, nombre: 'v.png', tipo_mime: 'image/png', tamano: 3, sha256: 'a'.repeat(64), datos: Buffer.from([1, 2, 3]) } });
    const val = await llamar(base, 'PATCH', `/api/pagos/${pagos.get('B.1-106')}/validacion`, T.adminA, { estado: 'validado' });
    assert.equal(val.status, 200, JSON.stringify(val.body));
    assert.equal(val.body.aviso_multa.texto, a.texto, 'tras validar el aviso sigue: la multa aún está sin pagar');
  });

  it('sólo aparece cuando corresponde', async () => {
    const poner = (codigo: string, datos: Record<string, unknown>) => prisma.pago.update({ where: { id: pagos.get(codigo)! }, data: datos });
    await poner('B.1-106', { fecha_pago: new Date('2026-10-01T12:00:00Z'), fecha_origen: 'voucher' });
    assert.ok(await aviso('B.1-106'));
    // La fecha es la declarada (no la del voucher): no se afirma nada.
    await poner('B.1-106', { fecha_origen: 'declarada' });
    assert.equal(await aviso('B.1-106'), null, 'declarada → sin aviso');
    await poner('B.1-106', { fecha_origen: 'no_leida' });
    assert.equal(await aviso('B.1-106'), null);
    // Una fecha corregida a mano sí vale.
    await poner('B.1-106', { fecha_origen: 'manual' });
    assert.ok(await aviso('B.1-106'));
    // Fecha de voucher posterior al vencimiento: no pagó a tiempo.
    await poner('B.1-106', { fecha_pago: new Date('2026-10-03T12:00:00Z'), fecha_origen: 'voucher' });
    assert.equal(await aviso('B.1-106'), null, 'tarde → sin aviso');
    await poner('B.1-106', { fecha_pago: new Date('2026-10-01T12:00:00Z') });
    assert.ok(await aviso('B.1-106'));
    // Pago rechazado: no cuenta.
    await poner('B.1-106', { estado_validacion: 'rechazado' });
    assert.equal(await aviso('B.1-106'), null, 'rechazado → sin aviso');
    await poner('B.1-106', { estado_validacion: 'validado' });
    assert.ok(await aviso('B.1-106'));
    // La multa ya pagada: ya no se puede quitar, no hay aviso.
    await prisma.reciboConceptoUnidad.updateMany({ where: { unidad_id: dpto('B.1-106'), reciboConcepto: { recibo: { mes: 10, anio: 2026 }, concepto: { nombre: CONCEPTO_MORA } } }, data: { estado_pago: 'pagado' } });
    assert.equal(await aviso('B.1-106'), null, 'multa pagada → sin aviso');
    await prisma.reciboConceptoUnidad.updateMany({ where: { unidad_id: dpto('B.1-106'), reciboConcepto: { recibo: { mes: 10, anio: 2026 } } }, data: { estado_pago: 'pendiente' } });
    assert.ok(await aviso('B.1-106'));
    // Quitada la multa, el aviso desaparece.
    const q = await llamar(base, 'POST', `/api/recibos/${(await reciboOct()).id}/mantenimientos/${dpto('B.1-106')}/quitar-multa`, T.adminA, { motivo: 'Pagó a tiempo según el voucher' });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(await aviso('B.1-106'), null, 'multa quitada → sin aviso');
    // Un departamento que pagó a tiempo y nunca tuvo multa no tiene aviso.
    assert.equal(await aviso('B.1-101'), null);
  });

  it('un pago a tiempo que NO cubre el saldo (parcial) no prueba que pagó a tiempo: sin aviso', async () => {
    // B.1-106 pagó 40 de 100 con voucher a tiempo y completó tarde: sigue «tarde» para la emisión, así que la multa es correcta.
    await prisma.pago.update({ where: { id: pagos.get('B.1-106')! }, data: { fecha_pago: new Date('2026-10-01T12:00:00Z'), fecha_origen: 'voucher', monto: 40 } });
    try {
      assert.equal(await aviso('B.1-106'), null);
    } finally {
      await prisma.pago.update({ where: { id: pagos.get('B.1-106')! }, data: { monto: 100 } });
    }
  });

  it('el aviso va en el pago cuya fecha es ≤ al vencimiento, no en otro pago del mismo departamento que llegó tarde', async () => {
    const original = pagos.get('B.1-106')!;
    await prisma.pago.update({ where: { id: original }, data: { fecha_pago: new Date('2026-10-01T12:00:00Z'), fecha_origen: 'voucher' } });
    const cargoId = (await prisma.pago.findUniqueOrThrow({ where: { id: original } })).recibo_concepto_unidad_id!;
    const tardio = await prisma.pago.create({ data: { recibo_concepto_unidad_id: cargoId, monto: 5, fecha_pago: new Date('2026-10-04T12:00:00Z'), fecha_origen: 'voucher', estado_validacion: 'por_validar', metodo_pago: 'yape' } });
    try {
      const reciboSet = await prisma.recibo.findFirstOrThrow({ where: { mes: 9, anio: 2026, estructura_id: torre1.id } });
      const r = await llamar(base, 'GET', `/api/recibos/${reciboSet.id}/mantenimientos/${dpto('B.1-106')}`, T.adminA);
      const porId = new Map((r.body.pagos as { id: number; aviso_multa: unknown }[]).map((p) => [p.id, p.aviso_multa]));
      assert.ok(porId.get(original), 'el pago a tiempo lleva el aviso');
      assert.equal(porId.get(tardio.id), null, 'el pago tardío no');
    } finally {
      await prisma.pago.delete({ where: { id: tardio.id } });
    }
  });

  it('la multa de OTRO mes no es la de este recibo: sin aviso (la del Excel, sin motivo, sí cuenta)', async () => {
    await prisma.pago.update({ where: { id: pagos.get('B.1-106')! }, data: { fecha_pago: new Date('2026-10-01T12:00:00Z'), fecha_origen: 'voucher' } });
    const cargo = { unidad_id: dpto('B.1-106'), reciboConcepto: { recibo: { mes: 10, anio: 2026 }, concepto: { nombre: CONCEPTO_MORA } } };
    await prisma.reciboConceptoUnidad.updateMany({ where: cargo, data: { observaciones: 'Pago fuera de fecha del recibo de agosto de 2026' } });
    assert.equal(await aviso('B.1-106'), null);
    await prisma.reciboConceptoUnidad.updateMany({ where: cargo, data: { observaciones: null } });
    assert.ok(await aviso('B.1-106'));
  });

  it('lo ve la administración y la junta del block; el vecino no', async () => {
    await prisma.pago.update({ where: { id: pagos.get('B.1-106')! }, data: { fecha_pago: new Date('2026-10-01T12:00:00Z'), fecha_origen: 'voucher' } });
    assert.ok(await aviso('B.1-106', T.adminA));
    assert.ok(await aviso('B.1-106', T.junta));
    const vecino = await prisma.unidad.update({ where: { id: dpto('B.1-106') }, data: { propietario_id: d.propietario1.id } });
    try {
      const reciboSet = await prisma.recibo.findFirstOrThrow({ where: { mes: 9, anio: 2026, estructura_id: torre1.id } });
      const r = await llamar(base, 'GET', `/api/me/mantenimientos/${reciboSet.id}/${vecino.id}`, T.prop1);
      assert.equal(r.status, 200);
      assert.ok(!JSON.stringify(r.body).includes('aviso_multa'), 'el residente no recibe el aviso');
    } finally {
      await prisma.unidad.update({ where: { id: dpto('B.1-106') }, data: { propietario_id: null } });
    }
  });
});
