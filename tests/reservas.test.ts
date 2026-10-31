// Reservas de áreas comunes: reglas (cruce, horario, pasado, anticipación, duración, zona horaria), permisos entre empresas y roles,
// carrera de dos pedidos a la vez, solo lectura y auditoría. Contra la base de pruebas, con la API real.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { darCortesia, esperar, iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { hoyLima } from '../src/server/lib/fechas';
import { hoyDelCondominio, instanteDePared, sumarDias, ventanaDelDia } from '../src/server/services/reservas';
import { invalidarComercial } from '../src/server/services/comercial/modulos';
import { MENSAJE_SOLO_LECTURA_VECINO } from '../src/server/services/comercial/operativo';

const HORA = 3_600_000;
const LIMA = 'America/Lima';
const TOKIO = 'Asia/Tokyo';
const dia = (n: number, zona = LIMA) => sumarDias(hoyDelCondominio(zona), n);

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
type Clave = 'super' | 'adminA' | 'adminB' | 'adminSin' | 'prop1' | 'prop2' | 'propB' | 'inq1' | 'segA' | 'mttoA';
let T: Record<Clave, string>;
let salon: { id: number }; // complejo A, 08:00–22:00, máx. 4 h, sin aprobación
let parrilla: { id: number }; // complejo A, requiere aprobación
let salonB: { id: number }; // complejo B
let abierta: { id: number }; // complejo A, 00:00–24:00 (para probar el pasado)
let salonTokio: { id: number };
let nocheTokio: { id: number };
let unidadTokio: { id: number };
let salonSL: { id: number }; // condominio en solo lectura
let unidadSL: { id: number };

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  const area = (complejo_id: number, nombre: string, extra: Record<string, unknown> = {}) =>
    prisma.areaComun.create({ data: { complejo_id, nombre, hora_apertura: '08:00', hora_cierre: '22:00', duracion_max_horas: 4, dias_anticipacion_max: 30, ...extra } });
  salon = await area(d.complejoA.id, 'Salón de eventos');
  parrilla = await area(d.complejoA.id, 'Parrilla', { requiere_aprobacion: true, duracion_max_horas: 3 });
  abierta = await area(d.complejoA.id, 'Terraza 24 h', { hora_apertura: '00:00', hora_cierre: '24:00', duracion_max_horas: 24 });
  salonB = await area(d.complejoB.id, 'Salón B');
  // Un condominio en otra zona horaria (Tokio, UTC+9 sin horario de verano) con una unidad de prop1.
  const tokio = await prisma.complejoHabitacional.create({ data: { nombre: 'Complejo Tokio', tipo: 'Edificio', empresa_id: d.empresaA.id, zona_horaria: TOKIO } });
  unidadTokio = await prisma.unidad.create({ data: { codigo: 'T-1', tipo: 'Departamento', complejo_id: tokio.id, empresa_id: d.empresaA.id, propietario_id: d.propietario1.id, estado: 'activa' } });
  salonTokio = await area(tokio.id, 'Salón Tokio');
  nocheTokio = await area(tokio.id, 'Madrugada Tokio', { hora_apertura: '00:00', hora_cierre: '24:00' });
  // Un condominio que ya terminó su periodo gratis (solo lectura), con prop1 de dueño e inq1 de inquilino.
  const sl = await prisma.complejoHabitacional.create({ data: { nombre: 'Complejo Solo Lectura', tipo: 'Edificio', empresa_id: d.empresaA.id } });
  await prisma.suscripcionCondominio.create({ data: { complejo_id: sl.id, plan_clave: 'gratis', estado: 'gratis', gratis_hasta: new Date(hoyLima().getTime() - 86_400_000) } });
  unidadSL = await prisma.unidad.create({ data: { codigo: 'SL-1', tipo: 'Departamento', complejo_id: sl.id, empresa_id: d.empresaA.id, propietario_id: d.propietario1.id, inquilino_id: d.inquilino1.id, estado: 'activa' } });
  salonSL = await area(sl.id, 'Salón SL', { requiere_aprobacion: true });
  await darCortesia(tokio.id);
  invalidarComercial();
  T = {
    super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'), adminSin: await login(base, 'admin.huerfano@test.pe'),
    prop1: await login(base, 'prop1@test.pe'), prop2: await login(base, 'prop2@test.pe'), propB: await login(base, 'propb@test.pe'), inq1: await login(base, 'inq1@test.pe'),
    segA: await login(base, 'seg.a@test.pe'), mttoA: await login(base, 'mtto.a@test.pe'),
  };
});
after(async () => { await cerrar(); await prisma.$disconnect(); });
beforeEach(async () => { await prisma.reserva.deleteMany(); });

const api = (t: string | null, m: string, ruta: string, cuerpo?: unknown) => llamar(base, m, ruta, t, cuerpo);
const pedido = (area_id: number, unidad_id: number, diaN: string, hora_inicio: string, hora_fin: string) => ({ area_id, unidad_id, dia: diaN, hora_inicio, hora_fin });
/** Reserva con prop1 en su unidad A-101 (por omisión, en el salón, mañana+1 de 10 a 12). */
const reservar = (t = T.prop1, p = pedido(salon.id, d.unidadA1.id, dia(2), '10:00', '12:00')) => api(t, 'POST', '/api/reservas', p);
/** Una reserva directa en la base (para estados que la API no deja crear: en el pasado, ya empezada). */
const directa = (area_id: number, unidad_id: number, usuario_id: number, ini: number, fin: number, estado = 'aprobada') =>
  prisma.reserva.create({ data: { area_id, unidad_id, usuario_id, inicio: new Date(ini), fin: new Date(fin), estado } });

