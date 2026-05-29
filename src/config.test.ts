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

  await t.test('FAULT TOLERANCE: should safely fallback to defaults if YAML is malformed', () => {
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
      const config = loadConfig(tempConfigPath);
      // Should gracefully fall back to DEFAULT_CONFIG without crashing
      assert.strictEqual(config.scanners.trivy?.enabled, true);
      assert.deepStrictEqual(config.failOn, ['CRITICAL', 'HIGH']);
    } finally {
      fs.unlinkSync(tempConfigPath);
    }
  });
});
