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