describe('áreas comunes: la administración las gestiona dentro de su empresa', () => {
  const nueva = (extra: Record<string, unknown> = {}) => ({ complejo_id: d.complejoA.id, nombre: 'Gimnasio', hora_apertura: '06:00', hora_cierre: '22:00', ...extra });

  it('el admin crea un área con valores por omisión, queda auditada y trae la zona horaria del condominio', async () => {
    const r = await api(T.adminA, 'POST', '/api/areas-comunes', nueva({ descripcion: 'Con espejos', capacidad: 12 }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual([r.body.duracion_max_horas, r.body.dias_anticipacion_max, r.body.requiere_aprobacion, r.body.activa, r.body.zona_horaria, r.body.capacidad], [2, 30, false, true, LIMA, 12]);
    const aud = await esperar(() => prisma.auditoria.findFirst({ where: { entidad: 'area_comun', entidad_id: r.body.id, accion: 'crear' } }));
    assert.equal((aud.detalle as { nombre: string }).nombre, 'Gimnasio');
  });

  it('horario incoherente, formato malo y límites → 422 con el campo', async () => {
    for (const [extra, campo] of [[{ hora_apertura: '22:00', hora_cierre: '08:00' }, 'hora_cierre'], [{ hora_cierre: '06:00' }, 'hora_cierre'], [{ hora_apertura: '8:00' }, 'hora_apertura'], [{ hora_apertura: '24:00' }, 'hora_apertura'], [{ duracion_max_horas: 0 }, 'duracion_max_horas'], [{ dias_anticipacion_max: 400 }, 'dias_anticipacion_max'], [{ nombre: '  ' }, 'nombre'], [{ capacidad: 0 }, 'capacidad']] as const) {
      const r = await api(T.adminA, 'POST', '/api/areas-comunes', nueva({ nombre: 'Prueba 422', ...extra }));
      assert.equal(r.status, 422, JSON.stringify(extra));
      assert.ok(campo in r.body.campos, `${JSON.stringify(extra)} → ${JSON.stringify(r.body.campos)}`);
    }
    assert.equal((await api(T.adminA, 'POST', '/api/areas-comunes', nueva({ nombre: 'Cierra a medianoche', hora_cierre: '24:00' }))).status, 201);
  });

  it('el nombre no se repite en el condominio (sin distinguir mayúsculas), pero sí puede estar en otro', async () => {
    const r = await api(T.adminA, 'POST', '/api/areas-comunes', nueva({ nombre: 'SALÓN DE EVENTOS' }));
    assert.equal(r.status, 409);
    assert.equal((await api(T.adminB, 'POST', '/api/areas-comunes', { ...nueva({ nombre: 'Salón de eventos' }), complejo_id: d.complejoB.id })).status, 201);
  });

  it('otra empresa → 404; admin sin empresa → 403; residente y personal no crean', async () => {
    assert.equal((await api(T.adminB, 'POST', '/api/areas-comunes', nueva({ nombre: 'Intruso' }))).status, 404);
    assert.equal((await api(T.adminSin, 'POST', '/api/areas-comunes', nueva({ nombre: 'Huérfano' }))).status, 403);
    for (const t of [T.prop1, T.inq1, T.segA, T.mttoA]) assert.equal((await api(t, 'POST', '/api/areas-comunes', nueva({ nombre: 'No' }))).status, 403);
    assert.equal(await prisma.areaComun.count({ where: { nombre: { in: ['Intruso', 'Huérfano', 'No'] } } }), 0);
  });

  it('edita y desactiva; el de otra empresa no puede (404) y no cambia nada', async () => {
    const a = await prisma.areaComun.create({ data: { complejo_id: d.complejoA.id, nombre: 'Sauna', hora_apertura: '10:00', hora_cierre: '20:00' } });
    const r = await api(T.adminA, 'PATCH', `/api/areas-comunes/${a.id}`, { capacidad: 6, requiere_aprobacion: true });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.capacidad, r.body.requiere_aprobacion, r.body.nombre], [6, true, 'Sauna']);
    assert.equal((await api(T.adminA, 'PUT', `/api/areas-comunes/${a.id}`, { hora_cierre: '09:00' })).status, 422, 'el cierre ya no podría ser anterior a la apertura guardada');
    assert.equal((await api(T.adminB, 'PATCH', `/api/areas-comunes/${a.id}`, { activa: false, nombre: 'Hackeado' })).status, 404);
    assert.equal((await api(T.adminA, 'PATCH', `/api/areas-comunes/${a.id}`, { activa: false })).status, 200);
    const fila = await prisma.areaComun.findUniqueOrThrow({ where: { id: a.id } });
    assert.deepEqual([fila.activa, fila.nombre], [false, 'Sauna']);
    assert.equal((await api(T.prop1, 'PATCH', `/api/areas-comunes/${a.id}`, { activa: true })).status, 403);
  });

  it('cada admin lista sólo las áreas de SU empresa; el superadmin ve todas; el personal → 403', async () => {
    const ids = async (t: string) => (await api(t, 'GET', '/api/areas-comunes?pageSize=100')).body.items.map((a: { id: number }) => a.id);
    const a = await ids(T.adminA);
    const b = await ids(T.adminB);
    assert.ok(a.includes(salon.id) && !a.includes(salonB.id), JSON.stringify(a));
    assert.ok(b.includes(salonB.id) && !b.includes(salon.id), JSON.stringify(b));
    assert.ok((await ids(T.super)).includes(salonB.id));
    assert.equal((await api(T.segA, 'GET', '/api/areas-comunes')).status, 403);
    assert.equal((await api(T.adminB, 'GET', `/api/areas-comunes/${salon.id}`)).status, 404);
    assert.equal((await api(T.adminA, 'GET', `/api/areas-comunes?complejo_id=${d.complejoB.id}`)).body.total, 0, 'filtrar por un condominio ajeno no lo abre');
  });

  it('el residente sólo ve las áreas ACTIVAS de los condominios donde tiene unidad (dueño o inquilino)', async () => {
    const inactiva = await prisma.areaComun.create({ data: { complejo_id: d.complejoA.id, nombre: 'Cancha cerrada', hora_apertura: '08:00', hora_cierre: '20:00', activa: false } });
    const ids = async (t: string) => (await api(t, 'GET', '/api/areas-comunes?pageSize=100')).body.items.map((a: { id: number }) => a.id);
    const p1 = await ids(T.prop1); // dueño en A, Tokio y Solo Lectura
    assert.ok([salon.id, salonTokio.id, salonSL.id].every((x) => p1.includes(x)), JSON.stringify(p1));
    assert.ok(!p1.includes(salonB.id) && !p1.includes(inactiva.id), JSON.stringify(p1));
    const i1 = await ids(T.inq1); // inquilino de A-101 y de SL-1: no de Tokio
    assert.ok(i1.includes(salon.id) && i1.includes(salonSL.id) && !i1.includes(salonTokio.id) && !i1.includes(salonB.id), JSON.stringify(i1));
    const pb = await ids(T.propB);
    assert.ok(pb.includes(salonB.id) && !pb.includes(salon.id) && !pb.includes(salonTokio.id), JSON.stringify(pb));
    assert.equal((await api(T.propB, 'GET', `/api/areas-comunes/${salon.id}`)).status, 404);
    assert.equal((await api(T.prop1, 'GET', `/api/areas-comunes/${inactiva.id}`)).status, 404, 'el residente no alcanza un área desactivada');
    assert.equal((await api(T.adminA, 'GET', `/api/areas-comunes/${inactiva.id}`)).status, 200, 'la administración sí');
  });
});

