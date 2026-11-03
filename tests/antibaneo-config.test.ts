import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar } from './helpers/app';
import { obtenerConfiguracion } from '../src/server/services/comercial/configuracion';

// Los tres ajustes anti-baneo se guardan en la base (ConfiguracionComercial) y los edita el superadmin desde Precios.

let base: string;
let cerrar: () => Promise<void>;
let T: { super: string; adminA: string };

before(async () => {
  await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe') };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

const put = (body: unknown, token = T.super) => llamar(base, 'PUT', '/api/comercial/configuracion', token, body);
const guardado = () => prisma.configuracionComercial.findFirstOrThrow({ select: { whatsapp_tope_diario: true, whatsapp_pausa_min_seg: true, whatsapp_pausa_max_seg: true } });

describe('PUT /api/comercial/configuracion: ajustes de WhatsApp', () => {
  it('guarda un tope diario y una pausa válidos', async () => {
    const r = await put({ whatsapp_tope_diario: 150, whatsapp_pausa_min_seg: 3, whatsapp_pausa_max_seg: 20 });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(await guardado(), { whatsapp_tope_diario: 150, whatsapp_pausa_min_seg: 3, whatsapp_pausa_max_seg: 20 });
  });

  it('el tope acepta null (sin tope) y 0 (sin tope)', async () => {
    assert.equal((await put({ whatsapp_tope_diario: null })).status, 200);
    assert.equal((await guardado()).whatsapp_tope_diario, null);
    assert.equal((await put({ whatsapp_tope_diario: 0 })).status, 200);
    assert.equal((await guardado()).whatsapp_tope_diario, 0);
  });

  it('el tope no admite negativos ni decimales', async () => {
    for (const v of [-1, 2.5]) {
      const r = await put({ whatsapp_tope_diario: v });
      assert.equal(r.status, 422, `valor ${v}: ${r.texto}`);
      assert.ok(r.body.campos?.whatsapp_tope_diario, `valor ${v} marca el campo`);
    }
  });

  it('la pausa son enteros ≥ 0 y la máxima no pasa de 60 s', async () => {
    assert.equal((await put({ whatsapp_pausa_min_seg: -1 })).status, 422);
    assert.equal((await put({ whatsapp_pausa_min_seg: 1.5 })).status, 422);
    const r = await put({ whatsapp_pausa_max_seg: 61 });
    assert.equal(r.status, 422);
    assert.ok(r.body.campos?.whatsapp_pausa_max_seg);
  });

  it('el mínimo no puede pasar del máximo, mirando lo que ya está guardado si sólo se manda uno', async () => {
    await put({ whatsapp_pausa_min_seg: 5, whatsapp_pausa_max_seg: 15 });
    const r = await put({ whatsapp_pausa_min_seg: 30 }); // el máximo guardado es 15
    assert.equal(r.status, 422, r.texto);
    assert.ok(r.body.campos?.whatsapp_pausa_min_seg);
    assert.equal((await guardado()).whatsapp_pausa_min_seg, 5, 'no guarda nada');
    assert.equal((await put({ whatsapp_pausa_min_seg: 30, whatsapp_pausa_max_seg: 40 })).status, 200, 'si se manda el par, vale');
  });

  it('sólo el superadmin lo cambia', async () => {
    assert.equal((await put({ whatsapp_tope_diario: 10 }, T.adminA)).status, 403);
  });

  it('valores de partida al crear la fila: tope 200, pausa de 5 a 15 s', async () => {
    await prisma.configuracionComercial.deleteMany();
    const c = await obtenerConfiguracion();
    assert.equal(c.whatsapp_tope_diario, 200);
    assert.equal(c.whatsapp_pausa_min_seg, 5);
    assert.equal(c.whatsapp_pausa_max_seg, 15);
  });
});

describe('interfaz: avisos de WhatsApp (superadmin y administradora)', () => {
  it('Precios (superadmin) edita los tres ajustes junto a la configuración', () => {
    const fuente = readFileSync('src/pages/superadmin/_parts/suscripciones/Precios.tsx', 'utf8');
    for (const campo of ['whatsapp_tope_diario', 'whatsapp_pausa_min_seg', 'whatsapp_pausa_max_seg']) {
      assert.ok(fuente.includes(campo), `falta ${campo}`);
    }
    assert.match(fuente, /whatsapp_tope_diario[\s\S]{0,300}Number|Number[\s\S]{0,300}whatsapp_tope_diario/, 'el tope se envía como número o null');
  });

  it('WhatsappSync avisa ANTES de conectar: número con historial, uso previo si es nuevo, pausas y tope diario', () => {
    const fuente = readFileSync('src/pages/admin/WhatsappSync.tsx', 'utf8');
    const aviso = fuente.indexOf('historial de chats');
    assert.ok(aviso > 0, 'el aviso habla del historial de chats');
    assert.ok(fuente.includes('tope diario'), 'menciona el tope diario');
    assert.ok(fuente.includes('pausas'), 'menciona las pausas');
    assert.ok(aviso < fuente.indexOf('Sincronizar mi número'), 'el aviso va antes del botón de conectar');
    assert.match(fuente.slice(Math.max(0, aviso - 400), aviso), /<Alert/, 'el aviso es un Alert');
  });
});
