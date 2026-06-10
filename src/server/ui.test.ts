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
});
