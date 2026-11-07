// Bandeja del superadmin: mensajes de /contacto y hojas del Libro de Reclamaciones. Sólo superadmin; días hábiles que faltan; marcar atendida/respondida.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar } from './helpers/app';
import { hoyEn } from '../src/server/lib/fechas';
import { reclamacionSchema } from '../src/server/services/reclamaciones/esquema';
import { registrarReclamacion, ZONA_LIBRO } from '../src/server/services/reclamaciones/registro';
import { sumarDiasHabiles } from '../src/server/services/reclamaciones/plazo';

let base: string;
let cerrar: () => Promise<void>;
let T: Record<'super' | 'adminA' | 'prop' | 'inq', string>;

const hoja = (over: Record<string, unknown> = {}) => ({
  nombre: 'Rosa Quispe', tipo_documento: 'dni', numero_documento: '45678912', domicilio: 'Jr. Los Pinos 123, Lima', correo: 'rosa@casa.pe', menor_de_edad: false,
  bien_tipo: 'servicio', bien_descripcion: 'Torre Pro', tipo: 'reclamo', detalle: 'Cobro duplicado del mes.', pedido: 'Devolución del cobro.', acepta_respuesta_correo: true, ...over,
});
const dia = (d: Date) => d.toISOString().slice(0, 10);
const origen = { ip: '127.0.0.1', user_agent: 'prueba' };

before(async () => {
  await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), prop: await login(base, 'prop1@test.pe'), inq: await login(base, 'inq1@test.pe') };
});
after(async () => { await cerrar(); await prisma.$disconnect(); });
beforeEach(async () => {
  await prisma.reclamacion.deleteMany();
  await prisma.solicitudContacto.deleteMany();
  await prisma.configuracionComercial.update({ where: { id: 1 }, data: { legal_razon_social: 'Torre S.A.C.', legal_ruc: '20601234567', legal_domicilio: 'Av. Ejemplo 1, Lima', correo_superadmin: null, legal_correo: null } });
});

const sembrarContacto = (over: Record<string, unknown> = {}) => prisma.solicitudContacto.create({ data: { nombre: 'Luis Prado', correo: 'luis@casa.pe', mensaje: 'Quiero información', condominio: 'Los Cedros', ...over } as never });

describe('quién puede ver la bandeja', () => {
  it('admin, propietario e inquilino → 403 en todas las rutas; sin sesión → 401', async () => {
    const c = await sembrarContacto();
    await registrarReclamacion(reclamacionSchema.parse(hoja()), origen);
    const r = await prisma.reclamacion.findFirstOrThrow();
    for (const quien of [T.adminA, T.prop, T.inq]) {
      for (const [m, ruta, cuerpo] of [['GET', '/api/comercial/contactos'], ['GET', '/api/comercial/reclamaciones'], ['GET', `/api/comercial/reclamaciones/${r.id}`], ['PATCH', `/api/comercial/contactos/${c.id}`, { estado: 'atendida' }], ['PATCH', `/api/comercial/reclamaciones/${r.id}`, { estado: 'respondida' }]] as const) {
        assert.equal((await llamar(base, m, ruta, quien, cuerpo)).status, 403, `${m} ${ruta}`);
      }
    }
    assert.equal((await llamar(base, 'GET', '/api/comercial/reclamaciones', null)).status, 401);
    assert.equal((await prisma.reclamacion.findFirstOrThrow()).estado, 'pendiente');
    assert.equal((await prisma.solicitudContacto.findFirstOrThrow()).estado, 'nueva');
  });
});

describe('contactos', () => {
  it('el superadmin los lista (más nuevos primero), filtra por estado y busca', async () => {
    const a = await sembrarContacto({ nombre: 'Ana Ríos', correo: 'ana@casa.pe' });
    await sembrarContacto({ nombre: 'Beto Sol', correo: 'beto@casa.pe', condominio: 'Torres del Sol' });
    const todos = await llamar(base, 'GET', '/api/comercial/contactos', T.super);
    assert.equal(todos.status, 200, todos.texto);
    assert.equal(todos.body.total, 2);
    assert.equal(todos.body.nuevas, 2);
    assert.equal(todos.body.items[0].nombre, 'Beto Sol');
    await llamar(base, 'PATCH', `/api/comercial/contactos/${a.id}`, T.super, { estado: 'atendida' });
    assert.equal((await llamar(base, 'GET', '/api/comercial/contactos?estado=nueva', T.super)).body.total, 1);
    assert.equal((await llamar(base, 'GET', '/api/comercial/contactos?q=torres', T.super)).body.items[0].nombre, 'Beto Sol');
    assert.equal((await llamar(base, 'GET', '/api/comercial/contactos?estado=otro', T.super)).status, 422);
  });

  it('marcar atendida guarda fecha y nota; volver a «nueva» las limpia; id inexistente → 404', async () => {
    const c = await sembrarContacto();
    const r = await llamar(base, 'PATCH', `/api/comercial/contactos/${c.id}`, T.super, { estado: 'atendida', nota: 'Le escribí por WhatsApp' });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.estado, 'atendida');
    assert.equal(r.body.nota, 'Le escribí por WhatsApp');
    assert.ok(r.body.atendida_at);
    assert.equal((await llamar(base, 'PATCH', `/api/comercial/contactos/${c.id}`, T.super, { estado: 'nueva' })).body.atendida_at, null);
    assert.equal((await llamar(base, 'PATCH', '/api/comercial/contactos/99999', T.super, { estado: 'atendida' })).status, 404);
    assert.ok(await prisma.auditoria.findFirst({ where: { entidad: 'solicitud_contacto', accion: 'atender' } }), 'queda en la auditoría');
  });
});

