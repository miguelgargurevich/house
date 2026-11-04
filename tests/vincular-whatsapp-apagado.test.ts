// Con el asistente de WhatsApp apagado (por defecto), el número de la administración sólo envía avisos: Mi perfil no ofrece vincular el WhatsApp
// y generar un código para WhatsApp da 409. Encendido, se ofrece como antes.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { estadoCanales, type CanalesMe } from '../src/pages/shared/_parts/canalesFormato';
import { obtenerConfiguracion } from '../src/server/services/comercial/configuracion';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let prop1: string;

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar());
  prop1 = await login(base, 'prop1@test.pe');
  await obtenerConfiguracion();
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

const botWhatsapp = (activo: boolean) => prisma.configuracionComercial.updateMany({ data: { whatsapp_bot_activo: activo } });

describe('vincular el WhatsApp con el asistente apagado', () => {
  it('apagado: GET /api/me/canales dice whatsapp_bot=false y generar un código de WhatsApp → 409 sin crear nada', async () => {
    await botWhatsapp(false);
    const g = await llamar(base, 'GET', '/api/me/canales', prop1);
    assert.equal(g.status, 200);
    assert.equal(g.body.whatsapp_bot, false);
    const r = await llamar(base, 'POST', '/api/me/canales/whatsapp/codigo', prop1, {});
    assert.equal(r.status, 409);
    assert.match(r.body.error, /sólo envía avisos/);
    assert.equal(await prisma.codigoVinculacion.count({ where: { usuario_id: d.propietario1.id } }), 0);
  });

  it('encendido: ya no lo frena el asistente (sin número conectado responde el 409 de siempre)', async () => {
    await botWhatsapp(true);
    assert.equal((await llamar(base, 'GET', '/api/me/canales', prop1)).body.whatsapp_bot, true);
    const r = await llamar(base, 'POST', '/api/me/canales/whatsapp/codigo', prop1, {});
    assert.equal(r.status, 409);
    assert.match(r.body.error, /todavía no activó WhatsApp/);
    await botWhatsapp(false);
  });

  it('Mi perfil oculta la tarjeta con el asistente apagado, aunque haya un número disponible', () => {
    const datos: CanalesMe = { vinculos: [], codigo_vigente: null, destinos: [{ empresa: { id: 1, nombre: 'A' }, disponible: true, numero: '51900000001' }] };
    assert.equal(estadoCanales({ ...datos, whatsapp_bot: false }), 'oculto');
    assert.equal(estadoCanales({ ...datos, whatsapp_bot: true }), 'listo');
  });

  it('la pantalla de WhatsApp de la administración ya no invita a los vecinos a vincularse', () => {
    const f = readFileSync('src/pages/admin/WhatsappSync.tsx', 'utf8');
    assert.doesNotMatch(f, /vincular su WhatsApp desde Mi perfil/);
    assert.match(f, /salen los avisos de cobro y los comunicados/);
  });
});
