// Formulario /contacto (sin sesión): guarda el mensaje, avisa a Torre por correo y se defiende del abuso (campo trampa, tope por IP, tamaños, sin HTML).
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, prisma, sembrar } from './helpers/app';
import { correoFalso } from './helpers/correoFalso';
import { comercialCorreo } from '../src/server/services/comercial/configuracion';

const original = comercialCorreo.deps;
let correo = correoFalso();
let base: string;
let cerrar: () => Promise<void>;

const mensaje = (over: Record<string, unknown> = {}) => ({
  nombre: 'Rosa Quispe', correo: 'rosa@casa.pe', celular: '987 654 321', condominio: 'Condominio Los Pinos', unidades: 48, varios_condominios: false,
  mensaje: 'Quiero ver cómo funciona Torre para mi edificio.', ...over,
});

before(async () => { await sembrar(); });
after(async () => { await prisma.$disconnect(); });
beforeEach(async () => {
  await prisma.solicitudContacto.deleteMany();
  await prisma.configuracionComercial.update({ where: { id: 1 }, data: { legal_correo: 'contacto@torre.ejemplo.test', correo_superadmin: 'dueno@torre.ejemplo.test' } });
  correo = correoFalso();
  comercialCorreo.deps = correo.deps;
  ({ base, cerrar } = await iniciar());
});
afterEach(async () => { comercialCorreo.deps = original; await cerrar(); });

