import test from 'node:test';
import assert from 'node:assert';
import { isBinaryAvailable, missingBinaries, __setProbeCache, __clearProbeCache } from './preflight.js';

test('Preflight binary probe', async (t) => {
  await t.test('detects a binary that exists (node)', async () => {
    __clearProbeCache();
    assert.strictEqual(await isBinaryAvailable('node'), true);
  });

  await t.test('reports a non-existent binary as unavailable', async () => {
    __clearProbeCache();
    assert.strictEqual(await isBinaryAvailable('definitely-not-a-real-binary-xyz'), false);
  });

  await t.test('missingBinaries returns only the absent ones', async () => {
    __clearProbeCache();
    __setProbeCache('present-tool', true);
    __setProbeCache('absent-tool', false);
    const missing = await missingBinaries(['present-tool', 'absent-tool']);
    assert.deepStrictEqual(missing, ['absent-tool']);
  });

  await t.test('empty requirement list is always satisfied', async () => {
    assert.deepStrictEqual(await missingBinaries([]), []);
    assert.deepStrictEqual(await missingBinaries(undefined), []);
  });
});
