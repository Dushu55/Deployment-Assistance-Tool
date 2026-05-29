import test from 'node:test';
import assert from 'node:assert';
import { trivyScanner } from './trivy.js';

test('Trivy Scanner Adapter', async (t) => {
  await t.test('should register with correct properties', () => {
    assert.strictEqual(trivyScanner.name, 'Trivy');
    assert.strictEqual(trivyScanner.module, 'security');
  });
});
