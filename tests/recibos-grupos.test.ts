// El aviso del recibo va al GRUPO de WhatsApp de su block (un mensaje por grupo y recibo), y el WhatsApp directo a cada departamento queda apagado por defecto.
// Cobertura de grupos, migración única, comunicados a la junta y el contador. Nada sale a la red: Evolution va con `fetch` falso.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { darCortesia, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { canalesDeps } from '../src/server/services/canales/deps';
import { enviarAvisoReciboAGrupos, esperarEnviosAGrupos } from '../src/server/services/canales/grupos';
import { migracionRecordatorioGrupos, migracionReciboAutomatico } from '../src/server/services/comercial/migracion';
import { encolarAviso } from '../src/server/services/avisos';
import { WHATSAPP_POR_DEFECTO } from '../src/server/services/avisos/whatsappTipos';
import { invalidarComercial } from '../src/server/services/comercial/modulos';

const DIA = 86_400_000;
const NUMERO = '51999000111';
const G1 = '120363000000000011@g.us';
const G2 = '120363000000000012@g.us';
/** La lista por defecto (sin el recibo directo) y la de antes del cambio (con él). */
const DEFECTO = ['vence_hoy', 'vencido', 'cierre_pendiente'];
const CON_RECIBO = ['recibo_emitido', 'vence_hoy', 'vencido', 'cierre_pendiente'];

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
/** Evolution falso: el número sigue en G1 y G2; cada envío queda anotado (jid y texto). */
const enviados: { jid: string; texto: string }[] = [];
const evolution = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(url));
  if (u.pathname.startsWith('/instance/fetchInstances')) return json([{ ownerJid: `${NUMERO}@s.whatsapp.net` }]);
  if (u.pathname.startsWith('/group/findGroupInfos/')) {
    const jid = u.searchParams.get('groupJid');
    return json({ id: jid, subject: 'Grupo', participants: [{ id: `${NUMERO}@s.whatsapp.net` }] });
  }
  if (u.pathname.startsWith('/message/sendText/')) {
    const cuerpo = JSON.parse(String(init?.body)) as { number: string; text: string };
    enviados.push({ jid: cuerpo.number, texto: cuerpo.text });
    return json({ ok: true });
  }
  throw new Error(`Llamada no prevista a Evolution: ${u.pathname}`);
}) as typeof fetch;
const original = { fetch: canalesDeps.fetch, env: canalesDeps.env, esperar: canalesDeps.esperar, azar: canalesDeps.azar };

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'adminA' | 'adminB', string>;
let e1: { id: number }, e2: { id: number }, e3: { id: number };
let unidadA3: { id: number };
let g1: { id: number };
let prop2Telefono = '';

/** Un recibo de un block con un cargo a una unidad (la que paga, según `pagadoresDe`). */
async function reciboDeBlock(estructuraId: number, mes: number, unidadId: number) {
  const recibo = await prisma.recibo.create({
    data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, estructura_id: estructuraId, mes, anio: 2026, fecha_emision: new Date(Date.now() - 2 * DIA), fecha_vencimiento: new Date(Date.now() + 20 * DIA), estado: 'emitido', descripcion: `Recibo ${mes}` },
  });
  const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: d.conceptoA.id, monto: 100, orden: 1 } });
  await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidadId, monto: 100, estado_pago: 'pendiente' } });
  return recibo;
}

const avisosDelRecibo = (reciboId: number, canal?: string) => prisma.notificacion.findMany({ where: { tipo: 'recibo_emitido', ref_entidad: 'recibo', ref_id: reciboId, ...(canal ? { canal } : {}) } });
const envioAGrupo = (reciboId: number) => prisma.envioGrupoWhatsapp.findMany({ where: { recibo_id: reciboId, estado: 'enviado' }, select: { grupo_id: true } });

/** Pone la lista de WhatsApp del condominio A. */
async function listaA(lista: string[]) {
  await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { whatsapp_avisos: lista } });
  invalidarComercial();
}

