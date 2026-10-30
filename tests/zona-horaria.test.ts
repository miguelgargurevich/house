// Zona horaria por condominio (fase 4): el «hoy» de cada condominio es el de SU zona, no el de Lima.
// Datos: Complejo A (empresa A) y Complejo B (empresa B) de `sembrar()`. Cada bloque deja las zonas como las encontró.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { estadoCargo, filtroEstadoCargo, formatearCargo, includeCargo } from '../src/server/lib/cargos';
import { hoyEn } from '../src/server/lib/fechas';
import { estadoMantenimiento, listarMantenimientos } from '../src/server/lib/mantenimientos';
import { abrirContrato } from '../src/server/lib/contratos';
import { relojDe, relojDeCondominios } from '../src/server/lib/zonas';
import { encolarRecordatorios } from '../src/server/services/avisos';
import { avisarVoucherAlBlock, voucherBlockDeps } from '../src/server/services/avisos/voucherBlock';
import { decidirFecha } from '../src/server/services/fechaVoucher';
import { historialResidente } from '../src/server/services/historial';
import { evaluarMora, moraDeps } from '../src/server/services/mora';
import { crearContratosIniciales } from '../src/server/lib/contratosIniciales';
import { historialXlsx } from '../src/server/lib/historialExcel';
import XLSX from 'xlsx';
import { cooldownDeps } from '../src/server/lib/cooldown';
import { cargarDatos } from '../src/server/services/asistente/contexto';
import { ejecutarHerramienta } from '../src/server/tools';
import type { AuthUser } from '../src/server/middleware/auth';

const iso = (t: Date) => t.toISOString().slice(0, 10);

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1', string>;

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    super: await login(base, 'super@test.pe'),
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    prop1: await login(base, 'prop1@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('condominios: zona horaria', () => {
  beforeEach(async () => {
    await prisma.complejoHabitacional.deleteMany({ where: { nombre: { startsWith: 'Nuevo ' } } });
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { pais: 'PE' } });
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { zona_horaria: 'America/Lima' } });
  });

  it('los condominios que ya existen y los nuevos sin país nacen en America/Lima', async () => {
    const c = await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: d.complejoB.id } });
    assert.equal(c.zona_horaria, 'America/Lima');
    const r = await llamar(base, 'POST', '/api/complejos', T.adminA, { nombre: 'Nuevo Lima', tipo: 'Edificio' });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.zona_horaria, 'America/Lima');
  });

  it('sin zona, nace con la de su país (y con la del país de su empresa si no se dice país)', async () => {
    const mx = await llamar(base, 'POST', '/api/complejos', T.adminA, { nombre: 'Nuevo Mexico', tipo: 'Edificio', pais: 'MX' });
    assert.deepEqual([mx.body.pais, mx.body.moneda, mx.body.zona_horaria], ['MX', 'MXN', 'America/Mexico_City']);
    // Gratis incluye un condominio por administradora: los siguientes los crea el superadmin (sin ese límite); lo que se prueba es la zona.
    const es = await llamar(base, 'POST', '/api/complejos', T.super, { nombre: 'Nuevo Madrid', tipo: 'Edificio', pais: 'ES', empresa_id: d.empresaA.id });
    assert.equal(es.body.zona_horaria, 'Europe/Madrid');
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { pais: 'CL' } });
    const cl = await llamar(base, 'POST', '/api/complejos', T.super, { nombre: 'Nuevo Santiago', tipo: 'Edificio', empresa_id: d.empresaA.id });
    assert.deepEqual([cl.body.pais, cl.body.zona_horaria], ['CL', 'America/Santiago']);
  });

  it('con zona explícita manda sobre la del país (Cancún, en un condominio de México)', async () => {
    const r = await llamar(base, 'POST', '/api/complejos', T.adminA, { nombre: 'Nuevo Cancun', tipo: 'Edificio', pais: 'MX', zona_horaria: 'America/Cancun' });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.zona_horaria, 'America/Cancun');
  });

  it('una zona que Intl no conoce, un desfase suelto o un texto raro → 422 con el campo; no se guarda', async () => {
    for (const zona of ['America/Limaa', '+05:00', 'Lima', '', 'GMT+5', 'x'.repeat(80)]) {
      const r = await llamar(base, 'POST', '/api/complejos', T.adminA, { nombre: 'Nuevo Malo', tipo: 'Edificio', zona_horaria: zona });
      assert.equal(r.status, 422, `${JSON.stringify(zona)}: ${r.texto}`);
      assert.ok(r.body.campos?.zona_horaria, JSON.stringify(r.body));
    }
    const e = await llamar(base, 'PUT', `/api/complejos/${d.complejoA.id}`, T.adminA, { zona_horaria: 'Mars/Olympus' });
    assert.equal(e.status, 422, e.texto);
    assert.equal((await prisma.complejoHabitacional.count({ where: { nombre: 'Nuevo Malo' } })), 0);
    assert.equal((await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: d.complejoA.id } })).zona_horaria, 'America/Lima');
  });

  it('se edita en la ficha (aun con recibos emitidos: sólo mueve el día en que algo vence); otro tenant → 404', async () => {
    const ok = await llamar(base, 'PUT', `/api/complejos/${d.complejoA.id}`, T.adminA, { zona_horaria: 'America/Santiago' });
    assert.equal(ok.status, 200, ok.texto);
    assert.equal(ok.body.zona_horaria, 'America/Santiago');
    const lee = await llamar(base, 'GET', `/api/complejos/${d.complejoA.id}`, T.adminA);
    assert.equal(lee.body.zona_horaria, 'America/Santiago');
    const ajeno = await llamar(base, 'PUT', `/api/complejos/${d.complejoA.id}`, T.adminB, { zona_horaria: 'America/Lima' });
    assert.equal(ajeno.status, 404);
    assert.equal((await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: d.complejoA.id } })).zona_horaria, 'America/Santiago');
  });

  it('un residente no edita la zona (403)', async () => {
    const r = await llamar(base, 'PUT', `/api/complejos/${d.complejoA.id}`, T.prop1, { zona_horaria: 'Europe/Madrid' });
    assert.ok([403, 404].includes(r.status), r.texto);
    assert.equal((await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: d.complejoA.id } })).zona_horaria, 'America/Lima');
  });
});

// ---------- Fixtures: un recibo con un cargo pendiente en el departamento de cada condominio ----------
const ponerZona = (complejoId: number, zona: string) => prisma.complejoHabitacional.update({ where: { id: complejoId }, data: { zona_horaria: zona } });