describe('reservar: reglas', () => {
  it('dentro del horario y sin aprobación nace APROBADA; guarda UTC y devuelve día y horas de pared de Lima (UTC−5)', async () => {
    const r = await reservar();
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual([r.body.estado, r.body.dia, r.body.hora_inicio, r.body.hora_fin, r.body.zona_horaria, r.body.unidad.codigo, r.body.area.nombre], ['aprobada', dia(2), '10:00', '12:00', LIMA, 'A-101', 'Salón de eventos']);
    assert.equal(r.body.inicio, `${dia(2)}T15:00:00.000Z`);
    assert.equal(r.body.fin, `${dia(2)}T17:00:00.000Z`);
    const fila = await prisma.reserva.findUniqueOrThrow({ where: { id: r.body.id } });
    assert.equal(fila.usuario_id, d.propietario1.id);
  });

  it('si el área requiere aprobación nace PENDIENTE; el inquilino reserva con la unidad que habita', async () => {
    const r = await reservar(T.inq1, pedido(parrilla.id, d.unidadA1.id, dia(2), '12:00', '14:00'));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.estado, 'pendiente');
    assert.equal(r.body.usuario.nombre, 'Inquilino 1');
  });

  it('el cruce se rechaza (409) en todas sus formas; pegado al borde (fin = inicio) sí entra', async () => {
    assert.equal((await reservar()).status, 201); // 10–12
    for (const [i, f] of [['10:00', '12:00'], ['11:00', '13:00'], ['09:00', '11:00'], ['10:30', '11:30'], ['09:00', '13:00']] as const) {
      const r = await reservar(T.prop2, pedido(salon.id, d.unidadA2.id, dia(2), i, f));
      assert.equal(r.status, 409, `${i}-${f}: ${JSON.stringify(r.body)}`);
    }
    assert.equal((await reservar(T.prop2, pedido(salon.id, d.unidadA2.id, dia(2), '12:00', '14:00'))).status, 201, 'después');
    assert.equal((await reservar(T.prop2, pedido(salon.id, d.unidadA2.id, dia(2), '08:00', '10:00'))).status, 201, 'antes');
    assert.equal((await reservar(T.prop2, pedido(salon.id, d.unidadA2.id, dia(3), '10:00', '12:00'))).status, 201, 'otro día');
    assert.equal((await reservar(T.prop2, pedido(parrilla.id, d.unidadA2.id, dia(2), '10:00', '12:00'))).status, 201, 'otra área');
    assert.equal(await prisma.reserva.count({ where: { area_id: salon.id } }), 4);
  });

  it('una reserva PENDIENTE también ocupa el horario; rechazada o cancelada lo liberan', async () => {
    const p = await reservar(T.prop1, pedido(parrilla.id, d.unidadA1.id, dia(2), '10:00', '12:00'));
    assert.equal(p.body.estado, 'pendiente');
    assert.equal((await reservar(T.prop2, pedido(parrilla.id, d.unidadA2.id, dia(2), '11:00', '12:00'))).status, 409);
    assert.equal((await api(T.adminA, 'POST', `/api/reservas/${p.body.id}/rechazar`, { motivo: 'Mantenimiento ese día' })).status, 200);
    const otra = await reservar(T.prop2, pedido(parrilla.id, d.unidadA2.id, dia(2), '11:00', '12:00'));
    assert.equal(otra.status, 201);
    assert.equal((await api(T.adminA, 'POST', `/api/reservas/${otra.body.id}/cancelar`, {})).status, 200);
    assert.equal((await reservar(T.prop1, pedido(parrilla.id, d.unidadA1.id, dia(2), '10:00', '12:00'))).status, 201);
  });

  it('fuera del horario del área, fin ≤ inicio y duración mayor que el máximo → 422 con el campo', async () => {
    const casos: [string, string, string][] = [['07:00', '09:00', 'hora_inicio'], ['20:00', '22:30', 'hora_inicio'], ['21:00', '24:00', 'hora_inicio'], ['12:00', '12:00', 'hora_fin'], ['13:00', '12:00', 'hora_fin'], ['10:00', '14:30', 'hora_fin'], ['08:00', '22:00', 'hora_fin']];
    for (const [i, f, campo] of casos) {
      const r = await reservar(T.prop1, pedido(salon.id, d.unidadA1.id, dia(2), i, f));
      assert.equal(r.status, 422, `${i}-${f}: ${JSON.stringify(r.body)}`);
      assert.ok(campo in r.body.campos, `${i}-${f} → ${JSON.stringify(r.body.campos)}`);
    }
    assert.equal((await reservar(T.prop1, pedido(salon.id, d.unidadA1.id, dia(2), '18:00', '22:00'))).status, 201, 'justo la duración máxima y justo el cierre');
    assert.equal((await reservar(T.prop1, pedido(salon.id, d.unidadA1.id, dia(2), '08:00', '08:30'))).status, 201, 'justo la apertura');
    assert.equal(await prisma.reserva.count(), 2, 'lo rechazado no deja nada');
  });

  it('no en el pasado: ayer y hoy a una hora que ya pasó → 422', async () => {
    const ayer = await reservar(T.prop1, pedido(abierta.id, d.unidadA1.id, dia(-1), '10:00', '11:00'));
    assert.equal(ayer.status, 422, JSON.stringify(ayer.body));
    const hoyTemprano = await reservar(T.prop1, pedido(abierta.id, d.unidadA1.id, dia(0), '00:00', '00:30'));
    assert.equal(hoyTemprano.status, 422, 'hoy a las 00:00 ya pasó (salvo que sean justo las 00:00 en Lima)');
    assert.ok(hoyTemprano.body.campos.dia);
    assert.equal(await prisma.reserva.count(), 0);
  });

  it('no más allá de la anticipación máxima (el último día permitido sí entra)', async () => {
    const pasado = await reservar(T.prop1, pedido(salon.id, d.unidadA1.id, dia(31), '10:00', '12:00'));
    assert.equal(pasado.status, 422, JSON.stringify(pasado.body));
    assert.ok(pasado.body.campos.dia);
    assert.equal((await reservar(T.prop1, pedido(salon.id, d.unidadA1.id, dia(30), '10:00', '12:00'))).status, 201);
    const corta = await prisma.areaComun.create({ data: { complejo_id: d.complejoA.id, nombre: 'Anticipación 1 día', hora_apertura: '08:00', hora_cierre: '22:00', dias_anticipacion_max: 1 } });
    assert.equal((await reservar(T.prop1, pedido(corta.id, d.unidadA1.id, dia(2), '10:00', '11:00'))).status, 422);
    assert.equal((await reservar(T.prop1, pedido(corta.id, d.unidadA1.id, dia(1), '10:00', '11:00'))).status, 201);
  });

  it('un área que cierra a las 24:00 admite reservar hasta la medianoche: se guarda el instante del día siguiente y se muestra «24:00»', async () => {
    const r = await reservar(T.prop1, pedido(abierta.id, d.unidadA1.id, dia(2), '23:00', '24:00'));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual([r.body.hora_inicio, r.body.hora_fin, r.body.dia], ['23:00', '24:00', dia(2)]);
    assert.equal(r.body.fin, `${dia(3)}T05:00:00.000Z`);
    assert.equal((await reservar(T.prop2, pedido(abierta.id, d.unidadA2.id, dia(3), '00:00', '01:00'))).status, 201, 'pegado al borde, el día siguiente sí');
  });

  it('área desactivada → 409; formato de día y horas malo → 422', async () => {
    const off = await prisma.areaComun.create({ data: { complejo_id: d.complejoA.id, nombre: 'Cerrada', hora_apertura: '08:00', hora_cierre: '22:00', activa: false } });
    assert.equal((await reservar(T.prop1, pedido(off.id, d.unidadA1.id, dia(2), '10:00', '11:00'))).status, 409);
    for (const p of [pedido(salon.id, d.unidadA1.id, '2026-02-30', '10:00', '11:00'), pedido(salon.id, d.unidadA1.id, '05/11/2026', '10:00', '11:00'), pedido(salon.id, d.unidadA1.id, dia(2), '10', '11:00'), pedido(salon.id, d.unidadA1.id, dia(2), '25:00', '26:00'), { area_id: salon.id }]) {
      assert.equal((await reservar(T.prop1, p as never)).status, 422, JSON.stringify(p));
    }
  });
});