describe('POST /api/publico/contacto', () => {
  it('guarda el mensaje (con IP y navegador) y responde con el texto de confirmación', async () => {
    const r = await llamar(base, 'POST', '/api/publico/contacto', null, mensaje(), { 'user-agent': 'PruebaNavegador/1.0' });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.mensaje, 'Recibimos tu mensaje. Te escribimos en menos de 1 día hábil.');
    const f = await prisma.solicitudContacto.findFirstOrThrow();
    assert.equal(f.nombre, 'Rosa Quispe');
    assert.equal(f.correo, 'rosa@casa.pe');
    assert.equal(f.unidades, 48);
    assert.equal(f.condominio, 'Condominio Los Pinos');
    assert.equal(f.estado, 'nueva');
    assert.equal(f.tema, 'consulta');
    assert.equal(f.user_agent, 'PruebaNavegador/1.0');
    assert.ok(f.ip, 'guarda la IP');
    assert.ok(f.celular?.startsWith('+51'), 'el celular queda en formato internacional');
  });

  it('manda el aviso a legal_correo (de la config) con los datos, en texto y en HTML', async () => {
    await llamar(base, 'POST', '/api/publico/contacto', null, mensaje({ varios_condominios: true }));
    assert.equal(correo.enviados.length, 1);
    const c = correo.enviados[0];
    assert.equal(c.para, 'contacto@torre.ejemplo.test');
    assert.match(c.asunto, /Rosa Quispe/);
    for (const dato of ['Rosa Quispe', 'rosa@casa.pe', 'Condominio Los Pinos', '48', 'Quiero ver cómo funciona']) { assert.ok(c.texto.includes(dato), `texto: ${dato}`); assert.ok(c.html.includes(dato), `html: ${dato}`); }
    assert.match(c.texto, /varios condominios\?: sí/);
    assert.equal((await prisma.solicitudContacto.findFirstOrThrow()).aviso_enviado, true);
  });

  it('sin legal_correo, el aviso va al correo del superadmin (el destino sale siempre de la config)', async () => {
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { legal_correo: null } });
    await llamar(base, 'POST', '/api/publico/contacto', null, mensaje());
    assert.equal(correo.enviados[0].para, 'dueno@torre.ejemplo.test');
  });

  it('el HTML del correo escapa lo que escribe el visitante (un símbolo suelto no se vuelve etiqueta)', async () => {
    await llamar(base, 'POST', '/api/publico/contacto', null, mensaje({ mensaje: 'Somos 5 < 10 vecinos & queremos "algo"' }));
    const c = correo.enviados[0];
    assert.ok(c.html.includes('5 &lt; 10 vecinos &amp; queremos &quot;algo&quot;'), c.html);
  });

  it('si el correo falla, el mensaje igual queda guardado y la persona ve la confirmación', async () => {
    comercialCorreo.deps = correoFalso({ fallar: true }).deps;
    const r = await llamar(base, 'POST', '/api/publico/contacto', null, mensaje());
    assert.equal(r.status, 200);
    const f = await prisma.solicitudContacto.findFirstOrThrow();
    assert.equal(f.aviso_enviado, false);
  });

  it('desde «Solicita una demo» (tema=demo) el mensaje queda marcado y el aviso lo dice', async () => {
    await llamar(base, 'POST', '/api/publico/contacto', null, mensaje({ tema: 'demo' }));
    assert.equal((await prisma.solicitudContacto.findFirstOrThrow()).tema, 'demo');
    assert.match(correo.enviados[0].asunto, /demo/i);
  });

  it('celular, condominio y departamentos son opcionales', async () => {
    const r = await llamar(base, 'POST', '/api/publico/contacto', null, { nombre: 'Luis', correo: 'luis@casa.pe', mensaje: 'Hola, necesito información.' });
    assert.equal(r.status, 200, r.texto);
    const f = await prisma.solicitudContacto.findFirstOrThrow();
    assert.equal(f.celular, null);
    assert.equal(f.unidades, null);
  });

  it('sin correo o sin mensaje → 422 con el campo, y no guarda ni envía', async () => {
    const sinCorreo = await llamar(base, 'POST', '/api/publico/contacto', null, mensaje({ correo: undefined }));
    assert.equal(sinCorreo.status, 422);
    assert.ok(sinCorreo.body.campos.correo);
    const sinMensaje = await llamar(base, 'POST', '/api/publico/contacto', null, mensaje({ mensaje: '' }));
    assert.equal(sinMensaje.status, 422);
    assert.ok(sinMensaje.body.campos.mensaje);
    assert.equal((await llamar(base, 'POST', '/api/publico/contacto', null, mensaje({ correo: 'no-es-correo' }))).status, 422);
    assert.equal(await prisma.solicitudContacto.count(), 0);
    assert.equal(correo.enviados.length, 0);
  });

  it('campos larguísimos → 422 (mensaje, nombre, condominio)', async () => {
    for (const [campo, largo] of [['mensaje', 2001], ['nombre', 121], ['condominio', 121]] as const) {
      const r = await llamar(base, 'POST', '/api/publico/contacto', null, mensaje({ [campo]: 'a'.repeat(largo) }));
      assert.equal(r.status, 422, campo);
      assert.ok(r.body.campos[campo], campo);
    }
    assert.equal(await prisma.solicitudContacto.count(), 0);
  });

  it('con 2000 caracteres en el mensaje (el máximo) sí pasa; departamentos fuera de rango → 422', async () => {
    assert.equal((await llamar(base, 'POST', '/api/publico/contacto', null, mensaje({ mensaje: 'a'.repeat(2000) }))).status, 200);
    assert.equal((await llamar(base, 'POST', '/api/publico/contacto', null, mensaje({ unidades: 0 }))).status, 422);
    assert.equal((await llamar(base, 'POST', '/api/publico/contacto', null, mensaje({ unidades: 1_000_000 }))).status, 422);
  });

  it('no acepta HTML en los campos (etiquetas ni comentarios), pero sí un «<» suelto', async () => {
    for (const [campo, valor] of [['nombre', '<script>alert(1)</script>'], ['mensaje', 'Hola <b>equipo</b>, quiero info'], ['condominio', '<img src=x onerror=alert(1)>'], ['mensaje', 'Hola <!-- oculto --> quiero info']] as const) {
      const r = await llamar(base, 'POST', '/api/publico/contacto', null, mensaje({ [campo]: valor }));
      assert.equal(r.status, 422, `${campo}: ${valor}`);
    }
    assert.equal(await prisma.solicitudContacto.count(), 0);
    assert.equal((await llamar(base, 'POST', '/api/publico/contacto', null, mensaje({ mensaje: 'Tenemos menos de 5 < 10 vecinos' }))).status, 200);
  });

  it('un nombre en varias líneas se rechaza (no se cuela en el asunto del correo)', async () => {
    assert.equal((await llamar(base, 'POST', '/api/publico/contacto', null, mensaje({ nombre: 'Rosa\nBcc: otro@x.pe' }))).status, 422);
  });

  it('campo trampa lleno → responde 200 igual que un envío bueno, pero NO guarda ni envía', async () => {
    const r = await llamar(base, 'POST', '/api/publico/contacto', null, mensaje({ sitio_web: 'http://spam.example' }));
    assert.equal(r.status, 200);
    assert.equal(r.body.mensaje, 'Recibimos tu mensaje. Te escribimos en menos de 1 día hábil.');
    assert.equal(await prisma.solicitudContacto.count(), 0);
    assert.equal(correo.enviados.length, 0);
    // Aunque el robot mande los demás campos mal, la respuesta es la misma.
    assert.equal((await llamar(base, 'POST', '/api/publico/contacto', null, { sitio_web: 'x' })).status, 200);
    // Vacío o con espacios no es un robot.
    assert.equal((await llamar(base, 'POST', '/api/publico/contacto', null, mensaje({ sitio_web: '  ' }))).status, 200);
    assert.equal(await prisma.solicitudContacto.count(), 1);
  });

  it('tope por IP: pasados 5 envíos en una hora, el sexto → 429 y no se guarda', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await llamar(base, 'POST', '/api/publico/contacto', null, mensaje())).status, 200, `envío ${i + 1}`);
    const sexto = await llamar(base, 'POST', '/api/publico/contacto', null, mensaje());
    assert.equal(sexto.status, 429);
    assert.match(sexto.body.error, /WhatsApp/);
    assert.equal(await prisma.solicitudContacto.count(), 5);
  });

  it('el tope del contacto no gasta el del registro (cada formulario lleva el suyo)', async () => {
    for (let i = 0; i < 5; i++) await llamar(base, 'POST', '/api/publico/contacto', null, mensaje());
    const r = await llamar(base, 'POST', '/api/publico/registro', null, { nombre: 'Rosa', email: 'rosa.nueva@casa.pe', celular: '987 654 321', password: 'Cl4ve-segura-2026', acepta_terminos: true });
    assert.equal(r.status, 202, r.texto);
  });
});