/** Un recibo (vence el día calendario `vence`) con un cargo pendiente de 100 para esa unidad. */
async function cargoEn(complejo: { id: number; empresa_id: number | null }, unidadId: number, vence: string, mes = 12) {
  const recibo = await prisma.recibo.create({ data: { empresa_id: complejo.empresa_id, complejo_id: complejo.id, mes, anio: 2026, fecha_emision: new Date('2026-11-20T00:00:00Z'), fecha_vencimiento: new Date(`${vence}T00:00:00Z`), estado: 'emitido', descripcion: `Zona ${vence}` } });
  const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: d.conceptoA.id, monto: 100, orden: 1 } });
  const cargo = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidadId, monto: 100, estado_pago: 'pendiente' } });
  return { recibo, cargo };
}
const limpiarCargos = async (...reciboIds: number[]) => {
  await prisma.notificacion.deleteMany({ where: { ref_id: { in: reciboIds } } });
  await prisma.pago.deleteMany({ where: { reciboConceptoUnidad: { reciboConcepto: { recibo_id: { in: reciboIds } } } } });
  await prisma.reciboConceptoUnidad.deleteMany({ where: { reciboConcepto: { recibo_id: { in: reciboIds } } } });
  await prisma.reciboConcepto.deleteMany({ where: { recibo_id: { in: reciboIds } } });
  await prisma.recibo.deleteMany({ where: { id: { in: reciboIds } } });
};
const idsDeCargos = async (estado: 'vencido' | 'pendiente', ahora: Date, ids: number[]) =>
  (await prisma.reciboConceptoUnidad.findMany({ where: { AND: [{ id: { in: ids } }, filtroEstadoCargo(estado, await relojDeCondominios(ahora))] }, select: { id: true }, orderBy: { id: 'asc' } })).map((c) => c.id);

describe('estado de cargos: vencido desde el día siguiente al vencimiento, en la hora de SU condominio', () => {
  // El cargo vence el 10-dic (fecha de calendario). Lima = UTC−5 y Ciudad de México = UTC−6 (sin horario de verano desde 2022).
  const VENCE = '2026-12-10';
  const L_2330 = new Date('2026-12-11T04:30:00Z'); //  10-dic 23:30 en Lima;  22:30 en México; en UTC ya es el 11
  const M_2330 = new Date('2026-12-11T05:30:00Z'); //  11-dic 00:30 en Lima;  23:30 del 10 en México
  const L_0030 = new Date('2026-12-11T05:30:00Z'); //  (el mismo instante: Lima ya está en el día siguiente)
  const M_0030 = new Date('2026-12-11T06:30:00Z'); //  11-dic 01:30 en Lima;  00:30 del 11 en México
  let a: { recibo: { id: number }; cargo: { id: number } };
  let b: { recibo: { id: number }; cargo: { id: number } };

  before(async () => {
    await ponerZona(d.complejoB.id, 'America/Mexico_City');
    a = await cargoEn(d.complejoA, d.unidadA1.id, VENCE);
    b = await cargoEn(d.complejoB, d.unidadB1.id, VENCE);
  });
  after(async () => {
    await limpiarCargos(a.recibo.id, b.recibo.id);
    await ponerZona(d.complejoB.id, 'America/Lima');
  });

  it('estadoCargo: a las 23:30 del día del vencimiento sigue «pendiente» en Lima y en México; «vencido» a las 00:30 del siguiente', () => {
    const v = new Date(`${VENCE}T00:00:00Z`);
    assert.equal(estadoCargo('pendiente', v, hoyEn('America/Lima', L_2330)), 'pendiente');
    assert.equal(estadoCargo('pendiente', v, hoyEn('America/Mexico_City', new Date('2026-12-11T05:30:00Z'))), 'pendiente'); // 23:30 en México
    assert.equal(estadoCargo('pendiente', v, hoyEn('America/Lima', new Date('2026-12-11T05:30:00Z'))), 'vencido'); // 00:30 en Lima
    assert.equal(estadoCargo('pendiente', v, hoyEn('America/Mexico_City', new Date('2026-12-11T06:30:00Z'))), 'vencido'); // 00:30 en México
    assert.equal(estadoCargo('pagado', v, hoyEn('America/Lima', M_0030)), 'pagado', 'pagado manda');
  });

  it('el mismo instante da estados distintos en dos condominios: Lima ya venció, México todavía no', async () => {
    assert.equal(iso(M_2330), '2026-12-11', 'en UTC ya es el día siguiente');
    assert.deepEqual(await idsDeCargos('vencido', M_2330, [a.cargo.id, b.cargo.id]), [a.cargo.id], 'sólo el de Lima venció');
    assert.deepEqual(await idsDeCargos('pendiente', M_2330, [a.cargo.id, b.cargo.id]), [b.cargo.id], 'el de México sigue pendiente');
  });

  it('a las 23:30 del día del vencimiento (hora de cada uno) ninguno está vencido; una hora después, los dos', async () => {
    assert.deepEqual(await idsDeCargos('vencido', new Date('2026-12-11T04:30:00Z'), [a.cargo.id, b.cargo.id]), [], 'Lima 23:30 y México 22:30');
    assert.deepEqual(await idsDeCargos('pendiente', new Date('2026-12-11T04:30:00Z'), [a.cargo.id, b.cargo.id]), [a.cargo.id, b.cargo.id]);
    assert.deepEqual(await idsDeCargos('vencido', M_0030, [a.cargo.id, b.cargo.id]), [a.cargo.id, b.cargo.id], 'Lima 01:30 y México 00:30 del día siguiente');
    assert.deepEqual(await idsDeCargos('pendiente', M_0030, [a.cargo.id, b.cargo.id]), []);
  });

  it('un recibo sin condominio (dato viejo) cuenta con la hora de Lima aunque haya otras zonas en uso', async () => {
    const rc = await prisma.reciboConcepto.findFirstOrThrow({ where: { recibo_id: a.recibo.id } });
    const viejo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: null, mes: 12, anio: 2026, fecha_emision: new Date('2026-11-20T00:00:00Z'), fecha_vencimiento: new Date(`${VENCE}T00:00:00Z`), estado: 'emitido' } });
    const rcViejo = await prisma.reciboConcepto.create({ data: { recibo_id: viejo.id, concepto_id: d.conceptoA.id, monto: 100, orden: 1 } });
    const cargo = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rcViejo.id, unidad_id: d.unidadA2.id, monto: 100, estado_pago: 'pendiente' } });
    try {
      assert.ok(rc);
      assert.deepEqual(await idsDeCargos('vencido', M_2330, [cargo.id]), [cargo.id], 'Lima ya está en el 11 (México, no)');
      assert.deepEqual(await idsDeCargos('pendiente', M_2330, [cargo.id]), []);
    } finally {
      await limpiarCargos(viejo.id);
    }
  });

  it('formatearCargo: el estado de cada cargo sale con el «hoy» de la zona de su condominio', async () => {
    const cargos = await prisma.reciboConceptoUnidad.findMany({ where: { id: { in: [a.cargo.id, b.cargo.id] } }, include: includeCargo, orderBy: { id: 'asc' } });
    assert.deepEqual(cargos.map((c) => formatearCargo(c, M_2330).estado), ['vencido', 'pendiente']);
    assert.deepEqual(cargos.map((c) => formatearCargo(c, M_0030).estado), ['vencido', 'vencido']);
    assert.deepEqual(cargos.map((c) => formatearCargo(c, L_2330).estado), ['pendiente', 'pendiente']);
    assert.equal('zona_horaria' in (formatearCargo(cargos[0]!, L_0030).recibo ?? {}), false, 'la zona no se filtra al cliente dentro del recibo');
  });

  it('mantenimientos (SQL) y estadoMantenimiento (JS) dicen lo mismo en cada zona', async () => {
    for (const ahora of [L_2330, M_2330, M_0030]) {
      const filas = (await listarMantenimientos({ unidadIds: [d.unidadA1.id, d.unidadB1.id] }, { page: 1, pageSize: 50, reloj: await relojDeCondominios(ahora) })).items.filter((f) => [a.recibo.id, b.recibo.id].includes(f.recibo_id));
      assert.equal(filas.length, 2);
      for (const f of filas) {
        const zona = f.recibo_id === a.recibo.id ? 'America/Lima' : 'America/Mexico_City';
        const esperado = estadoMantenimiento({ total: f.total, cobrado: f.cobrado, en_revision: f.en_revision, saldo: f.saldo }, f.fecha_vencimiento, hoyEn(zona, ahora));
        assert.equal(f.estado, esperado, `${zona} a las ${ahora.toISOString()}`);
      }
    }
    const vencidos = await listarMantenimientos({ unidadIds: [d.unidadA1.id, d.unidadB1.id], estado: 'vencido' }, { page: 1, pageSize: 50, reloj: await relojDeCondominios(M_2330) });
    assert.deepEqual(vencidos.items.filter((f) => [a.recibo.id, b.recibo.id].includes(f.recibo_id)).map((f) => f.recibo_id), [a.recibo.id]);
  });

  it('horario de verano: en Madrid el día cambia a las 23:00 UTC tras el cambio de hora (con +02 fijo habría vencido una hora antes)', async () => {
    await ponerZona(d.complejoB.id, 'Europe/Madrid');
    const m = await cargoEn(d.complejoB, d.unidadB1.id, '2026-10-25', 10); // el día en que los relojes se atrasan
    try {
      assert.deepEqual(await idsDeCargos('vencido', new Date('2026-10-25T22:30:00Z'), [m.cargo.id]), [], '23:30 del 25 en Madrid (CET): todavía no');
      assert.deepEqual(await idsDeCargos('vencido', new Date('2026-10-25T23:30:00Z'), [m.cargo.id]), [m.cargo.id], '00:30 del 26');
    } finally {
      await limpiarCargos(m.recibo.id);
      await ponerZona(d.complejoB.id, 'America/Mexico_City');
    }
  });

  it('horario de verano en Santiago: vence el 5-sep, el día en que el reloj salta (de 23:59 a 01:00)', async () => {
    await ponerZona(d.complejoB.id, 'America/Santiago');
    const s = await cargoEn(d.complejoB, d.unidadB1.id, '2026-09-05', 9);
    try {
      assert.deepEqual(await idsDeCargos('vencido', new Date('2026-09-06T03:30:00Z'), [s.cargo.id]), [], '23:30 del 5 (UTC−4)');
      assert.deepEqual(await idsDeCargos('vencido', new Date('2026-09-06T04:30:00Z'), [s.cargo.id]), [s.cargo.id], '01:30 del 6 (UTC−3)');
    } finally {
      await limpiarCargos(s.recibo.id);
      await ponerZona(d.complejoB.id, 'America/Mexico_City');
    }
  });
});

