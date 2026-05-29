import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildComponentModel, normalizeCallPath, linkCallsToEndpoints, locateComponent } from './builder.js';
import { ComponentNode } from './types.js';

function tmpWorkspace(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dat-model-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

test('normalizeCallPath', () => {
  assert.strictEqual(normalizeCallPath('https://api.example.com/api/users/123?x=1'), '/api/users/:param');
  assert.strictEqual(normalizeCallPath('/api/orders'), '/api/orders');
  assert.strictEqual(normalizeCallPath('/api/users/${id}'), '/api/users/:param');
  assert.strictEqual(normalizeCallPath(null), null);
});

test('linkCallsToEndpoints', () => {
  const nodes: ComponentNode[] = [
    { id: 'ApiCall:a:1:0', kind: 'ApiCall', label: 'GET /api/users/5', location: { file: 'a', line: 1 }, attributes: { method: 'GET', url: '/api/users/5' } },
    { id: 'ApiEndpoint:b:1:1', kind: 'ApiEndpoint', label: 'GET /api/users/:param', location: { file: 'b', line: 1 }, attributes: { method: 'GET', path: '/api/users/:param' } },
    { id: 'ApiEndpoint:b:2:2', kind: 'ApiEndpoint', label: 'POST /api/users/:param', location: { file: 'b', line: 2 }, attributes: { method: 'POST', path: '/api/users/:param' } }
  ];
  const edges = linkCallsToEndpoints(nodes);
  assert.strictEqual(edges.length, 1);
  assert.deepStrictEqual(edges[0], { from: 'ApiCall:a:1:0', to: 'ApiEndpoint:b:1:1', kind: 'calls' });
});

test('buildComponentModel end-to-end', async (t) => {
  const dir = tmpWorkspace({
    'web/Page.tsx': `export const P = () => <button onClick={() => fetch('/api/orders/42', { method: 'GET' })}>Go</button>;`,
    'server/routes.ts': `app.get('/api/orders/:id', requireAuth, handler);`,
    'infra/main.tf': `resource "aws_security_group" "g" { ingress { from_port = 22 to_port = 22 cidr_blocks = ["0.0.0.0/0"] } }`
  });

  const graph = buildComponentModel(dir, { timestamp: '2026-05-30T00:00:00.000Z', detectedLanguages: ['node'] });
  fs.rmSync(dir, { recursive: true, force: true });

  await t.test('aggregates nodes across all three extractors', () => {
    assert.ok(graph.nodes.some(n => n.kind === 'Button'));
    assert.ok(graph.nodes.some(n => n.kind === 'ApiCall'));
    assert.ok(graph.nodes.some(n => n.kind === 'ApiEndpoint'));
    assert.ok(graph.nodes.some(n => n.kind === 'NetworkResource'));
  });

  await t.test('records ecosystem and per-extractor coverage', () => {
    assert.deepStrictEqual(graph.ecosystem.frontend, ['react']);
    assert.deepStrictEqual(graph.ecosystem.backend, ['rest']);
    assert.deepStrictEqual(graph.ecosystem.iac, ['terraform']);
    assert.strictEqual(graph.coverage.length, 3);
  });

  await t.test('links the UI call to the backend endpoint across the stack', () => {
    const calls = graph.edges.filter(e => e.kind === 'calls');
    assert.strictEqual(calls.length, 1, 'GET /api/orders/42 should link to GET /api/orders/:id');
  });

  await t.test('locateComponent maps a finding line to the nearest node in-file', () => {
    const tf = graph.nodes.find(n => n.kind === 'NetworkResource')!;
    assert.strictEqual(locateComponent(graph, tf.location.file, (tf.location.line ?? 1) + 5), tf.id);
    assert.strictEqual(locateComponent(graph, 'nonexistent.ts', 1), null);
  });
});
