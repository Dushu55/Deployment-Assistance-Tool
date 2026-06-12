import test from 'node:test';
import assert from 'node:assert';
import { garakScanner, runGarak } from './garak.js';
import { runCommand } from '../runner.js';

test('Garak (LLM DAST) scanner', async (t) => {
  await t.test('registers with correct properties', () => {
    assert.strictEqual(garakScanner.name, 'Garak (LLM DAST)');
    assert.strictEqual(garakScanner.module, 'llm');
    assert.deepStrictEqual(garakScanner.requiredBinaries, ['python3']);
  });

  await t.test('no URL → advisory INFO (not a failure)', async () => {
    const r = await runGarak(undefined);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.issues[0].id, 'NO-URL');
  });

  await t.test('restricted/SSRF URL → blocked failure', async () => {
    const r = await runGarak('http://169.254.169.254/latest/meta-data/');
    assert.strictEqual(r.success, false);
    assert.match(r.error || '', /SSRF|restricted|Invalid/i);
  });

  await t.test('missing garak package → graceful skip with an actionable message', async () => {
    // python3 is required; the garak PACKAGE is separate. When it isn't importable, the scanner
    // must skip (advisory), not fail with a confusing "report not generated".
    const importable = (await runCommand('python3', ['-c', 'import garak'], 15000).catch(() => ({ exitCode: 1 }))).exitCode === 0;
    if (importable) { t.skip('garak is installed in this environment'); return; }
    const r = await runGarak('https://app.example.com/llm');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.skipped, true);
    assert.strictEqual(r.issues[0].id, 'GARAK-NOT-INSTALLED');
    assert.match(r.skipReason || '', /not installed/i);
  });
});
