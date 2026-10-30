// Registro público: una transacción, verificación obligatoria del correo, sin enumerar correos, antiabuso y el endpoint público de planes.
import './helpers/env';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, prisma, sembrar } from './helpers/app';
import type { DepsAvisos } from '../src/server/services/avisos/canales';
import { comercialCorreo } from '../src/server/services/comercial/configuracion';
import { comercialDeps } from '../src/server/services/comercial/modulos';

interface Correo { para: string; asunto: string; cuerpo: string }
let enviados: Correo[] = [];
const depsFalsas = (): DepsAvisos => ({
  ahora: () => comercialDeps.ahora(),
  env: { RESEND_API_KEY: 're_falsa', MAIL_FROM: 'House <house@ejemplo.test>' },
  fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body));
    enviados.push({ para: b.to[0], asunto: b.subject, cuerpo: b.text });
    return new Response('{}', { status: 200 });
  }) as typeof fetch,
});
const depsOriginal = comercialCorreo.deps;

const tokenDe = (c: Correo) => /token=([\w-]+)/.exec(c.cuerpo)?.[1] ?? '';
const registro = (over: Record<string, unknown> = {}) => ({
  nombre: 'Rosa Quispe', email: 'rosa@casa.pe', celular: '987 654 321', password: 'Cl4ve-segura-2026', empresa: 'Junta Los Pinos', condominio: 'Condominio Los Pinos', unidades: 48, acepta_terminos: true, ...over,
});

let base: string;
let cerrar: () => Promise<void>;

async function levantar(rateLimits = {}) {
  ({ base, cerrar } = await iniciar({ rateLimits }));
}