describe('filtros por zona: sólo arman tramos cuando el día es distinto', () => {
  const sql = (z: string[], ahora: string) => JSON.stringify(filtroEstadoCargo('vencido', relojDe(z, new Date(ahora))));
  it('zonas con el mismo «hoy» (Lima y Madrid a las 18:00 UTC) dan el filtro de siempre, sin condicionar por zona', () => {
    assert.doesNotMatch(sql(['Europe/Madrid'], '2026-12-10T18:00:00Z'), /zona_horaria/);
    assert.doesNotMatch(sql([], '2026-12-10T18:00:00Z'), /zona_horaria/);
  });
  it('con «hoy» distinto (Lima 18:30 del 10, Madrid 00:30 del 11) hay un tramo por zona', () => {
    const f = sql(['Europe/Madrid'], '2026-12-10T23:30:00Z');
    assert.match(f, /"zona_horaria":\{"in":\["Europe\/Madrid"\]\}/);
    assert.match(f, /"complejo_id":null/, 'lo que no tiene condominio cuenta con Lima');
  });
});

describe('mora: pagar tarde se mide en la hora del condominio', () => {
  const moraOriginal = { ...moraDeps };
  afterEach(() => { Object.assign(moraDeps, moraOriginal); });

  it('en Santiago, un pago a las 23:00 del día del vencimiento no es tarde y a las 00:30 del siguiente sí (en Lima, los dos serían a tiempo)', async () => {
    await ponerZona(d.complejoB.id, 'America/Santiago'); // octubre: UTC−3
    const unidad = (codigo: string) => prisma.unidad.create({ data: { codigo, tipo: 'Departamento', complejo_id: d.complejoB.id, empresa_id: d.empresaB.id, estado: 'activa' } });
    const [aTiempo, tarde] = [await unidad('Z-1'), await unidad('Z-2')];
    const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaB.id, complejo_id: d.complejoB.id, mes: 9, anio: 2026, fecha_emision: new Date('2026-09-15T00:00:00Z'), fecha_vencimiento: new Date('2026-10-02T00:00:00Z'), estado: 'emitido' } });
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: d.conceptoB.id, monto: 0, orden: 1 } });
    const cargo = async (unidad_id: number, fecha: string) => {
      const c = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id, monto: 100, estado_pago: 'pendiente' } });
      await prisma.pago.create({ data: { recibo_concepto_unidad_id: c.id, monto: 100, fecha_pago: new Date(fecha), estado_validacion: 'validado', metodo_pago: 'yape' } });
    };
    await cargo(aTiempo.id, '2026-10-03T02:00:00Z'); // 2-oct 23:00 en Santiago (UTC−3); 21:00 en Lima
    await cargo(tarde.id, '2026-10-03T03:30:00Z'); //   3-oct 00:30 en Santiago; 22:30 del 2 en Lima
    moraDeps.ahora = () => new Date('2026-10-20T15:00:00Z');
    const evaluar = () => prisma.$transaction((tx) => evaluarMora(tx, { complejoId: d.complejoB.id, estructuraId: null, mes: 10, anio: 2026, unidadIds: [aTiempo.id, tarde.id] }));
    try {
      assert.deepEqual([...(await evaluar()).tarde], [tarde.id], 'Santiago: sólo el de las 00:30');
      await ponerZona(d.complejoB.id, 'America/Lima');
      assert.deepEqual([...(await evaluar()).tarde], [], 'control: con la hora de Lima los dos eran a tiempo');
    } finally {
      await limpiarCargos(recibo.id);
      await prisma.unidad.deleteMany({ where: { id: { in: [aTiempo.id, tarde.id] } } });
      await ponerZona(d.complejoB.id, 'America/Lima');
    }
  });

  it('«aún no vence» también es de su zona: a las 23:30 del día del vencimiento en Santiago todavía no se evalúa a nadie; a las 00:30 sí', async () => {
    await ponerZona(d.complejoB.id, 'America/Santiago');
    const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaB.id, complejo_id: d.complejoB.id, mes: 9, anio: 2026, fecha_emision: new Date('2026-09-15T00:00:00Z'), fecha_vencimiento: new Date('2026-10-02T00:00:00Z'), estado: 'emitido' } });
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: d.conceptoB.id, monto: 0, orden: 1 } });
    await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: d.unidadB1.id, monto: 100, estado_pago: 'pendiente' } });
    const evaluar = () => prisma.$transaction((tx) => evaluarMora(tx, { complejoId: d.complejoB.id, estructuraId: null, mes: 10, anio: 2026, unidadIds: [d.unidadB1.id] }));
    try {
      moraDeps.ahora = () => new Date('2026-10-03T02:30:00Z'); // 2-oct 23:30 en Santiago (en Lima: 21:30)
      assert.equal((await evaluar()).aunNoVence, true);
      moraDeps.ahora = () => new Date('2026-10-03T03:30:00Z'); // 3-oct 00:30 en Santiago (en Lima: 22:30 del 2)
      const ev = await evaluar();
      assert.equal(ev.aunNoVence, false);
      assert.deepEqual([...ev.tarde], [d.unidadB1.id], 'sin pago, a las 00:30 ya pagó tarde');
      await ponerZona(d.complejoB.id, 'America/Lima');
      assert.equal((await evaluar()).aunNoVence, true, 'control: en Lima, a esa hora todavía es el día del vencimiento');
    } finally {
      await limpiarCargos(recibo.id);
      await ponerZona(d.complejoB.id, 'America/Lima');
    }
  });
});

