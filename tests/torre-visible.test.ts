// La torre se VE y se FILTRA en toda la aplicación: recibos, pagos, panel, morosidad, residente, avisos y asistente. Cada torre tiene su recibo.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { cargarDatos, bloqueDe } from '../src/server/services/asistente/contexto';
import { hoyLima } from '../src/server/lib/fechas';
import { encolarAviso, encolarReciboEmitido } from '../src/server/services/avisos';
import { plantilla } from '../src/server/services/avisos/plantillas';
import { ejecutarHerramienta } from '../src/server/tools';
import type { AuthUser } from '../src/server/middleware/auth';
import { iniciar, llamar, login, prisma } from './helpers/app';
import { sembrarHerramientas, usuarioDe, type DatosHerramientas } from './helpers/herramientas';

let base: string;
let cerrar: () => Promise<void>;
let d: DatosHerramientas;
let T: Record<'adminA' | 'adminB' | 'juntaB1' | 'prop1', string>;
let U: Record<'adminA' | 'juntaB1' | 'prop1' | 'prop2', AuthUser>;
/** Recibo de julio del Block 1 (cargo de la A-101) y del Block 2 (cargo de la A-102): cada torre su recibo. */
let recibo1: { id: number };
let recibo2: { id: number };
let pago1: { id: number };

const DIA = 86_400_000;

before(async () => {
  d = await sembrarHerramientas();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'), juntaB1: await login(base, 'tesorero1@test.pe'), prop1: await login(base, 'prop1@test.pe') };
  U = { adminA: await usuarioDe(d.adminA.id), juntaB1: await usuarioDe(d.juntaBlock1.id), prop1: await usuarioDe(d.propietario1.id), prop2: await usuarioDe(d.propietario2.id) };
  const vence = new Date(Date.now() + 20 * DIA);
  const recibo = (estructura_id: number, descripcion: string) => prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, estructura_id, mes: 7, anio: 2026, fecha_emision: new Date(), fecha_vencimiento: vence, estado: 'emitido', descripcion } });
  recibo1 = await recibo(d.block1.id, 'Mantenimiento de julio de 2026 · Block 1');
  recibo2 = await recibo(d.block2.id, 'Mantenimiento de julio de 2026 · Block 2');
  for (const [r, unidad, monto] of [[recibo1, d.unidadA1, 120], [recibo2, d.unidadA2, 220]] as const) {
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: r.id, concepto_id: d.conceptoA.id, monto, orden: 1 } });
    await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidad.id, monto, estado_pago: 'pendiente' } });
  }
  const cargo1 = await prisma.reciboConceptoUnidad.findFirstOrThrow({ where: { reciboConcepto: { recibo_id: recibo1.id } } });
  pago1 = await prisma.pago.create({ data: { recibo_concepto_unidad_id: cargo1.id, monto: 120, metodo_pago: 'yape', estado_validacion: 'por_validar', usuario_id: d.propietario1.id } });
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

const datos = async (u: AuthUser, nombre: string, entrada: unknown = {}) => {
  const r = await ejecutarHerramienta(u, nombre, entrada, { origen: 'asistente' });
  assert.ok(r.ok, `${nombre} falló: ${r.ok ? '' : r.mensaje}`);
  return r.datos as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};

describe('API: Recibos con su torre', () => {
  it('la lista trae la torre de cada recibo y se filtra por estructura_id', async () => {
    const todos = await llamar(base, 'GET', `/api/recibos?complejo_id=${d.complejoA.id}&anio=2026&mes=7&pageSize=50`, T.adminA);
    assert.equal(todos.status, 200);
    assert.deepEqual(todos.body.items.map((r: { estructura: { nombre: string } }) => r.estructura.nombre).sort(), ['Block 1', 'Block 2']);
    const uno = await llamar(base, 'GET', `/api/recibos?estructura_id=${d.block2.id}`, T.adminA);
    assert.deepEqual(uno.body.items.map((r: { id: number }) => r.id), [recibo2.id]);
    assert.equal(uno.body.items[0].totales.monto, '220.00', 'los totales son sólo de esa torre');
    // Un recibo viejo sin torre sigue saliendo, con estructura null.
    const viejo = await llamar(base, 'GET', `/api/recibos/${d.reciboFuturoA.id}`, T.adminA);
    assert.equal(viejo.body.estructura, null);
  });

  it('el detalle trae la torre del recibo y la de cada unidad de sus cargos', async () => {
    const r = await llamar(base, 'GET', `/api/recibos/${recibo1.id}`, T.adminA);
    assert.deepEqual(r.body.estructura, { id: d.block1.id, nombre: 'Block 1' });
    assert.deepEqual(r.body.cargos[0].unidad.estructura, { id: d.block1.id, nombre: 'Block 1' });
    assert.equal(r.body.totales.monto, '120.00');
  });

  it('el recibo de otra empresa sigue siendo 404 (no hay recibo de torre ajena)', async () => {
    assert.equal((await llamar(base, 'GET', `/api/recibos/${recibo1.id}`, T.adminB)).status, 404);
  });
});

