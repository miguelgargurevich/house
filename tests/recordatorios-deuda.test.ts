// Recordatorio de deuda a los morosos marcados (Morosidad › «Enviar recordatorio»): vista previa sin encolar, sólo al responsable de pago de cada unidad,
// una vez por unidad y día de Lima, y cuenta para el tope de WhatsApp. Todo con `fetch` falso (Resend y Evolution): nada sale a la red.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { esperar, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { procesarCola, type DepsAvisos } from '../src/server/services/avisos';
import { MOTIVO_YA_AL_DIA } from '../src/server/services/avisos/cola';
import { MOTIVO_TOPE_WHATSAPP, periodoDe } from '../src/server/services/comercial/consumo';
import { invalidarComercial } from '../src/server/services/comercial/modulos';
import { diaDeLima, encolarDeuda, planDeuda } from '../src/server/services/recordatorios/deuda';
import { correoDeAviso } from '../src/server/services/avisos/correoAviso';
import { plantilla, rutaDeAviso } from '../src/server/services/avisos/plantillas';
import type { AuthUser } from '../src/server/middleware/auth';

const ENV_OK: NodeJS.ProcessEnv = { RESEND_API_KEY: 're_CLAVE-FALSA-NO-REAL', MAIL_FROM: 'Casa <avisos@ejemplo.test>', EVOLUTION_URL: 'https://evo.ejemplo.test/', EVOLUTION_APIKEY: 'evo-CLAVE-FALSA-NO-REAL' };
/** Procesa la cola con `fetch` inyectado: nunca sale a la red. */
async function procesar() {
  const llamadas: { url: string; body: string }[] = [];
  const deps: DepsAvisos = {
    ahora: () => new Date(),
    esperar: async () => {},
    azar: () => 0,
    env: ENV_OK,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => { llamadas.push({ url: String(url), body: String(init?.body ?? '') }); return new Response('{}', { status: 200 }); }) as typeof fetch,
  };
  return { resumen: await procesarCola(deps), llamadas };
}
const esWhatsapp = (l: { url: string }) => l.url.includes('/message/sendText/');

const DIA = 86_400_000;
let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let U: Record<'A101' | 'A102' | 'A103' | 'A104' | 'B101', number>;
let P: Record<'rp' | 'familiar' | 'v3', number>;
let T: Record<'adminA' | 'adminB' | 'prop1' | 'inq1' | 'mttoA' | 'segA' | 'presi1' | 'super', string>;
let adminA: AuthUser;

