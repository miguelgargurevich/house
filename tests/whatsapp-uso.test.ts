// Contador de mensajes de WhatsApp de la pantalla «WhatsApp» (`GET /api/whatsapp/uso`): lo de hoy contra el tope diario del número, lo del mes por
// condominio contra su cuota, lo que espera en cola, lo que falló hoy y el desglose por tipo. «Hoy» y el mes son de Lima. Con datos sembrados y reloj
// inyectado: nada sale a la red (Evolution revienta si alguien le pregunta algo).
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { darCortesia, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { contarEnviadasHoy, manana0800Lima } from '../src/server/services/avisos/cola';
import { canalesDeps } from '../src/server/services/canales/deps';
import { obtenerConfiguracion } from '../src/server/services/comercial/configuracion';
import { invalidarComercial } from '../src/server/services/comercial/modulos';

const DIA = 86_400_000;
const AHORA = new Date('2026-11-02T20:00:00Z'); // 15:00 del 2-nov en Lima
const AYER = new Date('2026-11-01T20:00:00Z');
const original = { fetch: canalesDeps.fetch, ahora: canalesDeps.ahora };
let llamadasAEvolution = 0;

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let e1: { id: number };
let T: Record<'super' | 'adminA' | 'adminB' | 'adminSin' | 'prop1' | 'presi1', string>;

before(async () => {
  d = await sembrar();
  e1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
  const hash = await bcrypt.hash(PASSWORD, 4);
  const presi = await prisma.usuario.create({ data: { nombre: 'Presidente 1', email: 'presi1@test.pe', rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, cargo_junta: 'presidente', estructura_id: e1.id } });
  await prisma.juntaDirectiva.create({ data: { complejo_id: d.complejoA.id, estructura_id: e1.id, desde: new Date('2026-01-01'), miembros: { create: [{ usuario_id: presi.id, cargo: 'presidente' }] } } });
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    super: await login(base, 'super@test.pe'),
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    adminSin: await login(base, 'admin.huerfano@test.pe'),
    prop1: await login(base, 'prop1@test.pe'),
    presi1: await login(base, 'presi1@test.pe'),
  };
  canalesDeps.fetch = (async () => { llamadasAEvolution++; throw new Error('el contador no debe llamar a Evolution'); }) as typeof fetch;
});
after(async () => {
  Object.assign(canalesDeps, original);
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  llamadasAEvolution = 0;
  usados.clear();
  canalesDeps.ahora = () => AHORA;
  await prisma.notificacion.deleteMany();
  await prisma.comunicado.deleteMany();
  await prisma.consumoMensual.deleteMany();
  await prisma.suscripcionCondominio.deleteMany();
  await prisma.envioGrupoWhatsapp.deleteMany();
  await darCortesia(d.complejoA.id, d.complejoB.id);
  await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: 'inst-a' } });
  await prisma.empresaAdministradora.update({ where: { id: d.empresaB.id }, data: { whatsapp_instance: 'inst-b' } });
  await prisma.configuracionComercial.update({ where: { id: (await obtenerConfiguracion()).id }, data: { whatsapp_tope_diario: 200 } });
  await prisma.planComercial.update({ where: { clave: 'pro' }, data: { whatsapp_por_unidad_mes: null, unidades_minimas: null } });
  invalidarComercial();
});

const uso = (t: string | null = T.adminA) => llamar(base, 'GET', '/api/whatsapp/uso', t);

