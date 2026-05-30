import test from 'node:test';
import assert from 'node:assert';
import { resolveLLMBackend, parseJsonLoose } from './index.js';

test('resolveLLMBackend', async (t) => {
  const saved = { key: process.env.GEMINI_API_KEY, proj: process.env.GCP_PROJECT_ID, gcp: process.env.GOOGLE_CLOUD_PROJECT };
  const reset = () => { delete process.env.GEMINI_API_KEY; delete process.env.GCP_PROJECT_ID; delete process.env.GOOGLE_CLOUD_PROJECT; };

  await t.test('GEMINI_API_KEY present -> apikey', () => {
    reset(); process.env.GEMINI_API_KEY = 'k';
    assert.deepStrictEqual(resolveLLMBackend(), { mode: 'apikey', apiKey: 'k', model: undefined });
  });

  await t.test('only GCP project -> vertex', () => {
    reset(); process.env.GCP_PROJECT_ID = 'dat-tool';
    const b = resolveLLMBackend();
    assert.strictEqual(b.mode, 'vertex');
    assert.strictEqual((b as any).project, 'dat-tool');
  });

  await t.test('neither -> none', () => {
    reset();
    assert.deepStrictEqual(resolveLLMBackend(), { mode: 'none' });
  });

  await t.test('explicit provider:vertex with config project wins', () => {
    reset(); process.env.GEMINI_API_KEY = 'k'; // present, but provider forces vertex
    const b = resolveLLMBackend({ provider: 'vertex', project: 'p', location: 'eu' });
    assert.deepStrictEqual(b, { mode: 'vertex', project: 'p', location: 'eu', model: undefined });
  });

  await t.test('explicit provider:apikey without key -> none', () => {
    reset();
    assert.deepStrictEqual(resolveLLMBackend({ provider: 'apikey' }), { mode: 'none' });
  });

  // restore
  if (saved.key) process.env.GEMINI_API_KEY = saved.key; else delete process.env.GEMINI_API_KEY;
  if (saved.proj) process.env.GCP_PROJECT_ID = saved.proj; else delete process.env.GCP_PROJECT_ID;
  if (saved.gcp) process.env.GOOGLE_CLOUD_PROJECT = saved.gcp; else delete process.env.GOOGLE_CLOUD_PROJECT;
});

test('parseJsonLoose', async (t) => {
  await t.test('raw JSON array', () => {
    assert.deepStrictEqual(parseJsonLoose('[{"a":1}]'), [{ a: 1 }]);
  });
  await t.test('fenced ```json block', () => {
    assert.deepStrictEqual(parseJsonLoose('```json\n[1,2]\n```'), [1, 2]);
  });
  await t.test('JSON embedded in prose', () => {
    assert.deepStrictEqual(parseJsonLoose('Here you go: [{"x":true}] cheers'), [{ x: true }]);
  });
  await t.test('garbage -> null', () => {
    assert.strictEqual(parseJsonLoose('not json at all'), null);
    assert.strictEqual(parseJsonLoose(''), null);
  });
});
