// «Mis avisos»: el historial que ve el residente en «Celular y avisos». Backend: sólo sus avisos, máximo 20, más nuevos primero,
// sin cuerpo ni error crudo, con un motivo en palabras nuestras. Frontend: la lista renderiza estados y motivos, y un tipo nuevo
// (p. ej. `comunicado`) se muestra con su asunto. Las mutaciones (filtro por usuario, límite, orden, campos, motivo crudo) deben caer aquí.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { after, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar } from './helpers/app';
import { MOTIVO_SIN_WHATSAPP } from '../src/server/services/avisos/cola';

const RUTA = '/api/me/avisos/historial';
const CAMPOS = ['asunto', 'canal', 'estado', 'fecha', 'id', 'motivo', 'tipo'];
const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const LISTA = 'src/pages/shared/_parts/MisAvisosLista.tsx';
const CONTENEDOR = 'src/pages/shared/_parts/MisAvisos.tsx';
const PERFIL = 'src/pages/shared/_parts/AvisosPerfil.tsx';

let base: string;
let cerrar: () => Promise<void>;
let tokenProp1: string;
let tokenProp2: string;
let ListaMisAvisos: typeof import('../src/pages/shared/_parts/MisAvisosLista').ListaMisAvisos;

before(async () => {
  await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  tokenProp1 = await login(base, 'prop1@test.pe');
  tokenProp2 = await login(base, 'prop2@test.pe');
  (globalThis as { React?: unknown }).React = React;
  ({ ListaMisAvisos } = await import('../src/pages/shared/_parts/MisAvisosLista'));
});

after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.notificacion.deleteMany();
});

let secuencia = 0;
/** Un aviso «enviado» por defecto para el usuario con ese correo. */
async function aviso(email: string, datos: Partial<{ canal: string; asunto: string; cuerpo: string; estado: string; intentos: number; error: string | null; programada_para: Date; enviada_at: Date | null; created_at: Date }> = {}) {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { email } });
  secuencia += 1;
  return prisma.notificacion.create({
    data: {
      usuario_id: usuario.id,
      canal: 'email',
      tipo: 'recibo_emitido',
      asunto: `Aviso ${secuencia}`,
      cuerpo: 'Cuerpo del aviso',
      estado: 'enviada',
      ref_entidad: 'recibo',
      ref_id: secuencia,
      ...datos,
    },
  });
}

describe('GET /api/me/avisos/historial', () => {
  it('sin sesión → 401', async () => {
    const r = await llamar(base, 'GET', RUTA, null);
    assert.equal(r.status, 401);
  });

  it('devuelve sólo los avisos del usuario actual', async () => {
    const mio = await aviso('prop1@test.pe', { asunto: 'Mi recibo' });
    await aviso('prop2@test.pe', { asunto: 'Recibo AJENO' });
    const r = await llamar(base, 'GET', RUTA, tokenProp1);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.map((a: { id: number }) => a.id), [mio.id]);
    assert.doesNotMatch(r.texto, /AJENO/);
  });

  it('sin avisos → lista vacía', async () => {
    const r = await llamar(base, 'GET', RUTA, tokenProp2);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, []);
  });

  it('máximo 20, más nuevos primero', async () => {
    const creados: number[] = [];
    for (let i = 0; i < 25; i++) {
      const a = await aviso('prop1@test.pe', { created_at: new Date(Date.UTC(2026, 9, 1) + i * 60_000) });
      creados.push(a.id);
    }
    const r = await llamar(base, 'GET', RUTA, tokenProp1);
    assert.equal(r.body.length, 20);
    // Los 20 últimos creados, del más nuevo al más viejo.
    assert.deepEqual(r.body.map((a: { id: number }) => a.id), creados.slice(5).reverse());
  });

  it('nunca devuelve el cuerpo ni el error crudo del proveedor', async () => {
    await aviso('prop1@test.pe', { estado: 'error', asunto: 'Con error', cuerpo: 'CUERPO-SECRETO-1', error: 'HTTP 500 token=TOKEN-FALSO-123' });
    const r = await llamar(base, 'GET', RUTA, tokenProp1);
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.texto, /CUERPO-SECRETO-1|TOKEN-FALSO-123|HTTP 500/);
    assert.deepEqual(Object.keys(r.body[0]).sort(), CAMPOS);
  });

  it('motivo amigable según el caso (y nunca el texto crudo)', async () => {
    const casos: [string, Parameters<typeof aviso>[1], string | null][] = [
      ['omitida-plan', { canal: 'whatsapp', estado: 'omitida', error: MOTIVO_SIN_WHATSAPP }, 'Tu condominio no tiene WhatsApp en su plan'],
      ['omitida-celular', { canal: 'whatsapp', estado: 'omitida', error: 'Sin celular' }, 'Falta tu celular'],
      ['omitida-otro', { canal: 'whatsapp', estado: 'omitida', error: 'Sincronización de WhatsApp no configurada para la administradora' }, 'No se pudo enviar por este canal'],
      ['con-error', { estado: 'error', error: 'proveedor caído en tal IP' }, 'No se pudo entregar'],
      ['reintento', { estado: 'pendiente', intentos: 1, error: 'timeout', programada_para: new Date(Date.now() + 600_000) }, 'No se pudo entregar; lo reintentamos'],
      ['primera-vez', { estado: 'pendiente', intentos: 0, programada_para: new Date(Date.now() + 600_000) }, null],
      ['enviado', { estado: 'enviada', error: null }, null],
    ];
    for (const [asunto, datos] of casos) await aviso('prop1@test.pe', { ...datos, asunto });
    const r = await llamar(base, 'GET', RUTA, tokenProp1);
    for (const [asunto, , motivo] of casos) {
      const fila = r.body.find((a: { asunto: string }) => a.asunto === asunto);
      assert.ok(fila, `falta el aviso ${asunto}`);
      assert.equal(fila.motivo, motivo, asunto);
    }
    assert.doesNotMatch(r.texto, /proveedor caído|timeout|Sincronización de WhatsApp/);
  });

  it('fecha: enviada_at si existe; si no, programada_para', async () => {
    const enviado = await aviso('prop1@test.pe', { enviada_at: new Date('2026-10-20T14:00:00Z'), created_at: new Date('2026-10-19T00:00:00Z') });
    const pendiente = await aviso('prop1@test.pe', { estado: 'pendiente', enviada_at: null, programada_para: new Date('2026-10-30T09:00:00Z'), created_at: new Date('2026-10-21T00:00:00Z') });
    const r = await llamar(base, 'GET', RUTA, tokenProp1);
    const porId = new Map(r.body.map((a: { id: number; fecha: string }) => [a.id, a.fecha]));
    assert.equal(porId.get(enviado.id), '2026-10-20T14:00:00.000Z');
    assert.equal(porId.get(pendiente.id), '2026-10-30T09:00:00.000Z');
    assert.equal(r.body[0].id, pendiente.id, 'el más nuevo (created_at) va primero');
  });
});