const usados = new Set<string>();
/** Un aviso con el estado dado. Los enviados se ubican por la instancia; los pendientes/fallidos, por el recibo al que se refieren. */
function aviso(extra: { tipo?: string; estado: string; instancia?: string | null; enviada_at?: Date; programada_para?: Date; error?: string | null; recibo?: number; ref?: { entidad: string; id: number } }) {
  const personas = [d.propietario1, d.propietario2, d.inquilino1, d.mantenimientoA, d.mantenimientoA2, d.seguridadA, d.adminA, d.adminB, d.propietarioB, d.superadmin, d.adminSinEmpresa];
  const tipo = extra.tipo ?? 'recibo_emitido';
  const ref = extra.ref ?? (extra.estado === 'enviada' && extra.recibo == null ? { entidad: 'ia', id: usados.size + 1 } : { entidad: 'recibo', id: extra.recibo ?? d.reciboVencidoA.id });
  // Único por usuario, canal, tipo y referencia: se busca a alguien que aún no tenga ese mismo aviso.
  const persona = personas.find((p) => !usados.has(`${p.id}|${tipo}|${ref.entidad}|${ref.id}`));
  assert.ok(persona, 'faltan personas para sembrar tantos avisos iguales');
  usados.add(`${persona.id}|${tipo}|${ref.entidad}|${ref.id}`);
  return prisma.notificacion.create({
    data: {
      usuario_id: persona.id, canal: 'whatsapp', tipo, asunto: 'a', cuerpo: 'b',
      estado: extra.estado, error: extra.error ?? null, programada_para: extra.programada_para ?? AHORA, enviada_at: extra.enviada_at ?? null,
      whatsapp_instancia: extra.instancia ?? null, ref_entidad: ref.entidad, ref_id: ref.id,
    },
  });
}
const grupo = (extra: { empresa?: number; instancia?: string; estado: 'enviado' | 'fallo'; at: Date; motivo?: string }) =>
  prisma.envioGrupoWhatsapp.create({ data: { empresa_id: extra.empresa ?? d.empresaA.id, instancia: extra.instancia ?? 'inst-a', complejo_id: d.complejoA.id, estado: extra.estado, motivo: extra.motivo ?? null, at: extra.at } });
async function ponerPro(porUnidad: number) {
  await prisma.planComercial.update({ where: { clave: 'pro' }, data: { whatsapp_por_unidad_mes: porUnidad, unidades_minimas: null } });
  await prisma.suscripcionCondominio.deleteMany({ where: { complejo_id: d.complejoA.id } });
  await prisma.suscripcionCondominio.create({ data: { complejo_id: d.complejoA.id, plan_clave: 'pro', modulos: [], estado: 'activa', es_prueba: false, vigente_hasta: new Date(AHORA.getTime() + 60 * DIA) } });
  invalidarComercial();
}

