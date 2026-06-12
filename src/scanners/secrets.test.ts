import test from 'node:test';
import assert from 'node:assert';
import { gitleaksScanner, isBuildArtifactPath } from './secrets.js';

test('Gitleaks Scanner Adapter', async (t) => {
  await t.test('should register with correct properties', () => {
    assert.strictEqual(gitleaksScanner.name, 'Gitleaks (Secrets)');
    assert.strictEqual(gitleaksScanner.module, 'security');
  });
});

test('Gitleaks build-artifact filter', async (t) => {
  await t.test('treats build/dependency output dirs as artifacts (filtered out)', () => {
    for (const f of [
      '.next/cache/.previewinfo',
      '.next/standalone/.env',
      'node_modules/x/index.js',
      'dist/bundle.js',
      'coverage/lcov.info',
      'app/.next/server/x',
    ]) {
      assert.strictEqual(isBuildArtifactPath(f), true, `${f} should be an artifact`);
    }
  });

  await t.test('keeps real source files (and a top-level .env — gitignore handles that separately)', () => {
    for (const f of ['src/app/api/orders/route.ts', 'lib/db.ts', '.env', 'config/settings.py']) {
      assert.strictEqual(isBuildArtifactPath(f), false, `${f} should NOT be an artifact`);
    }
    assert.strictEqual(isBuildArtifactPath(undefined), false);
  });
});