before(async () => {
  d = await sembrar();
  e1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
  e2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'Block', complejo_id: d.complejoA.id } });
  e3 = await prisma.estructura.create({ data: { nombre: 'Block 3', tipo: 'Block', complejo_id: d.complejoA.id } });
  await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: e1.id } });
  await prisma.unidad.update({ where: { id: d.unidadA2.id }, data: { estructura_id: e2.id } });
  unidadA3 = await prisma.unidad.create({ data: { codigo: 'A-301', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, propietario_id: d.propietario1.id, estado: 'activa', estructura_id: e3.id } });
  await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: 'inst-a' } });
  // Quien paga A-102 (propietario 2) tiene celular y acepta WhatsApp: si el directo estuviera encendido, le llegaría.
  prop2Telefono = '987654321';
  await prisma.usuario.update({ where: { id: d.propietario2.id }, data: { telefono: prop2Telefono, aviso_whatsapp: true } });
  g1 = await prisma.grupoWhatsapp.create({ data: { empresa_id: d.empresaA.id, jid: G1, nombre: 'Vecinos Block 1', en_uso: true, destino: 'block', complejo_id: d.complejoA.id, estructura_id: e1.id } });
  await prisma.grupoWhatsapp.create({ data: { empresa_id: d.empresaA.id, jid: G2, nombre: 'Vecinos Block 2', en_uso: true, destino: 'block', complejo_id: d.complejoA.id, estructura_id: e2.id } });
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe') };
  canalesDeps.env = { ...process.env, EVOLUTION_URL: 'https://evo.ejemplo.test', EVOLUTION_APIKEY: 'evo-CLAVE-FALSA-NO-REAL' };
  canalesDeps.fetch = evolution;
  canalesDeps.esperar = async () => {};
  canalesDeps.azar = () => 0.5;
});

after(async () => {
  Object.assign(canalesDeps, original);
  await esperarEnviosAGrupos();
  await cerrar();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await esperarEnviosAGrupos();
  enviados.length = 0;
  await prisma.notificacion.deleteMany();
  await prisma.envioGrupoWhatsapp.deleteMany();
  await prisma.auditoria.deleteMany({ where: { accion: 'avisar_vecinos' } });
  await prisma.consumoMensual.deleteMany();
  await prisma.suscripcionCondominio.deleteMany();
  await darCortesia(d.complejoA.id, d.complejoB.id);
  await prisma.usuario.updateMany({ data: { aviso_email: true } });
  await prisma.usuario.update({ where: { id: d.propietario2.id }, data: { telefono: prop2Telefono, aviso_whatsapp: true } });
  await prisma.usuario.update({ where: { id: d.inquilino1.id }, data: { telefono: '987000111', aviso_whatsapp: true } });
  // Lo que sale por defecto: el recibo NO va directo por WhatsApp.
  await listaA(DEFECTO);
  await prisma.complejoHabitacional.update({ where: { id: d.complejoB.id }, data: { whatsapp_avisos: DEFECTO } });
});