/** Todo lo que cuenta, sembrado de una vez: la empresa A (inst-a) y, aparte, lo de la empresa B que NO debe contarse. */
async function sembrarTodo() {
  const hoy = (h: number) => new Date(AHORA.getTime() - h * 3_600_000);
  // Enviados hoy por el número de A: 2 recibos y 1 «venció».
  await aviso({ estado: 'enviada', tipo: 'recibo_emitido', instancia: 'inst-a', enviada_at: hoy(1) });
  await aviso({ estado: 'enviada', tipo: 'recibo_emitido', instancia: 'inst-a', enviada_at: hoy(2), recibo: d.reciboFuturoA.id });
  await aviso({ estado: 'enviada', tipo: 'vencido', instancia: 'inst-a', enviada_at: hoy(3) });
  // Ayer (cuenta para el mes, no para hoy) y lo del número de B (no es de A).
  await aviso({ estado: 'enviada', tipo: 'vencido', instancia: 'inst-a', enviada_at: AYER, recibo: d.reciboFuturoA.id });
  await aviso({ estado: 'enviada', tipo: 'recibo_emitido', instancia: 'inst-b', enviada_at: hoy(1), recibo: d.reciboB.id });
  // Mensajes a grupos: 2 hoy y 1 ayer de A; 1 hoy de B; y un fallo de A hoy.
  await grupo({ estado: 'enviado', at: hoy(1) });
  await grupo({ estado: 'enviado', at: hoy(2) });
  await grupo({ estado: 'enviado', at: AYER });
  await grupo({ estado: 'enviado', at: hoy(1), empresa: d.empresaB.id, instancia: 'inst-b' });
  await grupo({ estado: 'fallo', at: hoy(1), motivo: 'No se pudo escribir en el grupo «Vecinos Block 1»: WhatsApp respondió con error 500' });
  // En cola: 2 aplazados a mañana por el tope, 1 listo para salir, 1 comunicado; y uno de B (no cuenta).
  const manana = manana0800Lima(AHORA);
  await aviso({ estado: 'pendiente', tipo: 'recibo_emitido', programada_para: manana });
  await aviso({ estado: 'pendiente', tipo: 'vence_hoy', programada_para: manana });
  await aviso({ estado: 'pendiente', tipo: 'por_vencer', programada_para: hoy(0.01), recibo: d.reciboFuturoA.id });
  const c = await prisma.comunicado.create({ data: { complejo_id: d.complejoA.id, titulo: 'T', cuerpo: 'C', enviar_grupo: true, grupos_resultado: [{ grupo_id: 1, nombre: 'Vecinos', estado: 'pendiente', motivo: 'Tope diario alcanzado' }, { grupo_id: 2, nombre: 'Junta', estado: 'enviado' }] } });
  await aviso({ estado: 'pendiente', tipo: 'comunicado', programada_para: hoy(0.01), ref: { entidad: 'comunicado', id: c.id } });
  await aviso({ estado: 'pendiente', tipo: 'recibo_emitido', programada_para: manana, recibo: d.reciboB.id });
  // Fallidos hoy: 2 con error, 1 omitido (con su motivo); uno de ayer y uno de B no cuentan.
  await aviso({ estado: 'error', tipo: 'vencido', error: 'Evolution respondió 500', programada_para: hoy(2), recibo: d.reciboFuturoA.id });
  await aviso({ estado: 'error', tipo: 'vence_hoy', error: 'Evolution respondió 500', programada_para: hoy(2) });
  await aviso({ estado: 'omitida', tipo: 'recibo_emitido', error: 'Sin celular', programada_para: hoy(1), recibo: d.reciboFuturoA.id });
  await aviso({ estado: 'error', tipo: 'vencido', error: 'Sin conexión con Evolution', programada_para: AYER });
  await aviso({ estado: 'error', tipo: 'vencido', error: 'Evolution respondió 500', programada_para: hoy(1), recibo: d.reciboB.id });
  // Cuota del mes: A usó 7 de 10 (2 unidades × 5); B usó 3 (no se ve).
  await ponerPro(5);
  await prisma.consumoMensual.create({ data: { complejo_id: d.complejoA.id, periodo: '202611', recurso: 'whatsapp', cantidad: 7 } });
  await prisma.consumoMensual.create({ data: { complejo_id: d.complejoB.id, periodo: '202611', recurso: 'whatsapp', cantidad: 3 } });
  await prisma.consumoMensual.create({ data: { complejo_id: d.complejoA.id, periodo: '202610', recurso: 'whatsapp', cantidad: 9 } });
}

