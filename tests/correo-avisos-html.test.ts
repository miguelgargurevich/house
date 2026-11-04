// Correos de aviso con diseño (HTML) y remitente en la base: el HTML de cada tipo trae los datos correctos y escapa lo que viene de la base; el texto plano
// de respaldo dice lo mismo; el `from` sale de `ConfiguracionComercial.correo_remitente` (con el condominio en el nombre) y cae a MAIL_FROM.
// Todo con `fetch` falso: nunca sale un correo real.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { encolarAviso, procesarCola, type DepsAvisos } from '../src/server/services/avisos';
import { enviarCorreo, estadoCanales } from '../src/server/services/avisos/canales';
import { correoDeAviso } from '../src/server/services/avisos/correoAviso';
import { ENLACE_APP, enlaceDeAviso, fechaLarga, plantilla, TIPOS, type DatosAviso, type TipoAviso } from '../src/server/services/avisos/plantillas';
import { parsearRemitente, resolverRemitente } from '../src/server/services/avisos/remitente';

const EMOJI = /\p{Extended_Pictographic}/u;
const conceptos = [
  { nombre: 'ADMINISTRACION VRANY', monto: 'S/ 38.00' },
  { nombre: 'LUZ AREAS COMUNES DEL CONDOMINIO', monto: 'S/ 41.20' },
  { nombre: 'LUZ COMUN DEL BLOCK 1', monto: 'S/ 22.95' },
  { nombre: 'AGUA AREAS COMUNES', monto: 'S/ 30.00' },
  { nombre: 'LIMPIEZA Y MANTENIMIENTO DE ASCENSORES', monto: 'S/ 140.00' },
];
const base = (extra: Partial<DatosAviso> = {}): DatosAviso => ({
  nombre: 'Miguel Gargurevich', periodo: 'octubre de 2026', monto: 'S/ 272.15', vencimiento: '02/11/2026', vence: new Date(Date.UTC(2026, 10, 2)), dias: 2,
  concepto: conceptos.map((c) => c.nombre).join(', '), conceptos, condominio: 'Condominio Los Libertadores de Surco', departamentos: [{ codigo: 'B01-804', torre: 'Block 1' }], ...extra,
});
const con = (tipo: TipoAviso, extra: Partial<DatosAviso> = {}, rol = 'propietario'): DatosAviso => { const d = base(extra); return { ...d, enlace: enlaceDeAviso(tipo, rol, d.central) }; };

describe('fechas y enlaces de los avisos', () => {
  it('fechaLarga: día de la semana, día y mes (con «setiembre»)', () => {
    assert.equal(fechaLarga(new Date(Date.UTC(2026, 10, 2))), 'lunes 2 de noviembre');
    assert.equal(fechaLarga(new Date(Date.UTC(2026, 10, 1))), 'domingo 1 de noviembre');
    assert.equal(fechaLarga(new Date(Date.UTC(2026, 8, 15))), 'martes 15 de setiembre');
  });

  it('cada rol llega a SU pantalla; un rol desconocido, al inicio', () => {
    assert.equal(enlaceDeAviso('recibo_emitido', 'propietario'), `${ENLACE_APP}/propietario/cargos`);
    assert.equal(enlaceDeAviso('vencido', 'inquilino'), `${ENLACE_APP}/inquilino/cargos`);
    assert.equal(enlaceDeAviso('pago_rechazado', 'inquilino'), `${ENLACE_APP}/inquilino/pagos`);
    assert.equal(enlaceDeAviso('comunicado', 'propietario'), `${ENLACE_APP}/propietario/comunicados`);
    assert.equal(enlaceDeAviso('cierre_pendiente', 'propietario', true), `${ENLACE_APP}/junta/cierre-central`);
    assert.equal(enlaceDeAviso('cierre_pendiente', 'propietario'), `${ENLACE_APP}/junta/cierre`);
    assert.equal(enlaceDeAviso('ia_caida', 'superadmin'), `${ENLACE_APP}/superadmin/llavero`);
    assert.equal(enlaceDeAviso('recibo_emitido', 'seguridad'), ENLACE_APP);
    assert.equal(enlaceDeAviso('recibo_emitido', null), ENLACE_APP);
  });
});

