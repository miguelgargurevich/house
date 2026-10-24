import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { iniciar, esperar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { hoyLima } from '../src/server/lib/fechas';
import { encolarAviso, encolarRecordatorios, encolarReciboEmitido, procesarCola, ciclo, MAX_INTENTOS, type DepsAvisos } from '../src/server/services/avisos';
import { LOCK_AVISOS, planificadorActivo } from '../src/server/services/avisos/planificador';
import { formatearCelular, normalizarCelular } from '../src/server/services/avisos/celular';
import { fechaTexto, periodoTexto, plantilla, solesTexto, TIPOS } from '../src/server/services/avisos/plantillas';
import { estadoCanales } from '../src/server/services/avisos/canales';

const DIA = 86_400_000;
const MIN = 60_000;
const CLAVE_RESEND = 're_CLAVE-FALSA-NO-REAL';
const CLAVE_EVO = 'evo-CLAVE-FALSA-NO-REAL';
const ENV_OK: NodeJS.ProcessEnv = {
  RESEND_API_KEY: CLAVE_RESEND,
  MAIL_FROM: 'Casa <avisos@ejemplo.test>',
  EVOLUTION_URL: 'https://evo.ejemplo.test/',
  EVOLUTION_INSTANCE: 'instancia-falsa',
  EVOLUTION_APIKEY: CLAVE_EVO,
};

interface Llamada { url: string; init: RequestInit }
/** Dependencias inyectadas: reloj fijo y `fetch` que nunca sale a la red. */
function crearDeps(ahora: Date, env: NodeJS.ProcessEnv, responder: (l: Llamada) => Response | Promise<Response> = () => new Response('{}', { status: 200 })) {
  const llamadas: Llamada[] = [];
  const deps: DepsAvisos = {
    ahora: () => ahora,
    env,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const l = { url: String(url), init: init ?? {} };
      llamadas.push(l);
      return responder(l);
    }) as typeof fetch,
  };
  return { deps, llamadas };
}

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1' | 'inq1', string>;

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    super: await login(base, 'super@test.pe'),
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    prop1: await login(base, 'prop1@test.pe'),
    inq1: await login(base, 'inq1@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

const restaurar = new Map<string, string | undefined>();
beforeEach(async () => {
  await prisma.notificacion.deleteMany();
  await prisma.usuario.updateMany({ data: { aviso_email: true, aviso_whatsapp: false } });
  await prisma.usuario.updateMany({ data: { telefono: null } });
  await prisma.reciboConceptoUnidad.updateMany({ data: { estado_pago: 'pendiente' } });
});
afterEach(() => {
  for (const [k, v] of restaurar) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  restaurar.clear();
});
const fijarEnv = (env: NodeJS.ProcessEnv) => {
  for (const k of Object.keys(env)) { restaurar.set(k, process.env[k]); process.env[k] = env[k]; }
};

const notifs = (where: object = {}) => prisma.notificacion.findMany({ where, orderBy: { id: 'asc' } });

describe('celulares peruanos', () => {
  it('normaliza a 51 + 9 dígitos y descarta lo inválido', () => {
    for (const ok of ['987654321', '987 654 321', '+51 987 654 321', '51987654321', '0051987654321', '(+51) 987-654-321', ' 987.654.321 ']) {
      assert.equal(normalizarCelular(ok), '51987654321', ok);
    }
    for (const mal of ['', null, undefined, '12345', '887654321', '01 234 5678', '5198765432', '519876543210', '+34 612 345 678', 'abc', '98765432a', '9876543210']) {
      assert.equal(normalizarCelular(mal as string), null, String(mal));
    }
    assert.equal(formatearCelular('51987654321'), '+51 987 654 321');
  });
});

describe('plantillas', () => {
  const datos = { nombre: 'María Elena Quispe', periodo: periodoTexto(10, 2026), concepto: 'Mantenimiento', monto: solesTexto('1234.5'), vencimiento: fechaTexto(new Date(Date.UTC(2026, 10, 15))), dias: 3 };
  it('cada tipo lleva nombre, periodo, monto, enlace y está en español con tuteo', () => {
    assert.equal(datos.periodo, 'octubre de 2026');
    assert.equal(datos.monto, 'S/ 1,234.50');
    assert.equal(datos.vencimiento, '15/11/2026');
    for (const tipo of TIPOS.filter((t) => !t.startsWith('ia_'))) { // los de la IA no hablan de cargos (ver abajo)
      const { asunto, cuerpo } = plantilla(tipo, datos);
      assert.ok(asunto.length > 5 && asunto.length < 90, tipo);
      assert.match(cuerpo, /^Hola María,/, tipo);
      assert.match(cuerpo, /octubre de 2026/, tipo);
      assert.match(cuerpo, /S\/ 1,234\.50/, tipo);
      assert.match(cuerpo, /https:\/\/house\.gargurevich\.dev/, tipo);
      assert.doesNotMatch(cuerpo, /Quispe|undefined|NaN|\{|\}/, tipo);
    }
    assert.match(plantilla('por_vencer', datos).asunto, /vence en 3 días/);
    assert.match(plantilla('por_vencer', { ...datos, dias: 1 }).asunto, /vence mañana/);
    assert.match(plantilla('recibo_emitido', datos).cuerpo, /Vence el 15\/11\/2026/);
    assert.match(plantilla('vencido', datos).cuerpo, /venció el 15\/11\/2026/);
  });

  it('los avisos de la IA (sólo superadmin) llevan el detalle y el enlace al Llavero, sin hablar de cargos', () => {
    const caida = plantilla('ia_caida', { ...datos, motivo: 'Sin IA disponible desde las 14:32: Gemini 404, Groq 404, OpenRouter sin saldo.' });
    assert.match(caida.cuerpo, /^Hola María,/);
    assert.match(caida.cuerpo, /Gemini 404, Groq 404, OpenRouter sin saldo/);
    assert.match(caida.cuerpo, /house\.gargurevich\.dev\/superadmin\/llavero/);
    assert.match(plantilla('ia_restablecida', { ...datos, motivo: 'La IA del asistente se restableció.' }).cuerpo, /se restableció/);
    for (const tipo of ['ia_caida', 'ia_restablecida'] as const) assert.doesNotMatch(plantilla(tipo, datos).cuerpo, /S\/|undefined|\{|\}/);
  });
});

describe('recibo emitido', () => {
  it('encola un aviso por usuario y recibo, sin duplicar aunque se repita', async () => {
    const hoy = hoyLima();
    const r = await llamar(base, 'POST', '/api/recibos', T.adminA, {
      complejo_id: d.complejoA.id, mes: 11, anio: 2026, fecha_emision: hoy.toISOString().slice(0, 10), fecha_vencimiento: new Date(hoy.getTime() + 20 * DIA).toISOString().slice(0, 10),
      conceptos: [{ concepto_id: d.conceptoA.id, monto: 100 }, { concepto_id: d.conceptoA.id, monto: 50.5 }],
    });
    assert.equal(r.status, 201, r.texto);
    // Unidades A-101 (prop1 + inq1) y A-102 (prop2): tres usuarios, un correo cada uno.
    const todas = await notifs({ ref_id: r.body.id });
    assert.equal(todas.length, 3);
    assert.deepEqual(todas.map((n) => n.usuario_id).sort(), [d.propietario1.id, d.propietario2.id, d.inquilino1.id].sort());
    assert.ok(todas.every((n) => n.canal === 'email' && n.tipo === 'recibo_emitido' && n.estado === 'pendiente' && n.ref_entidad === 'recibo'));
    const de1 = todas.find((n) => n.usuario_id === d.propietario1.id)!;
    assert.match(de1.cuerpo, /Total a pagar: S\/ 150\.50/, 'suma de los dos conceptos de su unidad');
    assert.match(de1.asunto, /noviembre de 2026/);
    assert.equal(await encolarReciboEmitido(r.body.id), 0, 'repetir no duplica');
    assert.equal((await notifs({ ref_id: r.body.id })).length, 3);
  });

  it('un fallo al encolar no deshace la emisión del recibo', async () => {
    const original = prisma.notificacion.createMany;
    const consola = console.error;
    const logs: string[] = [];
    console.error = (...a: unknown[]) => { logs.push(a.join(' ')); };
    prisma.notificacion.createMany = () => { throw new Error('boom con clave-secreta'); };
    try {
      const hoy = hoyLima();
      const r = await llamar(base, 'POST', '/api/recibos', T.adminA, {
        complejo_id: d.complejoA.id, mes: 12, anio: 2026, fecha_emision: hoy.toISOString().slice(0, 10), fecha_vencimiento: new Date(hoy.getTime() + 20 * DIA).toISOString().slice(0, 10),
        conceptos: [{ concepto_id: d.conceptoA.id, monto: 10 }],
      });
      assert.equal(r.status, 201, r.texto);
      assert.equal(await prisma.recibo.count({ where: { id: r.body.id } }), 1);
      assert.ok(logs.some((l) => l.includes('[avisos]')));
    } finally {
      prisma.notificacion.createMany = original;
      console.error = consola;
    }
  });

  it('respeta preferencias, correo y celular: WhatsApp sólo con la opción activa y celular', async () => {
    await prisma.usuario.update({ where: { id: d.propietario1.id }, data: { aviso_whatsapp: true, telefono: '987654321' } });
    await prisma.usuario.update({ where: { id: d.inquilino1.id }, data: { aviso_email: false } }); // sin ningún canal
    await prisma.usuario.update({ where: { id: d.propietario2.id }, data: { aviso_whatsapp: true } }); // quiere WhatsApp pero no tiene celular
    const creadas = await encolarReciboEmitido(d.reciboVencidoA.id);
    const todas = await notifs();
    assert.equal(creadas, 3);
    assert.deepEqual(todas.map((n) => `${n.usuario_id}:${n.canal}`).sort(), [`${d.propietario1.id}:email`, `${d.propietario1.id}:whatsapp`, `${d.propietario2.id}:email`].sort());
  });
});

describe('recordatorios por fecha (reloj inyectado)', () => {
  const ref = () => d.reciboFuturoA.fecha_vencimiento.getTime();

  it('por_vencer: aparece 3 días antes, no antes, y repetir el planificador no duplica', async () => {
    assert.equal(await encolarRecordatorios(new Date(ref() - 4 * DIA + 12 * 3600_000)), 0, '4 días antes aún no');
    const tres = new Date(ref() - 3 * DIA + 12 * 3600_000);
    assert.equal(await encolarRecordatorios(tres), 2, 'propietario e inquilino de A-101');
    const n = await notifs();
    assert.ok(n.every((x) => x.tipo === 'por_vencer' && x.ref_id === d.reciboFuturoA.id));
    assert.match(n[0]!.asunto, /vence en 3 días/);
    assert.equal(await encolarRecordatorios(tres), 0);
    assert.equal(await encolarRecordatorios(new Date(tres.getTime() + 2 * MIN)), 0);
    assert.equal((await notifs()).length, 2);
  });

  it('vencido: al día siguiente del vencimiento; no antes', async () => {
    const venc = d.reciboVencidoA.fecha_vencimiento.getTime();
    await encolarRecordatorios(new Date(venc + 12 * 3600_000));
    assert.equal((await notifs({ tipo: 'vencido' })).length, 0, 'el día del vencimiento aún no está vencido (sólo por_vencer: vence hoy)');
    await prisma.notificacion.deleteMany();
    await encolarRecordatorios(new Date(venc + DIA + 12 * 3600_000));
    const n = await notifs({ tipo: 'vencido', ref_id: d.reciboVencidoA.id });
    assert.equal(n.length, 3, 'A-101 (propietario e inquilino) y A-102');
    assert.equal((await notifs({ tipo: 'vencido', ref_id: d.reciboB.id })).length, 1, 'y el recibo de la empresa B, por separado');
    assert.match(n[0]!.cuerpo, /Tu recibo de agosto de 2026 venció el /);
    assert.equal(await encolarRecordatorios(new Date(venc + DIA + 13 * 3600_000)), 0, 'repetir no duplica');
  });

  it('sólo cargos pendientes: ni en revisión ni pagados', async () => {
    await prisma.reciboConceptoUnidad.update({ where: { id: d.cargoA2.id }, data: { estado_pago: 'en_revision' } });
    await prisma.reciboConceptoUnidad.update({ where: { id: d.cargoVencidoA1.id }, data: { estado_pago: 'pagado' } });
    const venc = d.reciboVencidoA.fecha_vencimiento.getTime();
    await encolarRecordatorios(new Date(venc + DIA + 12 * 3600_000));
    assert.deepEqual((await notifs({ tipo: 'vencido', ref_id: d.reciboVencidoA.id })).length, 0);
  });

  it('un recibo emitido hoy no recibe por_vencer el mismo día (ya se avisó al emitirlo)', async () => {
    const hoy = hoyLima();
    await prisma.recibo.update({ where: { id: d.reciboFuturoA.id }, data: { fecha_emision: hoy, fecha_vencimiento: new Date(hoy.getTime() + 2 * DIA) } });
    try {
      assert.equal(await encolarRecordatorios(new Date(hoy.getTime() + 12 * 3600_000)), 0);
      assert.equal(await encolarRecordatorios(new Date(hoy.getTime() + DIA + 12 * 3600_000)), 2, 'al día siguiente sí');
    } finally {
      await prisma.recibo.update({ where: { id: d.reciboFuturoA.id }, data: { fecha_emision: new Date(hoy.getTime() - 60 * DIA), fecha_vencimiento: d.reciboFuturoA.fecha_vencimiento } });
    }
  });
});

describe('eventos de pago: encolarAviso exportado', () => {
  it('pago_validado y pago_rechazado salen de un cargo, con su monto y concepto', async () => {
    assert.equal(await encolarAviso('pago_validado', d.propietario1.id, { entidad: 'cargo', id: d.cargoVencidoA1.id }), 1);
    assert.equal(await encolarAviso('pago_rechazado', d.propietario1.id, { entidad: 'cargo', id: d.cargoVencidoA1.id }), 1);
    assert.equal(await encolarAviso('pago_validado', d.propietario1.id, { entidad: 'cargo', id: d.cargoVencidoA1.id }), 0, 'idempotente');
    const [v, r] = await notifs();
    assert.match(v!.cuerpo, /Validamos tu pago de S\/ 150\.00 por Mantenimiento/);
    assert.match(r!.cuerpo, /No pudimos validar tu pago de S\/ 150\.00/);
    assert.equal(await encolarAviso('pago_validado', 999_999, { entidad: 'cargo', id: d.cargoVencidoA1.id }), 0, 'usuario inexistente');
    assert.equal(await encolarAviso('pago_validado', d.propietario1.id, { entidad: 'cargo', id: 999_999 }), 0, 'cargo inexistente');
  });
});

describe('envío por canal', () => {
  const AHORA = new Date('2026-10-23T15:00:00Z');
  const sembrarUna = async (canal: 'email' | 'whatsapp', usuario_id = d.propietario1.id) =>
    prisma.notificacion.create({ data: { usuario_id, canal, tipo: 'recibo_emitido', asunto: 'Asunto de prueba', cuerpo: 'Cuerpo de prueba', ref_entidad: 'recibo', ref_id: 1, programada_para: new Date(AHORA.getTime() - MIN) } });

  it('sin variables del canal: omitida «Canal no configurado», sin llamar a la red ni dar error', async () => {
    await sembrarUna('email');
    await sembrarUna('whatsapp', d.propietario2.id);
    await prisma.usuario.update({ where: { id: d.propietario2.id }, data: { telefono: '987654321' } });
    const { deps, llamadas } = crearDeps(AHORA, {});
    const r = await procesarCola(deps);
    assert.equal(llamadas.length, 0);
    assert.deepEqual(r, { enviadas: 0, omitidas: 2, fallos: 0, errores: 0 });
    for (const n of await notifs()) {
      assert.equal(n.estado, 'omitida');
      assert.equal(n.error, 'Canal no configurado');
    }
  });

  it('correo por Resend y WhatsApp por Evolution con el contrato esperado', async () => {
    await prisma.usuario.update({ where: { id: d.propietario1.id }, data: { telefono: '+51 987 654 321' } });
    await sembrarUna('email');
    await sembrarUna('whatsapp');
    const { deps, llamadas } = crearDeps(AHORA, ENV_OK);
    const r = await procesarCola(deps);
    assert.deepEqual(r, { enviadas: 2, omitidas: 0, fallos: 0, errores: 0 });
    const correo = llamadas.find((l) => l.url.includes('resend'))!;
    assert.equal(correo.url, 'https://api.resend.com/emails');
    assert.equal(correo.init.method, 'POST');
    assert.equal((correo.init.headers as Record<string, string>).Authorization, `Bearer ${CLAVE_RESEND}`);
    assert.deepEqual(JSON.parse(String(correo.init.body)), { from: 'Casa <avisos@ejemplo.test>', to: ['prop1@test.pe'], subject: 'Asunto de prueba', text: 'Cuerpo de prueba' });
    const wa = llamadas.find((l) => l.url.includes('evo'))!;
    assert.equal(wa.url, 'https://evo.ejemplo.test/message/sendText/instancia-falsa', 'sin doble barra');
    assert.equal((wa.init.headers as Record<string, string>).apikey, CLAVE_EVO);
    assert.deepEqual(JSON.parse(String(wa.init.body)), { number: '51987654321', text: 'Cuerpo de prueba' });
    for (const n of await notifs()) {
      assert.equal(n.estado, 'enviada');
      assert.equal(n.intentos, 1);
      assert.equal(n.enviada_at!.getTime(), AHORA.getTime());
    }
    assert.equal((await procesarCola(deps)).enviadas, 0, 'lo enviado no se reenvía');
  });

  it('celular inválido: omitida, sin llamar a Evolution', async () => {
    await prisma.usuario.update({ where: { id: d.propietario1.id }, data: { telefono: '12345' } });
    await sembrarUna('whatsapp');
    const { deps, llamadas } = crearDeps(AHORA, ENV_OK);
    await procesarCola(deps);
    assert.equal(llamadas.length, 0);
    const [n] = await notifs();
    assert.equal(n!.estado, 'omitida');
    assert.equal(n!.error, 'Celular inválido');
  });

  it('no envía lo programado para después', async () => {
    await prisma.notificacion.create({ data: { usuario_id: d.propietario1.id, canal: 'email', tipo: 'vencido', asunto: 'a', cuerpo: 'b', ref_entidad: 'recibo', ref_id: 2, programada_para: new Date(AHORA.getTime() + 5 * MIN) } });
    const { deps, llamadas } = crearDeps(AHORA, ENV_OK);
    assert.equal((await procesarCola(deps)).enviadas, 0);
    assert.equal(llamadas.length, 0);
  });

  it('reintenta con espera creciente y al tercer fallo queda en error, sin filtrar claves ni la respuesta del proveedor', async () => {
    const n0 = await sembrarUna('email');
    const { deps, llamadas } = crearDeps(AHORA, ENV_OK, () => new Response(`{"detalle":"RESPUESTA-DEL-PROVEEDOR ${CLAVE_RESEND}"}`, { status: 500 }));
    assert.equal((await procesarCola(deps)).fallos, 1);
    let n = (await prisma.notificacion.findUnique({ where: { id: n0.id } }))!;
    assert.equal(n.estado, 'pendiente');
    assert.equal(n.intentos, 1);
    assert.equal(n.programada_para.getTime(), AHORA.getTime() + 2 * MIN);
    assert.equal(n.error, 'Resend respondió 500');

    const antes = crearDeps(new Date(AHORA.getTime() + MIN), ENV_OK);
    await procesarCola(antes.deps);
    assert.equal(antes.llamadas.length, 0, 'todavía en espera');

    const t2 = new Date(AHORA.getTime() + 2 * MIN);
    assert.equal((await procesarCola({ ...deps, ahora: () => t2 })).fallos, 1);
    n = (await prisma.notificacion.findUnique({ where: { id: n0.id } }))!;
    assert.equal(n.intentos, 2);
    assert.equal(n.programada_para.getTime(), t2.getTime() + 10 * MIN);

    const t3 = new Date(t2.getTime() + 10 * MIN);
    assert.equal((await procesarCola({ ...deps, ahora: () => t3 })).errores, 1);
    n = (await prisma.notificacion.findUnique({ where: { id: n0.id } }))!;
    assert.equal(n.estado, 'error');
    assert.equal(n.intentos, MAX_INTENTOS);
    assert.equal(llamadas.length, 3);
    const volcado = JSON.stringify(n);
    assert.ok(!volcado.includes(CLAVE_RESEND) && !volcado.includes('RESPUESTA-DEL-PROVEEDOR'), 'la fila no filtra secretos');
    const t4 = new Date(t3.getTime() + DIA);
    assert.equal((await procesarCola({ ...deps, ahora: () => t4 })).errores, 0, 'en error ya no se reintenta solo');
    assert.equal(llamadas.length, 3);
  });

  it('un error de red con la clave en el mensaje tampoco se guarda', async () => {
    await sembrarUna('email');
    const { deps } = crearDeps(AHORA, ENV_OK, () => { throw new Error(`fallo conectando con Authorization: Bearer ${CLAVE_RESEND}`); });
    await procesarCola(deps);
    const [n] = await notifs();
    assert.equal(n!.error, 'Sin conexión con Resend');
    assert.ok(!JSON.stringify(n).includes(CLAVE_RESEND));
  });

  it('dos procesos no mandan el mismo aviso', async () => {
    await sembrarUna('email');
    const { deps, llamadas } = crearDeps(AHORA, ENV_OK, async () => { await new Promise((r) => setTimeout(r, 50)); return new Response('{}'); });
    const [a, b] = await Promise.all([procesarCola(deps), procesarCola(deps)]);
    assert.equal(a.enviadas + b.enviadas, 1);
    assert.equal(llamadas.length, 1);
  });
});

describe('planificador', () => {
  it('sólo trabaja una réplica a la vez (bloqueo asesor) y se activa por variable', async () => {
    const { deps } = crearDeps(new Date(), {});
    let liberar!: () => void;
    const suelto = new Promise<void>((r) => { liberar = r; });
    let tomado!: () => void;
    const listo = new Promise<void>((r) => { tomado = r; });
    const otra = prisma.$transaction(async (tx) => {
      const [{ ok }] = await tx.$queryRawUnsafe<{ ok: boolean }[]>(`SELECT pg_try_advisory_xact_lock(${LOCK_AVISOS}) AS ok`);
      assert.ok(ok);
      tomado();
      await suelto;
    });
    await listo;
    assert.equal(await ciclo(deps), null, 'otra réplica tiene el turno');
    liberar();
    await otra;
    const r = await ciclo(deps);
    assert.ok(r && typeof r.encoladas === 'number');

    assert.equal(planificadorActivo({ NODE_ENV: 'test' }), false);
    assert.equal(planificadorActivo({ NODE_ENV: 'production' }), true);
    assert.equal(planificadorActivo({ NODE_ENV: 'production', AVISOS_PLANIFICADOR: 'off' }), false);
    assert.equal(planificadorActivo({ NODE_ENV: 'test', AVISOS_PLANIFICADOR: 'on' }), true);
  });
});

describe('API de notificaciones', () => {
  const crear = (usuario_id: number, extra: Record<string, unknown> = {}) =>
    prisma.notificacion.create({ data: { usuario_id, canal: 'email', tipo: 'vencido', asunto: 'Asunto', cuerpo: 'CUERPO-PRIVADO', ref_entidad: 'recibo', ref_id: 1, ...extra } });

  it('acceso por rol: sólo admin y superadmin', async () => {
    for (const t of [T.prop1, T.inq1]) {
      assert.equal((await llamar(base, 'GET', '/api/notificaciones', t)).status, 403);
      assert.equal((await llamar(base, 'GET', '/api/notificaciones/canales', t)).status, 403);
      assert.equal((await llamar(base, 'GET', '/api/notificaciones/resumen', t)).status, 403);
      assert.equal((await llamar(base, 'POST', '/api/notificaciones/1/reenviar', t)).status, 403);
    }
    assert.equal((await llamar(base, 'GET', '/api/notificaciones')).status, 401);
    assert.equal((await llamar(base, 'GET', '/api/notificaciones', T.adminA)).status, 200);
    assert.equal((await llamar(base, 'GET', '/api/notificaciones', T.super)).status, 200);
  });

  it('cada admin ve sólo los avisos de su empresa; el superadmin, todos; otro tenant da 404', async () => {
    const a = await crear(d.propietario1.id, { estado: 'error', error: 'Resend respondió 500' });
    const b = await crear(d.propietarioB.id, { estado: 'error', error: 'Resend respondió 500' });
    const ra = await llamar(base, 'GET', '/api/notificaciones', T.adminA);
    assert.deepEqual(ra.body.items.map((n: { id: number }) => n.id), [a.id]);
    assert.equal(ra.body.total, 1);
    const rb = await llamar(base, 'GET', '/api/notificaciones', T.adminB);
    assert.deepEqual(rb.body.items.map((n: { id: number }) => n.id), [b.id]);
    const rs = await llamar(base, 'GET', '/api/notificaciones', T.super);
    assert.equal(rs.body.total, 2);
    assert.equal((await llamar(base, 'GET', `/api/notificaciones/${b.id}`, T.adminA)).status, 404);
    assert.equal((await llamar(base, 'POST', `/api/notificaciones/${b.id}/reenviar`, T.adminA)).status, 404);
    assert.equal((await prisma.notificacion.findUnique({ where: { id: b.id } }))!.estado, 'error', 'no se tocó');
    assert.ok(!ra.texto.includes('CUERPO-PRIVADO'), 'el listado no lleva el cuerpo');
    assert.deepEqual(ra.body.items[0].usuario, { id: d.propietario1.id, nombre: 'Propietario 1' });
    assert.ok(!/@test\.pe|password/.test(ra.texto));
  });

  it('filtros por estado, canal, tipo y búsqueda; resumen por estado', async () => {
    await crear(d.propietario1.id, { estado: 'enviada', tipo: 'recibo_emitido' });
    await crear(d.propietario1.id, { estado: 'error', canal: 'whatsapp', ref_id: 2 });
    await crear(d.propietario2.id, { estado: 'omitida', tipo: 'por_vencer', ref_id: 3 });
    await crear(d.propietario2.id, { estado: 'pendiente', ref_id: 4 });
    const lista = async (qs: string) => (await llamar(base, 'GET', `/api/notificaciones?${qs}`, T.adminA)).body;
    assert.equal((await lista('estado=error')).total, 1);
    assert.equal((await lista('canal=whatsapp')).total, 1);
    assert.equal((await lista('tipo=por_vencer')).total, 1);
    assert.equal((await lista('q=Propietario 2')).total, 2);
    assert.equal((await lista('')).total, 4);
    assert.equal((await llamar(base, 'GET', '/api/notificaciones?estado=raro', T.adminA)).status, 422);
    const res = await llamar(base, 'GET', '/api/notificaciones/resumen', T.adminA);
    assert.deepEqual(res.body, { pendiente: 1, enviada: 1, error: 1, omitida: 1 });
  });

  it('reenviar: sólo error u omitida; vuelve a pendiente, se audita y no toca lo enviado', async () => {
    const e = await crear(d.propietario1.id, { estado: 'error', intentos: 3, error: 'Resend respondió 500' });
    const o = await crear(d.propietario1.id, { estado: 'omitida', error: 'Canal no configurado', ref_id: 2 });
    const ok = await crear(d.propietario1.id, { estado: 'enviada', ref_id: 3 });
    const p = await crear(d.propietario1.id, { estado: 'pendiente', ref_id: 4 });
    const r = await llamar(base, 'POST', `/api/notificaciones/${e.id}/reenviar`, T.adminA);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.estado, 'pendiente');
    assert.equal(r.body.intentos, 0);
    assert.equal(r.body.error, null);
    assert.ok(!r.texto.includes('CUERPO-PRIVADO'));
    assert.equal((await llamar(base, 'POST', `/api/notificaciones/${o.id}/reenviar`, T.super)).status, 200);
    for (const id of [ok.id, p.id]) assert.equal((await llamar(base, 'POST', `/api/notificaciones/${id}/reenviar`, T.adminA)).status, 409);
    assert.equal((await prisma.notificacion.findUnique({ where: { id: ok.id } }))!.estado, 'enviada');
    const aud = await esperar(() => prisma.auditoria.findFirst({ where: { entidad: 'notificacion', accion: 'reenviar', entidad_id: e.id } }));
    assert.deepEqual(aud.detalle, { canal: 'email', tipo: 'vencido', estado_anterior: 'error' });
    assert.equal((await llamar(base, 'POST', '/api/notificaciones/abc/reenviar', T.adminA)).status, 422);
    // y la cola lo vuelve a enviar
    const { deps, llamadas } = crearDeps(new Date(Date.now() + MIN), ENV_OK);
    await procesarCola(deps);
    assert.equal(llamadas.length, 3, 'las dos reenviadas y la que ya estaba pendiente');
    assert.equal((await prisma.notificacion.findUnique({ where: { id: e.id } }))!.estado, 'enviada');
  });

  it('canales: sólo si están configurados y qué variable falta; nunca valores', async () => {
    for (const k of Object.keys(ENV_OK)) restaurar.set(k, process.env[k]);
    for (const k of Object.keys(ENV_OK)) delete process.env[k];
    let r = await llamar(base, 'GET', '/api/notificaciones/canales', T.adminA);
    assert.deepEqual(r.body, {
      email: { configurado: false, faltan: ['RESEND_API_KEY', 'MAIL_FROM'] },
      whatsapp: { configurado: false, faltan: ['EVOLUTION_URL', 'EVOLUTION_INSTANCE', 'EVOLUTION_APIKEY'] },
    });
    fijarEnv(ENV_OK);
    r = await llamar(base, 'GET', '/api/notificaciones/canales', T.super);
    assert.deepEqual(r.body, { email: { configurado: true, faltan: [] }, whatsapp: { configurado: true, faltan: [] } });
    for (const secreto of [CLAVE_RESEND, CLAVE_EVO, 'ejemplo.test', 'instancia-falsa']) assert.ok(!r.texto.includes(secreto), `filtra ${secreto}`);
    delete process.env.EVOLUTION_APIKEY;
    assert.deepEqual(estadoCanales().whatsapp, { configurado: false, faltan: ['EVOLUTION_APIKEY'] });
    process.env.EVOLUTION_URL = '   ';
    assert.deepEqual(estadoCanales().whatsapp.faltan, ['EVOLUTION_URL', 'EVOLUTION_APIKEY'], 'en blanco cuenta como falta');
  });
});