describe('avisar un recibo de un block con grupo', () => {
  it('UN mensaje al grupo de su block, correo a cada responsable y CERO WhatsApp directos (con el defecto nuevo)', async () => {
    const recibo = await reciboDeBlock(e1.id, 9, d.unidadA1.id);
    const r = await llamar(base, 'POST', `/api/recibos/${recibo.id}/avisar`, T.adminA);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.grupo.situacion, 'listo', 'el block tiene su grupo: el aviso sale hacia él');
    await esperarEnviosAGrupos();
    assert.equal(enviados.filter((e) => e.jid === G1).length, 1, 'un solo mensaje al grupo del Block 1');
    assert.equal(enviados.filter((e) => e.jid === G2).length, 0, 'ni al grupo de otro block');
    assert.match(enviados[0]!.texto, /Ya está el mantenimiento de .* del Block 1/, 'el texto del grupo no lleva montos ni nombres');
    assert.deepEqual(await envioAGrupo(recibo.id), [{ grupo_id: g1.id }]);
    const correo = await avisosDelRecibo(recibo.id, 'email');
    assert.deepEqual(correo.map((n) => n.usuario_id), [d.inquilino1.id], 'el correo sigue yendo a quien paga');
    assert.equal((await avisosDelRecibo(recibo.id, 'whatsapp')).length, 0, 'ningún WhatsApp directo con la lista por defecto');
  });

  it('repetir no vuelve a mandar el mismo recibo al mismo grupo', async () => {
    const recibo = await reciboDeBlock(e1.id, 10, d.unidadA1.id);
    await llamar(base, 'POST', `/api/recibos/${recibo.id}/avisar`, T.adminA);
    await esperarEnviosAGrupos();
    const otra = await enviarAvisoReciboAGrupos(recibo.id);
    assert.deepEqual(otra, [], 'ningún grupo queda por avisar');
    assert.equal(enviados.filter((e) => e.jid === G1).length, 1, 'sigue habiendo un solo mensaje');
    assert.equal((await envioAGrupo(recibo.id)).length, 1);
  });

  it('un block sin grupo: el recibo sale directo a cada departamento por WhatsApp (automático) y por correo, y la respuesta lo dice', async () => {
    // Quien paga A-301 (propietario 1) acepta WhatsApp: en un block sin grupo, el directo le llega sin que el condominio lo marque.
    await prisma.usuario.update({ where: { id: d.propietario1.id }, data: { telefono: '987111222', aviso_whatsapp: true } });
    const recibo = await reciboDeBlock(e3.id, 9, unidadA3.id);
    const r = await llamar(base, 'POST', `/api/recibos/${recibo.id}/avisar`, T.adminA);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.grupo.situacion, 'sin_grupo');
    assert.match(r.body.grupo.aviso, /El Block 3 no tiene grupo de WhatsApp: el aviso del recibo le llegará por WhatsApp directo a cada departamento/);
    await esperarEnviosAGrupos();
    assert.equal((await envioAGrupo(recibo.id)).length, 0, 'no hay grupo al que ir');
    assert.ok((await avisosDelRecibo(recibo.id, 'email')).length > 0, 'el correo sí');
    assert.ok((await avisosDelRecibo(recibo.id, 'whatsapp')).length > 0, 'y el WhatsApp directo, porque su block no tiene grupo');
  });

  it('el mismo condominio: el block CON grupo no recibe directo y el block SIN grupo sí (Miguel, 4-nov: «así debe ser»)', async () => {
    await prisma.usuario.update({ where: { id: d.propietario1.id }, data: { telefono: '987111222', aviso_whatsapp: true } });
    const conGrupo = await reciboDeBlock(e2.id, 7, d.unidadA2.id);
    const sinGrupo = await reciboDeBlock(e3.id, 7, unidadA3.id);
    for (const rec of [conGrupo, sinGrupo]) assert.equal((await llamar(base, 'POST', `/api/recibos/${rec.id}/avisar`, T.adminA)).status, 200);
    await esperarEnviosAGrupos();
    assert.equal((await avisosDelRecibo(conGrupo.id, 'whatsapp')).length, 0, 'Block 2 tiene grupo: sin directo');
    assert.equal((await envioAGrupo(conGrupo.id)).length, 1, 'Block 2: un mensaje a su grupo');
    assert.ok((await avisosDelRecibo(sinGrupo.id, 'whatsapp')).length > 0, 'Block 3 sin grupo: directo');
  });

  it('con recibo_emitido prendido a mano en el condominio, también salen los WhatsApp directos', async () => {
    await listaA(CON_RECIBO);
    const recibo = await reciboDeBlock(e2.id, 10, d.unidadA2.id);
    const r = await llamar(base, 'POST', `/api/recibos/${recibo.id}/avisar`, T.adminA);
    assert.equal(r.status, 200, r.texto);
    await esperarEnviosAGrupos();
    assert.equal(enviados.filter((e) => e.jid === G2).length, 1, 'el grupo del block sale igual');
    assert.equal((await avisosDelRecibo(recibo.id, 'whatsapp')).length, 1, 'y el directo a quien paga A-102');
  });
});