describe('reservar: zona horaria del condominio', () => {
  it('un condominio de Tokio (UTC+9): 09:00–11:00 de pared se guarda como 00:00–02:00 UTC', async () => {
    const r = await reservar(T.prop1, pedido(salonTokio.id, unidadTokio.id, dia(2, TOKIO), '09:00', '11:00'));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual([r.body.inicio, r.body.fin, r.body.hora_inicio, r.body.hora_fin, r.body.zona_horaria], [`${dia(2, TOKIO)}T00:00:00.000Z`, `${dia(2, TOKIO)}T02:00:00.000Z`, '09:00', '11:00', TOKIO]);
  });

  it('el horario del área se lee en la zona del condominio: 08:00 de Tokio es el 23:00 UTC anterior y entra', async () => {
    const r = await reservar(T.prop1, pedido(salonTokio.id, unidadTokio.id, dia(2, TOKIO), '08:00', '10:00'));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.inicio, `${dia(1, TOKIO)}T23:00:00.000Z`);
    assert.equal((await reservar(T.prop1, pedido(salonTokio.id, unidadTokio.id, dia(2, TOKIO), '07:00', '09:00'))).status, 422, 'antes de abrir en Tokio');
  });

  it('el cruce y la disponibilidad usan el DÍA de pared de Tokio, no el de UTC', async () => {
    const r = await reservar(T.prop1, pedido(nocheTokio.id, unidadTokio.id, dia(3, TOKIO), '02:00', '04:00')); // 17:00–19:00 UTC del día anterior
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.inicio, `${dia(2, TOKIO)}T17:00:00.000Z`);
    const mismo = await api(T.prop1, 'GET', `/api/areas-comunes/${nocheTokio.id}/disponibilidad?dia=${dia(3, TOKIO)}`);
    assert.deepEqual(mismo.body.ocupados.map((o: { hora_inicio: string; hora_fin: string; mia: boolean }) => [o.hora_inicio, o.hora_fin, o.mia]), [['02:00', '04:00', true]]);
    assert.deepEqual((await api(T.prop1, 'GET', `/api/areas-comunes/${nocheTokio.id}/disponibilidad?dia=${dia(2, TOKIO)}`)).body.ocupados, [], 'el día UTC anterior no la ve');
    assert.equal(mismo.body.hoy, hoyDelCondominio(TOKIO));
    // Y el filtro por día de la administración también.
    const lista = await api(T.adminA, 'GET', `/api/reservas?dia=${dia(3, TOKIO)}&area_id=${nocheTokio.id}`);
    assert.equal(lista.body.total, 1);
    assert.equal((await api(T.adminA, 'GET', `/api/reservas?dia=${dia(2, TOKIO)}&area_id=${nocheTokio.id}`)).body.total, 0);
  });

  it('conversión pura con horario de verano: Madrid UTC+1 en enero, +2 en julio; la hora que no existe es null', () => {
    assert.equal(instanteDePared('Europe/Madrid', '2027-01-15', '09:00')?.toISOString(), '2027-01-15T08:00:00.000Z');
    assert.equal(instanteDePared('Europe/Madrid', '2027-07-01', '09:00')?.toISOString(), '2027-07-01T07:00:00.000Z');
    assert.equal(instanteDePared('Europe/Madrid', '2027-03-28', '02:30'), null, 'el reloj salta de 02:00 a 03:00');
    assert.equal(instanteDePared('America/Lima', '2027-01-15', '24:00')?.toISOString(), '2027-01-16T05:00:00.000Z');
    const v = ventanaDelDia('Asia/Tokyo', '2027-01-15');
    assert.deepEqual([v.desde.toISOString(), v.hasta.toISOString()], ['2027-01-14T15:00:00.000Z', '2027-01-15T15:00:00.000Z']);
  });
});