describe('avisos programados: cada condominio con su «hoy»', () => {
  // 10-dic 23:30 UTC = 18:30 en Lima (día 10) y 00:30 del día 11 en Madrid (CET, UTC+1).
  const X = new Date('2026-12-10T23:30:00Z');
  const hechas: number[] = [];
  const notifs = () => prisma.notificacion.findMany({ where: { ref_id: { in: hechas } }, orderBy: [{ ref_id: 'asc' }, { usuario_id: 'asc' }] });

  before(async () => { await ponerZona(d.complejoB.id, 'Europe/Madrid'); });
  after(async () => {
    await limpiarCargos(...hechas);
    await ponerZona(d.complejoB.id, 'America/Lima');
  });

  it('el planificador evalúa cada condominio con su día: el mismo instante es «vence hoy» en Lima y «vencido» en Madrid', async () => {
    const aHoy = await cargoEn(d.complejoA, d.unidadA1.id, '2026-12-10'); //  Lima: hoy es el 10 → vence_hoy
    const bHoy = await cargoEn(d.complejoB, d.unidadB1.id, '2026-12-10'); //  Madrid: hoy es el 11 → vencido (con la hora de Lima sería vence_hoy)
    const aDos = await cargoEn(d.complejoA, d.unidadA2.id, '2026-12-12'); //  Lima: faltan 2 días → por_vencer
    const bDos = await cargoEn(d.complejoB, d.unidadB1.id, '2026-12-12', 11); // Madrid: falta 1 día → nada (con la hora de Lima sería por_vencer)
    hechas.push(aHoy.recibo.id, bHoy.recibo.id, aDos.recibo.id, bDos.recibo.id);
    assert.equal(await encolarRecordatorios(X), 4, 'prop1 + inq1 (vence_hoy), prop2 (por_vencer), propB (vencido)');
    const porRecibo = (id: number) => notifs().then((n) => n.filter((x) => x.ref_id === id).map((x) => `${x.tipo}:${x.usuario_id}`).sort());
    assert.deepEqual(await porRecibo(aHoy.recibo.id), [`vence_hoy:${d.propietario1.id}`, `vence_hoy:${d.inquilino1.id}`].sort());
    assert.deepEqual(await porRecibo(bHoy.recibo.id), [`vencido:${d.propietarioB.id}`]);
    assert.deepEqual(await porRecibo(aDos.recibo.id), [`por_vencer:${d.propietario2.id}`]);
    assert.deepEqual(await porRecibo(bDos.recibo.id), [], 'en Madrid todavía no toca el recordatorio de 2 días');
    assert.equal(await encolarRecordatorios(X), 0, 'repetir no duplica');
  });

  it('una hora después de que Madrid cambia de día, los días que faltan salen con su calendario («vence mañana», no «en 2 días»)', async () => {
    const { encolarAviso } = await import('../src/server/services/avisos');
    const bDos = hechas[3]!; // Madrid, vence el 12-dic
    await encolarAviso('por_vencer', d.propietarioB.id, { entidad: 'recibo', id: bDos }, { ahora: X });
    const n = (await notifs()).find((x) => x.ref_id === bDos && x.tipo === 'por_vencer')!;
    assert.match(n.asunto, /vence mañana/, 'Madrid está en el día 11: falta 1 día');
    await prisma.notificacion.delete({ where: { id: n.id } });
    await encolarAviso('por_vencer', d.propietario2.id, { entidad: 'recibo', id: hechas[2]! }, { ahora: new Date(X.getTime() + 60_000) });
    const a = (await notifs()).filter((x) => x.ref_id === hechas[2]! && x.tipo === 'por_vencer');
    assert.ok(a.length >= 1 && a.every((x) => /vence en 2 días/.test(x.asunto)), 'Lima sigue en el día 10: faltan 2 días');
  });
});