describe('preferencias propias: PUT /api/me/avisos', () => {
  it('cualquier rol guarda sus preferencias y las ve en /api/auth/me y /api/me/avisos', async () => {
    const r = await llamar(base, 'PUT', '/api/me/avisos', T.prop1, { aviso_email: false, aviso_whatsapp: true, telefono: '987 654 321' });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.body, { aviso_email: false, aviso_whatsapp: true, telefono: '+51 987 654 321' });
    const me = await llamar(base, 'GET', '/api/auth/me', T.prop1);
    assert.equal(me.body.aviso_email, false);
    assert.equal(me.body.aviso_whatsapp, true);
    assert.equal(me.body.email, 'prop1@test.pe', 'el contrato actual sigue igual');
    assert.deepEqual((await llamar(base, 'GET', '/api/me/avisos', T.prop1)).body, r.body);
    // sin tocar el celular: se conserva
    const r2 = await llamar(base, 'PUT', '/api/me/avisos', T.prop1, { aviso_email: true, aviso_whatsapp: true });
    assert.equal(r2.body.telefono, '+51 987 654 321');
    const aud = await esperar(() => prisma.auditoria.findFirst({ where: { entidad: 'usuario', entidad_id: d.propietario1.id, detalle: { path: ['campo'], equals: 'avisos' } } }));
    assert.ok(aud);
  });

  it('valida: celular peruano, WhatsApp exige celular, booleanos obligatorios; sólo cambia al propio usuario', async () => {
    const mal = await llamar(base, 'PUT', '/api/me/avisos', T.inq1, { aviso_email: true, aviso_whatsapp: false, telefono: '12345' });
    assert.equal(mal.status, 422);
    assert.ok(mal.body.campos.telefono);
    const sin = await llamar(base, 'PUT', '/api/me/avisos', T.inq1, { aviso_email: true, aviso_whatsapp: true });
    assert.equal(sin.status, 422, 'WhatsApp sin celular');
    assert.equal((await llamar(base, 'PUT', '/api/me/avisos', T.inq1, { aviso_email: 'si', aviso_whatsapp: false })).status, 422);
    assert.equal((await llamar(base, 'PUT', '/api/me/avisos', T.inq1, { aviso_email: true, aviso_whatsapp: false, telefono: '' })).body.telefono, null);
    assert.equal((await llamar(base, 'PUT', '/api/me/avisos', null, { aviso_email: true, aviso_whatsapp: false })).status, 401);
    await llamar(base, 'PUT', '/api/me/avisos', T.inq1, { aviso_email: false, aviso_whatsapp: false, id: d.propietario1.id });
    assert.equal((await prisma.usuario.findUnique({ where: { id: d.propietario1.id } }))!.aviso_email, true, 'no toca a otros');
  });
});