describe('API: Pagos con torre y condominio', () => {
  it('cada pago trae la torre y el condominio de su unidad y se filtra por estructura_id y complejo_id', async () => {
    const todos = await llamar(base, 'GET', '/api/pagos?pageSize=100', T.adminA);
    const p = todos.body.items.find((x: { id: number }) => x.id === pago1.id);
    assert.deepEqual(p.unidad.estructura, { id: d.block1.id, nombre: 'Block 1' });
    assert.deepEqual(p.unidad.complejo, { id: d.complejoA.id, nombre: 'Complejo A', moneda: 'PEN' });
    assert.equal(p.recibo.estructura.nombre, 'Block 1');
    const b2 = await llamar(base, 'GET', `/api/pagos?estructura_id=${d.block2.id}&pageSize=100`, T.adminA);
    assert.ok(b2.body.items.length > 0);
    assert.ok(b2.body.items.every((x: { unidad: { estructura: { id: number } } }) => x.unidad.estructura.id === d.block2.id));
    const b1 = await llamar(base, 'GET', `/api/pagos?estructura_id=${d.block1.id}&pageSize=100`, T.adminA);
    assert.ok(b1.body.items.some((x: { id: number }) => x.id === pago1.id));
    assert.ok(b1.body.items.every((x: { unidad: { estructura: { id: number } } }) => x.unidad.estructura.id === d.block1.id));
    const c = await llamar(base, 'GET', `/api/pagos?complejo_id=${d.complejoA.id}&pageSize=100`, T.adminA);
    assert.ok(c.body.items.every((x: { unidad: { complejo: { id: number } } }) => x.unidad.complejo.id === d.complejoA.id));
    const otro = await llamar(base, 'GET', `/api/pagos?complejo_id=${d.complejoB.id}&pageSize=100`, T.adminA);
    assert.equal(otro.body.total, 0, 'un condominio de otra empresa no aparece aunque se pida');
  });

  it('la junta del Block 1 sólo ve los pagos de su block, también con filtro', async () => {
    const r = await llamar(base, 'GET', `/api/pagos?estructura_id=${d.block2.id}&pageSize=100`, T.juntaB1);
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 0);
  });
});

