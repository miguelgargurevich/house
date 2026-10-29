import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clasificarModelo, esModeloDeChat } from '../src/server/lib/modelosIA';

describe('qué modelos sirven para conversar', () => {
  it('los clasificadores de seguridad no son de chat (caso real: openai/gpt-oss-safeguard-20b)', () => {
    for (const id of ['openai/gpt-oss-safeguard-20b', 'openai/gpt-oss-safeguard-120b', 'llama-guard-4-12b', 'meta-llama/llama-prompt-guard-2-86m', 'nvidia/llama-3.1-nemoguard-8b-content-safety']) {
      assert.equal(esModeloDeChat(id), false, id);
      assert.equal(clasificarModelo(id), 'otro', id);
    }
  });
  it('los de chat siguen entrando', () => {
    for (const id of ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'gemini-flash-latest', 'meta/llama-3.3-70b-instruct', 'mistral-small-latest']) {
      assert.equal(esModeloDeChat(id), true, id);
    }
  });
});

describe('modelos de OpenAI: qué sirve para conversar', () => {
  it('legados de completado, tiempo real, codex, investigación, búsqueda y los `pro` de la Responses API no son de chat (caso real: babbage-002 salió primero)', () => {
    for (const id of ['babbage-002', 'davinci-002', 'gpt-3.5-turbo-instruct', 'gpt-4o-realtime-preview', 'gpt-4o-mini-realtime-preview', 'gpt-5-codex', 'codex-mini-latest', 'o3-deep-research', 'o4-mini-deep-research', 'o1-pro', 'o1-pro-2025-03-19', 'o3-pro', 'gpt-5-pro', 'gpt-4o-search-preview', 'gpt-4o-mini-search-preview']) {
      assert.equal(esModeloDeChat(id), false, id);
      assert.equal(clasificarModelo(id), 'otro', id);
    }
  });
  it('imagen, audio, embeddings y moderación de OpenAI tampoco', () => {
    for (const id of ['gpt-image-1', 'gpt-4o-mini-transcribe', 'gpt-4o-mini-tts', 'text-embedding-3-small', 'omni-moderation-latest']) {
      assert.equal(esModeloDeChat(id), false, id);
    }
  });
  it('los de chat de OpenAI siguen entrando, con su categoría', () => {
    for (const [id, cat] of [['gpt-4o-mini', 'rapido'], ['gpt-4o', 'equilibrado'], ['gpt-4.1', 'equilibrado'], ['gpt-4.1-nano', 'rapido'], ['gpt-5-mini', 'rapido'], ['chatgpt-4o-latest', 'equilibrado'], ['o1-2024-12-17', 'razonamiento'], ['o3-mini', 'razonamiento']] as const) {
      assert.equal(esModeloDeChat(id), true, id);
      assert.equal(clasificarModelo(id), cat, id);
    }
  });
  it('la exclusión por palabra no toca a otros proveedores (mini en gemini, codex en nombres ajenos)', () => {
    assert.equal(esModeloDeChat('gemini-2.5-flash-lite'), true);
    assert.equal(clasificarModelo('gemini-2.5-flash-lite'), 'rapido');
    assert.equal(esModeloDeChat('meta/llama-3.3-70b-instruct'), true);
    assert.equal(esModeloDeChat('mistral-small-latest'), true);
  });
});

describe('Auto con una clave de OpenAI', () => {
  it('elige gpt-4o-mini primero con el catálogo de producción (antes elegía o1 y luego babbage-002)', async () => {
    const { ordenarActivos } = await import('../src/server/services/modelos/seleccion');
    // Mismo filtro que `candidatosDeClave`: lo de categoría 'otro' no es elegible.
    const catalogo = ['o1-2024-12-17', 'babbage-002', 'gpt-4o-mini', 'gpt-4o', 'chatgpt-4o-latest', 'gpt-4.1-nano', 'gpt-4o-mini-2024-07-18', 'gpt-4o-2024-08-06', 'gpt-4.1', 'text-embedding-3-small', 'dall-e-3'];
    const filas = catalogo
      .map((id) => ({ modelo_id: id, categoria: clasificarModelo(id), estado: 'activo', gratis: false, nombre: null }))
      .filter((f) => f.categoria !== 'otro');
    assert.ok(!filas.some((f) => f.modelo_id === 'babbage-002'));
    for (const ctx of [{}, { mensajeCorto: true }]) {
      const orden = ordenarActivos('openai', filas, ctx);
      assert.equal(orden[0], 'gpt-4o-mini', JSON.stringify(ctx));
      assert.ok(orden.indexOf('gpt-4o') < orden.indexOf('gpt-4o-2024-08-06'), 'gpt-4o sin fecha antes que la fechada');
      assert.ok(orden.indexOf('gpt-4o-mini') < orden.indexOf('gpt-4o-mini-2024-07-18'), 'mini sin fecha antes que la fechada');
      assert.ok(orden.indexOf('gpt-4o') < orden.indexOf('o1-2024-12-17'), 'la lista de preferencia manda sobre el orden por nombre');
    }
  });
});

describe('Auto no elige modelos débiles', () => {
  it('allam y los <= 4B van al final aunque sean «rápidos» (caso real: Groq elegía allam-2-7b)', async () => {
    const { esDebil } = await import('../src/server/lib/modelosIA');
    const { ordenarActivos } = await import('../src/server/services/modelos/seleccion');
    for (const id of ['allam-2-7b', 'meta-llama/llama-3.2-3b-instruct', 'gemma-3-1b-it', 'qwen2.5-1.5b']) assert.equal(esDebil(id), true, id);
    for (const id of ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'llama-3.1-8b-instant', 'gemini-flash-lite-latest', 'mistral-small-latest']) assert.equal(esDebil(id), false, id);
    const filas = [
      { modelo_id: 'allam-2-7b', categoria: 'rapido', estado: 'activo', gratis: true, nombre: null },
      { modelo_id: 'qwen/qwen3.8-27b', categoria: 'equilibrado', estado: 'activo', gratis: true, nombre: null },
      { modelo_id: 'openai/gpt-oss-120b', categoria: 'razonamiento', estado: 'activo', gratis: true, nombre: null },
    ];
    const orden = ordenarActivos('groq', filas, { mensajeCorto: true });
    assert.notEqual(orden[0], 'allam-2-7b');
    assert.equal(orden.at(-1), 'allam-2-7b');
  });
});
