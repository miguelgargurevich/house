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