describe('ListaMisAvisos (render)', () => {
  const pintar = (avisos: Parameters<typeof ListaMisAvisos>[0]['avisos']) => renderToStaticMarkup(createElement(ListaMisAvisos, { avisos }));

  it('lista vacía → «Todavía no te enviamos avisos.»', () => {
    assert.match(pintar([]), /Todavía no te enviamos avisos\./);
  });

  it('muestra estado, canal, motivo y asunto; un tipo nuevo (comunicado) se ve con su asunto', () => {
    const html = pintar([
      { id: 1, canal: 'email', tipo: 'recibo_emitido', asunto: 'Recibo de octubre', estado: 'enviada', fecha: '2026-10-20T14:00:00Z', motivo: null },
      { id: 2, canal: 'whatsapp', tipo: 'vencido', asunto: 'Tu cuota venció', estado: 'omitida', fecha: '2026-10-21T14:00:00Z', motivo: 'Tu condominio no tiene WhatsApp en su plan' },
      { id: 3, canal: 'email', tipo: 'comunicado', asunto: 'Corte de agua el martes', estado: 'pendiente', fecha: '2026-10-22T14:00:00Z', motivo: 'No se pudo entregar; lo reintentamos' },
      { id: 4, canal: 'email', tipo: 'vencido', asunto: 'Otro aviso', estado: 'error', fecha: '2026-10-23T14:00:00Z', motivo: 'No se pudo entregar' },
    ]);
    for (const texto of ['Recibo de octubre', 'Tu cuota venció', 'Corte de agua el martes', 'Enviado', 'Omitido', 'Pendiente', 'No se entregó', 'WhatsApp', 'Correo', 'Tu condominio no tiene WhatsApp en su plan', 'No se pudo entregar; lo reintentamos']) {
      assert.match(html, new RegExp(texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), texto);
    }
    assert.doesNotMatch(html, /undefined/);
  });
});

describe('UI de «Mis avisos» (fuente)', () => {
  it('el contenedor pide sólo el historial propio y la lista no lee cuerpo ni error crudo', () => {
    assert.match(fuente(CONTENEDOR), /\/api\/me\/avisos\/historial/);
    const ui = fuente(CONTENEDOR) + fuente(LISTA);
    assert.doesNotMatch(ui, /\.cuerpo\b/);
    assert.doesNotMatch(ui, /\.error\b/);
  });

  it('«Celular y avisos» muestra «Últimos avisos» debajo del formulario', () => {
    assert.match(fuente(PERFIL), /import \{ MisAvisos \} from '\.\/MisAvisos'/);
    assert.match(fuente(PERFIL), /<MisAvisos \/>/);
  });
});