before(async () => {
  d = await sembrar();
  const hash = await bcrypt.hash(PASSWORD, 4);
  const persona = (nombre: string, email: string, extra: Record<string, unknown> = {}) =>
    prisma.usuario.create({ data: { nombre, email, rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, ...extra } }).then((x) => x.id);
  P = { rp: await persona('Rosa Pagos', 'rp@test.pe'), familiar: await persona('Familiar de Rosa', 'familiar@test.pe'), v3: await persona('Vecino Tres', 'v3@test.pe') };
  await persona('Presidente 1', 'presi1@test.pe', { cargo_junta: 'presidente' });
  const unidad = (codigo: string, propietario_id: number) =>
    prisma.unidad.create({ data: { codigo, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, propietario_id, estado: 'activa' } }).then((x) => x.id);
  U = { A101: d.unidadA1.id, A102: d.unidadA2.id, A103: await unidad('A-103', P.v3), A104: await unidad('A-104', P.rp), B101: d.unidadB1.id };
  // A-104: dos personas con cuenta; sólo Rosa es la responsable de pago (la otra no debe recibir el cobro).
  await prisma.personaUnidad.create({ data: { unidad_id: U.A104, empresa_id: d.empresaA.id, nombre: 'Rosa Pagos', relacion: 'propietario', usuario_id: P.rp, responsable_pago: true, recibe_comunicados: true } });
  await prisma.personaUnidad.create({ data: { unidad_id: U.A104, empresa_id: d.empresaA.id, nombre: 'Familiar de Rosa', relacion: 'familiar', usuario_id: P.familiar, responsable_pago: false, recibe_comunicados: true } });
  const rc = await prisma.reciboConcepto.findFirstOrThrow({ where: { recibo_id: d.reciboVencidoA.id } });
  const cargo = (unidad_id: number, monto: number, estado_pago: string, rcId = rc.id) => prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rcId, unidad_id, monto, estado_pago } });
  await cargo(U.A103, 150, 'pagado'); // A-103 está al día
  await cargo(U.A104, 80, 'pendiente'); // A-104 debe 80.00
  // A-101 debe además un segundo mes vencido (50): su deuda vencida es 200.00 (el recibo futuro de 200 NO cuenta).
  const reciboViejo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, mes: 7, anio: 2026, fecha_emision: new Date(Date.now() - 90 * DIA), fecha_vencimiento: new Date(Date.now() - 60 * DIA), estado: 'emitido', descripcion: 'Recibo 7' } });
  const rcViejo = await prisma.reciboConcepto.create({ data: { recibo_id: reciboViejo.id, concepto_id: d.conceptoA.id, monto: 50, orden: 1 } });
  await cargo(U.A101, 50, 'pendiente', rcViejo.id);
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    prop1: await login(base, 'prop1@test.pe'),
    inq1: await login(base, 'inq1@test.pe'),
    mttoA: await login(base, 'mtto.a@test.pe'),
    segA: await login(base, 'seg.a@test.pe'),
    presi1: await login(base, 'presi1@test.pe'),
    super: await login(base, 'super@test.pe'),
  };
  adminA = { id: d.adminA.id, email: 'admin.a@test.pe', rol: 'admin', empresa_id: d.empresaA.id, complejo_id: null, cargo_junta: null, estructura_id: null };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.notificacion.deleteMany();
  await prisma.auditoria.deleteMany();
  await prisma.consumoMensual.deleteMany();
  await prisma.usuario.updateMany({ data: { aviso_email: true, aviso_whatsapp: false, telefono: null } });
  await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: null, nombre_comercial: null } });
  await prisma.configuracionComercial.updateMany({ data: { whatsapp_tope_diario: null } });
  await prisma.planComercial.update({ where: { clave: 'cortesia' }, data: { whatsapp_por_unidad_mes: null } });
  invalidarComercial();
});

const llama = (t: string | null, metodo: string, ruta: string, cuerpo?: unknown) => llamar(base, metodo, ruta, t, cuerpo);
const recordar = (t: string | null, unidades: number[], canales: string[] = ['email', 'whatsapp'], confirmar = false) => llama(t, 'POST', '/api/recordatorios/deuda', { unidades, canales, confirmar });
const conWhatsapp = async (...ids: number[]) => { await prisma.usuario.updateMany({ where: { id: { in: ids } }, data: { aviso_whatsapp: true, telefono: '+51987000000' } }); };
const conInstancia = () => prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: 'instancia-empresa-a' } });
const encolado = async () => (await prisma.notificacion.findMany({ where: { tipo: 'recordatorio_deuda' }, select: { usuario_id: true, canal: true, ref_id: true } })).map((n) => `${n.ref_id}:${n.usuario_id}:${n.canal}`).sort();