describe('registro público', () => {
  beforeEach(async () => {
    await sembrar();
    enviados = [];
    comercialCorreo.deps = depsFalsas;
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { correo_superadmin: 'miguel@house.test', url_publica: 'https://house.ejemplo.test' } });
    await levantar({ registroIp: 100, registroCorreo: 100 });
  });
  afterEach(async () => { comercialCorreo.deps = depsOriginal; await cerrar(); });

  it('crea en UNA transacción empresa + admin + condominio en Gratis (con su contrato) y manda el enlace', async () => {
    const r = await llamar(base, 'POST', '/api/publico/registro', null, registro());
    assert.equal(r.status, 202, r.texto);
    const u = await prisma.usuario.findUniqueOrThrow({ where: { email: 'rosa@casa.pe' } });
    assert.equal(u.rol, 'admin');
    assert.equal(u.correo_verificado, false);
    assert.ok(u.empresa_id);
    const empresa = await prisma.empresaAdministradora.findUniqueOrThrow({ where: { id: u.empresa_id! } });
    assert.equal(empresa.nombre, 'Junta Los Pinos');
    const complejo = await prisma.complejoHabitacional.findFirstOrThrow({ where: { empresa_id: empresa.id } });
    assert.equal(complejo.nombre, 'Condominio Los Pinos');
    const sus = await prisma.suscripcionCondominio.findUniqueOrThrow({ where: { complejo_id: complejo.id } });
    assert.equal(sus.plan_clave, 'gratis');
    assert.match(sus.notas ?? '', /48 departamentos/);
    assert.equal(await prisma.contratoAdministracion.count({ where: { complejo_id: complejo.id, empresa_id: empresa.id, fecha_fin: null } }), 1);
    const aCliente = enviados.find((c) => c.para === 'rosa@casa.pe')!;
    assert.match(aCliente.cuerpo, /^.*\n[\s\S]*https:\/\/house\.ejemplo\.test\/verificar-correo\?token=/);
    const aSuper = enviados.find((c) => c.para === 'miguel@house.test')!;
    assert.match(aSuper.cuerpo, /Rosa Quispe/);
    assert.match(aSuper.cuerpo, /Los Pinos/);
    assert.doesNotMatch(aSuper.cuerpo, /Cl4ve-segura/);
    assert.equal((await prisma.auditoria.findFirst({ where: { accion: 'registro_publico' } }))?.entidad_id, u.id);
  });

  it('el token se guarda sólo como hash (nunca el token) y vence en 24 h', async () => {
    await llamar(base, 'POST', '/api/publico/registro', null, registro());
    const token = tokenDe(enviados.find((c) => c.para === 'rosa@casa.pe')!);
    const fila = await prisma.tokenVerificacionCorreo.findFirstOrThrow();
    assert.notEqual(fila.token_hash, token);
    assert.equal(fila.token_hash, createHash('sha256').update(token).digest('hex'));
    const horas = (fila.expira_at.getTime() - fila.created_at.getTime()) / 3_600_000;
    assert.ok(Math.abs(horas - 24) < 0.1, `vence en ${horas} h`);
  });

  it('un correo ya registrado da EXACTAMENTE la misma respuesta y no crea nada más', async () => {
    const primera = await llamar(base, 'POST', '/api/publico/registro', null, registro());
    await prisma.usuario.update({ where: { email: 'rosa@casa.pe' }, data: { correo_verificado: true } });
    const antes = { u: await prisma.usuario.count(), e: await prisma.empresaAdministradora.count(), c: await prisma.complejoHabitacional.count() };
    const repetida = await llamar(base, 'POST', '/api/publico/registro', null, registro({ nombre: 'Otra Persona', empresa: 'Otra empresa' }));
    assert.equal(repetida.status, primera.status);
    assert.deepEqual(repetida.body, primera.body);
    assert.deepEqual({ u: await prisma.usuario.count(), e: await prisma.empresaAdministradora.count(), c: await prisma.complejoHabitacional.count() }, antes);
    assert.ok(enviados.some((c) => c.para === 'rosa@casa.pe' && /ya tiene una cuenta/.test(c.cuerpo)), 'a la dueña del correo se le avisa');
    // Con un correo de una cuenta que ya existía de antes (no del registro) también.
    const existente = await llamar(base, 'POST', '/api/publico/registro', null, registro({ email: 'admin.a@test.pe' }));
    assert.deepEqual(existente.body, primera.body);
    assert.equal(existente.status, 202);
  });

  it('dos registros simultáneos con el mismo correo: uno solo crea y no quedan empresas ni condominios huérfanos (rollback)', async () => {
    const [a, b] = await Promise.all([
      llamar(base, 'POST', '/api/publico/registro', null, registro({ email: 'carrera@casa.pe' })),
      llamar(base, 'POST', '/api/publico/registro', null, registro({ email: 'carrera@casa.pe', empresa: 'Otra empresa', condominio: 'Otro condominio' })),
    ]);
    assert.equal(a.status, 202);
    assert.equal(b.status, 202);
    assert.deepEqual(a.body, b.body);
    assert.equal(await prisma.usuario.count({ where: { email: 'carrera@casa.pe' } }), 1);
    // sembrar() crea 2 empresas y 2 condominios; el registro suma exactamente 1 de cada uno.
    assert.equal(await prisma.empresaAdministradora.count(), 3);
    assert.equal(await prisma.complejoHabitacional.count(), 3);
    assert.equal(await prisma.suscripcionCondominio.count({ where: { plan_clave: 'gratis' } }), 1);
  });

  it('sin verificar el correo NO entra (aunque la contraseña sea correcta); con contraseña mala sigue siendo el 401 de siempre', async () => {
    await llamar(base, 'POST', '/api/publico/registro', null, registro());
    const mala = await llamar(base, 'POST', '/api/auth/login', null, { email: 'rosa@casa.pe', password: 'otra-cosa-1234' });
    assert.equal(mala.status, 401);
    const buena = await llamar(base, 'POST', '/api/auth/login', null, { email: 'rosa@casa.pe', password: 'Cl4ve-segura-2026' });
    assert.equal(buena.status, 403);
    assert.equal(buena.body.code, 'CORREO_NO_VERIFICADO');
    assert.equal(buena.headers.get('set-cookie'), null, 'no hay sesión');
    assert.equal(await prisma.sesion.count(), 0);
  });

  it('con el enlace verifica y entra; el mismo enlace una segunda vez ya no sirve', async () => {
    await llamar(base, 'POST', '/api/publico/registro', null, registro());
    const token = tokenDe(enviados.find((c) => c.para === 'rosa@casa.pe')!);
    const v = await llamar(base, 'POST', '/api/publico/verificar-correo', null, { token });
    assert.equal(v.status, 200, v.texto);
    const l = await llamar(base, 'POST', '/api/auth/login', null, { email: 'rosa@casa.pe', password: 'Cl4ve-segura-2026' });
    assert.equal(l.status, 200);
    assert.equal(l.body.user.rol, 'admin');
    const otra = await llamar(base, 'POST', '/api/publico/verificar-correo', null, { token });
    assert.equal(otra.status, 400);
    assert.equal(otra.body.code, 'ENLACE_INVALIDO');
  });

  it('un enlace vencido (más de 24 h) o inventado da 400 y no verifica', async () => {
    await llamar(base, 'POST', '/api/publico/registro', null, registro());
    const token = tokenDe(enviados.find((c) => c.para === 'rosa@casa.pe')!);
    await prisma.tokenVerificacionCorreo.updateMany({ data: { expira_at: new Date(Date.now() - 1000) } });
    const vencido = await llamar(base, 'POST', '/api/publico/verificar-correo', null, { token });
    assert.equal(vencido.status, 400);
    const falso = await llamar(base, 'POST', '/api/publico/verificar-correo', null, { token: 'a'.repeat(43) });
    assert.equal(falso.status, 400);
    assert.deepEqual(vencido.body, falso.body, 'mismo mensaje: no se distingue vencido de inexistente');
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { email: 'rosa@casa.pe' } })).correo_verificado, false);
    assert.equal((await llamar(base, 'POST', '/api/auth/login', null, { email: 'rosa@casa.pe', password: 'Cl4ve-segura-2026' })).status, 403);
  });

  it('dos clics simultáneos con el mismo enlace: sólo uno lo usa', async () => {
    await llamar(base, 'POST', '/api/publico/registro', null, registro());
    const token = tokenDe(enviados.find((c) => c.para === 'rosa@casa.pe')!);
    const rs = await Promise.all([1, 2, 3].map(() => llamar(base, 'POST', '/api/publico/verificar-correo', null, { token })));
    assert.equal(rs.filter((r) => r.status === 200).length, 1);
  });

  it('reenviar: responde igual exista o no la cuenta; sólo manda enlace a una cuenta sin verificar (y con 60 s entre envíos)', async () => {
    await llamar(base, 'POST', '/api/publico/registro', null, registro());
    enviados = [];
    const existe = await llamar(base, 'POST', '/api/publico/reenviar-verificacion', null, { email: 'rosa@casa.pe' });
    assert.equal(enviados.length, 0, 'el primero fue hace menos de 60 s');
    await prisma.tokenVerificacionCorreo.updateMany({ data: { created_at: new Date(Date.now() - 120_000) } });
    await llamar(base, 'POST', '/api/publico/reenviar-verificacion', null, { email: 'rosa@casa.pe' });
    assert.equal(enviados.length, 1);
    const noExiste = await llamar(base, 'POST', '/api/publico/reenviar-verificacion', null, { email: 'nadie@casa.pe' });
    assert.equal(noExiste.status, existe.status);
    assert.deepEqual(noExiste.body, existe.body);
    assert.equal(enviados.length, 1, 'a quien no existe no se le escribe');
  });

  it('validación: contraseña débil, igual al correo, campos vacíos o larguísimos → 422 y no se crea nada', async () => {
    const casos: Record<string, unknown>[] = [
      { password: 'corta1' }, { password: 'solo-letras-largas' }, { password: '12345678' }, { password: 'password123' },
      { password: 'rosa@casa.pe' }, { email: 'no-es-correo' }, { nombre: '' }, { nombre: 'x'.repeat(121) }, { empresa: 'e'.repeat(161) },
      { condominio: '' }, { celular: 'abc' }, { unidades: 0 }, { unidades: 99999 }, { unidades: 'muchos' },
    ];
    for (const c of casos) {
      const r = await llamar(base, 'POST', '/api/publico/registro', null, registro(c));
      assert.equal(r.status, 422, `${JSON.stringify(c)} → ${r.status}`);
    }
    assert.equal(await prisma.usuario.count({ where: { email: 'rosa@casa.pe' } }), 0);
  });

  it('el señuelo (campo oculto) lleno = robot: misma respuesta y no se crea nada', async () => {
    const r = await llamar(base, 'POST', '/api/publico/registro', null, registro({ sitio_web: 'http://spam.example' }));
    assert.equal(r.status, 202);
    assert.equal(await prisma.usuario.count({ where: { email: 'rosa@casa.pe' } }), 0);
  });

  it('con el registro cerrado desde la configuración responde 503 y no crea nada', async () => {
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { registro_abierto: false } });
    const r = await llamar(base, 'POST', '/api/publico/registro', null, registro());
    assert.equal(r.status, 503);
    assert.equal(await prisma.usuario.count({ where: { email: 'rosa@casa.pe' } }), 0);
  });

  it('el enlace sale de la configuración (BD), nunca de la cabecera Host', async () => {
    await llamar(base, 'POST', '/api/publico/registro', null, registro(), { host: 'atacante.example', 'x-forwarded-host': 'atacante.example' });
    const c = enviados.find((x) => x.para === 'rosa@casa.pe')!;
    assert.match(c.cuerpo, /https:\/\/house\.ejemplo\.test\/verificar-correo/);
    assert.doesNotMatch(c.cuerpo, /atacante/);
  });

  it('un correo que falla al enviarse no tumba el registro (la cuenta queda y se puede reenviar)', async () => {
    comercialCorreo.deps = () => ({ ...depsFalsas(), fetch: (async () => new Response('{}', { status: 500 })) as typeof fetch });
    const r = await llamar(base, 'POST', '/api/publico/registro', null, registro());
    assert.equal(r.status, 202);
    assert.equal(await prisma.usuario.count({ where: { email: 'rosa@casa.pe' } }), 1);
  });
});

