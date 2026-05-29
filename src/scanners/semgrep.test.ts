import test from 'node:test';
import assert from 'node:assert';
import { semgrepScanner } from './semgrep.js';

test('Semgrep Scanner Adapter', async (t) => {
  await t.test('should register with correct properties', () => {
    assert.strictEqual(semgrepScanner.name, 'Semgrep');
    assert.strictEqual(semgrepScanner.module, 'static');
  });
});