describe('reclamaciones', () => {
  it('lista con los días hábiles que faltan: una de hoy tiene 15; una vencida, negativo y `vencida`; las pendientes van primero', async () => {
    await registrarReclamacion(reclamacionSchema.parse(hoja({ correo: 'hoy@casa.pe' })), origen); // hoy
    const hoy = hoyEn(ZONA_LIBRO);
    // Una hoja registrada hace 5 semanas: su plazo ya venció.
    const hace = new Date(hoy.getTime() - 35 * 86_400_000);
    await registrarReclamacion(reclamacionSchema.parse(hoja({ correo: 'vieja@casa.pe' })), origen, new Date(hace.getTime() + 17 * 3_600_000));
    const r = await llamar(base, 'GET', '/api/comercial/reclamaciones', T.super);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.total, 2);
    assert.equal(r.body.pendientes, 2);
    assert.equal(r.body.vencidas, 1);
    const [primera, segunda] = r.body.items;
    assert.equal(primera.consumidor_correo, 'vieja@casa.pe', 'la que vence antes (vencida) va arriba');
    assert.equal(primera.vencida, true);
    assert.ok(primera.dias_habiles_restantes < 0);
    assert.equal(segunda.dias_habiles_restantes, 15);
    assert.equal(segunda.vencida, false);
    assert.equal(segunda.fecha_limite, dia(sumarDiasHabiles(hoy, 15)));
  });

  it('marcar respondida guarda la fecha y la nota, deja de correr el plazo (ya no está «vencida») y se puede volver a pendiente', async () => {
    const hoy = hoyEn(ZONA_LIBRO);
    const hace = new Date(hoy.getTime() - 35 * 86_400_000);
    await registrarReclamacion(reclamacionSchema.parse(hoja()), origen, new Date(hace.getTime() + 17 * 3_600_000));
    const f = await prisma.reclamacion.findFirstOrThrow();
    const r = await llamar(base, 'PATCH', `/api/comercial/reclamaciones/${f.id}`, T.super, { estado: 'respondida', fecha: dia(hoy), nota: 'Respondido por correo con la devolución' });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.estado, 'respondida');
    assert.equal(dia(new Date(r.body.respondida_at)), dia(hoy));
    assert.equal(r.body.respuesta_nota, 'Respondido por correo con la devolución');
    assert.equal(r.body.vencida, false);
    assert.equal(r.body.dias_habiles_restantes, null);
    const lista = (await llamar(base, 'GET', '/api/comercial/reclamaciones', T.super)).body;
    assert.equal(lista.pendientes, 0);
    assert.equal(lista.vencidas, 0);
    assert.equal((await llamar(base, 'PATCH', `/api/comercial/reclamaciones/${f.id}`, T.super, { estado: 'pendiente' })).body.respondida_at, null);
    assert.ok(await prisma.auditoria.findFirst({ where: { entidad: 'reclamacion', accion: 'responder' } }));
  });

  it('la fecha de respuesta no puede ser futura ni anterior al registro (422); sin fecha vale hoy', async () => {
    await registrarReclamacion(reclamacionSchema.parse(hoja()), origen);
    const f = await prisma.reclamacion.findFirstOrThrow();
    const hoy = hoyEn(ZONA_LIBRO);
    assert.equal((await llamar(base, 'PATCH', `/api/comercial/reclamaciones/${f.id}`, T.super, { estado: 'respondida', fecha: dia(new Date(hoy.getTime() + 2 * 86_400_000)) })).status, 422);
    assert.equal((await llamar(base, 'PATCH', `/api/comercial/reclamaciones/${f.id}`, T.super, { estado: 'respondida', fecha: dia(new Date(hoy.getTime() - 3 * 86_400_000)) })).status, 422);
    const ok = await llamar(base, 'PATCH', `/api/comercial/reclamaciones/${f.id}`, T.super, { estado: 'respondida' });
    assert.equal(dia(new Date(ok.body.respondida_at)), dia(hoy));
  });

  it('detalle de una hoja y búsqueda por correlativo o por documento', async () => {
    await registrarReclamacion(reclamacionSchema.parse(hoja()), origen);
    const f = await prisma.reclamacion.findFirstOrThrow();
    const d = await llamar(base, 'GET', `/api/comercial/reclamaciones/${f.id}`, T.super);
    assert.equal(d.body.correlativo, f.correlativo);
    assert.equal(d.body.detalle, 'Cobro duplicado del mes.');
    assert.equal((await llamar(base, 'GET', `/api/comercial/reclamaciones?q=${f.correlativo}`, T.super)).body.total, 1);
    assert.equal((await llamar(base, 'GET', '/api/comercial/reclamaciones?q=45678912', T.super)).body.total, 1);
    assert.equal((await llamar(base, 'GET', '/api/comercial/reclamaciones?tipo=queja', T.super)).body.total, 0);
    assert.equal((await llamar(base, 'GET', '/api/comercial/reclamaciones/99999', T.super)).status, 404);
  });
});
