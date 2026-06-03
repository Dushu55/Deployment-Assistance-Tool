import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NeonProvisioner } from './neon.js';
import { createProvisioner } from './provisioner.js';
import { detectMigrateCommand } from './migrate.js';

// Mocked Neon API: records calls, returns a project + connection URI on create.
function neonStub() {
  const calls: { method: string; url: string }[] = [];
  const fetchFn = (async (url: any, init: any) => {
    calls.push({ method: init?.method, url: String(url) });
    if (init?.method === 'POST') {
      return new Response(JSON.stringify({
        project: { id: 'proj-abc' },
        connection_uris: [{ connection_uri: 'postgres://u:pw@ep-x.aws.neon.tech/neondb?sslmode=require' }]
      }), { status: 201 });
    }
    return new Response(null, { status: 200 }); // DELETE
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

test('NeonProvisioner', async (t) => {
  await t.test('provisions a postgres URL and tears down by project id', async () => {
    const { calls, fetchFn } = neonStub();
    const p = new NeonProvisioner({ apiKey: 'k', fetchFn });
    const db = await p.provision('postgres');
    assert.strictEqual(db.databaseUrl, 'postgres://u:pw@ep-x.aws.neon.tech/neondb?sslmode=require');
    assert.strictEqual(db.handle, 'proj-abc');
    assert.ok(calls.some(c => c.method === 'POST' && c.url.endsWith('/projects')));

    await p.teardown(db.handle);
    assert.ok(calls.some(c => c.method === 'DELETE' && c.url.endsWith('/projects/proj-abc')));
  });

  await t.test('includes org_id in the create body when configured (org-scoped accounts)', async () => {
    let body: any = null;
    const fetchFn = (async (_url: any, init: any) => {
      if (init?.method === 'POST') body = JSON.parse(init.body);
      return new Response(JSON.stringify({ project: { id: 'p1' }, connection_uris: [{ connection_uri: 'postgres://x' }] }), { status: 201 });
    }) as unknown as typeof fetch;
    const p = new NeonProvisioner({ apiKey: 'k', orgId: 'org-xyz', fetchFn });
    await p.provision('postgres');
    assert.strictEqual(body.project.org_id, 'org-xyz');
  });

  await t.test('omits org_id when not configured', async () => {
    delete process.env.NEON_ORG_ID; // hermetic: don't inherit an ambient org id from the environment
    let body: any = null;
    const fetchFn = (async (_url: any, init: any) => {
      if (init?.method === 'POST') body = JSON.parse(init.body);
      return new Response(JSON.stringify({ project: { id: 'p1' }, connection_uris: [{ connection_uri: 'postgres://x' }] }), { status: 201 });
    }) as unknown as typeof fetch;
    const p = new NeonProvisioner({ apiKey: 'k', fetchFn });
    await p.provision('postgres');
    assert.ok(!('org_id' in body.project));
  });

  await t.test('refuses non-postgres engines', async () => {
    const { fetchFn } = neonStub();
    const p = new NeonProvisioner({ apiKey: 'k', fetchFn });
    await assert.rejects(() => p.provision('mysql'), /Postgres only/);
  });

  await t.test('requires an API key', async () => {
    delete process.env.NEON_API_KEY;
    const { fetchFn } = neonStub();
    const p = new NeonProvisioner({ fetchFn });
    await assert.rejects(() => p.provision('postgres'), /NEON_API_KEY is not set/);
  });

  await t.test('teardown never throws on API failure', async () => {
    const fetchFn = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const p = new NeonProvisioner({ apiKey: 'k', fetchFn });
    await assert.doesNotReject(() => p.teardown('proj-x'));
  });
});

test('createProvisioner factory', async (t) => {
  await t.test('manual → null (no auto-provisioning)', () => {
    assert.strictEqual(createProvisioner({ provider: 'manual' }), null);
  });
  await t.test('autoProvision:false → null even for neon', () => {
    assert.strictEqual(createProvisioner({ provider: 'neon', autoProvision: false }), null);
  });
  await t.test('selects neon and cloudsql by provider', () => {
    assert.strictEqual(createProvisioner({ provider: 'neon' })?.name, 'neon');
    assert.strictEqual(createProvisioner({ provider: 'cloudsql' })?.name, 'cloudsql');
  });
});

test('detectMigrateCommand', async (t) => {
  const mk = (files: string[]) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dat-mig-'));
    for (const f of files) {
      fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), '');
    }
    return dir;
  };
  await t.test('prisma → migrate deploy', () => {
    assert.strictEqual(detectMigrateCommand(mk(['prisma/schema.prisma'])), 'npx prisma migrate deploy');
  });
  await t.test('drizzle → drizzle-kit migrate', () => {
    assert.strictEqual(detectMigrateCommand(mk(['drizzle.config.ts'])), 'npx drizzle-kit migrate');
  });
  await t.test('unknown stack → null', () => {
    assert.strictEqual(detectMigrateCommand(mk(['package.json'])), null);
  });
});