describe('API: panel, morosidad y residente', () => {
  it('«recibos emitidos» cuenta periodos (no un recibo por torre) y por_torre desglosa; recibos_total sigue siendo el conteo bruto', async () => {
    const r = await llamar(base, 'GET', '/api/dashboard/resumen', T.adminA);
    const brutos = await prisma.recibo.count({ where: { empresa_id: d.empresaA.id } });
    assert.equal(r.body.recibos_total, brutos);
    // Los dos recibos de julio (torres distintas) son UN periodo.
    const periodos = await prisma.recibo.groupBy({ by: ['complejo_id', 'anio', 'mes'], where: { empresa_id: d.empresaA.id } });
    assert.equal(r.body.recibos_emitidos, periodos.length);
    assert.ok(r.body.recibos_emitidos < r.body.recibos_total);
    const b2 = r.body.por_torre.find((x: { estructura_id: number }) => x.estructura_id === d.block2.id);
    assert.equal(b2.nombre, 'Block 2');
    assert.equal(b2.complejo.nombre, 'Complejo A');
    assert.deepEqual(Object.keys(b2).sort(), ['cobrado', 'complejo', 'emitido', 'estructura_id', 'moneda', 'morosos', 'nombre', 'por_cobrar']);
  });

  it('el panel se filtra por torre (cifras sólo de esa torre) y por condominio', async () => {
    const todo = await llamar(base, 'GET', '/api/dashboard/resumen', T.adminA);
    const b2 = await llamar(base, 'GET', `/api/dashboard/resumen?estructura_id=${d.block2.id}`, T.adminA);
    assert.equal(b2.status, 200);
    assert.equal(b2.body.unidades_total, 1);
    assert.deepEqual(b2.body.por_torre.map((x: { estructura_id: number }) => x.estructura_id), [d.block2.id]);
    assert.ok(Number(b2.body.cargos_pendientes_monto) < Number(todo.body.cargos_pendientes_monto));
    const otra = await llamar(base, 'GET', `/api/dashboard/resumen?complejo_id=${d.complejoB.id}`, T.adminA);
    assert.equal(otra.body.unidades_total, 0, 'el condominio de otra empresa no aparece');
    assert.equal((await llamar(base, 'GET', '/api/dashboard/resumen?estructura_id=abc', T.adminA)).status, 422);
  });

  it('morosidad: filtra por condominio, trae el condominio de cada fila y las cifras son de TODO el filtro (no de la página)', async () => {
    const r = await llamar(base, 'GET', `/api/reportes/morosidad?complejo_id=${d.complejoA.id}&pageSize=1`, T.adminA);
    assert.equal(r.status, 200);
    assert.equal(r.body.items.length, 1);
    assert.deepEqual(r.body.items[0].complejo, { id: d.complejoA.id, nombre: 'Complejo A', moneda: 'PEN' });
    assert.ok(r.body.total >= 2);
    assert.equal(r.body.resumen.unidades, r.body.total);
    const todas = await llamar(base, 'GET', `/api/reportes/morosidad?complejo_id=${d.complejoA.id}&pageSize=100`, T.adminA);
    const suma = todas.body.items.reduce((s: number, f: { deuda_total: string }) => s + Number(f.deuda_total), 0);
    assert.equal(r.body.resumen.deuda_total, suma.toFixed(2));
    const b1 = await llamar(base, 'GET', `/api/reportes/morosidad?estructura_id=${d.block1.id}`, T.adminA);
    assert.ok(b1.body.items.every((x: { estructura: { id: number } }) => x.estructura.id === d.block1.id));
    assert.equal((await llamar(base, 'GET', `/api/reportes/morosidad?complejo_id=${d.complejoB.id}`, T.adminA)).body.total, 0);
  });

  it('/api/me/unidades trae la torre de cada unidad', async () => {
    const r = await llamar(base, 'GET', '/api/me/unidades', T.prop1);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.items[0].estructura, { id: d.block1.id, nombre: 'Block 1' });
  });

  it('los pagos y mantenimientos del residente traen la torre', async () => {
    const m = await llamar(base, 'GET', '/api/me/mantenimientos', T.prop1);
    assert.equal(m.status, 200);
    assert.ok(m.body.items.every((x: { unidad: { estructura: { nombre: string } } }) => x.unidad.estructura.nombre === 'Block 1'));
    const p = await llamar(base, 'GET', '/api/me/pagos', T.prop1);
    assert.ok(p.body.items.every((x: { mantenimiento: { torre: string } | null }) => x.mantenimiento == null || x.mantenimiento.torre === 'Block 1'));
  });
});

describe('API: avisos con torre', () => {
  it('la lista de avisos se filtra por torre y cada aviso dice de qué recibo (y torre) trata', async () => {
    const n = await prisma.notificacion.create({ data: { usuario_id: d.propietario1.id, canal: 'email', tipo: 'recibo_emitido', asunto: 'x', cuerpo: 'y', estado: 'pendiente', ref_entidad: 'recibo', ref_id: recibo1.id } });
    await prisma.notificacion.create({ data: { usuario_id: d.propietario2.id, canal: 'email', tipo: 'recibo_emitido', asunto: 'x', cuerpo: 'y', estado: 'pendiente', ref_entidad: 'recibo', ref_id: recibo2.id } });
    const b1 = await llamar(base, 'GET', `/api/notificaciones?estructura_id=${d.block1.id}&pageSize=100`, T.adminA);
    assert.equal(b1.status, 200);
    assert.ok(b1.body.items.some((x: { id: number }) => x.id === n.id));
    assert.ok(b1.body.items.every((x: { usuario: { id: number } }) => x.usuario.id !== d.propietario2.id), 'el vecino del Block 2 no sale al filtrar el Block 1');
    const mio = b1.body.items.find((x: { id: number }) => x.id === n.id);
    assert.equal(mio.contexto.recibo.torre, 'Block 1');
    assert.equal(mio.contexto.recibo.mes, 7);
    assert.equal(mio.cuerpo, undefined, 'el cuerpo nunca viaja en el listado');
  });
});