describe('recordatorio de deuda: vista previa', () => {
  it('da los números exactos y NO encola nada (tampoco avisa)', async () => {
    await conInstancia();
    await conWhatsapp(d.inquilino1.id); // el responsable de A-101; prop2 (A-102) no tiene celular
    const r = await recordar(T.adminA, [U.A101, U.A102, U.A103]);
    assert.equal(r.status, 200, r.texto);
    const { whatsapp, ejemplo, ...cifras } = r.body;
    assert.deepEqual(cifras, { confirmado: false, unidades: 3, sin_deuda: 1, ya_recordadas_hoy: 0, responsables: 2, por_avisar: 2, por_correo: 2, por_whatsapp: 1, sin_canal: 0 });
    assert.equal(whatsapp.length, 1);
    assert.equal(whatsapp[0].por_enviar, 1);
    assert.equal(whatsapp[0].disponible, true);
    // El texto trae lo que debe la primera unidad (A-101: 150 + 50) y el enlace; el nombre queda como marcador.
    assert.match(ejemplo.cuerpo, /Hola \[Nombre\],/);
    assert.match(ejemplo.cuerpo, /S\/ 200\.00/);
    assert.match(ejemplo.cuerpo, /torrecondominios\.com/);
    assert.equal(await prisma.notificacion.count(), 0, 'la vista previa no encola nada');
    // Lo único que queda es el registro de que se pidió la vista previa, sin datos personales.
    const aud = await esperar(() => prisma.auditoria.findFirst({ where: { entidad: 'recordatorio' } }));
    assert.equal(aud.accion, 'vista_previa_recordar_deuda');
    assert.ok(!JSON.stringify(aud.detalle).match(/@test|\+51|Rosa|Inquilino/));
  });

  it('cuenta los que no tienen canal (sin correo activo ni celular) y los que no quieren el aviso', async () => {
    await prisma.usuario.update({ where: { id: d.propietario2.id }, data: { aviso_email: false } }); // A-102: nada
    const r = await recordar(T.adminA, [U.A101, U.A102]);
    assert.equal(r.body.por_avisar, 1);
    assert.equal(r.body.sin_canal, 1);
    assert.equal(r.body.responsables, 2);
    // Sólo WhatsApp y nadie tiene celular: nadie recibe.
    const solo = await recordar(T.adminA, [U.A101, U.A102], ['whatsapp']);
    assert.equal(solo.body.por_avisar, 0);
    assert.equal(solo.body.sin_canal, 2);
    assert.equal(solo.body.ejemplo, null);
  });

  it('dice lo que queda de la cuota de WhatsApp del condominio y si alcanza', async () => {
    await conInstancia();
    await conWhatsapp(d.inquilino1.id, d.propietario2.id);
    // Cuota: 1 por departamento y mes × las 4 unidades del condominio = 4; el condominio ya usó 3.
    await prisma.planComercial.update({ where: { clave: 'cortesia' }, data: { whatsapp_por_unidad_mes: 1 } });
    invalidarComercial();
    await prisma.consumoMensual.create({ data: { complejo_id: d.complejoA.id, periodo: periodoDe(new Date()), recurso: 'whatsapp', cantidad: 3 } });
    const r = await recordar(T.adminA, [U.A101, U.A102]);
    assert.equal(r.body.por_whatsapp, 2);
    assert.deepEqual({ ...r.body.whatsapp[0], hoy: undefined }, { complejo_id: d.complejoA.id, nombre: 'Complejo A', por_enviar: 2, usadas: 3, tope: 4, restantes: 1, alcanza: false, hoy: undefined, disponible: true, motivo_no_disponible: null });
    // Con tope diario del número: lo dice también.
    await prisma.configuracionComercial.updateMany({ data: { whatsapp_tope_diario: 150 } });
    assert.deepEqual((await recordar(T.adminA, [U.A101])).body.whatsapp[0].hoy, { enviados: 0, tope: 150 });
  });

  it('sin el módulo de WhatsApp o sin número conectado, ninguno va por WhatsApp y lo dice', async () => {
    await conWhatsapp(d.inquilino1.id);
    const sinNumero = await recordar(T.adminA, [U.A101]);
    assert.equal(sinNumero.body.por_whatsapp, 0);
    assert.equal(sinNumero.body.por_correo, 1);
    assert.equal(sinNumero.body.whatsapp[0].disponible, false);
    assert.match(sinNumero.body.whatsapp[0].motivo_no_disponible, /número de WhatsApp/);
    await conInstancia();
    await prisma.suscripcionCondominio.deleteMany({ where: { complejo_id: d.complejoA.id } });
    invalidarComercial();
    const sinPlan = await recordar(T.adminA, [U.A101]);
    assert.equal(sinPlan.body.por_whatsapp, 0);
    assert.match(sinPlan.body.whatsapp[0].motivo_no_disponible, /plan/);
    await prisma.suscripcionCondominio.create({ data: { complejo_id: d.complejoA.id, plan_clave: 'cortesia', modulos: ['ia_vouchers', 'whatsapp_avisos', 'asistente'], estado: 'activa' } });
    invalidarComercial();
  });
});

