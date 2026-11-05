// «Mensajería inteligente»: cuántos directos evitó el grupo de cada block y cuántos mensajes salieron este mes (`GET /api/whatsapp/uso` → `mes`).
// Fórmula (services/canales/uso.ts, `gruposDelMes`): por cada RECIBO del mes que salió a un grupo, max(0, vecinos que lo habrían recibido por WhatsApp
// directo − mensajes a grupos de ese recibo). Sólo cuenta si el condominio NO marcó «recibo del mes también directo»; los comunicados no entran.
// Con datos sembrados y reloj inyectado: nada sale a la red.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { canalesDeps } from '../src/server/services/canales/deps';
import { obtenerConfiguracion } from '../src/server/services/comercial/configuracion';
import { CARACTERISTICA_MENSAJERIA, PLANES_SEED } from '../src/server/services/comercial/catalogo';
import { migracionMensajeria } from '../src/server/services/comercial/migracion';
import { invalidarComercial } from '../src/server/services/comercial/modulos';

const AHORA = new Date('2026-11-02T20:00:00Z'); // 15:00 del 2-nov en Lima
const original = { ahora: canalesDeps.ahora, fetch: canalesDeps.fetch };
const WLISTA_DEFECTO = ['vence_hoy', 'vencido', 'cierre_pendiente'];

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'adminA' | 'adminB', string>;
let e1: { id: number }, e2: { id: number }, e3: { id: number };
let u1: number[] = [], u2: number[] = [], u3: number[] = [];
let G1: { id: number }, G3: { id: number }, Gc: { id: number };

/** Un vecino con su departamento en un block. `celular` y `acepta` deciden si le llegaría un directo por WhatsApp. */
async function vecino(e: number, estructuraId: number, i: number, opts: { celular: boolean; acepta: boolean; vinculado?: boolean }) {
  const telefono = opts.celular ? `9${String(e).padStart(2, '0')}${String(i).padStart(5, '0')}` : null;
  const usuario = await prisma.usuario.create({
    data: { nombre: `Vecino ${e}-${i}`, email: `mensajeria.e${e}.${i}@test.pe`, rol: 'propietario', telefono, aviso_whatsapp: opts.acepta, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id },
  });
  const unidad = await prisma.unidad.create({
    data: { codigo: `M${e}-${i}`, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: estructuraId, propietario_id: usuario.id, estado: 'activa' },
  });
  if (opts.vinculado) {
    await prisma.canalVinculado.create({ data: { usuario_id: usuario.id, canal: 'whatsapp', identificador: `51900${String(i).padStart(5, '0')}@s.whatsapp.net`, empresa_id: d.empresaA.id, verificado_at: AHORA } });
  }
  return { usuario, unidad: unidad.id };
}

/** Un recibo del block (o del condominio si `estructuraId` es null) con un cargo a cada unidad. Su descripción lo marca para limpiarlo entre pruebas. */
async function recibo(estructuraId: number | null, unidades: number[], etiqueta: string) {
  const r = await prisma.recibo.create({
    data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, estructura_id: estructuraId, mes: 11, anio: 2026, fecha_emision: AHORA, fecha_vencimiento: new Date('2026-11-20T00:00:00Z'), estado: 'emitido', descripcion: `mensajeria-test ${etiqueta}` },
  });
  const rc = await prisma.reciboConcepto.create({ data: { recibo_id: r.id, concepto_id: d.conceptoA.id, monto: 100, orden: 1 } });
  for (const unidad_id of unidades) await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id, monto: 100, estado_pago: 'pendiente' } });
  return r;
}

/** Un mensaje a un grupo que salió (`enviado`) de la empresa A (por defecto), con la fecha y el recibo o comunicado que lo originó. */
const envioGrupo = (o: { grupo?: number | null; recibo?: number | null; at?: Date; empresa?: number; complejo?: number; estado?: string }) =>
  prisma.envioGrupoWhatsapp.create({
    data: { empresa_id: o.empresa ?? d.empresaA.id, instancia: o.empresa === d.empresaB.id ? 'inst-b' : 'inst-a', complejo_id: o.complejo ?? d.complejoA.id, grupo_id: o.grupo ?? null, recibo_id: o.recibo ?? null, estado: o.estado ?? 'enviado', at: o.at ?? AHORA },
  });

