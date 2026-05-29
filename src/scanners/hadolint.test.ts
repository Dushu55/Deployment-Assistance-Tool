import test from 'node:test';
import assert from 'node:assert';
import { hadolintScanner, runHadolint } from './hadolint.js';

test('Hadolint Scanner Adapter', async (t) => {
  await t.test('should register with correct properties', () => {
    assert.strictEqual(hadolintScanner.name, 'Hadolint');
    assert.strictEqual(hadolintScanner.module, 'container');
  });

  await t.test('should return success and info when target Dockerfile does not exist', async () => {
    const result = await runHadolint('non-existent-dockerfile');
    assert.strictEqual(result.scannerName, 'Hadolint');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.issues.length, 1);
    assert.strictEqual(result.issues[0].id, 'NO-DOCKERFILE');
    assert.strictEqual(result.issues[0].severity, 'INFO');
  });
});