describe('la fecha del voucher se juzga con el día del condominio', () => {
  const lectura = { fecha: '2026-12-11', es_comprobante_de_pago: true, legible: true, estado_operacion: 'exitosa' } as const;
  const emision = new Date('2026-12-01T00:00:00Z');
  const hoy = new Date('2026-12-10T23:30:00Z'); // 10-dic en Lima; 11-dic 00:30 en Madrid

  it('el 11-dic es una fecha FUTURA en Lima y vale en Madrid (que ya está en el 11)', () => {
    assert.equal(decidirFecha(lectura, { hoy, emision, zona: 'America/Lima' }).tipo, 'invalida');
    assert.equal(decidirFecha(lectura, { hoy, emision }).tipo, 'invalida', 'sin zona, la de Lima (como siempre)');
    const m = decidirFecha(lectura, { hoy, emision, zona: 'Europe/Madrid' });
    assert.equal(m.tipo, 'aplicar');
    assert.equal(m.tipo === 'aplicar' && m.fecha.toISOString(), '2026-12-11T12:00:00.000Z', 'se guarda al mediodía UTC, igual que en Lima');
  });

  it('en una zona al este de UTC+12 el mediodía UTC ya es otro día: se guarda al mediodía local para que se vea el día leído', () => {
    const nz = decidirFecha({ ...lectura, fecha: '2026-12-10' }, { hoy, emision, zona: 'Pacific/Auckland' }); // 11-dic 12:30 en Auckland (UTC+13)
    assert.equal(nz.tipo, 'aplicar');
    if (nz.tipo === 'aplicar') assert.equal(hoyEn('Pacific/Auckland', nz.fecha).toISOString().slice(0, 10), '2026-12-10');
  });
});

describe('historial del residente: estado y días contra el vencimiento en la zona del condominio', () => {
  it('un pago a las 00:30 del día siguiente al vencimiento en Santiago es de 1 día de atraso (en Lima, a tiempo); y el estado cambia con su hora', async () => {
    await ponerZona(d.complejoB.id, 'America/Santiago'); // octubre: UTC−3
    const pagado = await cargoEn(d.complejoB, d.unidadB1.id, '2026-10-02', 9);
    await prisma.reciboConceptoUnidad.update({ where: { id: pagado.cargo.id }, data: { estado_pago: 'pagado', fecha_pago: new Date('2026-10-03T03:30:00Z') } });
    await prisma.pago.create({ data: { recibo_concepto_unidad_id: pagado.cargo.id, monto: 100, fecha_pago: new Date('2026-10-03T03:30:00Z'), estado_validacion: 'validado', metodo_pago: 'yape' } });
    const abierto = await cargoEn(d.complejoB, d.unidadB1.id, '2026-10-18', 10);
    const mes = async (ahora: Date, mesN: number) => (await historialResidente({ id: d.unidadB1.id }, { anio: 2026, ahora })).meses.find((m) => m.mes === mesN)!;
    const diaDePagoEnExcel = async () => {
      const libro = XLSX.read(historialXlsx(await historialResidente({ id: d.unidadB1.id }, { anio: 2026, ahora: new Date('2026-10-20T15:00:00Z') })));
      const filas = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets['Meses']!, { header: 1 });
      return filas.find((f) => /setiembre|septiembre/i.test(String(f[0])))?.[7];
    };
    try {
      assert.equal(await diaDePagoEnExcel(), '03/10/2026', 'el Excel dice el día del pago en Santiago (00:30 del 3), no el de Lima');
      const m9 = await mes(new Date('2026-10-20T15:00:00Z'), 9);
      assert.equal(m9.dias_vs_vencimiento, 1, 'Santiago: 3-oct 00:30');
      assert.equal(m9.zona_horaria, 'America/Santiago');
      assert.equal((await mes(new Date('2026-10-19T02:30:00Z'), 10)).estado, 'pendiente', '18-oct 23:30 en Santiago: todavía el día del vencimiento');
      assert.equal((await mes(new Date('2026-10-19T03:30:00Z'), 10)).estado, 'vencido', '19-oct 00:30 en Santiago (en Lima aún es el 18)');
      await ponerZona(d.complejoB.id, 'America/Lima');
      assert.equal(await diaDePagoEnExcel(), '02/10/2026', 'control: en Lima era el 2');
      assert.equal((await mes(new Date('2026-10-20T15:00:00Z'), 9)).dias_vs_vencimiento, 0, 'control: en Lima eran las 22:30 del 2-oct');
      assert.equal((await mes(new Date('2026-10-19T03:30:00Z'), 10)).estado, 'pendiente', 'control: en Lima aún es el 18');
    } finally {
      await limpiarCargos(pagado.recibo.id, abierto.recibo.id);
      await ponerZona(d.complejoB.id, 'America/Lima');
    }
  });
});

