import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ComponentGraph, ComponentNode, ComponentEdge } from '../../components/types.js';
import { evaluateComponentGraph } from './index.js';
import { buildComponentModel } from '../../components/builder.js';

function graphOf(nodes: ComponentNode[], edges: ComponentEdge[] = []): ComponentGraph {
  return {
    schemaVersion: '1.0', generatedAt: 'T', ecosystem: { frontend: [], backend: [], iac: [] },
    nodes, edges, coverage: []
  };
}
function node(kind: any, attributes: any, id = `${kind}:f:1:0`): ComponentNode {
  return { id, kind, label: `${kind} x`, location: { file: 'f.ts', line: 1 }, attributes };
}
const ids = (g: ComponentGraph) => evaluateComponentGraph(g).issues.map(i => i.id);

test('endpoint rules', async (t) => {
  await t.test('unauth state-changing SENSITIVE endpoint -> HIGH security', () => {
    const r = evaluateComponentGraph(graphOf([node('ApiEndpoint', { method: 'POST', path: '/api/admin/users', isStateChanging: true, hasAuthMiddleware: false })]));
    const f = r.issues.find(i => i.id === 'COMP-ENDPOINT-NOAUTH')!;
    assert.ok(f); assert.strictEqual(f.severity, 'HIGH'); assert.strictEqual(f.category, 'security');
  });
  await t.test('unauth state-changing NON-sensitive endpoint -> MEDIUM (advisory, not gate-blocking)', () => {
    const f = evaluateComponentGraph(graphOf([node('ApiEndpoint', { method: 'POST', path: '/api/orders', isStateChanging: true, hasAuthMiddleware: false })])).issues.find(i => i.id === 'COMP-ENDPOINT-NOAUTH')!;
    assert.ok(f); assert.strictEqual(f.severity, 'MEDIUM');
  });
  await t.test('intentionally-public auth endpoint (login) is NOT flagged for no-auth', () => {
    assert.ok(!ids(graphOf([node('ApiEndpoint', { method: 'POST', path: '/api/auth/login', isStateChanging: true, hasAuthMiddleware: false })])).includes('COMP-ENDPOINT-NOAUTH'));
  });
  await t.test('authenticated endpoint is silent', () => {
    assert.ok(!ids(graphOf([node('ApiEndpoint', { method: 'POST', path: '/api/admin/x', isStateChanging: true, hasAuthMiddleware: true })])).includes('COMP-ENDPOINT-NOAUTH'));
  });
  await t.test('ANY method flagged', () => {
    assert.ok(ids(graphOf([node('ApiEndpoint', { method: 'ANY', isStateChanging: false, hasAuthMiddleware: true })])).includes('COMP-ENDPOINT-ANY-MUTATING'));
  });
});

test('apiCall rules', async (t) => {
  await t.test('mutating call without error handling + without timeout', () => {
    const found = ids(graphOf([node('ApiCall', { method: 'POST', url: '/x', hasErrorHandling: false, hasTimeout: false, hasAuthHeader: true })]));
    assert.ok(found.includes('COMP-APICALL-NO-ERROR-HANDLING'));
    assert.ok(found.includes('COMP-APICALL-NO-TIMEOUT'));
  });
  await t.test('GET call with error handling + timeout is silent', () => {
    const found = ids(graphOf([node('ApiCall', { method: 'GET', url: '/x', hasErrorHandling: true, hasTimeout: true, hasAuthHeader: true })]));
    assert.deepStrictEqual(found, []);
  });
});

test('input/form/button rules', async (t) => {
  await t.test('input with no validation -> robustness', () => {
    const f = evaluateComponentGraph(graphOf([node('Input', { inputType: 'text', validation: {} })])).issues.find(i => i.id === 'COMP-INPUT-NO-VALIDATION')!;
    assert.ok(f); assert.strictEqual(f.category, 'robustness');
  });
  await t.test('validated input is silent', () => {
    assert.deepStrictEqual(ids(graphOf([node('Input', { inputType: 'text', validation: { required: true, maxLength: true } })])), []);
  });
  await t.test('password without maxLength flagged', () => {
    assert.ok(ids(graphOf([node('Input', { inputType: 'password', validation: { required: true } })])).includes('COMP-INPUT-PASSWORD-NO-MAXLEN'));
  });
  await t.test('form with no handler -> fail-safe', () => {
    const f = evaluateComponentGraph(graphOf([node('Form', { hasOnSubmit: false, hasAction: false })])).issues.find(i => i.id === 'COMP-FORM-NO-HANDLER')!;
    assert.ok(f); assert.strictEqual(f.category, 'fail-safe');
  });
  await t.test('submit button with a form handler in same file is silent', () => {
    const g = graphOf([
      node('Form', { hasOnSubmit: true, hasAction: false }, 'Form:f:1:0'),
      node('Button', { isSubmit: true, hasOnClick: false }, 'Button:f:2:1')
    ]);
    assert.ok(!ids(g).includes('COMP-BUTTON-SUBMIT-NO-FORM'));
  });
});

