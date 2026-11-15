import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseSuggestions, reviewScreenshot } from '../ai.mjs';

describe('ai provider', { concurrency: false }, () => {
test('достаёт JSON и не превращает рекомендацию в подтверждённый дефект', () => {
  const parsed = parseSuggestions('Текст модели {"suggestions":[{"title":"Плотный текст","description":"Абзац трудно читать","severity":"low","status":"confirmed"}]} конец');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].status, undefined);
  assert.equal(parsed[0].title, 'Плотный текст');
});

test('ломаный ответ модели не маскируется под дефект', () => {
  assert.throws(() => parseSuggestions('просто текст без объекта'));
  assert.deepEqual(parseSuggestions('{"suggestions":[{"title":" ","description":"пусто"}]}'), []);
});

async function tempPng() {
  const file = path.join(os.tmpdir(), `uxproof-ai-${Date.now()}.png`);
  await fs.writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return file;
}

test('без ключа OpenAI запрос не уходит', async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  let called = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { called = true; throw Error('сеть не должна вызываться'); };
  const file = await tempPng();
  try {
    await assert.rejects(() => reviewScreenshot({ file, scenario: 'demo', viewport: 'Mobile', findings: [], provider: 'openai' }), /OPENAI_API_KEY/);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test('ошибка провайдера не содержит ключ', async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-test-secret-do-not-leak';
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => 'sk-test-secret-do-not-leak' });
  const file = await tempPng();
  try {
    await assert.rejects(
      () => reviewScreenshot({ file, scenario: 'demo', viewport: 'Mobile', findings: [], provider: 'openai' }),
      error => !String(error.message).includes('sk-test-secret-do-not-leak') && /401/.test(String(error.message))
    );
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test('удалённый Ollama запрещён', async () => {
  const previous = process.env.UXPROOF_OLLAMA_URL;
  process.env.UXPROOF_OLLAMA_URL = 'http://example.com:11434';
  const file = await tempPng();
  try {
    await assert.rejects(() => reviewScreenshot({ file, scenario: 'demo', viewport: 'Mobile', findings: [], provider: 'ollama' }), /localhost/);
  } finally {
    if (previous === undefined) delete process.env.UXPROOF_OLLAMA_URL;
    else process.env.UXPROOF_OLLAMA_URL = previous;
  }
});
});