describe('emitir un recibo', () => {
  it('al emitir un block con grupo, el mensaje va al grupo y la respuesta no trae advertencias', async () => {
    const hoy = new Date();
    const r = await llamar(base, 'POST', '/api/recibos', T.adminA, {
      complejo_id: d.complejoA.id, estructura_id: e1.id, mes: 12, anio: 2026,
      fecha_emision: hoy.toISOString().slice(0, 10), fecha_vencimiento: new Date(hoy.getTime() + 20 * DIA).toISOString().slice(0, 10),
      conceptos: [{ concepto_id: d.conceptoA.id, monto: 100 }],
    });
    assert.equal(r.status, 201, r.texto);
    await esperarEnviosAGrupos();
    assert.equal(enviados.filter((e) => e.jid === G1).length, 1);
    assert.equal((await avisosDelRecibo(r.body.id, 'whatsapp')).length, 0, 'sin WhatsApp directo por defecto');
    assert.ok(!(r.body.advertencias ?? []).some((a: string) => /no tiene grupo/.test(a)));
  });

  it('al emitir un block sin grupo, la respuesta lo advierte con el nombre del block', async () => {
    const hoy = new Date();
    const r = await llamar(base, 'POST', '/api/recibos', T.adminA, {
      complejo_id: d.complejoA.id, estructura_id: e3.id, mes: 12, anio: 2025,
      fecha_emision: hoy.toISOString().slice(0, 10), fecha_vencimiento: new Date(hoy.getTime() + 20 * DIA).toISOString().slice(0, 10),
      conceptos: [{ concepto_id: d.conceptoA.id, monto: 100 }],
    });
    assert.equal(r.status, 201, r.texto);
    assert.ok((r.body.advertencias ?? []).some((a: string) => /El Block 3 no tiene grupo de WhatsApp/.test(a)), JSON.stringify(r.body.advertencias));
    await esperarEnviosAGrupos();
    assert.equal(enviados.length, 0);
  });
});

describe('la lista por defecto y lo que sigue directo', () => {
  it('un condominio nuevo nace sin el recibo directo: la base y WHATSAPP_POR_DEFECTO dicen lo mismo', async () => {
    const nuevo = await prisma.complejoHabitacional.create({ data: { nombre: 'Complejo nuevo', tipo: 'Edificio', empresa_id: d.empresaA.id } });
    const c = await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: nuevo.id }, select: { whatsapp_avisos: true } });
    assert.ok(!c.whatsapp_avisos.includes('recibo_emitido'), 'el recibo no va directo por defecto');
    assert.deepEqual([...c.whatsapp_avisos].sort(), [...WHATSAPP_POR_DEFECTO].sort());
    assert.ok(!WHATSAPP_POR_DEFECTO.includes('recibo_emitido'));
  });

  it('vence_hoy, vencido y el recordatorio de deuda siguen por WhatsApp directo; el recibo de un block CON grupo, no', async () => {
    for (const tipo of ['vence_hoy', 'vencido'] as const) {
      await encolarAviso(tipo, d.inquilino1.id, { entidad: 'recibo', id: d.reciboVencidoA.id });
      assert.equal((await prisma.notificacion.findFirst({ where: { tipo, usuario_id: d.inquilino1.id, canal: 'whatsapp' } }))?.estado, 'pendiente', tipo);
    }
    const conGrupo = await reciboDeBlock(e2.id, 6, d.unidadA2.id);
    await encolarAviso('recibo_emitido', d.propietario2.id, { entidad: 'recibo', id: conGrupo.id });
    assert.equal(await prisma.notificacion.count({ where: { tipo: 'recibo_emitido', ref_id: conGrupo.id, canal: 'whatsapp' } }), 0);
  });
});