describe('antiabuso: límites del registro', () => {
  afterEach(async () => { comercialCorreo.deps = depsOriginal; await cerrar(); });

  it('por IP: pasado el tope, 429 aunque cambie el correo', async () => {
    await sembrar();
    comercialCorreo.deps = depsFalsas;
    await levantar({ registroIp: 2, registroCorreo: 100 });
    assert.equal((await llamar(base, 'POST', '/api/publico/registro', null, registro({ email: 'a1@casa.pe' }))).status, 202);
    assert.equal((await llamar(base, 'POST', '/api/publico/registro', null, registro({ email: 'a2@casa.pe' }))).status, 202);
    const r = await llamar(base, 'POST', '/api/publico/registro', null, registro({ email: 'a3@casa.pe' }));
    assert.equal(r.status, 429);
    assert.equal(await prisma.usuario.count({ where: { email: 'a3@casa.pe' } }), 0);
  });

  it('por correo: el mismo correo (exista o no) se frena igual, sin delatar si existía', async () => {
    await sembrar();
    comercialCorreo.deps = depsFalsas;
    await levantar({ registroIp: 100, registroCorreo: 2 });
    for (const email of ['admin.a@test.pe', 'nuevo@casa.pe']) {
      for (let i = 0; i < 2; i++) assert.equal((await llamar(base, 'POST', '/api/publico/registro', null, registro({ email }))).status, 202);
      const r = await llamar(base, 'POST', '/api/publico/registro', null, registro({ email }));
      assert.equal(r.status, 429, email);
    }
  });

  it('la verificación también se frena por IP', async () => {
    await sembrar();
    await levantar({ verificacion: 3 });
    for (let i = 0; i < 3; i++) assert.equal((await llamar(base, 'POST', '/api/publico/verificar-correo', null, { token: 'b'.repeat(43) })).status, 400);
    assert.equal((await llamar(base, 'POST', '/api/publico/verificar-correo', null, { token: 'b'.repeat(43) })).status, 429);
  });
});

