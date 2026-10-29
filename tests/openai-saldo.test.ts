import './helpers/env';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { proveedorPorId } from '../src/server/lib/proveedoresIA';
import { llaveroDeps } from '../src/server/services/llavero';
import { llamarProveedor, type Fallo, type Turno } from '../src/server/services/asistente/proveedor';
import { detalleDePrueba, tipoDeFallo } from '../src/server/services/asistente/prueba';
import type { Eslabon } from '../src/server/services/rotacion';

// Sin red: el `fetch` del llavero se reemplaza por una respuesta fija.
const fetchOriginal = llaveroDeps.fetch;
afterEach(() => { llaveroDeps.fetch = fetchOriginal; });

const openai = proveedorPorId('openai');
if (!openai) throw new Error('falta el proveedor openai en el catálogo');
const e: Eslabon = { cooldownKey: 'openai:1', claveId: 1, proveedor: openai, clave: 'sk-prueba-0000-AAAA', modelo: 'gpt-4o-mini', fijado: null, reserva: false };
const turno: Turno = { sistema: 'Responde breve.', mensajes: [{ rol: 'user', texto: 'Hola' }] };
const opciones = { parametros: { temperature: 0.2, maxTokens: 64, topP: 1, topK: 1 }, esfuerzo: 'low' as const, stream: false, esperaMs: 5_000 };

const responder = (status: number, cuerpo: string, cabeceras: Record<string, string> = {}) => {
  llaveroDeps.fetch = async () => new Response(cuerpo, { status, headers: { 'content-type': 'application/json', ...cabeceras } });
};
const falla = async (): Promise<Fallo> => {
  const s = await llamarProveedor(e, 'gpt-4o-mini', turno, { ...opciones, opcionales: true });
  assert.equal(s.tipo, 'fallo');
  return s as Fallo;
};

// Cuerpo real de OpenAI para una cuenta sin saldo (medido en producción).
const SIN_SALDO = '{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","code":"credit_balance_exhausted"}}';
const LIMITE = '{"error":{"message":"Rate limit reached for gpt-4o-mini. Please try again in 20s.","type":"requests","code":"rate_limit_exceeded"}}';

describe('OpenAI sin saldo llega como 402 (cuenta sin saldo), no como límite temporal', () => {
  it('429 con insufficient_quota → 402, sin reintento, y las pruebas dicen «La cuenta no tiene saldo»', async () => {
    responder(429, SIN_SALDO);
    const f = await falla();
    assert.equal(f.status, 402);
    assert.equal(f.retryAfterMs, null, 'sin saldo no se reintenta en unos segundos');
    assert.equal(tipoDeFallo(f), 'sin_saldo');
    assert.equal(detalleDePrueba('sin_saldo', 'gpt-4o-mini'), 'La cuenta no tiene saldo');
  });

  it('el 429 sin saldo ignora el Retry-After: sigue siendo 402', async () => {
    responder(429, SIN_SALDO, { 'retry-after': '30' });
    const f = await falla();
    assert.equal(f.status, 402);
    assert.equal(f.retryAfterMs, null);
  });

  it('403 y 400 con «exceeded your current quota» o billing_hard_limit_reached también son 402', async () => {
    for (const [status, cuerpo] of [
      [403, '{"error":{"message":"You exceeded your current quota"}}'],
      [400, '{"error":{"code":"billing_hard_limit_reached","message":"Billing hard limit has been reached"}}'],
    ] as const) {
      responder(status, cuerpo);
      assert.equal((await falla()).status, 402, `${status} ${cuerpo}`);
    }
  });

  it('cada texto de falta de saldo basta por sí solo (insufficient_quota, credit_balance_exhausted, billing_hard_limit_reached, exceeded your current quota)', async () => {
    for (const cuerpo of [
      '{"error":{"type":"insufficient_quota","code":"insufficient_quota"}}',
      '{"error":{"code":"credit_balance_exhausted"}}',
      '{"error":{"code":"billing_hard_limit_reached"}}',
      '{"error":{"message":"You exceeded your current quota"}}',
    ]) {
      responder(429, cuerpo);
      assert.equal((await falla()).status, 402, cuerpo);
    }
  });

  it('un 429 de límite de tasa normal sigue siendo 429, con su Retry-After', async () => {
    responder(429, LIMITE, { 'retry-after': '30' });
    const f = await falla();
    assert.equal(f.status, 429);
    assert.equal(f.retryAfterMs, 30_000);
    assert.equal(tipoDeFallo(f), 'limite');
  });

  it('un 429 sin cuerpo reconocible sigue siendo límite', async () => {
    responder(429, 'Too Many Requests');
    const f = await falla();
    assert.equal(f.status, 429);
    assert.equal(tipoDeFallo(f), 'limite');
  });
});
