import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { loadConfig } from './config.js';

test('Config Loader', async (t) => {
  await t.test('should load default config when file does not exist', () => {
    const config = loadConfig('non-existent.yaml');
    assert.strictEqual(config.scanners.semgrep?.enabled, true);
    assert.deepStrictEqual(config.failOn, ['CRITICAL', 'HIGH']);
  });

  await t.test('should deeply merge user config with defaults', () => {
    // Create a temporary mock config
    const tempConfigPath = '.test.config.yaml';
    const mockYaml = `
scanners:
  semgrep:
    enabled: false
  hadolint:
    enabled: true
failOn:
  - CRITICAL
`;
    fs.writeFileSync(tempConfigPath, mockYaml);

    try {
      const config = loadConfig(tempConfigPath);
      // User override applied
      assert.strictEqual(config.scanners.semgrep?.enabled, false);
      // Nested default rule kept intact
      assert.deepStrictEqual(config.scanners.semgrep?.rules, ['p/security-audit']);
      // Fallback defaults retained
      assert.strictEqual(config.scanners.trivy?.enabled, true);
      // Array override applied
      assert.deepStrictEqual(config.failOn, ['CRITICAL']);
    } finally {
      // Cleanup
      fs.unlinkSync(tempConfigPath);
    }
  });

  await t.test('FAIL-FAST: malformed YAML throws (a present-but-broken config is not silently ignored)', () => {
    const tempConfigPath = '.malformed.config.yaml';
    fs.writeFileSync(tempConfigPath, `
scanners:
  semgrep:
    enabled: true
    - broken_array: [
      : invalid
failOn: CRITICAL
`);
    try {
      assert.throws(() => loadConfig(tempConfigPath), /invalid YAML|Invalid \.dat\.config/);
    } finally {
      fs.unlinkSync(tempConfigPath);
    }
  });

  await t.test('FAIL-FAST: invalid enum value throws a readable schema error', () => {
    const tempConfigPath = '.badenum.config.yaml';
    fs.writeFileSync(tempConfigPath, `failOn:\n  - NONSENSE\n`);
    try {
      assert.throws(() => loadConfig(tempConfigPath), /Invalid \.dat\.config\.yaml[\s\S]*failOn/);
    } finally {
      fs.unlinkSync(tempConfigPath);
    }
  });
});
