import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

test('operatorEnv read/write/mask', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dat-openv-'));
  process.env.DAT_HOME = dir;
  // Import AFTER DAT_HOME is set so datHome() resolves to the temp dir.
  const { readOperatorEnv, writeOperatorEnv, maskedOperatorEnv } = await import('./operatorEnv.js');

  await t.test('writes known keys, ignores unknown ones', () => {
    writeOperatorEnv({ NEON_API_KEY: 'neon-xyz', GCP_PROJECT_ID: 'proj-1', TOTALLY_UNKNOWN: 'nope' });
    const env = readOperatorEnv();
    assert.strictEqual(env.NEON_API_KEY, 'neon-xyz');
    assert.strictEqual(env.GCP_PROJECT_ID, 'proj-1');
    assert.strictEqual(env.TOTALLY_UNKNOWN, undefined, 'unknown keys must not be persisted');
  });

  await t.test('file is owner-only (0600)', () => {
    const mode = fs.statSync(path.join(dir, '.env')).mode & 0o777;
    assert.strictEqual(mode, 0o600);
  });

  await t.test('mask reports set/unset without leaking values', () => {
    const masked = maskedOperatorEnv();
    const neon = masked.find((m) => m.key === 'NEON_API_KEY');
    const sonar = masked.find((m) => m.key === 'SONAR_TOKEN');
    assert.strictEqual(neon?.set, true);
    assert.strictEqual(sonar?.set, false);
    assert.ok(!('value' in (neon as object)), 'masked settings must not include the value');
  });

  await t.test('detects a credential from process.env (source=env)', () => {
    process.env.SONAR_TOKEN = 'from-process-env';
    const sonar = maskedOperatorEnv().find((m) => m.key === 'SONAR_TOKEN');
    assert.strictEqual(sonar?.set, true);
    assert.strictEqual(sonar?.source, 'env');
    delete process.env.SONAR_TOKEN;
  });

  await t.test('empty value deletes the key, others preserved', () => {
    writeOperatorEnv({ NEON_API_KEY: '' });
    const env = readOperatorEnv();
    assert.strictEqual(env.NEON_API_KEY, undefined);
    assert.strictEqual(env.GCP_PROJECT_ID, 'proj-1');
  });

  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.DAT_HOME;
});