describe('el correo del voucher a la junta dice la fecha y hora del condominio', () => {
  it('el mismo pago sale a las 14:32 en Lima y a las 20:32 en Madrid', async () => {
    const block = await prisma.estructura.create({ data: { nombre: 'Block Z', tipo: 'block', complejo_id: d.complejoB.id, correo_vouchers: 'junta.z@ejemplo.test' } });
    await prisma.unidad.update({ where: { id: d.unidadB1.id }, data: { estructura_id: block.id } });
    const c = await cargoEn(d.complejoB, d.unidadB1.id, '2026-12-30', 12);
    const pago = await prisma.pago.create({ data: { recibo_concepto_unidad_id: c.cargo.id, monto: 100, fecha_pago: new Date('2026-10-28T19:32:00Z'), estado_validacion: 'por_validar', metodo_pago: 'yape', usuario_id: d.propietarioB.id } });
    await prisma.archivoComprobante.create({ data: { pago_id: pago.id, nombre: 'v.png', tipo_mime: 'image/png', tamano: 4, sha256: 'zona-horaria-sha', datos: Buffer.from([1, 2, 3, 4]) } });
    const enviados: string[] = [];
    const deps = { ...voucherBlockDeps, esperaReintentoMs: 0, env: { RESEND_API_KEY: 're_CLAVE-FALSA-NO-REAL', MAIL_FROM: 'House <house@ejemplo.test>' } as NodeJS.ProcessEnv, fetch: (async (_u: unknown, init?: { body?: unknown }) => { enviados.push(JSON.parse(String(init?.body)).text); return new Response('{"id":"x"}', { status: 200 }); }) as typeof fetch };
    try {
      await ponerZona(d.complejoB.id, 'America/Lima');
      await avisarVoucherAlBlock(pago.id, deps);
      await prisma.auditoria.deleteMany({ where: { accion: 'avisar_voucher_block', entidad_id: pago.id } }); // para poder avisar otra vez
      await ponerZona(d.complejoB.id, 'Europe/Madrid');
      await avisarVoucherAlBlock(pago.id, deps);
      assert.equal(enviados.length, 2, enviados.join('\n'));
      assert.match(enviados[0]!, /Fecha: 28 de octubre de 2026, 14:32/);
      assert.match(enviados[1]!, /Fecha: 28 de octubre de 2026, 20:32/);
    } finally {
      await limpiarCargos(c.recibo.id);
      await prisma.auditoria.deleteMany({ where: { accion: 'avisar_voucher_block', entidad_id: pago.id } });
      await prisma.unidad.update({ where: { id: d.unidadB1.id }, data: { estructura_id: null } });
      await prisma.estructura.delete({ where: { id: block.id } });
      await ponerZona(d.complejoB.id, 'America/Lima');
    }
  });
});

describe('rutas y resumen con el reloj fijado (Date simulada)', () => {
  afterEach(() => { mock.timers.reset(); });
  /** Corre `f` con la fecha del sistema fijada en `ahora`: el servidor (en este proceso) y las sesiones nacen en ese instante. */
  const en = async <T>(ahora: string, f: () => Promise<T>): Promise<T> => {
    mock.timers.reset();
    mock.timers.enable({ apis: ['Date'], now: Date.parse(ahora) });
    try {
      return await f();
    } finally {
      mock.timers.reset();
    }
  };
  const verPago = (cargoId: number, monto: number, fecha: string) =>
    prisma.pago.create({ data: { recibo_concepto_unidad_id: cargoId, monto, fecha_pago: new Date(fecha), estado_validacion: 'validado', metodo_pago: 'yape' } });

  it('lista de cargos, recibos y «mis cargos»: el estado de cada uno sale con la hora de su condominio', async () => {
    await ponerZona(d.complejoB.id, 'America/Mexico_City');
    const a = await cargoEn(d.complejoA, d.unidadA1.id, '2026-12-10');
    const b = await cargoEn(d.complejoB, d.unidadB1.id, '2026-12-10');
    try {
      await en('2026-12-11T05:30:00Z', async () => { // 00:30 del 11 en Lima; 23:30 del 10 en México
        const sup = await login(base, 'super@test.pe');
        const cargos = await llamar(base, 'GET', '/api/recibo-concepto-unidades?pageSize=100&estado=vencido', sup);
        assert.equal(cargos.status, 200, cargos.texto);
        const ids = (cargos.body.items as { id: number }[]).map((c) => c.id);
        assert.ok(ids.includes(a.cargo.id) && !ids.includes(b.cargo.id), 'Lima venció; México no');
        const todos = await llamar(base, 'GET', '/api/recibo-concepto-unidades?pageSize=100', sup);
        const est = (id: number) => (todos.body.items as { id: number; estado: string }[]).find((c) => c.id === id)?.estado;
        assert.deepEqual([est(a.cargo.id), est(b.cargo.id)], ['vencido', 'pendiente']);
        const recibos = await llamar(base, 'GET', '/api/recibos?pageSize=100', sup);
        const cobranza = (id: number) => (recibos.body.items as { id: number; estado_cobranza: string }[]).find((r) => r.id === id)?.estado_cobranza;
        assert.deepEqual([cobranza(a.recibo.id), cobranza(b.recibo.id)], ['vencido', 'pendiente']);
        const detalle = await llamar(base, 'GET', `/api/recibos/${b.recibo.id}`, sup);
        assert.equal(detalle.body.estado_cobranza, 'pendiente');
        assert.equal(detalle.body.cargos.find((c: { id: number }) => c.id === b.cargo.id).estado, 'pendiente');
        const prop1 = await login(base, 'prop1@test.pe');
        const propB = await login(base, 'propb@test.pe');
        const mios = async (t: string, id: number) => (await llamar(base, 'GET', '/api/me/cargos?pageSize=100', t)).body.items.find((c: { id: number }) => c.id === id)?.estado;
        assert.equal(await mios(prop1, a.cargo.id), 'vencido');
        assert.equal(await mios(propB, b.cargo.id), 'pendiente');
        const resumenB = await llamar(base, 'GET', '/api/dashboard/resumen', propB);
        assert.equal(resumenB.body.vencidos, 1, 'sólo el cargo viejo de siempre: el del 10-dic todavía no venció en México');
      });
      await en('2026-12-11T06:30:00Z', async () => { // 00:30 del 11 en México
        const propB = await login(base, 'propb@test.pe');
        const resumenB = await llamar(base, 'GET', '/api/dashboard/resumen', propB);
        assert.equal(resumenB.body.vencidos, 2, 'ya es el 11 en México: vence también el del 10-dic');
      });
    } finally {
      mock.timers.reset();
      await limpiarCargos(a.recibo.id, b.recibo.id);
      await ponerZona(d.complejoB.id, 'America/Lima');
    }
  });

  it('«cobrado este mes» y la serie por mes: cada condominio cuenta con la hora de SU zona', async () => {
    await ponerZona(d.complejoB.id, 'Europe/Madrid');
    const a = await cargoEn(d.complejoA, d.unidadA1.id, '2026-11-15', 10);
    const b = await cargoEn(d.complejoB, d.unidadB1.id, '2026-11-15', 10);
    // 31-oct 23:30 UTC: 18:30 en Lima (sigue octubre) y 00:30 del 1-nov en Madrid (ya es noviembre).
    await verPago(a.cargo.id, 10, '2026-10-31T12:00:00Z');
    await verPago(a.cargo.id, 20, '2026-10-31T23:15:00Z');
    await verPago(b.cargo.id, 30, '2026-10-31T12:00:00Z');
    await verPago(b.cargo.id, 40, '2026-10-31T23:15:00Z');
    try {
      await en('2026-10-31T23:30:00Z', async () => {
        const sup = await login(base, 'super@test.pe');
        const r = await llamar(base, 'GET', '/api/dashboard/resumen', sup);
        assert.equal(r.status, 200, r.texto);
        // Lima: octubre completo = 10 + 20. Madrid: noviembre desde el 31-oct 23:00 UTC = 40.
        assert.equal(r.body.cobrado_mes, '70.00', 'Lima 30 + Madrid 40 (con la hora de Lima serían 100)');
        const serie = Object.fromEntries((r.body.cobrado_por_mes as { mes: string; cobrado: string }[]).map((m) => [m.mes, m.cobrado]));
        assert.equal(serie['2026-10'], '60.00', 'octubre: Lima 10 + 20 y Madrid 30');
        assert.equal(serie['2026-11'], '40.00', 'noviembre ya existe en Madrid: su pago de las 00:15');
        const soloA = await llamar(base, 'GET', `/api/dashboard/resumen?complejo_id=${d.complejoA.id}`, sup);
        assert.equal(soloA.body.cobrado_mes, '30.00');
        assert.equal(soloA.body.cobrado_por_mes.at(-1).mes, '2026-10', 'sin Madrid en el alcance la serie termina en octubre');
        const soloB = await llamar(base, 'GET', `/api/dashboard/resumen?complejo_id=${d.complejoB.id}`, sup);
        assert.equal(soloB.body.cobrado_mes, '40.00');
        assert.equal(soloB.body.cobrado_por_mes.at(-1).mes, '2026-11');
      });
    } finally {
      mock.timers.reset();
      await limpiarCargos(a.recibo.id, b.recibo.id);
      await ponerZona(d.complejoB.id, 'America/Lima');
    }
  });

  it('un contrato nuevo empieza el día de hoy en el condominio (Auckland ya está en el 11 cuando en Lima es el 10)', async () => {
    const c = await prisma.complejoHabitacional.create({ data: { nombre: 'Nuevo Auckland', tipo: 'Edificio', empresa_id: d.empresaA.id, zona_horaria: 'Pacific/Auckland' } });
    try {
      await en('2026-12-11T04:30:00Z', async () => { // 10-dic 23:30 en Lima; 11-dic 17:30 en Auckland (UTC+13)
        const contrato = await prisma.$transaction((tx) => abrirContrato(tx, c.id, d.empresaA.id));
        assert.equal(iso(contrato.fecha_inicio), '2026-12-11');
        await prisma.contratoAdministracion.deleteMany({ where: { complejo_id: c.id } });
        assert.ok((await crearContratosIniciales(prisma)) >= 1);
        const inicial = await prisma.contratoAdministracion.findFirstOrThrow({ where: { complejo_id: c.id } });
        assert.equal(iso(inicial.fecha_inicio), '2026-12-11', 'la migración de contratos también cuenta el día en el condominio');
      });
    } finally {
      mock.timers.reset();
      await prisma.contratoAdministracion.deleteMany({ where: { complejo_id: { in: [c.id, d.complejoA.id, d.complejoB.id] } } });
      await prisma.complejoHabitacional.delete({ where: { id: c.id } });
    }
  });
});