describe('recordatorio de deuda: confirmar', () => {
  it('encola SÓLO al responsable de pago de cada unidad marcada que debe, con su monto y el enlace', async () => {
    await conInstancia();
    await conWhatsapp(d.inquilino1.id, P.rp, P.familiar, d.propietario1.id);
    const r = await recordar(T.adminA, [U.A101, U.A103, U.A104], ['email', 'whatsapp'], true);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.confirmado, true);
    assert.equal(r.body.avisos_encolados, 4);
    // A-101 → su inquilino (paga él; el propietario no). A-104 → Rosa (la responsable; no su familiar con cuenta). A-103 está al día: nada.
    assert.deepEqual(await encolado(), [`${U.A101}:${d.inquilino1.id}:email`, `${U.A101}:${d.inquilino1.id}:whatsapp`, `${U.A104}:${P.rp}:email`, `${U.A104}:${P.rp}:whatsapp`].sort());
    const a101 = await prisma.notificacion.findFirstOrThrow({ where: { tipo: 'recordatorio_deuda', ref_id: U.A101, canal: 'email' } });
    assert.equal(a101.ref_entidad, `deuda:${diaDeLima(new Date())}`);
    assert.equal(a101.estado, 'pendiente');
    assert.match(a101.cuerpo, /Hola Inquilino,/);
    assert.match(a101.cuerpo, /saldo vencido de S\/ 200\.00/);
    assert.match(a101.cuerpo, /Departamento: A-101\./);
    assert.match(a101.cuerpo, /- Mantenimiento de .*: S\/ 50\.00/);
    assert.match(a101.cuerpo, /https:\/\/torrecondominios\.com\/inquilino\/cargos/);
    assert.match(a101.cuerpo, /— Administración de Complejo A$/);
    const a104 = await prisma.notificacion.findFirstOrThrow({ where: { tipo: 'recordatorio_deuda', ref_id: U.A104, canal: 'whatsapp' } });
    assert.match(a104.cuerpo, /S\/ 80\.00/);
    // Auditoría: cantidades e ids de departamento, nada personal.
    const aud = await esperar(() => prisma.auditoria.findFirst({ where: { entidad: 'recordatorio', accion: 'recordar_deuda' } }));
    const det = aud.detalle as Record<string, unknown>;
    assert.deepEqual({ ...det, unidades_ids: [...(det.unidades_ids as number[])].sort() }, { unidades_ids: [U.A101, U.A103, U.A104].sort((a, b) => a - b), canales: ['email', 'whatsapp'], sin_deuda: 1, ya_recordadas_hoy: 0, por_avisar: 2, por_correo: 2, por_whatsapp: 2, sin_canal: 0, avisos_encolados: 4 });
    assert.ok(!JSON.stringify(det).match(/@test|\+51|Rosa|Inquilino|S\//));
  });

  it('una unidad sin deuda no recibe nada', async () => {
    const r = await recordar(T.adminA, [U.A103], ['email', 'whatsapp'], true);
    assert.equal(r.status, 200);
    assert.equal(r.body.sin_deuda, 1);
    assert.equal(r.body.por_avisar, 0);
    assert.equal(r.body.avisos_encolados, 0);
    assert.equal(await prisma.notificacion.count(), 0);
  });

  it('el mismo día no se repite a la misma unidad (la vista previa lo dice); otro día sí', async () => {
    const primera = await recordar(T.adminA, [U.A101, U.A102], ['email'], true);
    assert.equal(primera.body.avisos_encolados, 2);
    const otra = await recordar(T.adminA, [U.A101, U.A102], ['email'], true);
    assert.equal(otra.body.avisos_encolados, 0);
    assert.equal(otra.body.ya_recordadas_hoy, 2);
    assert.equal(otra.body.por_avisar, 0);
    assert.equal(await prisma.notificacion.count({ where: { tipo: 'recordatorio_deuda' } }), 2, 'nada duplicado');
    // Tampoco por OTRO canal el mismo día: el departamento ya recibió su recordatorio de hoy.
    await conInstancia();
    await conWhatsapp(d.inquilino1.id);
    const porWa = await recordar(T.adminA, [U.A101], ['whatsapp']);
    assert.equal(porWa.body.ya_recordadas_hoy, 1);
    assert.equal(porWa.body.por_whatsapp, 0);
    // Con una unidad nueva sí sale, y las ya recordadas se saltan.
    const mezcla = await recordar(T.adminA, [U.A101, U.A104], ['email'], true);
    assert.equal(mezcla.body.ya_recordadas_hoy, 1);
    assert.equal(mezcla.body.avisos_encolados, 1);
    // Al día siguiente (día de Lima) se puede volver a recordar.
    const manana = new Date(Date.now() + DIA);
    const plan = await planDeuda(adminA, { unidades: [U.A101, U.A102], canales: ['email'] }, manana);
    assert.equal(plan.ya_recordadas_hoy, 0);
    assert.equal(await encolarDeuda(plan, manana), 2);
  });

  it('dos confirmaciones a la vez no duplican (la fila es única por persona, canal y día)', async () => {
    const [a, b] = await Promise.all([recordar(T.adminA, [U.A101, U.A102], ['email'], true), recordar(T.adminA, [U.A101, U.A102], ['email'], true)]);
    assert.equal(a.status + b.status, 400);
    assert.equal(await prisma.notificacion.count({ where: { tipo: 'recordatorio_deuda' } }), 2);
  });

  it('el correo sale con diseño (HTML), el WhatsApp con el pie de «SALIR»; ambos con `fetch` falso', async () => {
    await conInstancia();
    await conWhatsapp(d.inquilino1.id);
    await recordar(T.adminA, [U.A101], ['email', 'whatsapp'], true);
    const p = await procesar();
    assert.equal(p.resumen.enviadas, 2, JSON.stringify(p.resumen));
    const wa = JSON.parse(p.llamadas.find(esWhatsapp)!.body) as { text: string };
    assert.match(wa.text, /saldo vencido de S\/ 200\.00/);
    assert.match(wa.text, /responde SALIR/);
    const correo = JSON.parse(p.llamadas.find((l) => l.url.includes('resend'))!.body) as { subject: string; html: string };
    assert.match(correo.subject, /^Recordatorio: tienes S\/ 200\.00 pendientes/);
    assert.match(correo.html, /<table/);
    assert.match(correo.html, /Saldo vencido/);
    assert.match(correo.html, /S\/ 200\.00/);
    assert.match(correo.html, /Pagar y subir mi voucher/);
  });

  it('con la marca propia activa, la firma suma el nombre comercial de la empresa', async () => {
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { nombre_comercial: 'Urbana Condominios' } });
    await recordar(T.adminA, [U.A102], ['email'], true);
    const n = await prisma.notificacion.findFirstOrThrow({ where: { tipo: 'recordatorio_deuda' } });
    assert.match(n.cuerpo, /— Administración de Complejo A · Urbana Condominios$/);
    const p = await procesar();
    assert.match((JSON.parse(p.llamadas.find((l) => l.url.includes('resend'))!.body) as { html: string }).html, /Urbana Condominios/);
  });

  it('si el departamento paga antes de que salga, el aviso se omite (no se le cobra a quien ya está al día)', async () => {
    await recordar(T.adminA, [U.A102], ['email'], true);
    await prisma.reciboConceptoUnidad.updateMany({ where: { unidad_id: U.A102 }, data: { estado_pago: 'pagado' } });
    const p = await procesar();
    assert.equal(p.llamadas.length, 0);
    const n = await prisma.notificacion.findFirstOrThrow({ where: { tipo: 'recordatorio_deuda' } });
    assert.equal(n.estado, 'omitida');
    assert.equal(n.error, MOTIVO_YA_AL_DIA);
    await prisma.reciboConceptoUnidad.updateMany({ where: { unidad_id: U.A102 }, data: { estado_pago: 'pendiente' } });
  });
});