describe('reservar: permisos y alcance', () => {
  it('sólo propietarios e inquilinos reservan: la administración, el superadmin y el personal → 403', async () => {
    for (const t of [T.adminA, T.super, T.segA, T.mttoA]) assert.equal((await reservar(t)).status, 403);
    assert.equal(await prisma.reserva.count(), 0);
  });

  it('un residente de otro condominio no ve el área (404); con una unidad ajena tampoco (404); con la suya de otro condominio → 422', async () => {
    assert.equal((await reservar(T.propB, pedido(salon.id, d.unidadB1.id, dia(2), '10:00', '11:00'))).status, 404, 'área de otro condominio');
    assert.equal((await reservar(T.prop1, pedido(salon.id, d.unidadA2.id, dia(2), '10:00', '11:00'))).status, 404, 'unidad de otro vecino');
    assert.equal((await reservar(T.prop1, pedido(salon.id, unidadTokio.id, dia(2), '10:00', '11:00'))).status, 422, 'su unidad, pero de otro condominio');
    assert.equal((await reservar(T.inq1, pedido(salonTokio.id, unidadTokio.id, dia(2, TOKIO), '10:00', '11:00'))).status, 404, 'el inquilino de A no tiene unidad en Tokio');
    assert.equal(await prisma.reserva.count(), 0);
  });

  it('la disponibilidad no revela quién reservó: sólo marca las propias (`mia`)', async () => {
    await reservar(T.prop1);
    await reservar(T.prop2, pedido(salon.id, d.unidadA2.id, dia(2), '14:00', '16:00'));
    const ver = async (t: string) => (await api(t, 'GET', `/api/areas-comunes/${salon.id}/disponibilidad?dia=${dia(2)}`)).body;
    const p1 = await ver(T.prop1);
    assert.deepEqual(p1.ocupados.map((o: { hora_inicio: string; hora_fin: string; mia: boolean }) => [o.hora_inicio, o.hora_fin, o.mia]), [['10:00', '12:00', true], ['14:00', '16:00', false]]);
    assert.ok(!/usuario|unidad|nombre/i.test(JSON.stringify(p1.ocupados)), JSON.stringify(p1.ocupados));
    assert.deepEqual((await ver(T.prop2)).ocupados.map((o: { mia: boolean }) => o.mia), [false, true]);
    assert.equal((await api(T.prop1, 'GET', `/api/areas-comunes/${salon.id}/disponibilidad?dia=mañana`)).status, 422);
    assert.equal((await api(T.propB, 'GET', `/api/areas-comunes/${salon.id}/disponibilidad?dia=${dia(2)}`)).status, 404);
    assert.equal((await api(T.adminB, 'GET', `/api/areas-comunes/${salon.id}/disponibilidad?dia=${dia(2)}`)).status, 404);
  });

  it('el residente sólo lista SUS reservas; cada admin, las de su empresa', async () => {
    const a = await reservar();
    const b = await reservar(T.prop2, pedido(salon.id, d.unidadA2.id, dia(2), '14:00', '16:00'));
    const bb = await reservar(T.propB, pedido(salonB.id, d.unidadB1.id, dia(2), '10:00', '12:00'));
    const ids = async (t: string, q = '') => (await api(t, 'GET', `/api/reservas?pageSize=100${q}`)).body.items.map((r: { id: number }) => r.id).sort();
    assert.deepEqual(await ids(T.prop1), [a.body.id]);
    assert.deepEqual(await ids(T.prop2), [b.body.id]);
    assert.deepEqual(await ids(T.inq1), [], 'el inquilino no ve lo que reservó el dueño');
    assert.deepEqual(await ids(T.adminA), [a.body.id, b.body.id].sort());
    assert.deepEqual(await ids(T.adminB), [bb.body.id]);
    assert.deepEqual(await ids(T.super), [a.body.id, b.body.id, bb.body.id].sort());
    assert.equal((await api(T.segA, 'GET', '/api/reservas')).status, 403);
    assert.equal((await api(T.adminB, 'GET', `/api/reservas/${a.body.id}`)).status, 404);
    assert.equal((await api(T.prop2, 'GET', `/api/reservas/${a.body.id}`)).status, 404);
    assert.equal((await api(T.prop1, 'GET', `/api/reservas/${a.body.id}`)).status, 200);
  });

  it('filtros de la administración: estado, área, día y próximas', async () => {
    const p = await reservar(T.prop1, pedido(parrilla.id, d.unidadA1.id, dia(2), '10:00', '12:00'));
    await reservar(T.prop1, pedido(salon.id, d.unidadA1.id, dia(3), '10:00', '12:00'));
    const pasada = await directa(salon.id, d.unidadA1.id, d.propietario1.id, Date.now() - 48 * HORA, Date.now() - 46 * HORA);
    const total = async (q: string) => (await api(T.adminA, 'GET', `/api/reservas?${q}`)).body.total;
    assert.equal(await total('estado=pendiente'), 1);
    assert.equal(await total(`area_id=${salon.id}`), 2);
    assert.equal(await total(`dia=${dia(2)}`), 1);
    assert.equal(await total('proximas=true'), 2);
    assert.equal(await total(`complejo_id=${d.complejoA.id}`), 3);
    assert.equal(await total(`complejo_id=${d.complejoB.id}`), 0, 'filtrar por un condominio ajeno no lo abre');
    assert.equal(await total('estado=otra'), undefined, 'estado inválido → 422');
    assert.equal(pasada.estado, 'aprobada');
    assert.equal(p.status, 201);
  });
});