/** Un directo ya enviado por WhatsApp (una fila de notificación) a un vecino por un recibo. */
const directo = (usuarioId: number, reciboId: number) =>
  prisma.notificacion.create({
    data: { usuario_id: usuarioId, canal: 'whatsapp', tipo: 'recibo_emitido', asunto: 'a', cuerpo: 'b', estado: 'enviada', programada_para: AHORA, enviada_at: AHORA, whatsapp_instancia: 'inst-a', ref_entidad: 'recibo', ref_id: reciboId },
  });

const uso = (t = T.adminA) => llamar(base, 'GET', '/api/whatsapp/uso', t);

before(async () => {
  d = await sembrar();
  e1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
  e2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'Block', complejo_id: d.complejoA.id } });
  e3 = await prisma.estructura.create({ data: { nombre: 'Block 3', tipo: 'Block', complejo_id: d.complejoA.id } });
  // Block 1: 32 departamentos con una mezcla de casos. 20 con celular y WhatsApp; 6 sin celular ni número vinculado; 4 con celular pero sin WhatsApp
  // (aviso apagado); 2 sin celular pero con el número vinculado (esos sí cuentan). Directos posibles: 20 + 2 = 22.
  for (let i = 1; i <= 32; i++) {
    const caso = i <= 20 ? 'cuenta' : i <= 26 ? 'sin celular' : i <= 30 ? 'sin WhatsApp' : 'vinculado';
    u1.push((await vecino(1, e1.id, i, {
      celular: caso === 'cuenta' || caso === 'sin WhatsApp',
      acepta: caso !== 'sin WhatsApp',
      vinculado: caso === 'vinculado',
    })).unidad);
  }
  // Block 2 (sin grupo): 5 vecinos con celular.
  for (let i = 1; i <= 5; i++) u2.push((await vecino(2, e2.id, i, { celular: true, acepta: true })).unidad);
  // Block 3: 32 vecinos, todos con celular y WhatsApp.
  for (let i = 1; i <= 32; i++) u3.push((await vecino(3, e3.id, i, { celular: true, acepta: true })).unidad);

  G1 = await prisma.grupoWhatsapp.create({ data: { empresa_id: d.empresaA.id, jid: '120363000000000001@g.us', nombre: 'Vecinos Block 1', en_uso: true, destino: 'block', complejo_id: d.complejoA.id, estructura_id: e1.id } });
  G3 = await prisma.grupoWhatsapp.create({ data: { empresa_id: d.empresaA.id, jid: '120363000000000003@g.us', nombre: 'Vecinos Block 3', en_uso: true, destino: 'block', complejo_id: d.complejoA.id, estructura_id: e3.id } });
  Gc = await prisma.grupoWhatsapp.create({ data: { empresa_id: d.empresaA.id, jid: '120363000000000009@g.us', nombre: 'Todo el condominio', en_uso: true, destino: 'condominio', complejo_id: d.complejoA.id } });
  await prisma.grupoWhatsapp.create({ data: { empresa_id: d.empresaA.id, jid: '120363000000000008@g.us', nombre: 'Un grupo apagado', en_uso: false } });

  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe') };
  canalesDeps.fetch = (async () => { throw new Error('la cuenta no debe llamar a Evolution'); }) as typeof fetch;
});
after(async () => {
  Object.assign(canalesDeps, original);
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  canalesDeps.ahora = () => AHORA;
  await prisma.envioGrupoWhatsapp.deleteMany();
  await prisma.notificacion.deleteMany();
  await prisma.comunicado.deleteMany();
  await prisma.reciboConceptoUnidad.deleteMany({ where: { reciboConcepto: { recibo: { descripcion: { startsWith: 'mensajeria-test' } } } } });
  await prisma.reciboConcepto.deleteMany({ where: { recibo: { descripcion: { startsWith: 'mensajeria-test' } } } });
  await prisma.recibo.deleteMany({ where: { descripcion: { startsWith: 'mensajeria-test' } } });
  await prisma.configuracionComercial.update({ where: { id: (await obtenerConfiguracion()).id }, data: { whatsapp_tope_diario: 200 } });
  await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { whatsapp_avisos: WLISTA_DEFECTO } });
  await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: 'inst-a' } });
  await prisma.empresaAdministradora.update({ where: { id: d.empresaB.id }, data: { whatsapp_instance: 'inst-b' } });
  await prisma.grupoWhatsapp.updateMany({ where: { empresa_id: d.empresaA.id, nombre: 'Un grupo apagado' }, data: { en_uso: false } });
  await prisma.grupoWhatsapp.updateMany({ where: { empresa_id: d.empresaA.id, jid: { not: '120363000000000008@g.us' } }, data: { en_uso: true } });
  invalidarComercial();
});