describe('texto plano de respaldo', () => {
  it('el recibo dice la fecha legible y trae los conceptos completos con su monto, sin «…»', () => {
    const { cuerpo } = plantilla('recibo_emitido', con('recibo_emitido'));
    assert.match(cuerpo, /Vence el lunes 2 de noviembre\./);
    assert.doesNotMatch(cuerpo, /02\/11\/2026/);
    for (const c of conceptos) assert.ok(cuerpo.includes(`- ${c.nombre}: ${c.monto}`), c.nombre);
    assert.doesNotMatch(cuerpo, /…/);
    assert.match(cuerpo, /Total a pagar: S\/ 272\.15/);
    assert.match(cuerpo, /Departamento: B01-804 \(Block 1\)\./);
    assert.ok(cuerpo.includes(`${ENLACE_APP}/propietario/cargos`));
    assert.doesNotMatch(cuerpo, EMOJI);
  });

  it('por vencer, vence hoy y vencido usan la fecha legible', () => {
    assert.match(plantilla('por_vencer', con('por_vencer')).cuerpo, /vence en 2 días \(lunes 2 de noviembre\)/);
    assert.match(plantilla('vence_hoy', con('vence_hoy', { dias: 0 })).cuerpo, /Hoy, lunes 2 de noviembre, vence/);
    assert.match(plantilla('vencido', con('vencido', { vence: new Date(Date.UTC(2026, 10, 1)) })).cuerpo, /venció el domingo 1 de noviembre/);
  });
});