test('network rules', async (t) => {
  await t.test('sensitive port open to world -> CRITICAL', () => {
    const f = evaluateComponentGraph(graphOf([node('NetworkResource', { name: 'sg', openToWorld: true, exposesSensitivePort: true, ingressPorts: [22] })])).issues.find(i => i.id === 'COMP-NET-SENSITIVE-PORT')!;
    assert.ok(f); assert.strictEqual(f.severity, 'CRITICAL'); assert.strictEqual(f.category, 'security');
  });
  await t.test('open-to-world (non-sensitive) -> MEDIUM, not double-flagged', () => {
    const found = ids(graphOf([node('NetworkResource', { name: 'sg', openToWorld: true, exposesSensitivePort: false, ingressPorts: [443] })]));
    assert.ok(found.includes('COMP-NET-OPEN-WORLD'));
    assert.ok(!found.includes('COMP-NET-SENSITIVE-PORT'));
  });
});

test('cross-stack auth-mismatch (walks calls edges)', async (t) => {
  await t.test('bearer-style call without an Authorization header IS flagged', () => {
    const g = graphOf(
      [
        node('ApiCall', { method: 'GET', url: 'https://api.other.com/me', hasErrorHandling: true, hasTimeout: true, hasAuthHeader: false, hasCookieAuth: false }, 'ApiCall:web:1:0'),
        node('ApiEndpoint', { method: 'GET', path: '/api/me', hasAuthMiddleware: true, isStateChanging: false }, 'ApiEndpoint:srv:1:1')
      ],
      [{ from: 'ApiCall:web:1:0', to: 'ApiEndpoint:srv:1:1', kind: 'calls' }]
    );
    const f = evaluateComponentGraph(g).issues.find(i => i.id === 'COMP-CROSSSTACK-AUTH-MISMATCH')!;
    assert.ok(f); assert.strictEqual(f.category, 'coherence');
  });

  await t.test('same-origin cookie-authenticated call is NOT a false mismatch', () => {
    const g = graphOf(
      [
        node('ApiCall', { method: 'PATCH', url: '/api/admin/orders/1', hasErrorHandling: true, hasTimeout: true, hasAuthHeader: false, hasCookieAuth: true }, 'ApiCall:web:1:0'),
        node('ApiEndpoint', { method: 'PATCH', path: '/api/admin/orders/:param', hasAuthMiddleware: true, isStateChanging: true }, 'ApiEndpoint:srv:1:1')
      ],
      [{ from: 'ApiCall:web:1:0', to: 'ApiEndpoint:srv:1:1', kind: 'calls' }]
    );
    assert.ok(!evaluateComponentGraph(g).issues.some(i => i.id === 'COMP-CROSSSTACK-AUTH-MISMATCH'));
  });
});

test('integration: buildComponentModel -> evaluateComponentGraph', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dat-eval-'));
  fs.mkdirSync(path.join(dir, 'web'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'infra'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'server.ts'), `app.post('/api/transfer', (req,res)=>res.json({}));`);
  fs.writeFileSync(path.join(dir, 'web', 'Form.tsx'),
    `export const F = () => { fetch('/api/transfer', { method: 'POST' }); return <input name="amt" />; };`);
  fs.writeFileSync(path.join(dir, 'infra', 'sg.tf'),
    `resource "aws_security_group" "g" { ingress { from_port = 22 to_port = 22 cidr_blocks = ["0.0.0.0/0"] } }`);

  const graph = buildComponentModel(dir, { timestamp: 'T', detectedLanguages: ['node'] });
  const found = evaluateComponentGraph(graph).issues.map(i => i.id);
  fs.rmSync(dir, { recursive: true, force: true });

  await t.test('flags the unauth endpoint, fragile call, world-open SSH, and unvalidated input', () => {
    assert.ok(found.includes('COMP-ENDPOINT-NOAUTH'), 'unauth POST endpoint');
    assert.ok(found.includes('COMP-APICALL-NO-TIMEOUT'), 'fetch without timeout');
    assert.ok(found.includes('COMP-NET-SENSITIVE-PORT'), 'SSH open to world');
    assert.ok(found.includes('COMP-INPUT-NO-VALIDATION'), 'input without validation');
  });
});