describe('migración única: el recibo sale del WhatsApp directo donde ya hay grupos', () => {
  it('condominio con grupo de block pierde el recibo directo; sin grupos se queda; corre una sola vez', async () => {
    await listaA(CON_RECIBO);
    await prisma.complejoHabitacional.update({ where: { id: d.complejoB.id }, data: { whatsapp_avisos: CON_RECIBO } });
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { migracion_grupos_recibo_at: null } });
    // B no tiene ningún grupo: su lista no se toca.
    const r = await migracionRecordatorioGrupos(prisma);
    assert.deepEqual(r, { aplicada: true, condominios: 1 });
    const a = await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: d.complejoA.id }, select: { whatsapp_avisos: true } });
    const b = await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: d.complejoB.id }, select: { whatsapp_avisos: true } });
    assert.deepEqual([...a.whatsapp_avisos].sort(), ['cierre_pendiente', 'vence_hoy', 'vencido'], 'A con grupos: sin recibo directo, con lo demás');
    assert.ok(b.whatsapp_avisos.includes('recibo_emitido'), 'B sin grupos conserva el recibo directo');
    assert.deepEqual(await migracionRecordatorioGrupos(prisma), { aplicada: false, condominios: 0 }, 'la segunda vez no hace nada');
    const marca = await prisma.configuracionComercial.findUniqueOrThrow({ where: { id: 1 }, select: { migracion_grupos_recibo_at: true } });
    assert.ok(marca.migracion_grupos_recibo_at, 'queda la fecha de la migración');
  });
});

describe('comunicados: la junta sólo con enviar_junta', () => {
  it('sin enviar_junta no escribe a la junta; con enviar_junta: true sí', async () => {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const presi = await prisma.usuario.create({ data: { nombre: 'Presidente Junta', email: 'presi.junta@test.pe', rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, cargo_junta: 'presidente', telefono: '987111222', aviso_email: true, aviso_whatsapp: true } });
    await prisma.juntaDirectiva.create({ data: { complejo_id: d.complejoA.id, desde: new Date('2026-01-01'), miembros: { create: [{ usuario_id: presi.id, cargo: 'presidente' }] } } });
    const sinJunta = await llamar(base, 'POST', '/api/comunicados', T.adminA, { complejo_id: d.complejoA.id, titulo: 'Corte de agua', cuerpo: 'Mañana no hay agua.', enviar_correo: true });
    assert.equal(sinJunta.status, 201, sinJunta.texto);
    assert.equal(await prisma.notificacion.count({ where: { usuario_id: presi.id, tipo: 'comunicado' } }), 0, 'la junta no recibe nada por defecto');
    const conJunta = await llamar(base, 'POST', '/api/comunicados', T.adminA, { complejo_id: d.complejoA.id, titulo: 'Urgente', cuerpo: 'Hoy se corta el agua.', enviar_correo: false, enviar_junta: true });
    assert.equal(conJunta.status, 201, conJunta.texto);
    assert.ok((await prisma.notificacion.count({ where: { usuario_id: presi.id, tipo: 'comunicado' } })) >= 1, 'con enviar_junta sí');
  });
});

