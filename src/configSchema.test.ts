import test from 'node:test';
import assert from 'node:assert';
import { parseConfig } from './configSchema.js';

const base = { scanners: { semgrep: { enabled: true } }, failOn: ['CRITICAL', 'HIGH'] };

test('parseConfig', async (t) => {
  await t.test('accepts a valid config and preserves tool-specific extras', () => {
    const cfg = parseConfig({ scanners: { semgrep: { enabled: true, rules: ['p/x'] }, jest: { enabled: false, threshold: 80 } }, failOn: ['CRITICAL'] });
    assert.strictEqual((cfg.scanners.semgrep as any).enabled, true);
    assert.deepStrictEqual((cfg.scanners.semgrep as any).rules, ['p/x']);
    assert.strictEqual((cfg.scanners as any).jest.threshold, 80);
  });

  await t.test('rejects an invalid failOn severity', () => {
    assert.throws(() => parseConfig({ ...base, failOn: ['NONSENSE'] }), /failOn/);
  });

  await t.test('rejects an unknown llm provider', () => {
    assert.throws(() => parseConfig({ ...base, llm: { provider: 'openai' } }), /llm\.provider/);
  });

  await t.test('rejects a non-boolean scanner.enabled', () => {
    assert.throws(() => parseConfig({ scanners: { semgrep: { enabled: 'yes' } }, failOn: ['HIGH'] }), /enabled/);
  });

  await t.test('rejects a non-positive runner.maxConcurrency', () => {
    assert.throws(() => parseConfig({ ...base, runner: { maxConcurrency: 0 } }), /maxConcurrency/);
  });

  await t.test('accepts runner + verifyCommand + preflight tiers', () => {
    const cfg = parseConfig({ ...base, verifyCommand: 'npm test', runner: { maxConcurrency: 8, scannerTimeoutMs: 30000 }, preflight: { required: ['dockerfile'], highlyAdvised: ['iac'] } });
    assert.strictEqual(cfg.verifyCommand, 'npm test');
    assert.strictEqual(cfg.runner?.maxConcurrency, 8);
  });

  await t.test('aggregates multiple errors into one message', () => {
    try {
      parseConfig({ scanners: { semgrep: { enabled: 1 } }, failOn: ['X'], llm: { provider: 'z' } });
      assert.fail('expected throw');
    } catch (e: any) {
      assert.match(e.message, /Invalid \.dat\.config\.yaml/);
      // at least the failOn and llm.provider issues present
      assert.match(e.message, /failOn/);
      assert.match(e.message, /llm\.provider/);
    }
  });
});
