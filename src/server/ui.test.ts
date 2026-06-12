import test from 'node:test';
import assert from 'node:assert';
import { createUiHandler } from './ui.js';

const TOKEN = 'a'.repeat(48);

function invoke(req: { method: string; url: string; headers: Record<string, string> }) {
  const handler = createUiHandler(TOKEN);
  let statusCode = 0;
  let body = '';
  const res = {
    writeHead(s: number) { statusCode = s; return res; },
    end(b?: string) { if (b) body = b; },
  } as any;
  return Promise.resolve(handler(req as any, res)).then(() => ({ statusCode, body }));
}

const localHeaders = (extra: Record<string, string> = {}) => ({ host: 'localhost:4737', ...extra });

test('ui auth guard', async (t) => {
  await t.test('GET / serves the SPA (local host, no token needed)', async () => {
    const r = await invoke({ method: 'GET', url: '/', headers: localHeaders() });
    assert.strictEqual(r.statusCode, 200);
    assert.match(r.body, /DAT Control Panel/);
  });

  await t.test('SPA contains the sidebar pages and routes', async () => {
    const r = await invoke({ method: 'GET', url: '/', headers: localHeaders() });
    for (const id of ['page-reports', 'page-report-detail', 'page-scan', 'page-modules', 'page-settings', 'page-help']) {
      assert.ok(r.body.includes(`id="${id}"`), `missing section ${id}`);
    }
    assert.ok(r.body.includes('href="#/reports"'), 'missing reports nav link');
  });

  await t.test('SPA has no leaked template interpolation (escaping regression guard)', async () => {
    const r = await invoke({ method: 'GET', url: '/', headers: localHeaders() });
    assert.ok(!/\$\{/.test(r.body), 'a literal ${ leaked into the rendered SPA — a fragment broke the template-literal escaping rule');
  });

  await t.test('GET /api/modules with token → full catalog', async () => {
    const r = await invoke({ method: 'GET', url: '/api/modules', headers: localHeaders({ 'x-dat-token': TOKEN }) });
    assert.strictEqual(r.statusCode, 200);
    const body = JSON.parse(r.body);
    assert.ok(Array.isArray(body.groups) && body.groups.length === 5);
    assert.ok(body.modules.length >= 29, `expected ≥29 modules, got ${body.modules.length}`);
    const semgrep = body.modules.find((m: any) => m.key === 'semgrep');
    assert.ok(semgrep && semgrep.description && Array.isArray(semgrep.profiles) && semgrep.configSnippet.includes('enabled: true'));
    assert.strictEqual(typeof semgrep.binaries[0].installed, 'boolean');
  });

  await t.test('GET /api/modules without token → 403', async () => {
    const r = await invoke({ method: 'GET', url: '/api/modules', headers: localHeaders() });
    assert.strictEqual(r.statusCode, 403);
  });

  await t.test('GET / from a non-loopback Host → 403 (rebinding guard covers the SPA/report routes too)', async () => {
    const r = await invoke({ method: 'GET', url: '/', headers: { host: 'evil.example.com' } });
    assert.strictEqual(r.statusCode, 403);
  });

  await t.test('malformed URL → 400, not a crash', async () => {
    const r = await invoke({ method: 'GET', url: '/%E0%A4%A', headers: localHeaders() });
    assert.strictEqual(r.statusCode, 400);
  });

  await t.test('GET /api/reports with the correct token + local host → 200', async () => {
    const r = await invoke({ method: 'GET', url: '/api/reports', headers: localHeaders({ 'x-dat-token': TOKEN }) });
    assert.strictEqual(r.statusCode, 200);
  });

  await t.test('missing token → 403', async () => {
    const r = await invoke({ method: 'GET', url: '/api/reports', headers: localHeaders() });
    assert.strictEqual(r.statusCode, 403);
  });

  await t.test('wrong token → 403', async () => {
    const r = await invoke({ method: 'GET', url: '/api/reports', headers: localHeaders({ 'x-dat-token': 'b'.repeat(48) }) });
    assert.strictEqual(r.statusCode, 403);
  });

  await t.test('non-loopback Host → 403 (DNS-rebinding guard)', async () => {
    const r = await invoke({ method: 'GET', url: '/api/reports', headers: { host: 'evil.example.com', 'x-dat-token': TOKEN } });
    assert.strictEqual(r.statusCode, 403);
  });

  await t.test('cross-origin Origin → 403 (CSRF guard)', async () => {
    const r = await invoke({ method: 'GET', url: '/api/reports', headers: localHeaders({ 'x-dat-token': TOKEN, origin: 'http://evil.example.com' }) });
    assert.strictEqual(r.statusCode, 403);
  });

  await t.test('unknown /api endpoint with valid auth → 404', async () => {
    const r = await invoke({ method: 'GET', url: '/api/nope', headers: localHeaders({ 'x-dat-token': TOKEN }) });
    assert.strictEqual(r.statusCode, 404);
  });

  await t.test('GET /api/findings for a missing report → 404 (no sidecar)', async () => {
    const r = await invoke({ method: 'GET', url: '/api/findings?file=nope.html', headers: localHeaders({ 'x-dat-token': TOKEN }) });
    assert.strictEqual(r.statusCode, 404);
  });

  await t.test('GET /api/findings without a token → 403', async () => {
    const r = await invoke({ method: 'GET', url: '/api/findings?file=nope.html', headers: localHeaders() });
    assert.strictEqual(r.statusCode, 403);
  });
});
