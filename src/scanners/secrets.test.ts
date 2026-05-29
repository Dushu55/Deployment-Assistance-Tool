import test from 'node:test';
import assert from 'node:assert';
import { gitleaksScanner } from './secrets.js';

test('Gitleaks Scanner Adapter', async (t) => {
  await t.test('should register with correct properties', () => {
    assert.strictEqual(gitleaksScanner.name, 'Gitleaks (Secrets)');
    assert.strictEqual(gitleaksScanner.module, 'security');
  });
});
