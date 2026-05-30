import test from 'node:test';
import assert from 'node:assert';
import { runScannerWithTimeout } from './orchestrator.js';

test('runScannerWithTimeout', async (t) => {
  await t.test('bounds a scanner that hangs and returns a timed-out failure', async () => {
    const hung = { name: 'Hangs', run: () => new Promise(() => {}) }; // never resolves
    const res = await runScannerWithTimeout(hung, {}, 50);
    assert.strictEqual(res.success, false);
    assert.match(res.error || '', /timed out after 50ms/);
    assert.strictEqual(res.scannerName, 'Hangs');
  });

  await t.test('returns the scanner result when it completes in time', async () => {
    const ok = { name: 'Fast', run: async () => ({ scannerName: 'Fast', success: true, durationMs: 1, issues: [] }) };
    const res = await runScannerWithTimeout(ok, {}, 1000);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.scannerName, 'Fast');
  });

  await t.test('converts a thrown error into a failed result (never rejects)', async () => {
    const boom = { name: 'Boom', run: async () => { throw new Error('kaboom'); } };
    const res = await runScannerWithTimeout(boom, {}, 1000);
    assert.strictEqual(res.success, false);
    assert.match(res.error || '', /kaboom/);
  });
});