describe('reservar: dos pedidos a la vez para el mismo horario (carrera)', () => {
  it('con 4 pedidos simultáneos entra UNO (201) y los otros reciben 409; queda una sola reserva', async () => {
    for (const n of [4, 5, 6]) {
      const mismo = (unidad: number) => pedido(salon.id, unidad, dia(n), '10:00', '12:00');
      const rs = await Promise.all([
        reservar(T.prop1, mismo(d.unidadA1.id)),
        reservar(T.prop2, mismo(d.unidadA2.id)),
        reservar(T.inq1, mismo(d.unidadA1.id)),
        reservar(T.prop1, mismo(d.unidadA1.id)),
      ]);
      assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409, 409, 409], JSON.stringify(rs.map((r) => r.body)));
      const inicio = instanteDePared(LIMA, dia(n), '10:00')!;
      assert.equal(await prisma.reserva.count({ where: { area_id: salon.id, inicio } }), 1, `día +${n}`);
    }
  });

  it('dos pedidos que se cruzan a medias (10–12 y 11–13) tampoco entran los dos', async () => {
    const rs = await Promise.all([reservar(T.prop1, pedido(salon.id, d.unidadA1.id, dia(7), '10:00', '12:00')), reservar(T.prop2, pedido(salon.id, d.unidadA2.id, dia(7), '11:00', '13:00'))]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
  });
});