describe('recordatorio de deuda: cuenta para el tope de WhatsApp', () => {
  it('contra la cuota mensual del condominio: lo que no entra queda omitido por el tope y el correo sale', async () => {
    await conInstancia();
    await conWhatsapp(d.inquilino1.id, d.propietario2.id);
    await prisma.planComercial.update({ where: { clave: 'cortesia' }, data: { whatsapp_por_unidad_mes: 1 } }); // tope = 1 × 4 unidades = 4
    invalidarComercial();
    await prisma.consumoMensual.create({ data: { complejo_id: d.complejoA.id, periodo: periodoDe(new Date()), recurso: 'whatsapp', cantidad: 3 } }); // queda 1
    await recordar(T.adminA, [U.A101, U.A102], ['email', 'whatsapp'], true);
    const p = await procesar();
    assert.equal(p.llamadas.filter(esWhatsapp).length, 1, 'sólo cabía uno');
    assert.equal(p.llamadas.filter((l) => l.url.includes('resend')).length, 2, 'los correos no cuentan');
    const was = await prisma.notificacion.findMany({ where: { tipo: 'recordatorio_deuda', canal: 'whatsapp' }, orderBy: { id: 'asc' } });
    assert.deepEqual(was.map((n) => n.estado).sort(), ['enviada', 'omitida']);
    assert.equal(was.find((n) => n.estado === 'omitida')!.error, MOTIVO_TOPE_WHATSAPP);
    assert.equal((await prisma.consumoMensual.findFirstOrThrow({ where: { complejo_id: d.complejoA.id } })).cantidad, 4, 'el envío sumó a lo usado del mes');
  });

  it('contra el tope diario del número: pasado el tope, el resto queda para mañana', async () => {
    await conInstancia();
    await conWhatsapp(d.inquilino1.id, d.propietario2.id);
    await prisma.configuracionComercial.updateMany({ data: { whatsapp_tope_diario: 1 } });
    await recordar(T.adminA, [U.A101, U.A102], ['whatsapp'], true);
    const p = await procesar();
    assert.equal(p.llamadas.filter(esWhatsapp).length, 1);
    const filas = await prisma.notificacion.findMany({ where: { tipo: 'recordatorio_deuda' } });
    assert.deepEqual(filas.map((n) => n.estado).sort(), ['enviada', 'pendiente']);
    assert.ok(filas.find((n) => n.estado === 'pendiente')!.programada_para.getTime() > Date.now(), 'el pendiente sale mañana');
    // Y los que ya salieron hoy se ven en la vista previa del tope diario.
    await prisma.configuracionComercial.updateMany({ data: { whatsapp_tope_diario: 150 } });
    assert.deepEqual((await recordar(T.adminA, [U.A104], ['whatsapp'])).body.whatsapp[0].hoy, { enviados: 1, tope: 150 });
  });
});