describe('contador: lo de hoy, el mes, la cola, los fallos y los tipos', () => {
  it('suma lo de hoy del NÚMERO de la empresa (avisos y grupos) contra el tope diario, sin contar el número de otra empresa ni lo de ayer', async () => {
    await sembrarTodo();
    const r = await uso();
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.fecha, '2026-11-02');
    assert.deepEqual(r.body.hoy, { enviados: 5, tope: 200, restantes: 195 }, '3 avisos + 2 grupos');
    assert.equal(await contarEnviadasHoy('inst-a', AHORA), 5, 'es la misma cuenta que frena el envío');
    assert.equal(r.body.conectado, true);
  });

  it('el mes, por condominio de la empresa: usados contra la cuota del plan (sin el condominio de otra empresa ni el mes pasado)', async () => {
    await sembrarTodo();
    const r = await uso();
    assert.deepEqual(r.body.mes.condominios, [{ complejo_id: d.complejoA.id, nombre: 'Complejo A', usados: 7, tope: 10 }]);
    assert.equal(r.body.mes.periodo, '202611');
    assert.equal(r.body.mes.renueva, 'diciembre');
    const sinTope = await uso(T.adminB);
    assert.deepEqual(sinTope.body.mes.condominios.map((c: { usados: number; tope: number | null }) => [c.usados, c.tope]), [[3, null]], 'sin tope en el plan = null');
  });

  it('en cola: pendientes (aplazados a mañana por el tope y los que están por salir) y los grupos pendientes, sin lo de otra empresa', async () => {
    await sembrarTodo();
    const r = await uso();
    assert.equal(r.body.en_cola.total, 5, '2 a mañana + 1 listo + 1 comunicado + 1 grupo pendiente');
    assert.equal(r.body.en_cola.para_manana, 3, 'los 2 del tope y el grupo pendiente');
    assert.deepEqual(r.body.en_cola.por_tipo, { recibo_emitido: 1, por_vencer: 1, vence_hoy: 1, vencido: 0, comunicado: 1, cierre_pendiente: 0, grupo: 1, otros: 0 });
  });

  it('fallidos de hoy con el motivo agrupado (avisos y grupos); lo de ayer y de otra empresa no cuenta', async () => {
    await sembrarTodo();
    const r = await uso();
    assert.equal(r.body.fallidos_hoy.total, 4);
    assert.deepEqual(r.body.fallidos_hoy.motivos, [
      { motivo: 'Evolution respondió 500', cantidad: 2 },
      { motivo: 'No se pudo escribir en el grupo «Vecinos Block 1»: WhatsApp respondió con error 500', cantidad: 1 },
      { motivo: 'Sin celular', cantidad: 1 },
    ]);
  });

  it('desglose por tipo, hoy y en el mes, con los grupos como su propio tipo', async () => {
    await sembrarTodo();
    const r = await uso();
    assert.deepEqual(r.body.por_tipo.hoy, { recibo_emitido: 2, por_vencer: 0, vence_hoy: 0, vencido: 1, comunicado: 0, cierre_pendiente: 0, grupo: 2, otros: 0 });
    assert.deepEqual(r.body.por_tipo.mes, { recibo_emitido: 2, por_vencer: 0, vence_hoy: 0, vencido: 2, comunicado: 0, cierre_pendiente: 0, grupo: 3, otros: 0 });
  });

  it('sin tope diario (null o 0) no hay «restantes»; desconectar el número no borra lo que ya salió hoy (`conectado: false`)', async () => {
    await sembrarTodo();
    for (const sin of [null, 0]) {
      await prisma.configuracionComercial.update({ where: { id: (await obtenerConfiguracion()).id }, data: { whatsapp_tope_diario: sin } });
      const r = await uso();
      assert.deepEqual(r.body.hoy, { enviados: 5, tope: null, restantes: null });
    }
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: null } });
    const sinNumero = await uso();
    assert.equal(sinNumero.body.conectado, false);
    assert.equal(sinNumero.body.hoy.enviados, 5, 'lo enviado hoy por el número sigue contando aunque ahora esté desvinculado');
  });

  it('pasado el tope los restantes se quedan en 0, no en negativo', async () => {
    await sembrarTodo();
    await prisma.configuracionComercial.update({ where: { id: (await obtenerConfiguracion()).id }, data: { whatsapp_tope_diario: 3 } });
    assert.deepEqual((await uso()).body.hoy, { enviados: 5, tope: 3, restantes: 0 });
  });
});