describe('aprobar, rechazar y cancelar', () => {
  const pendiente = async () => (await reservar(T.prop1, pedido(parrilla.id, d.unidadA1.id, dia(2), '10:00', '12:00'))).body;

  it('el admin aprueba una pendiente: queda quién y cuándo; repetir → 409', async () => {
    const p = await pendiente();
    const r = await api(T.adminA, 'POST', `/api/reservas/${p.id}/aprobar`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.estado, r.body.resuelto_por.nombre, !!r.body.resuelto_at], ['aprobada', 'Admin A', true]);
    assert.equal((await api(T.adminA, 'POST', `/api/reservas/${p.id}/aprobar`)).status, 409);
    assert.equal((await api(T.adminA, 'POST', `/api/reservas/${p.id}/rechazar`, { motivo: 'tarde' })).status, 409, 'una aprobada ya no se rechaza');
    const aud = await esperar(() => prisma.auditoria.findFirst({ where: { entidad: 'reserva', entidad_id: p.id, accion: 'aprobar' } }));
    assert.equal((aud.detalle as { estado: string }).estado, 'aprobada');
  });

  it('rechazar exige motivo (422), lo guarda y libera el horario', async () => {
    const p = await pendiente();
    assert.equal((await api(T.adminA, 'POST', `/api/reservas/${p.id}/rechazar`, {})).status, 422);
    assert.equal((await api(T.adminA, 'POST', `/api/reservas/${p.id}/rechazar`, { motivo: '   ' })).status, 422);
    const r = await api(T.adminA, 'POST', `/api/reservas/${p.id}/rechazar`, { motivo: 'La parrilla está en reparación' });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.estado, r.body.motivo, r.body.resuelto_por.id], ['rechazada', 'La parrilla está en reparación', d.adminA.id]);
    const aud = await esperar(() => prisma.auditoria.findFirst({ where: { entidad: 'reserva', entidad_id: p.id, accion: 'rechazar' } }));
    assert.equal((aud.detalle as { motivo: string }).motivo, 'La parrilla está en reparación');
    assert.equal((await api(T.adminA, 'POST', `/api/reservas/${p.id}/aprobar`)).status, 409, 'una rechazada no se aprueba');
  });

  it('el admin cancela CUALQUIER reserva de sus condominios (aprobada o pendiente), con motivo opcional', async () => {
    const a = (await reservar()).body;
    const p = await pendiente();
    const r1 = await api(T.adminA, 'POST', `/api/reservas/${a.id}/cancelar`, { motivo: 'Corte de agua' });
    assert.deepEqual([r1.status, r1.body.estado, r1.body.motivo], [200, 'cancelada', 'Corte de agua']);
    assert.equal((await api(T.adminA, 'POST', `/api/reservas/${p.id}/cancelar`)).status, 200);
    assert.equal((await api(T.adminA, 'POST', `/api/reservas/${p.id}/cancelar`)).status, 409, 'ya cancelada');
    const aud = await esperar(() => prisma.auditoria.findFirst({ where: { entidad: 'reserva', entidad_id: a.id, accion: 'cancelar' } }));
    assert.equal((aud.detalle as { por: string }).por, 'administracion');
  });

  it('otra empresa no puede aprobar, rechazar ni cancelar (404) y la reserva no cambia', async () => {
    const p = await pendiente();
    for (const [ruta, cuerpo] of [['aprobar', undefined], ['rechazar', { motivo: 'no' }], ['cancelar', {}]] as const) {
      assert.equal((await api(T.adminB, 'POST', `/api/reservas/${p.id}/${ruta}`, cuerpo)).status, 404, ruta);
    }
    assert.equal((await prisma.reserva.findUniqueOrThrow({ where: { id: p.id } })).estado, 'pendiente');
  });

  it('el residente no aprueba ni rechaza (403)', async () => {
    const p = await pendiente();
    for (const [ruta, cuerpo] of [['aprobar', undefined], ['rechazar', { motivo: 'no' }]] as const) {
      assert.equal((await api(T.prop1, 'POST', `/api/reservas/${p.id}/${ruta}`, cuerpo)).status, 403, ruta);
      assert.equal((await api(T.segA, 'POST', `/api/reservas/${p.id}/${ruta}`, cuerpo)).status, 403, ruta);
    }
    assert.equal((await prisma.reserva.findUniqueOrThrow({ where: { id: p.id } })).estado, 'pendiente');
  });

  it('el residente cancela LA SUYA (y libera el horario); la de otro vecino → 404 y no cambia; el inquilino tampoco cancela la del dueño', async () => {
    const mia = (await reservar()).body;
    const deOtro = (await reservar(T.prop2, pedido(salon.id, d.unidadA2.id, dia(2), '14:00', '16:00'))).body;
    assert.equal((await api(T.prop1, 'POST', `/api/reservas/${deOtro.id}/cancelar`, {})).status, 404);
    assert.equal((await api(T.inq1, 'POST', `/api/reservas/${mia.id}/cancelar`, {})).status, 404, 'misma unidad, otra persona');
    assert.equal((await api(T.propB, 'POST', `/api/reservas/${mia.id}/cancelar`, {})).status, 404);
    assert.deepEqual((await prisma.reserva.findMany({ where: { id: { in: [mia.id, deOtro.id] } }, orderBy: { id: 'asc' } })).map((r) => r.estado), ['aprobada', 'aprobada']);
    const r = await api(T.prop1, 'POST', `/api/reservas/${mia.id}/cancelar`, { motivo: 'Ya no lo necesito' });
    assert.deepEqual([r.status, r.body.estado, r.body.resuelto_por.id], [200, 'cancelada', d.propietario1.id]);
    assert.equal((await reservar(T.prop2, pedido(salon.id, d.unidadA2.id, dia(2), '10:00', '12:00'))).status, 201, 'el horario quedó libre');
    const aud = await esperar(() => prisma.auditoria.findFirst({ where: { entidad: 'reserva', entidad_id: mia.id, accion: 'cancelar' } }));
    assert.equal((aud.detalle as { por: string }).por, 'residente');
  });

  it('el residente sólo cancela lo FUTURO: una ya empezada o ya cancelada → 409; la administración no cancela lo que ya terminó', async () => {
    const ahora = Date.now();
    const enCurso = await directa(salon.id, d.unidadA1.id, d.propietario1.id, ahora - HORA, ahora + HORA);
    assert.equal((await api(T.prop1, 'POST', `/api/reservas/${enCurso.id}/cancelar`, {})).status, 409);
    assert.equal((await api(T.adminA, 'POST', `/api/reservas/${enCurso.id}/cancelar`, {})).status, 200, 'la administración sí puede cortar una en curso');
    const terminada = await directa(salon.id, d.unidadA1.id, d.propietario1.id, ahora - 3 * HORA, ahora - 2 * HORA);
    assert.equal((await api(T.adminA, 'POST', `/api/reservas/${terminada.id}/cancelar`, {})).status, 409);
    const futura = (await reservar()).body;
    assert.equal((await api(T.prop1, 'POST', `/api/reservas/${futura.id}/cancelar`, {})).status, 200);
    assert.equal((await api(T.prop1, 'POST', `/api/reservas/${futura.id}/cancelar`, {})).status, 409);
    const pendPasada = await directa(parrilla.id, d.unidadA1.id, d.propietario1.id, ahora - 3 * HORA, ahora - 2 * HORA, 'pendiente');
    assert.equal((await api(T.adminA, 'POST', `/api/reservas/${pendPasada.id}/aprobar`)).status, 409, 'no se aprueba lo que ya pasó');
  });

  it('crear una reserva queda auditada con el condominio, el área y la unidad', async () => {
    const r = (await reservar()).body;
    const aud = await esperar(() => prisma.auditoria.findFirst({ where: { entidad: 'reserva', entidad_id: r.id, accion: 'crear' } }));
    assert.deepEqual([aud.usuario_id, (aud.detalle as { area_id: number }).area_id, (aud.detalle as { unidad_id: number }).unidad_id, (aud.detalle as { complejo_id: number }).complejo_id], [d.propietario1.id, salon.id, d.unidadA1.id, d.complejoA.id]);
  });
});