describe('evitados: lo que el grupo de un block le ahorra al número', () => {
  it('un recibo de un block con grupo y 32 vecinos con celular: el mensaje al grupo evita 31 directos (uno por vecino menos el del grupo)', async () => {
    const r = await recibo(e3.id, u3, 'block 3');
    await envioGrupo({ grupo: G3.id, recibo: r.id });
    const mes = (await uso()).body.mes;
    assert.equal(mes.evitados, 31);
    assert.equal(mes.a_grupos, 1);
    assert.equal(mes.enviados, 1, 'sólo el mensaje al grupo salió; los 31 directos no se mandaron');
  });

  it('un block SIN grupo no evita nada: sus directos cuentan como enviados', async () => {
    const r = await recibo(e2.id, u2, 'block 2');
    const usuarios = await prisma.usuario.findMany({ where: { email: { startsWith: 'mensajeria.e2.' } }, select: { id: true } });
    for (const u of usuarios) await directo(u.id, r.id);
    const mes = (await uso()).body.mes;
    assert.equal(mes.evitados, 0);
    assert.equal(mes.a_grupos, 0);
    assert.equal(mes.enviados, 5, 'los 5 directos salieron');
  });

  it('sólo cuentan los vecinos que pagan, aceptan WhatsApp y tienen celular o número vinculado: de 32 departamentos, 22 podían recibir directo y el grupo evita 21', async () => {
    const r = await recibo(e1.id, u1, 'block 1 mixto');
    await envioGrupo({ grupo: G1.id, recibo: r.id });
    assert.equal((await uso()).body.mes.evitados, 21, '20 con celular y WhatsApp + 2 con número vinculado = 22; menos el mensaje al grupo');
  });

  it('un envío de octubre no cuenta en el mes de noviembre (el contador es del mes en curso)', async () => {
    const r = await recibo(e3.id, u3, 'octubre');
    await envioGrupo({ grupo: G3.id, recibo: r.id, at: new Date('2026-10-31T12:00:00Z') }); // 7:00 del 31-oct en Lima
    const mes = (await uso()).body.mes;
    assert.equal(mes.a_grupos, 0);
    assert.equal(mes.evitados, 0);
  });

  it('si el condominio marca «recibo del mes también directo», el directo sale igual junto al grupo: no hay nada evitado', async () => {
    await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { whatsapp_avisos: [...WLISTA_DEFECTO, 'recibo_emitido'] } });
    const r = await recibo(e3.id, u3, 'forzado');
    await envioGrupo({ grupo: G3.id, recibo: r.id });
    const mes = (await uso()).body.mes;
    assert.equal(mes.evitados, 0);
    assert.equal(mes.a_grupos, 1, 'el mensaje al grupo sí se cuenta como enviado');
  });

  it('un comunicado al grupo no cuenta como evitado: su directo es una casilla aparte (enviar_whatsapp) y el grupo no reemplaza ninguno', async () => {
    await prisma.comunicado.create({ data: { complejo_id: d.complejoA.id, estructura_id: e3.id, titulo: 'Corte de agua', cuerpo: 'Mañana no habrá agua', enviar_grupo: true } });
    await envioGrupo({ grupo: G3.id, recibo: null });
    const mes = (await uso()).body.mes;
    assert.equal(mes.a_grupos, 1);
    assert.equal(mes.evitados, 0);
    assert.equal(mes.enviados, 1);
  });

  it('varios mensajes a grupos por el mismo recibo: cada uno resta uno (32 vecinos − 2 mensajes = 30)', async () => {
    const r = await recibo(e3.id, u3, 'dos grupos');
    await envioGrupo({ grupo: G3.id, recibo: r.id });
    await envioGrupo({ grupo: Gc.id, recibo: r.id });
    const mes = (await uso()).body.mes;
    assert.equal(mes.a_grupos, 2);
    assert.equal(mes.evitados, 30);
  });

  it('un mensaje a grupo que falló no evita ni cuenta como enviado', async () => {
    const r = await recibo(e3.id, u3, 'fallo');
    await envioGrupo({ grupo: G3.id, recibo: r.id, estado: 'fallo' });
    const mes = (await uso()).body.mes;
    assert.equal(mes.a_grupos, 0);
    assert.equal(mes.evitados, 0);
  });

  it('otra empresa no se mezcla: un grupo de la empresa B no suma a la A', async () => {
    const cb = await prisma.complejoHabitacional.findUnique({ where: { id: d.complejoB.id }, select: { id: true } });
    await envioGrupo({ empresa: d.empresaB.id, complejo: cb!.id });
    assert.equal((await uso(T.adminA)).body.mes.a_grupos, 0);
    assert.equal((await uso(T.adminB)).body.mes.a_grupos, 1);
  });

  it('enviados suma los directos y los mensajes a grupos del mes (recibo con grupo y recibo sin grupo)', async () => {
    const r2 = await recibo(e2.id, u2, 'block 2 suma');
    const usuarios = await prisma.usuario.findMany({ where: { email: { startsWith: 'mensajeria.e2.' } }, select: { id: true } });
    for (const u of usuarios) await directo(u.id, r2.id);
    const r3 = await recibo(e3.id, u3, 'block 3 suma');
    await envioGrupo({ grupo: G3.id, recibo: r3.id });
    const mes = (await uso()).body.mes;
    assert.equal(mes.enviados, 6, '5 directos + 1 al grupo');
    assert.equal(mes.a_grupos, 1);
    assert.equal(mes.evitados, 31);
  });

  it('sin grupos en uso la respuesta lo dice (grupos_en_uso 0): la pantalla pide asignarlos y no muestra un número de evitados', async () => {
    await prisma.grupoWhatsapp.updateMany({ where: { empresa_id: d.empresaA.id }, data: { en_uso: false } });
    const mes = (await uso()).body.mes;
    assert.equal(mes.grupos_en_uso, 0);
    assert.equal(mes.evitados, 0);
  });

  it('grupos_en_uso cuenta sólo los grupos en uso de la empresa', async () => {
    assert.equal((await uso()).body.mes.grupos_en_uso, 3, 'Block 1, Block 3 y el de todo el condominio; el apagado no');
    assert.equal((await uso(T.adminB)).body.mes.grupos_en_uso, 0);
  });
});