describe('HTML de cada aviso', () => {
  const COBRO: TipoAviso[] = ['recibo_emitido', 'por_vencer', 'vence_hoy', 'vencido'];

  it('los de cobro traen el total grande, la fecha legible, el departamento, TODOS los conceptos con su monto y el botón a su pantalla', () => {
    for (const tipo of COBRO) {
      const { html, texto } = correoDeAviso(tipo, con(tipo, tipo === 'vencido' ? { vence: new Date(Date.UTC(2026, 10, 1)) } : {}));
      assert.match(html, />S\/ 272\.15</, `${tipo}: total`);
      assert.match(html, /font-size:34px/, `${tipo}: el total va grande`);
      assert.match(html, tipo === 'vencido' ? /domingo 1 de noviembre/ : /lunes 2 de noviembre/, `${tipo}: fecha legible`);
      assert.doesNotMatch(html, /02\/11\/2026|01\/11\/2026/, `${tipo}: sin fecha numérica`);
      assert.match(html, />B01-804 \(Block 1\)</, `${tipo}: departamento y block`);
      assert.match(html, /octubre de 2026/, `${tipo}: periodo`);
      for (const c of conceptos) {
        assert.ok(html.includes(`>${c.nombre}<`), `${tipo}: concepto ${c.nombre}`);
        assert.ok(html.includes(`>${c.monto}<`), `${tipo}: monto ${c.monto}`);
      }
      assert.doesNotMatch(html, /…|\.\.\./, `${tipo}: nada cortado`);
      assert.match(html, /<a href="https:\/\/torrecondominios\.com\/propietario\/cargos"[^>]*>[^<]+<\/a>/, `${tipo}: botón`);
      assert.match(html, /Condominio Los Libertadores de Surco/, `${tipo}: condominio en la cabecera y el pie`);
      assert.match(html, /Mi perfil › Celular y avisos/, `${tipo}: cómo dejar de recibirlo`);
      assert.match(html, /torrecondominios\.com\/perfil/, `${tipo}: enlace a las preferencias`);
      assert.doesNotMatch(html, EMOJI, `${tipo}: sin emojis`);
      assert.doesNotMatch(texto, EMOJI);
    }
  });

  it('cada tipo tiene su botón y su título; lo vencido va en rojo', () => {
    assert.match(correoDeAviso('recibo_emitido', con('recibo_emitido')).html, />Ver y pagar mi recibo</);
    assert.match(correoDeAviso('por_vencer', con('por_vencer')).html, />Pagar y subir mi voucher</);
    assert.match(correoDeAviso('vencido', con('vencido')).html, />Regularizar mi pago</);
    assert.match(correoDeAviso('recibo_emitido', con('recibo_emitido')).html, /<h1[^>]*>Tu recibo de octubre de 2026 ya está disponible<\/h1>/);
    assert.match(correoDeAviso('vencido', con('vencido')).html, /#b3261e/);
    assert.doesNotMatch(correoDeAviso('recibo_emitido', con('recibo_emitido')).html, /#b3261e/, 'un recibo al día no se pinta como alerta');
  });

  it('con dos departamentos sale una fila por cada uno con su monto', () => {
    const { html } = correoDeAviso('recibo_emitido', con('recibo_emitido', { departamentos: [{ codigo: 'B01-804', torre: 'Block 1', monto: 'S/ 150.15' }, { codigo: 'B02-101', torre: 'Block 2', monto: 'S/ 122.00' }] }));
    assert.match(html, />B01-804 \(Block 1\): S\/ 150\.15</);
    assert.match(html, />B02-101 \(Block 2\): S\/ 122\.00</);
  });

  it('el pago rechazado muestra el monto y el motivo; el comunicado, su título y su texto con párrafos', () => {
    const rechazo = correoDeAviso('pago_rechazado', con('pago_rechazado', { concepto: 'Mantenimiento', motivo: 'El voucher no se lee' }, 'inquilino')).html;
    assert.match(rechazo, />S\/ 272\.15</);
    assert.match(rechazo, />El voucher no se lee</);
    assert.match(rechazo, /href="https:\/\/torrecondominios\.com\/inquilino\/pagos"/);
    const com = correoDeAviso('comunicado', con('comunicado', { titulo: 'Corte de agua el sábado', texto: 'Primer párrafo.\n\nSegundo con\nsalto de línea.' })).html;
    assert.match(com, /<h1[^>]*>Corte de agua el sábado<\/h1>/);
    assert.match(com, />Primer párrafo\.</);
    assert.match(com, />Segundo con<br>salto de línea\.</);
    assert.match(com, /\/propietario\/comunicados/);
  });

  it('cierre pendiente (block y central) y avisos de la IA salen con diseño y su enlace', () => {
    const cierre = correoDeAviso('cierre_pendiente', con('cierre_pendiente', { bloque: 'Block 1', concepto: '3 pagos sin registrar' })).html;
    assert.match(cierre, /3 pagos sin registrar/);
    assert.match(cierre, /href="https:\/\/torrecondominios\.com\/junta\/cierre"/);
    const central = correoDeAviso('cierre_pendiente', con('cierre_pendiente', { central: true, concepto: 'Block 2, Block 3' })).html;
    assert.match(central, /Block 2, Block 3/);
    assert.match(central, /href="https:\/\/torrecondominios\.com\/junta\/cierre-central"/);
    for (const tipo of ['ia_caida', 'ia_restablecida'] as const) {
      const ia = correoDeAviso(tipo, { nombre: 'Miguel', periodo: '', monto: '', vencimiento: '', enlace: enlaceDeAviso(tipo, 'superadmin') }, { asunto: 'El asistente de IA volvió a funcionar', cuerpo: 'Hola Miguel,\n\nGemini 429 y OpenRouter 401.\n\n— Torre', rol: 'superadmin' }).html;
      assert.match(ia, /Gemini 429 y OpenRouter 401\./, tipo);
      assert.match(ia, /\/superadmin\/llavero/, tipo);
      assert.match(ia, /plataforma Torre/, tipo);
      assert.doesNotMatch(ia, EMOJI, tipo);
    }
  });

  it('todos los tipos generan HTML sin emojis ni «undefined»', () => {
    for (const tipo of TIPOS) {
      const { html, texto } = correoDeAviso(tipo, con(tipo, { titulo: 'Título', texto: 'Texto', motivo: 'Motivo', concepto: 'Mantenimiento', bloque: 'Block 1' }));
      assert.doesNotMatch(html, EMOJI, tipo);
      assert.doesNotMatch(html, /undefined|NaN|\[object/, tipo);
      assert.doesNotMatch(texto, /undefined|NaN/, tipo);
      assert.match(html, /<table role="presentation"[^>]*width="600"/, tipo);
      assert.match(html, /max-width:100%/, tipo);
    }
  });

  it('escapa lo que viene de la base: nombre, condominio, concepto, comunicado, motivo y bloque no inyectan HTML', () => {
    const mal = `<script>alert(1)</script><img src=x onerror=alert(2)>"'&`;
    const dato = con('recibo_emitido', {
      nombre: mal, condominio: mal, concepto: mal, conceptos: [{ nombre: mal, monto: 'S/ 1.00' }], departamentos: [{ codigo: mal, torre: mal }],
      titulo: mal, texto: mal, motivo: mal, bloque: mal,
    });
    for (const tipo of TIPOS) {
      const { html } = correoDeAviso(tipo, { ...dato, enlace: enlaceDeAviso(tipo, 'propietario') }, tipo.startsWith('ia_') || tipo === 'cierre_pendiente' ? { asunto: mal, cuerpo: `Hola,\n\n${mal}\n\n— ${mal}` } : undefined);
      assert.doesNotMatch(html, /<script|<img src=x/i, `${tipo}: sin etiquetas inyectadas`);
      assert.deepEqual([...new Set(html.match(/<(\/?)([a-z0-9]+)/gi)?.map((t) => t.replace('/', '').toLowerCase()))].sort(), ['<a', '<body', '<br', '<div', '<h1', '<head', '<html', '<img', '<meta', '<p', '<style', '<table', '<td', '<title', '<tr'].filter((t) => t !== '<br' || html.includes('<br')), `${tipo}: sólo las etiquetas de la plantilla`);
      assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, `${tipo}: el texto sale escapado`);
    }
    // el único <img> del correo es el logo de Torre
    assert.equal((correoDeAviso('recibo_emitido', dato).html.match(/<img /g) ?? []).length, 1);
  });
});

describe('remitente', () => {
  const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ RESEND_API_KEY: 're_falsa', ...extra });

  it('formato: dirección sola o «Nombre <dirección>»; lo demás no vale', () => {
    assert.deepEqual(parsearRemitente('avisos@torrecondominios.com'), { nombre: null, direccion: 'avisos@torrecondominios.com' });
    assert.deepEqual(parsearRemitente('Torre <avisos@torrecondominios.com>'), { nombre: 'Torre', direccion: 'avisos@torrecondominios.com' });
    assert.deepEqual(parsearRemitente('"Torre, avisos" <avisos@torrecondominios.com>'), { nombre: 'Torre, avisos', direccion: 'avisos@torrecondominios.com' });
    for (const malo of ['', '   ', 'Torre', 'Torre <avisos>', 'Torre <avisos@dominio>', '<avisos@x.pe', 'a@b.pe, c@d.pe', 'Torre\r\nBcc: x@y.pe <avisos@x.pe>', 'avisos@x.pe\nBcc: x@y.pe', 'Tor<re <a@x.pe>', 'a b@x.pe']) {
      assert.equal(parsearRemitente(malo), null, JSON.stringify(malo));
    }
  });

  it('usa el remitente de la base y, si no hay, MAIL_FROM; sin ninguno no hay remitente', () => {
    assert.equal(resolverRemitente(env({ MAIL_FROM: 'House <house@gargurevich.dev>' }), 'Torre <avisos@torrecondominios.com>'), 'Torre <avisos@torrecondominios.com>');
    assert.equal(resolverRemitente(env({ MAIL_FROM: 'House <house@gargurevich.dev>' }), null), 'House <house@gargurevich.dev>');
    assert.equal(resolverRemitente(env({ MAIL_FROM: 'House <house@gargurevich.dev>' }), '   '), 'House <house@gargurevich.dev>');
    assert.equal(resolverRemitente(env({ MAIL_FROM: 'House <house@gargurevich.dev>' }), 'esto no es un correo'), 'House <house@gargurevich.dev>', 'un remitente roto en la base no corta el envío');
    assert.equal(resolverRemitente(env(), null), null);
    assert.equal(resolverRemitente(env({ MAIL_FROM: '  ' }), null), null);
  });

  it('con condominio cambia sólo el nombre visible; la dirección queda', () => {
    assert.equal(resolverRemitente(env(), 'Torre <avisos@torrecondominios.com>', 'Condominio Los Libertadores de Surco'), 'Condominio Los Libertadores de Surco vía Torre <avisos@torrecondominios.com>');
    assert.equal(resolverRemitente(env({ MAIL_FROM: 'House <house@gargurevich.dev>' }), null, 'Los Olivos'), 'Los Olivos vía Torre <house@gargurevich.dev>');
    assert.equal(resolverRemitente(env(), 'avisos@torrecondominios.com', 'Los Olivos'), 'Los Olivos vía Torre <avisos@torrecondominios.com>', 'sin nombre configurado también se agrega');
    assert.equal(resolverRemitente(env(), 'Torre <avisos@torrecondominios.com>', '   '), 'Torre <avisos@torrecondominios.com>', 'un condominio vacío no cambia nada');
    assert.equal(resolverRemitente(env(), 'Torre <avisos@torrecondominios.com>', null), 'Torre <avisos@torrecondominios.com>');
  });

  it('el nombre del condominio no puede romper la cabecera: sin saltos, comillas ni ángulos; con signos raros va entre comillas', () => {
    const f = resolverRemitente(env(), 'Torre <avisos@torrecondominios.com>', 'Los "Pinos" <x@y.pe>\r\nBcc: robo@x.pe')!;
    assert.ok(!/[\r\n]/.test(f), 'sin saltos de línea');
    assert.match(f, / <avisos@torrecondominios\.com>$/, 'la dirección es la configurada');
    assert.ok(f.startsWith('"') && f.endsWith('" <avisos@torrecondominios.com>') && f.indexOf('"', 1) === f.lastIndexOf('"'), 'el nombre (con su @ y sus dos puntos) queda entero entre una sola pareja de comillas');
    assert.equal(resolverRemitente(env(), 'Torre <avisos@torrecondominios.com>', 'Torres S.A.'), '"Torres S.A. vía Torre" <avisos@torrecondominios.com>');
    assert.equal(parsearRemitente(f)?.direccion, 'avisos@torrecondominios.com', 'lo que sale se vuelve a leer con la misma dirección');
  });

  it('el canal de correo está listo con RESEND_API_KEY y (remitente de la base o MAIL_FROM)', () => {
    assert.equal(estadoCanales(env(), 'Torre <avisos@torrecondominios.com>').email.configurado, true);
    assert.equal(estadoCanales(env({ MAIL_FROM: 'a@b.pe' }), null).email.configurado, true);
    assert.deepEqual(estadoCanales(env(), null).email, { configurado: false, faltan: ['MAIL_FROM'] });
    assert.deepEqual(estadoCanales(env(), '  ').email, { configurado: false, faltan: ['MAIL_FROM'] });
    assert.deepEqual(estadoCanales({ MAIL_FROM: 'a@b.pe' }, 'Torre <a@b.pe>').email, { configurado: false, faltan: ['RESEND_API_KEY'] }, 'sin la clave de Resend no hay correo aunque haya remitente');
  });

  it('enviarCorreo manda el from resuelto; sin remitente alguno se omite sin llamar a la red', async () => {
    const enviados: Record<string, unknown>[] = [];
    const deps = (e: NodeJS.ProcessEnv): DepsAvisos => ({ ahora: () => new Date(), esperar: async () => {}, azar: () => 0, env: e, fetch: (async (_u: string | URL | Request, init?: RequestInit) => { enviados.push(JSON.parse(String(init?.body))); return new Response('{}', { status: 200 }); }) as typeof fetch });
    assert.deepEqual(await enviarCorreo(deps(env()), 'a@x.pe', 'A', 'B', undefined, undefined, { remitente: 'Torre <avisos@torrecondominios.com>', condominio: 'Los Olivos' }), { resultado: 'ok' });
    assert.equal(enviados[0]!.from, 'Los Olivos vía Torre <avisos@torrecondominios.com>');
    assert.deepEqual(await enviarCorreo(deps(env()), 'a@x.pe', 'A', 'B'), { resultado: 'omitida', motivo: 'Canal no configurado' });
    assert.equal(enviados.length, 1, 'sin remitente no se llamó a Resend');
  });
});

