import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractApiEndpoints, normalizePath } from './api.js';

function tmpWorkspace(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dat-api-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

test('normalizePath', () => {
  assert.strictEqual(normalizePath('/api/users/:id'), '/api/users/:param');
  assert.strictEqual(normalizePath('/api/users/[id]'), '/api/users/:param');
  assert.strictEqual(normalizePath('/api/users/'), '/api/users');
});

test('extractApiEndpoints', async (t) => {
  const dir = tmpWorkspace({
    'server.ts': `
      const app = express();
      app.get('/api/profile', requireAuth, (req, res) => res.json({}));
      app.post('/api/login', (req, res) => res.json({}));
      router.delete('/api/users/:id', isAuthenticated, handler);
    `,
    'app/api/orders/route.ts': `
      import { getServerSession } from 'next-auth';
      export async function GET() {}
      export async function POST() {}
    `,
    'pages/api/health.ts': `export default function handler(req, res) { res.end('ok'); }`
  });

  const result = extractApiEndpoints(dir);
  const eps = result.nodes;
  fs.rmSync(dir, { recursive: true, force: true });

  await t.test('extracts Express routes with method and path', () => {
    const login = eps.find(n => n.attributes.path === '/api/login' && n.attributes.method === 'POST');
    assert.ok(login, 'POST /api/login should be found');
    assert.strictEqual(login!.attributes.isStateChanging, true);
  });

  await t.test('infers auth middleware from identifier hints', () => {
    const profile = eps.find(n => n.attributes.path === '/api/profile');
    assert.strictEqual(profile!.attributes.hasAuthMiddleware, true);
    const login = eps.find(n => n.attributes.path === '/api/login');
    assert.strictEqual(login!.attributes.hasAuthMiddleware, false); // /api/login path must NOT trigger auth hint
  });

  await t.test('extracts Next app-router handlers per method', () => {
    const get = eps.find(n => n.attributes.path === '/api/orders' && n.attributes.method === 'GET');
    const post = eps.find(n => n.attributes.path === '/api/orders' && n.attributes.method === 'POST');
    assert.ok(get && post);
    assert.strictEqual(get!.attributes.hasAuthMiddleware, true); // getServerSession present
  });

  await t.test('extracts Next pages/api default export', () => {
    const health = eps.find(n => n.attributes.path === '/api/health');
    assert.ok(health);
    assert.strictEqual(health!.attributes.method, 'ANY');
  });
});