describe('endpoint público de planes', () => {
  before(async () => {
    await sembrar();
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { pago_titular: 'Miguel G.', pago_cuenta: '191-1234567-0-12', pago_cci: '00219100123456701234', pago_yape: '999888777', correo_superadmin: 'secreto@house.test' } });
    await levantar();
  });
  after(async () => { await cerrar(); });

  it('sin sesión devuelve planes con el precio SIN IGV y los topes de unidades, y módulos SIN precio (ya no se venden sueltos); sin datos de pago ni correos', async () => {
    const r = await llamar(base, 'GET', '/api/publico/planes');
    assert.equal(r.status, 200);
    assert.equal(r.body.igv_incluido, false);
    assert.deepEqual(r.body.modulos.map((m: { clave: string }) => m.clave), ['ia_vouchers', 'whatsapp_avisos', 'asistente']);
    for (const m of r.body.modulos) assert.ok(!('precio_por_unidad' in m), 'un módulo ya no tiene precio público');
    const topes = Object.fromEntries(r.body.planes.map((p: { clave: string; unidades_maximas: number | null; unidades_minimas: number | null }) => [p.clave, [p.unidades_maximas, p.unidades_minimas]]));
    assert.deepEqual(topes, { gratis: [20, null], pro: [null, 20], administradora: [null, 20] }, 'Gratis hasta 20; Pro y Administradora cobran mínimo 20');
    const pro = r.body.planes.find((p: { clave: string }) => p.clave === 'pro');
    assert.deepEqual([...pro.modulos_incluidos].sort(), ['asistente', 'ia_vouchers', 'mora_automatica', 'reportes', 'whatsapp_avisos']);
    assert.deepEqual(r.body.planes.find((p: { clave: string }) => p.clave === 'gratis').modulos_incluidos, []);
    const planes = Object.fromEntries(r.body.planes.map((p: { clave: string; precio_por_unidad: string }) => [p.clave, p.precio_por_unidad]));
    assert.deepEqual(planes, { gratis: '0.00', pro: '2.50', administradora: '2.00' }, 'cortesía no es visible');
    for (const prohibido of ['999888777', '191-1234567', '00219100123456701234', 'secreto@house.test', 'Miguel G.', 'igv_tasa', 'pago_', 'correo_superadmin', 'precio_base']) {
      assert.ok(!r.texto.includes(prohibido), `no debe exponer ${prohibido}`);
    }
  });

  it('un precio editado por el superadmin se refleja (sin precios fijos en el código)', async () => {
    await prisma.planComercial.update({ where: { clave: 'pro' }, data: { precio_por_unidad: '3.00' } });
    const r = await llamar(base, 'GET', '/api/publico/planes');
    assert.equal(r.body.planes.find((p: { clave: string }) => p.clave === 'pro').precio_por_unidad, '3.00');
    await prisma.planComercial.update({ where: { clave: 'pro' }, data: { precio_por_unidad: '2.50' } });
  });

  it('cotizar: 448 deptos en Pro = 1.120,00 + IGV al mes (1.321,60 con IGV) y 13.440,00 + IGV al año; sin módulos sueltos; plan inexistente 422', async () => {
    const pro = await llamar(base, 'GET', '/api/publico/cotizar?unidades=448&plan=pro');
    assert.deepEqual(pro.body, { pais: 'PE', moneda: 'PEN', impuesto_nombre: 'IGV', consultar: false, unidades: 448, unidades_cobradas: 448, minimo_aplicado: false, total_mes: '1120.00', total_anio: '13440.00', igv_mes: '201.60', total_con_igv_mes: '1321.60', igv_incluido: false });
    const mod = await llamar(base, 'GET', '/api/publico/cotizar?unidades=100&modulos=ia_vouchers,asistente');
    assert.equal(mod.body.total_mes, '0.00', 'los módulos sueltos ya no se cotizan: sin plan, nada que cobrar');
    assert.equal((await llamar(base, 'GET', '/api/publico/cotizar?unidades=10&plan=cortesia')).status, 422, 'cortesía no se cotiza al público');
    assert.equal((await llamar(base, 'GET', '/api/publico/cotizar?unidades=abc')).status, 422);
  });
});

after(async () => { await prisma.$disconnect(); });