describe('recordatorio de deuda: quién puede y qué alcanza', () => {
  it('otra empresa: 404 y no se encola nada; mezclando una unidad ajena, tampoco se envía la propia', async () => {
    for (const unidades of [[U.A101], [U.A101, U.A102]]) {
      for (const confirmar of [false, true]) {
        const r = await recordar(T.adminB, unidades, ['email'], confirmar);
        assert.equal(r.status, 404, r.texto);
      }
    }
    for (const confirmar of [false, true]) assert.equal((await recordar(T.adminA, [U.A101, U.B101], ['email'], confirmar)).status, 404);
    assert.equal((await recordar(T.adminA, [U.A101, 999_999], ['email'], true)).status, 404);
    assert.equal(await prisma.notificacion.count(), 0);
  });

  it('personal, residentes y junta reciben 403; sin sesión 401', async () => {
    assert.equal((await recordar(null, [U.A101])).status, 401);
    for (const t of ['mttoA', 'segA', 'prop1', 'inq1', 'presi1'] as const) {
      for (const confirmar of [false, true]) assert.equal((await recordar(T[t], [U.A101], ['email'], confirmar)).status, 403, `${t} confirmar=${confirmar}`);
    }
    assert.equal(await prisma.notificacion.count(), 0);
  });

  it('el superadmin sí puede (alcance global)', async () => {
    assert.equal((await recordar(T.super, [U.A101], ['email'], true)).status, 200);
    assert.equal(await prisma.notificacion.count({ where: { tipo: 'recordatorio_deuda' } }), 1);
  });

  it('valida la entrada: sin unidades, sin canales, canal inválido, no enteros o demasiadas → 422', async () => {
    const malos: Record<string, unknown>[] = [
      { unidades: [], canales: ['email'] },
      { unidades: [U.A101], canales: [] },
      { unidades: [U.A101], canales: ['sms'] },
      { unidades: ['a'], canales: ['email'] },
      { unidades: Array.from({ length: 501 }, (_, i) => i + 1), canales: ['email'] },
      { unidades: [U.A101], canales: ['email'], confirmar: 'si' },
      { canales: ['email'] },
    ];
    for (const cuerpo of malos) assert.equal((await llama(T.adminA, 'POST', '/api/recordatorios/deuda', cuerpo)).status, 422, JSON.stringify(cuerpo).slice(0, 60));
    assert.equal(await prisma.notificacion.count(), 0);
  });

  it('respeta las preferencias: sin correo no hay correo; sólo los canales elegidos', async () => {
    await prisma.usuario.update({ where: { id: d.inquilino1.id }, data: { aviso_email: false, aviso_whatsapp: true, telefono: '+51987000000' } });
    await conInstancia();
    const soloCorreo = await recordar(T.adminA, [U.A101], ['email'], true);
    assert.equal(soloCorreo.body.sin_canal, 1);
    assert.equal(await prisma.notificacion.count(), 0);
    const wa = await recordar(T.adminA, [U.A101], ['whatsapp'], true);
    assert.equal(wa.body.por_avisar, 1);
    assert.deepEqual(await encolado(), [`${U.A101}:${d.inquilino1.id}:whatsapp`]);
  });
});

