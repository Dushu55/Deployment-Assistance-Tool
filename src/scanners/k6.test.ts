import test from 'node:test';
import assert from 'node:assert';
import { evaluateK6Summary, k6Scanner } from './k6.js';

const TARGET = 'https://example.run.app';
const mk = (passRate: number | undefined, p95: number | undefined) => ({
  metrics: {
    ...(p95 !== undefined ? { http_req_duration: { 'p(95)': p95 } } : {}),
    ...(passRate !== undefined ? { checks: { value: passRate } } : {}),
  },
});

test('k6 scanner registration', () => {
  assert.strictEqual(k6Scanner.name, 'k6 Load Test');
  assert.strictEqual(k6Scanner.module, 'testing');
});

test('evaluateK6Summary', async (t) => {
  await t.test('majority-failing target → TARGET-UNREACHABLE, and NO phantom latency finding', () => {
    const issues = evaluateK6Summary(mk(0, 3390), { thresholdMs: 500, targetUrl: TARGET });
    const ids = issues.map(i => i.id);
    assert.deepStrictEqual(ids, ['TARGET-UNREACHABLE']);
    assert.ok(!ids.includes('HIGH-LATENCY-P95'), 'latency on error responses must be suppressed');
    assert.strictEqual(issues[0].severity, 'HIGH');
    assert.strictEqual(issues[0].category, 'robustness');
  });

  await t.test('healthy target with high latency → HIGH-LATENCY-P95 (no unreachable, no checks-failed)', () => {
    const issues = evaluateK6Summary(mk(1, 800), { thresholdMs: 500, targetUrl: TARGET });
    const ids = issues.map(i => i.id);
    assert.deepStrictEqual(ids, ['HIGH-LATENCY-P95']);
    assert.strictEqual(issues[0].severity, 'HIGH');
  });

  await t.test('healthy fast target → LATENCY-OK (INFO only)', () => {
    const issues = evaluateK6Summary(mk(1, 120), { thresholdMs: 500, targetUrl: TARGET });
    assert.deepStrictEqual(issues.map(i => i.id), ['LATENCY-OK']);
    assert.strictEqual(issues[0].severity, 'INFO');
  });

  await t.test('partial failure (mostly up) → HTTP-CHECKS-FAILED AND latency still evaluated', () => {
    const issues = evaluateK6Summary(mk(0.9, 800), { thresholdMs: 500, targetUrl: TARGET });
    const ids = issues.map(i => i.id);
    assert.ok(ids.includes('HTTP-CHECKS-FAILED'));
    assert.ok(ids.includes('HIGH-LATENCY-P95'));
    assert.ok(!ids.includes('TARGET-UNREACHABLE'));
  });

  await t.test('probe status is threaded into the message', () => {
    const issues = evaluateK6Summary(mk(0, 3390), { thresholdMs: 500, targetUrl: TARGET, probeStatus: 403 });
    assert.match(issues[0].message, /HTTP 403/);
  });
});