describe('cobertura de grupos por block', () => {
  it('14 blocks con grupo en 13: «13 de 14», y el que falta se nombra; el número de otra empresa no cuenta', async () => {
    const c = await prisma.complejoHabitacional.create({ data: { nombre: 'Complejo C', tipo: 'Edificio', empresa_id: d.empresaA.id } });
    const blocks: { id: number; nombre: string | null }[] = [];
    for (let i = 1; i <= 14; i++) blocks.push(await prisma.estructura.create({ data: { nombre: `Block ${i}`, tipo: 'Block', complejo_id: c.id } }));
    for (const b of blocks.filter((x) => x.nombre !== 'Block 9')) {
      await prisma.grupoWhatsapp.create({ data: { empresa_id: d.empresaA.id, jid: `120363000000${b.id}@g.us`, nombre: `Vecinos ${b.nombre}`, en_uso: true, destino: 'block', complejo_id: c.id, estructura_id: b.id } });
    }
    // Un grupo de OTRA empresa del mismo nombre de block no cuenta.
    await prisma.grupoWhatsapp.create({ data: { empresa_id: d.empresaB.id, jid: '120363000000999@g.us', nombre: 'Ajeno', en_uso: true, destino: 'block', complejo_id: d.complejoB.id, estructura_id: null } });
    const r = await llamar(base, 'GET', `/api/whatsapp/cobertura/${c.id}`, T.adminA);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.bloques.total, 14);
    assert.equal(r.body.bloques.con_grupo, 13);
    assert.deepEqual(r.body.bloques.faltan, [{ estructura_id: blocks.find((x) => x.nombre === 'Block 9')!.id, nombre: 'Block 9', motivo: 'sin_grupo' }]);
    const lista = await llamar(base, 'GET', '/api/whatsapp/grupos', T.adminA);
    assert.ok(lista.body.cobertura.some((x: { complejo_id: number; bloques: { con_grupo: number } }) => x.complejo_id === c.id && x.bloques.con_grupo === 13));
    assert.equal((await llamar(base, 'GET', `/api/whatsapp/cobertura/${c.id}`, T.adminB)).status, 404, 'otra empresa: 404');
  });

  it('un grupo cuyo número ya no está dice «ya_no_esta», no «sin_grupo»', async () => {
    const c = await prisma.complejoHabitacional.create({ data: { nombre: 'Complejo D', tipo: 'Edificio', empresa_id: d.empresaA.id } });
    const b = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: c.id } });
    await prisma.grupoWhatsapp.create({ data: { empresa_id: d.empresaA.id, jid: '120363000000777@g.us', nombre: 'Vecinos Block 1', en_uso: true, destino: 'block', complejo_id: c.id, estructura_id: b.id, ya_no_esta: true } });
    const r = await llamar(base, 'GET', `/api/whatsapp/cobertura/${c.id}`, T.adminA);
    assert.equal(r.body.bloques.con_grupo, 0);
    assert.equal(r.body.bloques.faltan[0].motivo, 'ya_no_esta');
  });
});

describe('contador de WhatsApp: recordatorios y grupos de recibo con su nombre', () => {
  it('el recordatorio de deuda sale como su tipo, y el recibo al grupo cuenta como recibo_emitido', async () => {
    const recibo = await reciboDeBlock(e1.id, 11, d.unidadA1.id);
    await llamar(base, 'POST', `/api/recibos/${recibo.id}/avisar`, T.adminA);
    await esperarEnviosAGrupos();
    await prisma.notificacion.create({ data: { usuario_id: d.inquilino1.id, canal: 'whatsapp', tipo: 'recordatorio_deuda', asunto: 'Deuda', cuerpo: 'Tienes una deuda', estado: 'enviada', enviada_at: new Date(), whatsapp_instancia: 'inst-a', ref_entidad: 'deuda:2026-11-04', ref_id: d.unidadA1.id } });
    const r = await llamar(base, 'GET', '/api/whatsapp/uso', T.adminA);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.por_tipo.hoy.recordatorio_deuda, 1);
    assert.equal(r.body.por_tipo.hoy.recibo_emitido, 1, 'el mensaje al grupo del recibo');
    assert.equal(r.body.por_tipo.hoy.otros, 0);
  });
});

describe('migración única: el recibo directo pasa a ser automático por block', () => {
  it('quita recibo_emitido de TODOS los condominios (con o sin grupos) y corre una sola vez', async () => {
    await listaA(CON_RECIBO);
    await prisma.complejoHabitacional.update({ where: { id: d.complejoB.id }, data: { whatsapp_avisos: CON_RECIBO } });
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { migracion_recibo_auto_at: null } });
    assert.deepEqual(await migracionReciboAutomatico(prisma), { aplicada: true, condominios: 2 });
    for (const id of [d.complejoA.id, d.complejoB.id]) {
      const c = await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id }, select: { whatsapp_avisos: true } });
      assert.equal(c.whatsapp_avisos.includes('recibo_emitido'), false);
      assert.ok(c.whatsapp_avisos.includes('vence_hoy'), 'lo demás se queda');
    }
    assert.deepEqual(await migracionReciboAutomatico(prisma), { aplicada: false, condominios: 0 });
    await listaA(['vence_hoy', 'vencido', 'cierre_pendiente']);
  });
});
