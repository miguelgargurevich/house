import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, vaciarBase, type Datos } from './helpers/app';
import { atenderMensaje } from '../src/server/services/canales/entrante';
import { limites, limpiarLimites } from '../src/server/services/canales/limites';
import { TEXTO_BAJA_WHATSAPP } from '../src/server/services/canales/baja';
import type { MensajeEntrante, Transporte } from '../src/server/services/canales/transporte';
import { obtenerConfiguracion } from '../src/server/services/comercial/configuracion';

// Asistente de WhatsApp APAGADO (`whatsapp_bot_activo = false`): el número sólo atiende «SALIR»; cualquier otro mensaje se descarta sin respuesta.
// Telegram no cambia. Encendido, el número responde como antes. Nada sale de verdad: el transporte es un doble que guarda lo que respondería.

const NUM_PROP1 = '51987654321'; // celular de propietario1 en su perfil (sin vincular)
const NUM_PROP2 = '51922222222'; // propietario2 con WhatsApp vinculado (verificado)
const NUM_SIN_NADIE = '51900000009';

let base: string;
let cerrar: () => Promise<void>;
let T: { super: string; adminA: string };
let D: Datos;
let respuestas: string[] = [];
let seq = 0;

const transporte = (identificador: string, opts: { canal?: 'whatsapp' | 'telegram'; empresaId?: number | null } = {}): Transporte => ({
  canal: opts.canal ?? 'whatsapp',
  identificador,
  empresaId: opts.empresaId === undefined ? D.empresaA.id : opts.empresaId,
  responder: async (texto: string) => {
    respuestas.push(texto);
  },
  descargarMedio: async () => {
    throw new Error('no se usa en estas pruebas');
  },
});

const mensaje = (texto: string, extra: Partial<MensajeEntrante> = {}): MensajeEntrante => ({ mensajeId: `apagado-${++seq}`, texto, medio: null, otro: false, ...extra });

const escribe = (texto: string, identificador = NUM_PROP2) => atenderMensaje(transporte(identificador), mensaje(texto));

const fijarBot = (activo: boolean) => prisma.configuracionComercial.update({ where: { id: 1 }, data: { whatsapp_bot_activo: activo } });

before(async () => {
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, ai: 100_000, llavero: 100_000, evaluacion: 100_000 } }));
});

after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

beforeEach(async () => {
  D = await sembrar(); // el asistente queda encendido; cada prueba decide
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe') };
  await fijarBot(false);
  respuestas = [];
  limpiarLimites();
  await prisma.usuario.updateMany({ data: { aviso_whatsapp: true, telefono: null } });
  await prisma.usuario.update({ where: { id: D.propietario1.id }, data: { telefono: '+51 987 654 321' } });
  await prisma.canalVinculado.create({
    data: { usuario_id: D.propietario2.id, canal: 'whatsapp', identificador: NUM_PROP2, empresa_id: D.empresaA.id, verificado_at: new Date(), clave_vigente: `whatsapp:${NUM_PROP2}`, clave_usuario: `${D.propietario2.id}:whatsapp` },
  });
});

describe('asistente de WhatsApp apagado', () => {
  it('un número vinculado no obtiene respuesta a menú, pregunta ni desvincular, y el vínculo sigue', async () => {
    for (const texto of ['menu', '¿Cuánto debo de mi recibo?', 'desvincular']) await escribe(texto);
    assert.deepEqual(respuestas, [], 'cero respuestas');
    const vigente = await prisma.canalVinculado.findFirst({ where: { identificador: NUM_PROP2, canal: 'whatsapp', revocado_at: null } });
    assert.ok(vigente, 'desvincular no se procesa: el número sigue vinculado');
  });

  it('un número sin vínculo no recibe «no vinculado» ni «muchos mensajes», aunque escriba sin parar', async () => {
    await escribe('hola', NUM_SIN_NADIE);
    for (let i = 0; i < limites.mensajesNumero.tope + 3; i++) await escribe(`mensaje ${i}`, NUM_SIN_NADIE);
    assert.deepEqual(respuestas, []);
  });

  it('un código de vinculación no vincula y no responde', async () => {
    await escribe('123456', NUM_SIN_NADIE);
    assert.deepEqual(respuestas, []);
    assert.equal(await prisma.canalVinculado.count({ where: { identificador: NUM_SIN_NADIE } }), 0);
  });

  it('una foto, un documento o un mensaje sin texto tampoco reciben respuesta', async () => {
    await atenderMensaje(transporte(NUM_PROP2), mensaje('', { medio: { tipo: 'imagen', mimetype: 'image/png', nombre: null, tamano: 100, fileId: 'f1' } }));
    await atenderMensaje(transporte(NUM_PROP2), mensaje('', { otro: true }));
    assert.deepEqual(respuestas, []);
  });

  it('SALIR sigue dando de baja: responde el texto fijo y apaga el aviso por WhatsApp de esa persona', async () => {
    await atenderMensaje(transporte(NUM_PROP1), mensaje('SALIR'));
    assert.deepEqual(respuestas, [TEXTO_BAJA_WHATSAPP]);
    const p1 = await prisma.usuario.findUniqueOrThrow({ where: { id: D.propietario1.id }, select: { aviso_whatsapp: true } });
    assert.equal(p1.aviso_whatsapp, false);
  });

  it('Telegram no se rige por esto: el mismo bot responde por Telegram con el asistente apagado', async () => {
    await prisma.canalVinculado.create({
      data: { usuario_id: D.propietario2.id, canal: 'telegram', identificador: '777', empresa_id: D.empresaA.id, verificado_at: new Date(), clave_vigente: 'telegram:777', clave_usuario: `${D.propietario2.id}:telegram` },
    });
    await atenderMensaje(transporte('777', { canal: 'telegram', empresaId: null }), mensaje('menu'));
    assert.equal(respuestas.length, 1);
    assert.match(respuestas[0]!, /Menú/);
  });
});

describe('asistente de WhatsApp encendido', () => {
  it('responde como antes: el menú llega al número vinculado', async () => {
    await fijarBot(true);
    await escribe('menu');
    assert.equal(respuestas.length, 1);
    assert.match(respuestas[0]!, /Menú/);
  });
});

describe('ajuste en Suscripciones › Precios (PUT /api/comercial/configuracion)', () => {
  it('el superadmin lo enciende y lo apaga; el admin no lo cambia (403)', async () => {
    const put = (body: unknown, token: string) => llamar(base, 'PUT', '/api/comercial/configuracion', token, body);
    assert.equal((await put({ whatsapp_bot_activo: true }, T.adminA)).status, 403);
    assert.equal((await obtenerConfiguracion()).whatsapp_bot_activo, false, 'el admin no lo tocó');
    assert.equal((await put({ whatsapp_bot_activo: true }, T.super)).status, 200);
    assert.equal((await obtenerConfiguracion()).whatsapp_bot_activo, true);
    assert.equal((await put({ whatsapp_bot_activo: false }, T.super)).status, 200);
    assert.equal((await obtenerConfiguracion()).whatsapp_bot_activo, false);
  });

  it('de fábrica viene apagado', async () => {
    await vaciarBase();
    assert.equal((await obtenerConfiguracion()).whatsapp_bot_activo, false);
  });
});