describe('solo lectura (Gratis vencido): las reservas la respetan', () => {
  const enSL = (ini: number, fin: number, estado = 'pendiente') => directa(salonSL.id, unidadSL.id, d.propietario1.id, ini, fin, estado);
  const futuro = () => Date.now() + 3 * 24 * HORA;

  it('el residente no reserva (409 SOLO_LECTURA, con el mensaje del vecino) y el administrador no crea ni edita áreas', async () => {
    const r = await reservar(T.prop1, pedido(salonSL.id, unidadSL.id, dia(2), '10:00', '12:00'));
    assert.deepEqual([r.status, r.body.code, r.body.error], [409, 'SOLO_LECTURA', MENSAJE_SOLO_LECTURA_VECINO]);
    assert.equal((await reservar(T.inq1, pedido(salonSL.id, unidadSL.id, dia(2), '10:00', '12:00'))).body.code, 'SOLO_LECTURA');
    const sl = await prisma.areaComun.findUniqueOrThrow({ where: { id: salonSL.id } });
    const nueva = await api(T.adminA, 'POST', '/api/areas-comunes', { complejo_id: sl.complejo_id, nombre: 'Nueva SL', hora_apertura: '08:00', hora_cierre: '20:00' });
    assert.deepEqual([nueva.status, nueva.body.code], [409, 'SOLO_LECTURA']);
    assert.equal((await api(T.adminA, 'PATCH', `/api/areas-comunes/${salonSL.id}`, { activa: false })).body.code, 'SOLO_LECTURA');
    assert.equal(await prisma.reserva.count(), 0);
    assert.equal(await prisma.areaComun.count({ where: { nombre: 'Nueva SL' } }), 0);
    assert.equal((await prisma.areaComun.findUniqueOrThrow({ where: { id: salonSL.id } })).activa, true);
  });

  it('aprobar, rechazar y cancelar → 409 SOLO_LECTURA y nada cambia', async () => {
    const p = await enSL(futuro(), futuro() + HORA);
    for (const [t, ruta, cuerpo] of [[T.adminA, 'aprobar', undefined], [T.adminA, 'rechazar', { motivo: 'no' }], [T.adminA, 'cancelar', {}], [T.prop1, 'cancelar', {}]] as const) {
      const r = await api(t, 'POST', `/api/reservas/${p.id}/${ruta}`, cuerpo);
      assert.deepEqual([r.status, r.body.code], [409, 'SOLO_LECTURA'], ruta);
    }
    assert.equal((await prisma.reserva.findUniqueOrThrow({ where: { id: p.id } })).estado, 'pendiente');
  });

  it('LEER sigue funcionando (áreas, disponibilidad y reservas); el superadmin no queda bloqueado; otro condominio opera normal', async () => {
    const p = await enSL(futuro(), futuro() + HORA);
    assert.equal((await api(T.prop1, 'GET', `/api/areas-comunes/${salonSL.id}`)).status, 200);
    assert.equal((await api(T.prop1, 'GET', `/api/areas-comunes/${salonSL.id}/disponibilidad?dia=${dia(2)}`)).status, 200);
    assert.equal((await api(T.prop1, 'GET', `/api/reservas/${p.id}`)).status, 200);
    assert.equal((await api(T.adminA, 'GET', `/api/reservas?area_id=${salonSL.id}`)).body.total, 1);
    assert.equal((await api(T.super, 'POST', `/api/reservas/${p.id}/aprobar`)).status, 200, 'el superadmin nunca queda bloqueado');
    assert.equal((await reservar()).status, 201, 'el condominio A sigue operativo');
  });
});