describe('Avisos: departamento y torre en el mensaje', () => {
  it('la plantilla dice el departamento con su torre y firma con el condominio', () => {
    const base = { nombre: 'Ana Pérez', periodo: 'julio de 2026', monto: 'S/ 120.00', vencimiento: '02/08/2026', condominio: 'Los Libertadores' };
    const uno = plantilla('recibo_emitido', { ...base, departamentos: [{ codigo: 'B01-804', torre: 'Block 1' }] }).cuerpo;
    assert.match(uno, /Departamento: B01-804 \(Block 1\)\./);
    assert.match(uno, /— Administración de Los Libertadores/);
    const dos = plantilla('vencido', { ...base, departamentos: [{ codigo: 'B01-804', torre: 'Block 1', monto: 'S/ 120.00' }, { codigo: 'B02-101', torre: 'Block 2', monto: 'S/ 220.00' }] }).cuerpo;
    assert.match(dos, /- B01-804 \(Block 1\): S\/ 120\.00/);
    assert.match(dos, /- B02-101 \(Block 2\): S\/ 220\.00/);
    assert.match(plantilla('pago_validado', { ...base }).cuerpo, /— Administración de Los Libertadores/);
    assert.match(plantilla('vencido', { nombre: 'Ana', periodo: 'julio de 2026', monto: 'S/ 1.00', vencimiento: '02/08/2026' }).cuerpo, /— Administración de tu condominio/);
  });

  it('el aviso real de un recibo de torre nombra el departamento y la torre', async () => {
    await prisma.usuario.update({ where: { id: d.propietario1.id }, data: { aviso_email: true } });
    await prisma.notificacion.deleteMany({ where: { usuario_id: d.propietario1.id } });
    assert.ok((await encolarReciboEmitido(recibo1.id)) >= 1);
    const n = await prisma.notificacion.findFirstOrThrow({ where: { usuario_id: d.propietario1.id, ref_id: recibo1.id }, orderBy: { id: 'desc' } });
    assert.match(n.cuerpo, /Departamento: A-101 \(Block 1\)\./);
    assert.match(n.cuerpo, /— Administración de Complejo A/);
  });

  it('un vecino con departamentos en DOS torres dentro de un mismo recibo viejo recibe un solo aviso que los separa (no los fusiona)', async () => {
    await prisma.unidad.update({ where: { id: d.unidadA2.id }, data: { inquilino_id: d.propietario1.id } });
    try {
      const general = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, mes: 5, anio: 2026, fecha_emision: new Date(), fecha_vencimiento: new Date(Date.now() + 5 * DIA), estado: 'emitido' } });
      const rc = await prisma.reciboConcepto.create({ data: { recibo_id: general.id, concepto_id: d.conceptoA.id, monto: 50, orden: 1 } });
      await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: d.unidadA1.id, monto: 50, estado_pago: 'pendiente' } });
      await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: d.unidadA2.id, monto: 70, estado_pago: 'pendiente' } });
      await prisma.notificacion.deleteMany({ where: { usuario_id: d.propietario1.id } });
      assert.equal(await encolarAviso('recibo_emitido', d.propietario1.id, { entidad: 'recibo', id: general.id }), 1);
      const n = await prisma.notificacion.findFirstOrThrow({ where: { usuario_id: d.propietario1.id } });
      assert.match(n.cuerpo, /- A-101 \(Block 1\): S\/ 50\.00/);
      assert.match(n.cuerpo, /- A-102 \(Block 2\): S\/ 70\.00/);
      assert.match(n.cuerpo, /Total a pagar: S\/ 120\.00/);
    } finally {
      await prisma.unidad.update({ where: { id: d.unidadA2.id }, data: { inquilino_id: null } });
    }
  });
});