describe('contador: el día de Lima', () => {
  const tarde = async () => {
    await aviso({ estado: 'enviada', instancia: 'inst-a', enviada_at: new Date('2026-11-02T20:00:00Z') }); // 15:00 del 2-nov
    await aviso({ estado: 'enviada', tipo: 'vencido', instancia: 'inst-a', enviada_at: new Date('2026-11-03T04:00:00Z') }); // 23:00 del 2-nov (ya es 3-nov en UTC)
    await grupo({ estado: 'enviado', at: new Date('2026-11-03T04:20:00Z') }); // 23:20 del 2-nov
  };

  it('a las 23:30 de Lima (04:30 UTC del día siguiente) «hoy» sigue siendo el 2-nov: cuenta los 3, y es la misma cuenta que usa el tope', async () => {
    await tarde();
    const ahora = new Date('2026-11-03T04:30:00Z');
    canalesDeps.ahora = () => ahora;
    const r = await uso();
    assert.equal(r.body.fecha, '2026-11-02');
    assert.deepEqual(r.body.hoy, { enviados: 3, tope: 200, restantes: 197 });
    assert.equal(await contarEnviadasHoy('inst-a', ahora), 3);
    assert.equal(r.body.por_tipo.hoy.grupo, 1);
  });

  it('a las 00:30 de Lima (05:30 UTC) ya es otro día: «hoy» arranca de cero y sólo cuenta lo de después de la medianoche; el mes conserva todo', async () => {
    await tarde();
    await aviso({ estado: 'enviada', tipo: 'vence_hoy', instancia: 'inst-a', enviada_at: new Date('2026-11-03T05:10:00Z') }); // 00:10 del 3-nov
    const ahora = new Date('2026-11-03T05:30:00Z');
    canalesDeps.ahora = () => ahora;
    const r = await uso();
    assert.equal(r.body.fecha, '2026-11-03');
    assert.deepEqual(r.body.hoy, { enviados: 1, tope: 200, restantes: 199 });
    assert.equal(await contarEnviadasHoy('inst-a', ahora), 1);
    assert.deepEqual(r.body.por_tipo.hoy, { recibo_emitido: 0, por_vencer: 0, vence_hoy: 1, vencido: 0, comunicado: 0, cierre_pendiente: 0, grupo: 0, otros: 0 });
    assert.equal(Object.values(r.body.por_tipo.mes as Record<string, number>).reduce((a, b) => a + b, 0), 4, 'el mes sigue siendo noviembre');
  });

  it('el mes también cambia a la medianoche de Lima: a las 00:30 del 1-dic el contador del mes arranca de cero', async () => {
    await aviso({ estado: 'enviada', instancia: 'inst-a', enviada_at: new Date('2026-12-01T04:30:00Z') }); // 23:30 del 30-nov
    canalesDeps.ahora = () => new Date('2026-12-01T05:30:00Z'); // 00:30 del 1-dic
    const r = await uso();
    assert.equal(r.body.mes.periodo, '202612');
    assert.equal(Object.values(r.body.por_tipo.mes as Record<string, number>).reduce((a, b) => a + b, 0), 0);
    canalesDeps.ahora = () => new Date('2026-12-01T04:45:00Z'); // 23:45 del 30-nov
    const antes = await uso();
    assert.equal(antes.body.mes.periodo, '202611');
    assert.equal(Object.values(antes.body.por_tipo.mes as Record<string, number>).reduce((a, b) => a + b, 0), 1);
  });
});

describe('contador: quién lo ve y qué no lleva', () => {
  it('sólo la administración de la empresa: otra empresa ve lo suyo, la junta y los vecinos → 403, sin empresa → 400, sin sesión → 401', async () => {
    await sembrarTodo();
    const b = await uso(T.adminB);
    assert.equal(b.status, 200);
    assert.deepEqual(b.body.hoy, { enviados: 2, tope: 200, restantes: 198 }, 'el aviso de inst-b y su grupo; nada de A');
    assert.equal(b.body.fallidos_hoy.total, 1);
    assert.equal(b.body.en_cola.total, 1);
    for (const t of [T.presi1, T.prop1]) assert.equal((await uso(t)).status, 403);
    assert.equal((await uso(T.adminSin)).status, 400);
    assert.equal((await uso(T.super)).status, 400, 'el superadmin no tiene un número propio');
    assert.equal((await uso(null)).status, 401);
  });

  it('no lleva datos personales ni identificadores de grupos, y NO llama a Evolution (todo sale de la base)', async () => {
    await sembrarTodo();
    const r = await uso();
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.texto, /@test\.pe|@g\.us|@s\.whatsapp|9876543|Propietario|Inquilino|usuario/i);
    assert.equal(llamadasAEvolution, 0);
  });
});