describe('la característica en los planes (una sola vez)', () => {
  it('el catálogo nuevo trae la viñeta en Pro y Administradora, y no en Gratis ni en Básico', () => {
    const con = (clave: string) => (PLANES_SEED.find((p) => p.clave === clave)!.caracteristicas as readonly string[]).includes(CARACTERISTICA_MENSAJERIA);
    assert.equal(con('pro'), true);
    assert.equal(con('administradora'), true);
    assert.equal(con('gratis'), false);
    assert.equal(con('basico'), false);
  });

  it('la migración la suma a Pro justo después de «Avisos por WhatsApp» y a Administradora; después no vuelve si el superadmin la quita', async () => {
    const sinViñeta = (clave: string) => PLANES_SEED.find((p) => p.clave === clave)!.caracteristicas.filter((c) => c !== CARACTERISTICA_MENSAJERIA);
    await prisma.planComercial.update({ where: { clave: 'pro' }, data: { caracteristicas: sinViñeta('pro') } });
    await prisma.planComercial.update({ where: { clave: 'administradora' }, data: { caracteristicas: sinViñeta('administradora') } });
    await prisma.configuracionComercial.update({ where: { id: (await obtenerConfiguracion()).id }, data: { migracion_mensajeria_at: null } });

    const primera = await migracionMensajeria(prisma);
    assert.deepEqual(primera, { aplicada: true, planes: 2 });
    const pro = (await prisma.planComercial.findUnique({ where: { clave: 'pro' }, select: { caracteristicas: true } }))!.caracteristicas;
    assert.equal(pro[pro.indexOf('Avisos por WhatsApp') + 1], CARACTERISTICA_MENSAJERIA);
    const adm = (await prisma.planComercial.findUnique({ where: { clave: 'administradora' }, select: { caracteristicas: true } }))!.caracteristicas;
    assert.ok(adm.includes(CARACTERISTICA_MENSAJERIA));

    const segunda = await migracionMensajeria(prisma);
    assert.deepEqual(segunda, { aplicada: false, planes: 0 }, 'con la marca puesta no hace nada');

    // El superadmin la quita de Pro: la migración ya corrió y no la vuelve a poner.
    await prisma.planComercial.update({ where: { clave: 'pro' }, data: { caracteristicas: sinViñeta('pro') } });
    await migracionMensajeria(prisma);
    const tras = (await prisma.planComercial.findUnique({ where: { clave: 'pro' }, select: { caracteristicas: true } }))!.caracteristicas;
    assert.equal(tras.includes(CARACTERISTICA_MENSAJERIA), false);
  });
});