describe('asistente, herramientas, reportes y detalle: también con la hora de cada condominio', () => {
  const relojCooldown = cooldownDeps.ahora;
  afterEach(() => { mock.timers.reset(); cooldownDeps.ahora = relojCooldown; });
  const en = async <T>(ahora: string, f: () => Promise<T>): Promise<T> => {
    mock.timers.reset();
    mock.timers.enable({ apis: ['Date'], now: Date.parse(ahora) });
    cooldownDeps.ahora = () => Date.now();
    try {
      return await f();
    } finally {
      mock.timers.reset();
      cooldownDeps.ahora = relojCooldown;
    }
  };
  const comoUsuario = async (email: string): Promise<AuthUser> => {
    const u = await prisma.usuario.findUniqueOrThrow({ where: { email } });
    return { id: u.id, email: u.email, rol: u.rol, empresa_id: u.empresa_id, complejo_id: u.complejo_id, estructura_id: null, cargo_junta: null } as unknown as AuthUser;
  };
  const datosDe = (r: Awaited<ReturnType<typeof ejecutarHerramienta>>): Record<string, any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.ok(r.ok, JSON.stringify(r));
    return (r as { datos: Record<string, any> }).datos; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const X1 = '2026-12-11T05:30:00Z'; // 00:30 del 11 en Lima; 23:30 del 10 en México
  const X2 = '2026-12-11T06:30:00Z'; // 00:30 del 11 en México
  let a: Awaited<ReturnType<typeof cargoEn>>;
  let b: Awaited<ReturnType<typeof cargoEn>>;

  before(async () => {
    await ponerZona(d.complejoB.id, 'America/Mexico_City');
    a = await cargoEn(d.complejoA, d.unidadA1.id, '2026-12-10');
    b = await cargoEn(d.complejoB, d.unidadB1.id, '2026-12-10');
  });
  after(async () => {
    await limpiarCargos(a.recibo.id, b.recibo.id);
    await ponerZona(d.complejoB.id, 'America/Lima');
  });

  it('herramienta mi_deuda y mis_recibos: el cargo del 10-dic está vencido en Lima y pendiente en México a la misma hora', async () => {
    // Cada departamento trae además cargos de la siembra que a esa fecha ya vencieron: la diferencia es el del 10-dic.
    await en(X1, async () => {
      const prop1 = datosDe(await ejecutarHerramienta(await comoUsuario('prop1@test.pe'), 'mi_deuda', {}, { origen: 'asistente' }));
      const propB = datosDe(await ejecutarHerramienta(await comoUsuario('propb@test.pe'), 'mi_deuda', {}, { origen: 'asistente' }));
      assert.equal(prop1.cargos_vencidos, 3, 'Lima: los dos de la siembra (a esa fecha ya vencieron) y el del 10-dic');
      assert.equal(propB.cargos_vencidos, 1, 'México: sólo el viejo');
      const recibos = datosDe(await ejecutarHerramienta(await comoUsuario('propb@test.pe'), 'mis_recibos', {}, { origen: 'asistente' }));
      assert.equal(recibos.filas.find((f: { periodo: string }) => /diciembre/.test(f.periodo)).estado, 'pendiente');
    });
    await en(X2, async () => {
      const propB = datosDe(await ejecutarHerramienta(await comoUsuario('propb@test.pe'), 'mi_deuda', {}, { origen: 'asistente' }));
      assert.equal(propB.cargos_vencidos, 2);
      const recibos = datosDe(await ejecutarHerramienta(await comoUsuario('propb@test.pe'), 'mis_recibos', {}, { origen: 'asistente' }));
      assert.equal(recibos.filas.find((f: { periodo: string }) => /diciembre/.test(f.periodo)).estado, 'vencido');
    });
  });

  it('contexto del asistente: «hoy» y los vencidos son los del condominio de la persona; la fecha de su último pago, en su zona', async () => {
    const pago = await prisma.pago.create({ data: { recibo_concepto_unidad_id: b.cargo.id, monto: 5, fecha_pago: new Date(X1), estado_validacion: 'por_validar', metodo_pago: 'yape', usuario_id: d.propietarioB.id } });
    try {
      await en(X1, async () => {
        const mx = await cargarDatos(await comoUsuario('propb@test.pe'));
        const lima = await cargarDatos(await comoUsuario('prop1@test.pe'));
        assert.match(mx.hoy, /jueves, 10 de diciembre de 2026/, 'México: todavía es el 10');
        assert.match(lima.hoy, /viernes, 11 de diciembre de 2026/, 'Lima: ya es el 11');
        assert.equal(mx.residente!.vencidos, 1);
        assert.equal(lima.residente!.vencidos, 3);
        assert.equal(mx.residente!.ultimos_pagos[0]!.fecha, '10/12/2026', 'el pago de las 23:30 en México es del 10 (en UTC ya era el 11)');
      });
      await en(X2, async () => {
        assert.equal((await cargarDatos(await comoUsuario('propb@test.pe'))).residente!.vencidos, 2);
      });
    } finally {
      await prisma.pago.delete({ where: { id: pago.id } });
    }
  });

  it('reportes de morosidad y detalle del mantenimiento del residente: la mora cuenta desde el día siguiente en la hora del condominio', async () => {
    const fila = async (t: string) => {
      const r = await llamar(base, 'GET', '/api/reportes/morosidad?pageSize=100', t);
      assert.equal(r.status, 200, r.texto);
      return r.body.items.find((f: { unidad: { codigo: string } }) => f.unidad.codigo === 'B-101');
    };
    const vencidos = async (t: string) => (await fila(t)).cargos_vencidos;
    const atraso = async (t: string) => (await fila(t)).dias_max_atraso;
    const desdeSiembra = (dia: string) => Math.floor((Date.parse(`${dia}T00:00:00Z`) - d.reciboB.fecha_vencimiento.getTime()) / 86_400_000);
    const detalle = async (t: string) => (await llamar(base, 'GET', `/api/me/mantenimientos/${b.recibo.id}/${d.unidadB1.id}`, t)).body.estado;
    await en(X1, async () => {
      const adminB = await login(base, 'admin.b@test.pe');
      assert.equal(await vencidos(adminB), 1, 'México: sólo el viejo');
      assert.equal(await atraso(adminB), desdeSiembra('2026-12-10'), 'los días de atraso son los de México: todavía es el 10');
      assert.equal(await detalle(await login(base, 'propb@test.pe')), 'pendiente');
    });
    await en(X2, async () => {
      const adminB = await login(base, 'admin.b@test.pe');
      assert.equal(await vencidos(adminB), 2);
      assert.equal(await atraso(adminB), desdeSiembra('2026-12-11'));
      assert.equal(await detalle(await login(base, 'propb@test.pe')), 'vencido');
    });
  });

  it('la lista de residentes «morosos» también cuenta desde el día siguiente en la hora de su condominio', async () => {
    const z = await prisma.usuario.create({ data: { nombre: 'Residente Zeta', email: 'zeta@test.pe', rol: 'propietario', password_hash: 'x', empresa_id: d.empresaB.id, complejo_id: d.complejoB.id } });
    const un = await prisma.unidad.create({ data: { codigo: 'B-Z9', tipo: 'Departamento', complejo_id: d.complejoB.id, empresa_id: d.empresaB.id, propietario_id: z.id, estado: 'activa' } });
    const rc = await prisma.reciboConcepto.findFirstOrThrow({ where: { recibo_id: b.recibo.id } });
    await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: un.id, monto: 50, estado_pago: 'pendiente' } });
    const morosos = async (t: string) => ((await llamar(base, 'GET', '/api/usuarios?tipo=residente&estado=moroso&pageSize=100', t)).body.items as { id: number }[]).map((u) => u.id);
    try {
      await en(X1, async () => assert.ok(!(await morosos(await login(base, 'admin.b@test.pe'))).includes(z.id), 'México: aún no'));
      await en(X2, async () => assert.ok((await morosos(await login(base, 'admin.b@test.pe'))).includes(z.id), 'México: ya'));
    } finally {
      await prisma.reciboConceptoUnidad.deleteMany({ where: { unidad_id: un.id } });
      await prisma.unidad.delete({ where: { id: un.id } });
      await prisma.usuario.delete({ where: { id: z.id } });
    }
  });

  it('cobranza_por_mes: cada pago cuenta en el mes de la zona de su condominio', async () => {
    await ponerZona(d.complejoB.id, 'Europe/Madrid');
    const ca = await cargoEn(d.complejoA, d.unidadA1.id, '2026-11-15', 10);
    const cb = await cargoEn(d.complejoB, d.unidadB1.id, '2026-11-15', 10);
    const pagos = [[ca, 10, '2026-10-31T12:00:00Z'], [ca, 20, '2026-10-31T23:15:00Z'], [cb, 30, '2026-10-31T12:00:00Z'], [cb, 40, '2026-10-31T23:15:00Z']] as const;
    for (const [c, monto, fecha] of pagos) await prisma.pago.create({ data: { recibo_concepto_unidad_id: c.cargo.id, monto, fecha_pago: new Date(fecha), estado_validacion: 'validado', metodo_pago: 'yape' } });
    try {
      await en('2026-10-31T23:30:00Z', async () => {
        const r = datosDe(await ejecutarHerramienta(await comoUsuario('super@test.pe'), 'cobranza_por_mes', { meses: 2 }, { origen: 'asistente' }));
        const cobrado = Object.fromEntries(r.filas.map((f: { periodo: string; cobrado: string }) => [f.periodo, f.cobrado]));
        assert.deepEqual(Object.values(cobrado), ['60.00', '40.00'], JSON.stringify(r.filas));
      });
    } finally {
      await limpiarCargos(ca.recibo.id, cb.recibo.id);
      await ponerZona(d.complejoB.id, 'America/Mexico_City');
    }
  });
});
