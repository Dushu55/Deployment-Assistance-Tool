import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

test('buildSecretsPlan classifies app env + operator needs', async (t) => {
  // Clean operator store so credential `set` flags are deterministic.
  process.env.DAT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dat-home-'));
  const { buildSecretsPlan } = await import('./secretsPlan.js');
  const { __setGcloudCache } = await import('./gcloud.js');
  // Pin gcloud to "not configured" so GCP detection doesn't depend on the host.
  __setGcloudCache({ account: null, project: null });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dat-target-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { pg: '^8' } }));
  fs.writeFileSync(path.join(dir, '.env.example'),
    'DATABASE_URL=\nAUTH_SECRET=\nSTRIPE_SECRET_KEY=\nNODE_ENV=production\nADMIN_PASSWORD=\n');

  await t.test('classifies each key for a deploy run', () => {
    const plan = buildSecretsPlan(dir, { deploy: true });
    const kind: Record<string, string> = {};
    for (const s of plan.appSecrets) kind[s.key] = s.kind;
    assert.strictEqual(kind.DATABASE_URL, 'auto-db', 'DB url auto-provisioned (pg detected)');
    assert.strictEqual(kind.AUTH_SECRET, 'auto-auth', 'auth secret auto-generated');
    assert.strictEqual(kind.STRIPE_SECRET_KEY, 'required', 'third-party secret must be asked');
    assert.strictEqual(kind.NODE_ENV, 'config', 'non-secret config not asked');
    assert.strictEqual(kind.ADMIN_PASSWORD, 'required');
    assert.ok(plan.hasEnvExample);
    assert.ok(plan.needsDocker, 'deploy DAST needs Docker');
  });

  await t.test('operator credentials required for deploy, flagged unset (no gcloud)', () => {
    const plan = buildSecretsPlan(dir, { deploy: true });
    const neon = plan.operator.find((o) => o.key === 'NEON_API_KEY');
    const gcp = plan.operator.find((o) => o.key === 'GCP_PROJECT_ID');
    assert.ok(neon && neon.required && neon.set === false);
    assert.ok(gcp && gcp.required && gcp.set === false);
  });

  await t.test('GCP counts as set when gcloud is authed with a project', () => {
    __setGcloudCache({ account: 'me@example.com', project: 'proj-x' });
    const plan = buildSecretsPlan(dir, { deploy: true });
    const gcp = plan.operator.find((o) => o.key === 'GCP_PROJECT_ID');
    assert.ok(gcp && gcp.set === true);
    assert.strictEqual(gcp.detail, 'gcloud: proj-x');
    __setGcloudCache({ account: null, project: null });
  });

  await t.test('no deploy → no operator creds, no Docker', () => {
    const plan = buildSecretsPlan(dir, { deploy: false });
    assert.strictEqual(plan.operator.length, 0);
    assert.strictEqual(plan.needsDocker, false);
  });

  await t.test('missing .env.example reported', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'dat-empty-'));
    fs.writeFileSync(path.join(empty, 'package.json'), '{}');
    assert.strictEqual(buildSecretsPlan(empty, { deploy: true }).hasEnvExample, false);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(process.env.DAT_HOME, { recursive: true, force: true });
  delete process.env.DAT_HOME;
});