describe('de la cola al correo, con la base', () => {
  let d: Datos;
  let base: string;
  let cerrar: () => Promise<void>;
  let T: Record<'super' | 'adminA' | 'prop1', string>;
  const AHORA = new Date('2026-10-30T15:00:00Z');
  const ENV: NodeJS.ProcessEnv = { RESEND_API_KEY: 're_falsa', MAIL_FROM: 'Casa <avisos@ejemplo.test>' };

  const crear = (env: NodeJS.ProcessEnv = ENV) => {
    const correos: { from: string; to: string[]; subject: string; text: string; html?: string }[] = [];
    const deps: DepsAvisos = { ahora: () => AHORA, esperar: async () => {}, azar: () => 0, env, fetch: (async (_u: string | URL | Request, init?: RequestInit) => { correos.push(JSON.parse(String(init?.body))); return new Response('{}', { status: 200 }); }) as typeof fetch };
    return { deps, correos };
  };

  before(async () => {
    d = await sembrar();
    ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
    T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), prop1: await login(base, 'prop1@test.pe') };
    // El recibo de A-101 con cinco conceptos (el correo de antes cortaba a tres con «…») y vencimiento el lunes 2 de noviembre de 2026.
    await prisma.recibo.update({ where: { id: d.reciboFuturoA.id }, data: { fecha_vencimiento: new Date(Date.UTC(2026, 10, 2)), mes: 10, anio: 2026 } });
    let orden = 2;
    for (const [nombre, monto] of [['LUZ AREAS COMUNES DEL CONDOMINIO', 41.2], ['LUZ COMUN DEL BLOCK 1', 22.95], ['AGUA AREAS COMUNES', 30], ['<img src=x onerror=alert(1)> ASCENSORES', 140]] as const) {
      const concepto = await prisma.concepto.create({ data: { nombre, empresa_id: d.empresaA.id, tipo_monto: 'fijo' } });
      const rc = await prisma.reciboConcepto.create({ data: { recibo_id: d.reciboFuturoA.id, concepto_id: concepto.id, monto, orden: orden++ } });
      await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: d.unidadA1.id, monto, estado_pago: 'pendiente' } });
    }
  });
  after(async () => { await cerrar(); await prisma.$disconnect(); });
  beforeEach(async () => {
    await prisma.notificacion.deleteMany();
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { correo_remitente: null } });
  });

  const enviarRecibo = async (env?: NodeJS.ProcessEnv) => {
    // A-101 la paga el inquilino (quien paga la unidad si la tiene).
    assert.equal(await encolarAviso('recibo_emitido', d.inquilino1.id, { entidad: 'recibo', id: d.reciboFuturoA.id }, { ahora: AHORA }), 1);
    const { deps, correos } = crear(env);
    const r = await procesarCola(deps);
    return { r, correos };
  };

  it('el recibo sale con texto Y HTML: total, fecha legible, los cinco conceptos completos, botón a su pantalla; lo de la base, escapado', async () => {
    const { r, correos } = await enviarRecibo();
    assert.deepEqual(r, { enviadas: 1, omitidas: 0, fallos: 0, errores: 0 });
    const c = correos[0]!;
    assert.equal(c.subject, 'Tu recibo de octubre de 2026 ya está disponible');
    assert.ok(c.html, 'sale HTML');
    assert.match(c.html!, />S\/ 434\.15</, 'total: 200 de Mantenimiento (semilla) + 41.20 + 22.95 + 30 + 140');
    assert.match(c.html!, /lunes 2 de noviembre/);
    assert.doesNotMatch(c.html!, /02\/11\/2026/);
    for (const n of ['Mantenimiento', 'LUZ AREAS COMUNES DEL CONDOMINIO', 'LUZ COMUN DEL BLOCK 1', 'AGUA AREAS COMUNES']) assert.ok(c.html!.includes(`>${n}<`), n);
    assert.ok(c.html!.includes('&lt;img src=x onerror=alert(1)&gt; ASCENSORES'), 'el concepto con HTML sale escapado');
    assert.doesNotMatch(c.html!, /<img src=x|onerror=alert\(1\)>/);
    assert.doesNotMatch(c.html!, /…/);
    assert.match(c.html!, /href="https:\/\/torrecondominios\.com\/inquilino\/cargos"/);
    assert.match(c.html!, /Complejo A/);
    assert.doesNotMatch(c.html!, EMOJI);
    // el texto de respaldo es el de siempre, con la fecha legible y los conceptos completos
    assert.match(c.text, /Vence el lunes 2 de noviembre\./);
    assert.match(c.text, /- LUZ AREAS COMUNES DEL CONDOMINIO: S\/ 41\.20/);
    assert.match(c.text, /- <img src=x onerror=alert\(1\)> ASCENSORES: S\/ 140\.00/, 'el texto plano no se escapa: no es HTML');
    assert.doesNotMatch(c.text, /…/);
  });

  it('el from usa correo_remitente con el condominio en el nombre; sin él, MAIL_FROM (misma dirección, nombre del condominio)', async () => {
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { correo_remitente: 'Torre <avisos@torrecondominios.com>' } });
    const a = await enviarRecibo();
    assert.equal(a.correos[0]!.from, 'Complejo A vía Torre <avisos@torrecondominios.com>');

    await prisma.notificacion.deleteMany();
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { correo_remitente: null } });
    const b = await enviarRecibo();
    assert.equal(b.correos[0]!.from, 'Complejo A vía Torre <avisos@ejemplo.test>', 'sin remitente en la base cae a MAIL_FROM');
  });

  it('sin remitente en la base ni MAIL_FROM el correo se omite («Canal no configurado») y no llama a Resend', async () => {
    const { r, correos } = await enviarRecibo({ RESEND_API_KEY: 're_falsa' });
    assert.deepEqual(r, { enviadas: 0, omitidas: 1, fallos: 0, errores: 0 });
    assert.equal(correos.length, 0);
    // pero con el remitente en la base, y sin MAIL_FROM, sale
    await prisma.notificacion.deleteMany();
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { correo_remitente: 'avisos@torrecondominios.com' } });
    const ok = await enviarRecibo({ RESEND_API_KEY: 're_falsa' });
    assert.deepEqual(ok.r, { enviadas: 1, omitidas: 0, fallos: 0, errores: 0 });
    assert.equal(ok.correos[0]!.from, 'Complejo A vía Torre <avisos@torrecondominios.com>');
  });

  it('si el recibo ya no se puede rehacer, el correo sale igual (HTML con el texto guardado)', async () => {
    assert.equal(await encolarAviso('recibo_emitido', d.inquilino1.id, { entidad: 'recibo', id: d.reciboFuturoA.id }, { ahora: AHORA }), 1);
    await prisma.notificacion.updateMany({ data: { ref_id: 999_999 } }); // el recibo ya no existe
    const { deps, correos } = crear();
    assert.equal((await procesarCola(deps)).enviadas, 1);
    assert.ok(correos[0]!.html, 'sale con HTML');
    assert.match(correos[0]!.html!, /Hola Inquilino,/);
    assert.match(correos[0]!.text, /^Hola Inquilino,/);
  });

  describe('PUT /api/comercial/configuracion · correo_remitente', () => {
    const put = (token: string, body: unknown) => llamar(base, 'PUT', '/api/comercial/configuracion', token, body);

    it('el superadmin lo guarda (con nombre o sólo la dirección) y vacío lo borra', async () => {
      assert.equal((await put(T.super, { correo_remitente: 'Torre <avisos@torrecondominios.com>' })).status, 200);
      assert.equal((await prisma.configuracionComercial.findUniqueOrThrow({ where: { id: 1 } })).correo_remitente, 'Torre <avisos@torrecondominios.com>');
      assert.equal((await put(T.super, { correo_remitente: '  avisos@torrecondominios.com ' })).status, 200);
      assert.equal((await prisma.configuracionComercial.findUniqueOrThrow({ where: { id: 1 } })).correo_remitente, 'avisos@torrecondominios.com');
      assert.equal((await put(T.super, { correo_remitente: '' })).status, 200);
      assert.equal((await prisma.configuracionComercial.findUniqueOrThrow({ where: { id: 1 } })).correo_remitente, null);
    });

    it('un formato inválido da 422 con el campo y no cambia lo guardado', async () => {
      await put(T.super, { correo_remitente: 'Torre <avisos@torrecondominios.com>' });
      for (const mal of ['no-es-correo', 'Torre <avisos>', 'Torre avisos@x.pe', '<script>alert(1)</script>', 'Torre <a@x.pe>\r\nBcc: x@y.pe', 'a@x.pe, b@x.pe', 'x'.repeat(250) + '@x.pe', 42]) {
        const r = await put(T.super, { correo_remitente: mal });
        assert.equal(r.status, 422, JSON.stringify(mal));
        assert.ok(r.body.campos?.correo_remitente, `dice qué campo: ${JSON.stringify(r.body)}`);
      }
      assert.equal((await prisma.configuracionComercial.findUniqueOrThrow({ where: { id: 1 } })).correo_remitente, 'Torre <avisos@torrecondominios.com>');
    });

    it('sólo el superadmin: la administradora recibe 403 y la auditoría guarda el campo, no el valor', async () => {
      assert.equal((await put(T.adminA, { correo_remitente: 'x@x.pe' })).status, 403);
      assert.equal((await put(T.prop1, { correo_remitente: 'x@x.pe' })).status, 403);
      await put(T.super, { correo_remitente: 'Torre <avisos@torrecondominios.com>' });
      const a = await prisma.auditoria.findFirst({ where: { entidad: 'configuracion_comercial' }, orderBy: { id: 'desc' } });
      assert.deepEqual((a!.detalle as { campos: string[] }).campos, ['correo_remitente']);
    });
  });
});