describe('Asistente: herramientas con block', () => {
  it('los recibos traen el block, se filtran por estructura_id y la junta del Block 1 no ve el recibo del Block 2', async () => {
    const todos = await datos(U.adminA, 'recibos', { periodo: '2026-07' });
    assert.deepEqual(todos.filas.map((f: { block: string }) => f.block).sort(), ['Block 1', 'Block 2']);
    assert.ok(todos.filas.every((f: { periodo: string }) => f.periodo === 'julio de 2026'));
    const b2 = await datos(U.adminA, 'recibos', { periodo: '2026-07', estructura_id: d.block2.id });
    assert.deepEqual(b2.filas.map((f: { id: number }) => f.id), [recibo2.id]);
    assert.equal(b2.filas[0].emitido, '220.00');
    const junta = await datos(U.juntaB1, 'recibos', { periodo: '2026-07' });
    assert.deepEqual(junta.filas.map((f: { id: number }) => f.id), [recibo1.id], 'sólo el de su block');
  });

  it('los cargos y los pagos traen block y condominio y aceptan los filtros', async () => {
    const c = await datos(U.adminA, 'cargos', { periodo: '2026-07' });
    assert.deepEqual(c.filas.map((f: { block: string }) => f.block).sort(), ['Block 1', 'Block 2']);
    const c2 = await datos(U.adminA, 'cargos', { periodo: '2026-07', estructura_id: d.block2.id });
    assert.deepEqual(c2.filas.map((f: { unidad: string; condominio: string }) => [f.unidad, f.condominio]), [['A-102', 'Complejo A']]);
    const p = await datos(U.adminA, 'pagos', { estructura_id: d.block1.id });
    assert.ok(p.filas.length > 0);
    assert.ok(p.filas.every((f: { block: string; condominio: string }) => f.block === 'Block 1' && f.condominio === 'Complejo A'));
    const v = await datos(U.adminA, 'pagos_por_validar', { estructura_id: d.block2.id });
    assert.deepEqual(v.filas, []);
  });

  it('resumen_cobranza, cobranza_por_concepto y cobranza_por_mes se acotan a un block y el periodo sale en letras', async () => {
    const todo = await datos(U.adminA, 'resumen_cobranza', { periodo: '2026-07' });
    const b2 = await datos(U.adminA, 'resumen_cobranza', { periodo: '2026-07', estructura_id: d.block2.id });
    assert.equal(todo.periodo, 'julio de 2026');
    assert.equal(todo.emitido, '340.00');
    assert.equal(b2.emitido, '220.00');
    const conc = await datos(U.adminA, 'cobranza_por_concepto', { anio: 2026, mes: 7, estructura_id: d.block1.id });
    assert.equal(conc.filas[0].emitido, '120.00');
    assert.equal(conc.periodo, 'julio de 2026');
    const mes = await datos(U.adminA, 'cobranza_por_mes', { meses: 3, estructura_id: d.block1.id });
    assert.ok(mes.filas.every((f: { periodo: string }) => /^[a-zé]+ de \d{4}$/.test(f.periodo)));
  });

  it('el residente ve su block junto al código de la unidad en deuda, recibos, pagos y medios de pago', async () => {
    const deuda = await datos(U.prop1, 'mi_deuda');
    assert.ok(deuda.por_unidad.every((x: { unidad: string; block: string }) => x.unidad === 'A-101' && x.block === 'Block 1'));
    assert.equal(deuda.proximo_vencimiento.block, 'Block 1');
    const recibos = await datos(U.prop1, 'mis_recibos');
    assert.ok(recibos.filas.every((x: { block: string }) => x.block === 'Block 1'));
    assert.ok(recibos.mantenimientos.every((x: { block: string }) => x.block === 'Block 1'));
    const pagos = await datos(U.prop1, 'mis_pagos');
    assert.ok(pagos.filas.length > 0 && pagos.filas.every((x: { block: string }) => x.block === 'Block 1'));
    const medios = await datos(U.prop1, 'medios_para_pagar');
    assert.ok(medios.filas.some((x: { ambito: string; block: string | null }) => x.ambito === 'block' && x.block === 'Block 1'));
    assert.ok(medios.filas.every((x: { ambito: string; block: string | null }) => x.ambito === 'condominio' ? x.block === null : x.block === 'Block 1'), 'nunca el medio de otro block');
  });

  it('el contexto del asistente dice el block de cada unidad y, para gestión, el desglose por block', async () => {
    const r = await cargarDatos(U.prop1);
    assert.deepEqual(r.residente!.unidades, [{ codigo: 'A-101', condominio: 'Complejo A', block: 'Block 1' }]);
    assert.match(bloqueDe(r), /SUS UNIDADES: A-101 \(Complejo A · Block 1\)/);
    const g = await cargarDatos(U.adminA);
    assert.ok(g.gestion!.blocks.some((b) => b.nombre === 'Block 2'));
    assert.match(bloqueDe(g), /- Por block \(cada block tiene su propio recibo\):\n\s{2}· Block \d: por cobrar S\/ /);
    const j = await cargarDatos(U.juntaB1);
    assert.deepEqual(j.gestion!.blocks.map((b) => b.nombre), ['Block 1'], 'la junta sólo ve su block');
  });
});