describe('recordatorio de deuda: el mensaje', () => {
  const datos = { nombre: 'María Elena Quispe', periodo: '', monto: 'S/ 1,234.50', vencimiento: '', condominio: 'Condominio Los Pinos', departamentos: [{ codigo: 'B01-804', torre: 'Block 1' }], conceptos: [{ nombre: 'Mantenimiento de setiembre de 2026', monto: 'S/ 600.00' }, { nombre: 'Mantenimiento de octubre de 2026', monto: 'S/ 634.50' }] };

  it('el texto lleva nombre (sólo el primero), monto, departamento, un renglón por mes, enlace y firma; con tuteo y sin emojis', () => {
    const { asunto, cuerpo } = plantilla('recordatorio_deuda', { ...datos, enlace: 'https://torrecondominios.com/propietario/cargos', empresa: 'Urbana' });
    assert.equal(asunto, 'Recordatorio: tienes S/ 1,234.50 pendientes de pago');
    assert.match(cuerpo, /^Hola María,/);
    assert.match(cuerpo, /saldo vencido de S\/ 1,234\.50/);
    assert.match(cuerpo, /Departamento: B01-804 \(Block 1\)\./);
    assert.match(cuerpo, /- Mantenimiento de setiembre de 2026: S\/ 600\.00\n- Mantenimiento de octubre de 2026: S\/ 634\.50/);
    assert.match(cuerpo, /https:\/\/torrecondominios\.com\/propietario\/cargos/);
    assert.match(cuerpo, /— Administración de Condominio Los Pinos · Urbana$/);
    assert.doesNotMatch(cuerpo, /Quispe|undefined|NaN|\{|\}|\p{Extended_Pictographic}/u);
  });

  it('el enlace es la pantalla de cargos de cada rol', () => {
    assert.equal(rutaDeAviso('recordatorio_deuda', 'propietario'), '/propietario/cargos');
    assert.equal(rutaDeAviso('recordatorio_deuda', 'inquilino'), '/inquilino/cargos');
    assert.equal(rutaDeAviso('recordatorio_deuda', 'admin'), '');
  });

  it('el correo con diseño trae el saldo grande, el departamento, la tabla de meses y el botón; lo de la base va escapado', () => {
    const { html, asunto } = correoDeAviso('recordatorio_deuda', { ...datos, nombre: '<b>Ana</b> Pérez', conceptos: [{ nombre: '<script>x</script>', monto: 'S/ 1.00' }] });
    assert.equal(asunto, 'Recordatorio: tienes S/ 1,234.50 pendientes de pago');
    assert.match(html, /Saldo vencido/);
    assert.match(html, /S\/ 1,234\.50/);
    assert.match(html, /B01-804 \(Block 1\)/);
    assert.match(html, /Pagar y subir mi voucher/);
    assert.doesNotMatch(html, /<script>x|<b>Ana/);
  });
});
