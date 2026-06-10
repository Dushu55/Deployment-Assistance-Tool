import test from 'node:test';
import assert from 'node:assert';
import { classifyLine } from './scanRunner.js';

test('classifyLine parses scan stdout markers', async (t) => {
  await t.test('scanner running', () => {
    assert.deepStrictEqual(classifyLine('➜ Running Semgrep...'), { type: 'scanner', name: 'Semgrep', state: 'running' });
  });
  await t.test('scanner skipped (missing tool)', () => {
    assert.deepStrictEqual(
      classifyLine('⤼ Skipping Gitleaks (Secrets) — Required tool(s) not found on PATH: gitleaks'),
      { type: 'scanner', name: 'Gitleaks (Secrets)', state: 'skipped' });
  });
  await t.test('readiness score (leading whitespace)', () => {
    assert.deepStrictEqual(classifyLine('   Deployment Readiness Score: 42/100'), { type: 'score', score: 42 });
  });
  await t.test('gate fail / pass', () => {
    assert.deepStrictEqual(classifyLine('❌ Quality Gate Failed.'), { type: 'gate', gate: 'fail' });
    assert.deepStrictEqual(classifyLine('✅ Quality Gate Passed.'), { type: 'gate', gate: 'pass' });
  });
  await t.test('published report → basename only', () => {
    assert.deepStrictEqual(
      classifyLine('📰 Report published: http://localhost:4737/r/bakery_shop-20260608-120113.html  (run `dat serve` to view)'),
      { type: 'report', file: 'bakery_shop-20260608-120113.html' });
  });
  await t.test('strips ANSI color codes', () => {
    assert.deepStrictEqual(classifyLine('[36m➜ Running Trivy (FS)...[39m'), { type: 'scanner', name: 'Trivy (FS)', state: 'running' });
  });
  await t.test('ordinary log line → null', () => {
    assert.strictEqual(classifyLine('Executing scanners (concurrency 4, per-scanner timeout 600s)...'), null);
  });
});