describe('panel: estados por mantenimiento, serie hasta el último recibo y palabra block/torre', () => {
  /** El recibo del mes que viene (ya emitido, como pasa al cerrar el mes): tiene que salir en la serie aunque sea posterior al actual. */
  let siguiente: { anio: number; mes: number; clave: string };
  before(async () => {
    // Un departamento con dos conceptos en julio: dos cargos y un solo mantenimiento.
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo1.id, concepto_id: d.conceptoA.id, monto: 30, orden: 2 } });
    await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: d.unidadA1.id, monto: 30, estado_pago: 'pendiente' } });
    const h = hoyLima();
    const sig = new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth() + 1, 1));
    siguiente = { anio: sig.getUTCFullYear(), mes: sig.getUTCMonth() + 1, clave: `${sig.getUTCFullYear()}-${String(sig.getUTCMonth() + 1).padStart(2, '0')}` };
    const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, estructura_id: d.block1.id, mes: siguiente.mes, anio: siguiente.anio, fecha_emision: new Date(), fecha_vencimiento: new Date(Date.now() + 40 * DIA), estado: 'emitido', descripcion: 'Mantenimiento del mes siguiente' } });
    const rc2 = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: d.conceptoA.id, monto: 77, orden: 1 } });
    await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc2.id, unidad_id: d.unidadA1.id, monto: 77, estado_pago: 'pendiente' } });
  });

  it('«estados» cuenta mantenimientos (un departamento en un mes), no cargos', async () => {
    const r = await llamar(base, 'GET', '/api/dashboard/resumen', T.adminA);
    assert.equal(r.status, 200);
    const cargos = await prisma.reciboConceptoUnidad.findMany({ where: { reciboConcepto: { recibo: { empresa_id: d.empresaA.id } } }, select: { unidad_id: true, reciboConcepto: { select: { recibo_id: true } } } });
    const mantenimientos = new Set(cargos.map((c) => `${c.reciboConcepto?.recibo_id}-${c.unidad_id}`)).size;
    const e = r.body.estados;
    assert.equal(e.pagado + e.pendiente + e.parcial + e.vencido + e.en_revision, mantenimientos);
    assert.ok(cargos.length > mantenimientos, 'el departamento con dos conceptos cuenta una sola vez');
  });

  it('«Emitido vs. cobrado» llega hasta el recibo del mes que viene (6 meses seguidos)', async () => {
    const r = await llamar(base, 'GET', '/api/dashboard/resumen', T.adminA);
    const serie = r.body.cobrado_por_mes as { mes: string; emitido: string }[];
    assert.equal(serie.length, 6);
    assert.equal(serie[5].mes, siguiente.clave);
    assert.equal(serie[5].emitido, '77.00', 'lo emitido en ese mes aunque todavía no empiece');
    const primero = new Date(Date.UTC(siguiente.anio, siguiente.mes - 1 - 5, 1));
    assert.equal(serie[0].mes, `${primero.getUTCFullYear()}-${String(primero.getUTCMonth() + 1).padStart(2, '0')}`);
  });

  it('la palabra es «block» si todas las estructuras son blocks, y «torre» en cuanto hay una torre', async () => {
    assert.equal((await llamar(base, 'GET', '/api/dashboard/resumen', T.adminA)).body.palabra_estructura, 'block');
    await prisma.estructura.create({ data: { nombre: 'Torre Z', tipo: 'Torre', complejo_id: d.complejoA.id } });
    assert.equal((await llamar(base, 'GET', '/api/dashboard/resumen', T.adminA)).body.palabra_estructura, 'torre');
  });
});
